'use strict';

/**
 * DB-backed integration tests for /api/push routes (backlog 999.252).
 *
 * Real test-bed DB (3407) for the push_subscriptions table; JWT mocked.
 * web-push is mocked at the module level so no real push service is contacted —
 * we assert the route/repository behavior (store, remove, vapid-key, test-send).
 *
 * Run:
 *   docker exec ra-mysql-test-default mysql -uroot -prootpass -e \
 *     "DROP DATABASE IF EXISTS juggler_test; CREATE DATABASE juggler_test \
 *      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
 *   DB_HOST=127.0.0.1 DB_PORT=3407 DB_USER=root DB_PASSWORD=rootpass \
 *     DB_NAME=juggler_test REDIS_URL=redis://localhost:6479 \
 *     npx jest tests/api/push.routes.test.js
 */

process.env.NODE_ENV = 'test';

// JWT mock — sets req.user.id like the real middleware.
const TEST_USER = { id: 'push-user-001', email: 'push@test.com', name: 'Push Test', timezone: 'UTC' };
jest.mock('../../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.user = { ...TEST_USER };
    req.auth = { plans: {}, apps: ['juggler'] };
    next();
  },
  verifyToken: jest.fn(),
}));

// Mock web-push so sendPush (via /test) never contacts a real push service.
const mockSendNotification = jest.fn().mockResolvedValue({ statusCode: 201 });
jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: (...args) => mockSendNotification(...args),
}));

// Mock SSE emitter so the in-app path is observable without open clients.
const mockSseEmit = jest.fn();
jest.mock('../../src/lib/sse-emitter', () => ({
  emit: (...args) => mockSseEmit(...args),
  addClient: jest.fn(),
  clientCount: jest.fn(() => 0),
  getStats: jest.fn(() => ({ activeConnections: 0 })),
}));

const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const db = require('../../src/db');
const pushService = require('../../src/lib/push-service');
const { assertDbAvailable } = require('../helpers/requireDB');

const AUTH = { Authorization: 'Bearer test-token' };

function makeApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use('/api/push', require('../../src/routes/push.routes'));
  return app;
}

const SUB_A = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/sub-a',
  keys: { p256dh: 'BPpubkeyA', auth: 'authsecretA' },
};
const SUB_B = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/sub-b',
  keys: { p256dh: 'BPpubkeyB', auth: 'authsecretB' },
};

let app;
let available = false;

beforeAll(async () => {
  await assertDbAvailable();
  available = true;
  app = makeApp();
  await db('push_subscriptions').where('user_id', TEST_USER.id).del();
}, 15000);

afterAll(async () => {
  if (available) {
    await db('push_subscriptions').where('user_id', TEST_USER.id).del();
  }
  await db.destroy();
});

beforeEach(async () => {
  if (!available) return;
  await db('push_subscriptions').where('user_id', TEST_USER.id).del();
  mockSendNotification.mockClear();
  mockSseEmit.mockClear();
  // Default: VAPID configured so /test and vapid-key work.
  process.env.VAPID_PUBLIC_KEY = 'BTestPublicKey';
  process.env.VAPID_PRIVATE_KEY = 'testPrivateKey';
  process.env.VAPID_SUBJECT = 'mailto:test@example.com';
  pushService._resetConfigForTests();
});

describe('GET /api/push/vapid-public-key', () => {
  test('401 without auth', async () => {
    await request(app).get('/api/push/vapid-public-key').expect(401);
  });

  test('returns the public key + enabled:true when configured', async () => {
    const res = await request(app).get('/api/push/vapid-public-key').set(AUTH).expect(200);
    expect(res.body).toEqual({ publicKey: 'BTestPublicKey', enabled: true });
  });

  test('returns enabled:false + null key when VAPID absent', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    pushService._resetConfigForTests();
    const res = await request(app).get('/api/push/vapid-public-key').set(AUTH).expect(200);
    expect(res.body).toEqual({ publicKey: null, enabled: false });
  });
});

describe('POST /api/push/subscribe', () => {
  test('stores a new subscription (201) and persists the row', async () => {
    const res = await request(app).post('/api/push/subscribe').set(AUTH).send(SUB_A).expect(201);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.id).toBe('string');

    const rows = await db('push_subscriptions').where('user_id', TEST_USER.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].endpoint).toBe(SUB_A.endpoint);
    expect(rows[0].p256dh).toBe(SUB_A.keys.p256dh);
    expect(rows[0].auth).toBe(SUB_A.keys.auth);
  });

  test('re-subscribing the same endpoint upserts (200) — no duplicate row', async () => {
    await request(app).post('/api/push/subscribe').set(AUTH).send(SUB_A).expect(201);
    const res = await request(app).post('/api/push/subscribe').set(AUTH)
      .send({ endpoint: SUB_A.endpoint, keys: { p256dh: 'NEWKEY', auth: 'NEWAUTH' } })
      .expect(200);
    expect(res.body.ok).toBe(true);

    const rows = await db('push_subscriptions').where('user_id', TEST_USER.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].p256dh).toBe('NEWKEY'); // keys updated
  });

  test('400 on invalid payload (missing keys)', async () => {
    await request(app).post('/api/push/subscribe').set(AUTH)
      .send({ endpoint: 'https://fcm.googleapis.com/fcm/send/x' }).expect(400);
  });

  test('400 on non-URL endpoint', async () => {
    await request(app).post('/api/push/subscribe').set(AUTH)
      .send({ endpoint: 'not-a-url', keys: { p256dh: 'k', auth: 'a' } }).expect(400);
  });

  // SSRF guard (elmo BLOCK-1, 999.252): endpoints on non-push-service hosts must
  // be rejected so web-push can't be driven to internal/metadata hosts.
  test('400 on disallowed (SSRF) endpoint host', async () => {
    for (const bad of [
      'http://169.254.169.254/latest/meta-data/',
      'https://metadata.google.internal/computeMetadata/v1/',
      'https://evil.example.com/x',
      'http://fcm.googleapis.com/fcm/send/x', // http not https
    ]) {
      await request(app).post('/api/push/subscribe').set(AUTH)
        .send({ endpoint: bad, keys: { p256dh: 'k', auth: 'a' } }).expect(400);
    }
  });
});

describe('POST /api/push/unsubscribe', () => {
  test('removes the matching subscription', async () => {
    await request(app).post('/api/push/subscribe').set(AUTH).send(SUB_A).expect(201);
    await request(app).post('/api/push/subscribe').set(AUTH).send(SUB_B).expect(201);

    const res = await request(app).post('/api/push/unsubscribe').set(AUTH)
      .send({ endpoint: SUB_A.endpoint }).expect(200);
    expect(res.body).toEqual({ ok: true, removed: 1 });

    const rows = await db('push_subscriptions').where('user_id', TEST_USER.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].endpoint).toBe(SUB_B.endpoint);
  });

  test('removed:0 when endpoint not found (idempotent)', async () => {
    const res = await request(app).post('/api/push/unsubscribe').set(AUTH)
      .send({ endpoint: 'https://fcm.googleapis.com/fcm/send/never' }).expect(200);
    expect(res.body).toEqual({ ok: true, removed: 0 });
  });
});

describe('POST /api/push/test (manual test-send)', () => {
  test('fires BOTH the in-app SSE event AND web-push to stored subs', async () => {
    await request(app).post('/api/push/subscribe').set(AUTH).send(SUB_A).expect(201);

    const res = await request(app).post('/api/push/test').set(AUTH)
      .send({ title: 'Hello', body: 'world', url: '/tasks/42', taskId: '42' }).expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.inApp).toBe(true);
    expect(res.body.push.enabled).toBe(true);
    expect(res.body.push.sent).toBe(1);

    // In-app SSE 'reminder' event fired with the payload.
    expect(mockSseEmit).toHaveBeenCalledWith(TEST_USER.id, 'reminder', expect.objectContaining({
      type: 'task-reminder', title: 'Hello', body: 'world', url: '/tasks/42', taskId: '42',
    }));
    // web-push contacted for the stored subscription.
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
  });

  test('still fires in-app even when VAPID absent (push fail-soft)', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    pushService._resetConfigForTests();
    await request(app).post('/api/push/subscribe').set(AUTH).send(SUB_A).expect(201);

    const res = await request(app).post('/api/push/test').set(AUTH).send({ title: 'x' }).expect(200);
    expect(res.body.inApp).toBe(true);
    expect(res.body.push.enabled).toBe(false);
    expect(mockSseEmit).toHaveBeenCalled();
    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});
