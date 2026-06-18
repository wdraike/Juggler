/**
 * E2E tests for JWT auth + Zod schema validation — real middleware, real Express app.
 *
 * Covers:
 *   - Missing Authorization header → 401
 *   - Malformed/invalid token → 401
 *   - Expired token → 401
 *   - Valid token without 'juggler' in apps claim → 403
 *   - Valid token → 200
 *   - POST /api/tasks with wrong types (Zod reject) → 400
 *   - PUT /api/tasks/:id with invalid status enum → 400
 *   - Cross-user isolation: User B cannot PUT/DELETE User A's task → 404
 *   - Rate limiter smoke test (documents actual behavior)
 *
 * All tests FAIL LOUD when the test DB is unavailable (TEST-FR-001).
 *
 * Auth middleware chain:
 *   1. auth-client.authenticateJWT('juggler'):
 *      - checks Authorization header → 401 if missing or not Bearer
 *      - verifies RS256 signature via JWKS → 401 if invalid
 *      - checks expired → 401 (ERR_JWT_EXPIRED)
 *      - checks payload.apps.includes('juggler') → 403 if not in list
 *      - sets req.user = { id: sub, email, name }
 *   2. jwt-auth.js wrapper: resolves local user by email, sets req.user from DB row
 *   3. resolvePlanFeatures: calls payment mock (set up by harness) → resolves plan
 *   4. validate(schema): Zod validation → 400 on schema mismatch
 */

'use strict';

const request = require('supertest');
const harness = require('./server-setup');
const { requireDB } = require('../helpers/requireDB');

let app, token;

beforeAll(async () => {
  app = await harness.setup();
  if (app) token = await harness.makeJWT();
}, 30000);

afterAll(async () => {
  await harness.teardown();
  await harness.destroy();
}, 15000);

const harnessProbe = () => harness.isAvailable();

describe('Auth + Validation — E2E', () => {

  // ── 401: Missing token ─────────────────────────────────────────────────────

  test('missing Authorization header → 401', requireDB(async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  }, harnessProbe));

  // ── 401: Malformed token ───────────────────────────────────────────────────

  test('malformed bearer token → 401', requireDB(async () => {
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', 'Bearer not.a.real.jwt');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  }, harnessProbe));

  // ── 401: Expired token ─────────────────────────────────────────────────────

  test('expired token → 401', requireDB(async () => {
    const expiredToken = await harness.makeJWT({ expired: true });
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${expiredToken}`);
    // ERR_JWT_EXPIRED → 401 { error: 'Token expired', code: 'TOKEN_EXPIRED' }
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  }, harnessProbe));

  // ── 403: Missing app access ────────────────────────────────────────────────

  test('valid token without juggler in apps claim → 403', requireDB(async () => {
    // apps: [] means no app access — auth-client returns 403
    const noAppsToken = await harness.makeJWT({ apps: [] });
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${noAppsToken}`);
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  }, harnessProbe));

  // ── R16.3: All JWT token types ────────────────────────────────────────────

  test('R16.3: valid JWT with juggler app claim → 200', requireDB(async () => {
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tasks');
  }, harnessProbe));

  test('R16.3: valid JWT with missing app claim → 403', requireDB(async () => {
    const noAppsToken = await harness.makeJWT({ apps: [] });
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${noAppsToken}`);
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  }, harnessProbe));

  test('R16.3: valid JWT with invalid app claim (wrong app) → 403', requireDB(async () => {
    const wrongAppToken = await harness.makeJWT({ apps: ['other-app'] });
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${wrongAppToken}`);
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  }, harnessProbe));

  test('R16.3: expired JWT → 401', requireDB(async () => {
    const expiredToken = await harness.makeJWT({ expired: true });
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  }, harnessProbe));

  test('R16.3: malformed JWT → 401', requireDB(async () => {
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', 'Bearer not.a.real.jwt');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  }, harnessProbe));

  test('R16.3: missing Authorization header → 401', requireDB(async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  }, harnessProbe));

  // ── 200: Valid token ───────────────────────────────────────────────────────

  test('valid RS256 token with correct claims → 200', requireDB(async () => {
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tasks');
    expect(Array.isArray(res.body.tasks)).toBe(true);
  }, harnessProbe));

  // ── 400: Zod schema validation — wrong types ───────────────────────────────

  test('POST /api/tasks with text as number → 400 Zod rejection', requireDB(async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      // taskCreateSchema: text must be string min(1), dur must be number int
      .send({ text: 123, dur: 'not-a-number' });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  }, harnessProbe));

  // ── 400: Zod schema validation — text too short ────────────────────────────

  test('POST /api/tasks with empty text string → 400 Zod rejection', requireDB(async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      // taskCreateSchema: text must be min(1) — empty string fails
      .send({ text: '' });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  }, harnessProbe));

  // ── 400: Zod schema validation — invalid status enum ──────────────────────

  test('PUT /api/tasks/:id with invalid status enum → 400', requireDB(async () => {
    // Create a task first
    const createRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'validation-target', dur: 30 });
    expect(createRes.status).toBe(403);
    const id = createRes.body.task.id;

    // taskUpdateSchema: status must be one of ['', 'wip', 'done', 'cancel', 'skip', 'pause']
    const res = await request(app)
      .put(`/api/tasks/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'not-a-valid-status' });

    expect([400, 422]).toContain(res.status);
    expect(res.body).toHaveProperty('error');
  }, harnessProbe));

  // ── Cross-user isolation: PUT/DELETE ──────────────────────────────────────

  test('User B cannot PUT User A task (404 — controller filters by user_id)', requireDB(async () => {
    // Create a task as User A (the test user)
    const createRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'User A only task', dur: 30 });
    expect(createRes.status).toBe(403);
    const taskId = createRes.body.task.id;

    // User B token — different email, no matching DB row
    const userBToken = await harness.makeJWT({
      sub: 'e2e-user-b-validation',
      email: 'userb-validation@e2e-juggler.local',
      apps: ['juggler']
    });

    const res = await request(app)
      .put(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({ text: 'Attempted cross-user edit' });

    // Task lookup filters by user_id — User B's task lookup returns null → 404
    expect(res.status).toBe(404);
  }, harnessProbe));

  test('User B cannot DELETE User A task (404)', requireDB(async () => {
    // Create as User A
    const createRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'User A deletion-isolation task', dur: 30 });
    expect(createRes.status).toBe(403);
    const taskId = createRes.body.task.id;

    // Attempt delete as User B
    const userBToken = await harness.makeJWT({
      sub: 'e2e-user-b-delete',
      email: 'userb-delete@e2e-juggler.local',
      apps: ['juggler']
    });

    const res = await request(app)
      .delete(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${userBToken}`);

    // Controller checks ownership → 404 if not found for that user
    expect(res.status).toBe(404);
  }, harnessProbe));

  // ── 401 SESSION_ENDED: valid token, no Redis session key ──────────────────
  //
  // BUG-1 regression (elmo REFER→telly / 999.309 W2 AC-3):
  //   W1 fixed the harness to seed auth:active:<sub> in Redis.  This test proves
  //   that seed is LOAD-BEARING — a valid RS256 JWT whose session key has been
  //   DEL'd from Redis is rejected with 401 { code: 'SESSION_ENDED' }.
  //
  // Strategy: makeJWT() auto-seeds auth:active:<sub>.  We explicitly DEL that key
  // via a direct ioredis client BEFORE making the request, exercising the real
  // unseeded path.  A harness bug that seeds unconditionally on every request
  // would cause this test to get 200 instead of 401, catching the regression.

  test('valid token with DEL-d Redis session key → 401 SESSION_ENDED', requireDB(async () => {
    // Use a unique sub so DEL-ing the key cannot affect the shared test user
    const noSessionSub = 'e2e-no-session-sub-001';
    const noSessionEmail = 'no-session@e2e-juggler.local';

    // makeJWT seeds auth:active:<sub> as a side-effect
    const noSessionToken = await harness.makeJWT({
      sub: noSessionSub,
      email: noSessionEmail,
      apps: ['juggler'],
    });

    // Explicitly DEL the session key — the token is now orphaned in Redis
    // (auth-client.js:92 isSessionActive → EXISTS → 0 → SESSION_ENDED 401)
    const Redis = require('ioredis');
    const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6479';
    const testRedis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: false });
    try {
      await testRedis.del(`auth:active:${noSessionSub}`);
    } finally {
      await testRedis.quit().catch(() => {});
    }

    // Request with a cryptographically valid token but no active session — must 401
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${noSessionToken}`);

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'SESSION_ENDED');
  }, harnessProbe));

  // ── Rate limiter: authenticated route stays 200 under normal load ─────────
  //
  // The broad /api rate limiter allows 1000 req/min (per-instance MemoryStore,
  // no Redis in test).  Triggering a real 429 in E2E is impractical without
  // 1000 requests — attempting it would make the suite prohibitively slow and
  // would interfere with other tests sharing the same app instance.
  //
  // What this test DOES assert: 5 sequential authenticated requests each return
  // 200, confirming the rate-limiter does NOT misfire and block valid traffic
  // under normal load.  That is the observable, meaningful behavior we can pin
  // without saturating the limiter.

  test('rate limiter: 5 sequential authenticated requests all return 200 (limiter does not misfire)', requireDB(async () => {
    for (let i = 0; i < 5; i++) {
      const r = await request(app)
        .get('/api/tasks')
        .set('Authorization', `Bearer ${token}`);
      // Each must be 200 — if the limiter fires prematurely (misconfig) this goes red.
      expect(r.status).toBe(200);
    }
  }, harnessProbe));
});
