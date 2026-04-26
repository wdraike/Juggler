const request = require('supertest');
const express = require('express');

jest.mock('../db', () => {
  const insert = jest.fn().mockResolvedValue([1]);
  const db = jest.fn(() => ({ insert }));
  db._insert = insert;
  return db;
});

jest.mock('../proxy-config', () => ({
  authServiceUrl: 'http://auth-mock:5010'
}));

global.fetch = jest.fn();

const { startImpersonation, stopImpersonation, getImpersonationTargets } = require('../controllers/impersonation.controller');

function makeApp(handler, user = { id: 'admin-1', email: 'admin@test.com' }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = user; next(); });
  app.post('/test', handler);
  app.get('/test', handler);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.INTERNAL_SERVICE_KEY = 'test-internal-key';
});

describe('startImpersonation', () => {
  it('returns 400 when targetUserId is missing', async () => {
    const res = await request(makeApp(startImpersonation)).post('/test').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/targetUserId/i);
  });

  it('returns 400 when admin tries to impersonate themselves', async () => {
    const res = await request(makeApp(startImpersonation)).post('/test').send({ targetUserId: 'admin-1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/yourself/i);
  });

  it('proxies to auth-service and returns token on success', async () => {
    const authResp = {
      access_token: 'imp-tok',
      expires_in: 3600,
      impersonating: { id: 'u2', email: 'user@test.com', name: 'User' }
    };
    global.fetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify(authResp)
    });

    const res = await request(makeApp(startImpersonation))
      .post('/test')
      .send({ targetUserId: 'u2', reason: 'support' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe('imp-tok');
    expect(res.body.impersonating.id).toBe('u2');
    const db = require('../db');
    expect(db._insert).toHaveBeenCalledWith(expect.objectContaining({
      admin_user_id: 'admin-1',
      target_user_id: 'u2',
      action: 'start_impersonation'
    }));
  });

  it('returns 503 when auth-service is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(makeApp(startImpersonation))
      .post('/test')
      .send({ targetUserId: 'u2' });
    expect(res.status).toBe(503);
  });

  it('forwards 4xx errors from auth-service', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: 'Cannot impersonate admin users' })
    });
    const res = await request(makeApp(startImpersonation))
      .post('/test')
      .send({ targetUserId: 'u2' });
    expect(res.status).toBe(403);
  });
});

describe('stopImpersonation', () => {
  it('records audit row and returns message', async () => {
    const res = await request(makeApp(stopImpersonation)).post('/test').send({});
    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
    const db = require('../db');
    expect(db._insert).toHaveBeenCalledWith(expect.objectContaining({
      admin_user_id: 'admin-1',
      action: 'stop_impersonation'
    }));
  });
});
