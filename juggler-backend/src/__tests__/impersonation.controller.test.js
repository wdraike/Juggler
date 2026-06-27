const request = require('supertest');
const express = require('express');

// The impersonation controller is a THIN adapter over slices/user-config/facade
// (Phase H4/W6 refactor). It performs ZERO direct DB access — the audit-log insert
// and the target/log list queries run through KnexConfigRepository, whose knex is
// resolved via `lib/db.getDefaultDb()` (NOT src/db.js — ADR-0002 / W5 single-pool).
// So the test mocks `../lib/db`. The mock knex exposes `_insert` (the audit-row
// insert spy) and `__setChain` (installs a per-test chain for the list queries).
// Everything lives inside the factory (jest hoists jest.mock above all module-scope
// code, so the factory may not close over out-of-scope vars).
jest.mock('../lib/db', () => {
  const insert = jest.fn().mockResolvedValue([1]);
  let nextChain = null;
  function makeDefaultChain() {
    const clone = {
      clearSelect: jest.fn().mockReturnThis(),
      clearOrder: jest.fn().mockReturnThis(),
      count: jest.fn().mockResolvedValue([{ count: 0 }]),
      where: jest.fn().mockReturnThis(),
    };
    return {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockResolvedValue([]),
      clone: jest.fn(() => clone),
      insert,
    };
  }
  const knex = jest.fn(() => {
    if (nextChain) { const c = nextChain; nextChain = null; return c; }
    return makeDefaultChain();
  });
  knex._insert = insert;
  knex.__setChain = (chain) => { nextChain = chain; };
  return { getDefaultDb: () => knex };
});

jest.mock('../proxy-config', () => ({
  authServiceUrl: 'http://auth-mock:5010'
}));

// Mock logger to prevent ReferenceError in tests
jest.mock('@raike/lib-logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }))
}));

global.fetch = jest.fn();

const { startImpersonation, stopImpersonation, getImpersonationTargets } = require('../controllers/impersonation.controller');

function makeApp(handler, user = { id: 'admin-1', email: 'admin@test.com' }, auth = undefined) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = user; if (auth) req.auth = auth; next(); });
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
    const knex = require('../lib/db').getDefaultDb();
    expect(knex._insert).toHaveBeenCalledWith(expect.objectContaining({
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
  }, 10000);

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
  // The /stop handler reads admin/target from the impersonation-token context
  // (req.auth.actingAsAdmin). Per the 999.553 audit-misattribution fix
  // (StopImpersonation use-case), an audit row is recorded ONLY when an active
  // impersonation token is present (actingAsAdmin set): admin=actingAsAdmin,
  // target=req.user.id. A plain authenticated user (no token) gets 200 with NO row.
  it('records audit row when stopping an active impersonation', async () => {
    const user = { id: 'u2', email: 'user@test.com' };
    const auth = { actingAsAdmin: 'admin-1' };
    const res = await request(makeApp(stopImpersonation, user, auth)).post('/test').send({});
    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
    const knex = require('../lib/db').getDefaultDb();
    expect(knex._insert).toHaveBeenCalledWith(expect.objectContaining({
      admin_user_id: 'admin-1',
      target_user_id: 'u2',
      action: 'stop_impersonation'
    }));
  });

  it('does NOT record an audit row for a plain stop (no active impersonation)', async () => {
    const res = await request(makeApp(stopImpersonation)).post('/test').send({});
    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
    const knex = require('../lib/db').getDefaultDb();
    expect(knex._insert).not.toHaveBeenCalled();
  });
});

describe('getImpersonationTargets', () => {
  // Installs a one-shot knex chain for the repo's listImpersonationTargets query
  // (db('users').select().clone().clearSelect().count() then .orderBy().limit().offset()).
  function makeTargetsDb(users = [], count = 0) {
    // Build a clone object that handles clearSelect().count()
    const makeClone = () => ({
      clearSelect: jest.fn().mockReturnThis(),
      count: jest.fn().mockResolvedValue([{ count }]),
      where: jest.fn().mockReturnThis(),
    });
    const chain = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockResolvedValue(users),
      clone: jest.fn(makeClone),
    };
    require('../lib/db').getDefaultDb().__setChain(chain);
    return chain;
  }

  it('returns paginated users', async () => {
    makeTargetsDb([{ id: 'u1', email: 'a@test.com', created_at: '2026-01-01' }], 1);
    const res = await request(makeApp(getImpersonationTargets)).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.pagination.hasMore).toBe(false);
  });

  it('clamps limit to 100', async () => {
    makeTargetsDb([], 0);
    const res = await request(makeApp(getImpersonationTargets)).get('/test?limit=500&offset=0');
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(100);
  });

  it('enforces minimum limit of 1 for limit=0', async () => {
    makeTargetsDb([], 0);
    const res = await request(makeApp(getImpersonationTargets)).get('/test?limit=0&offset=0');
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(1);
  });
});
