/**
 * req-endpoints-coverage.test.js — 999.592
 *
 * Dedicated, requirement-tagged endpoint contract tests for the requirement IDs
 * triaged as lacking a DEDICATED endpoint test (prior coverage was only indirect
 * via characterization/boundary suites):
 *
 *   R44.1  GET  /api/schedule/placements      — REMOVED (W3: route deleted; MCP uses
 *                                               deriveSchedulePlacements server-side)
 *   R44.2  POST /api/schedule/nudge           (auth; enqueue nudge, { queued:true })
 *   R45.1  GET  /api/impersonation/targets    (auth + admin; list targets; non-admin 403)
 *   R45.2  POST /api/weather/ingest           (auth; populate weather cache)
 *   R47.1  DELETE /api/projects/:id           (auth; delete project, 404 unknown)
 *   R48.1  GET  /api/tools/                   (auth; list tools)
 *   R48.2  PUT  /api/tools/                   (auth; replace tool inventory)
 *
 * Pattern: supertest against the REAL Express app (src/app.js) with the slice
 * facade + weather facade mocked at the module boundary, so each test asserts the
 * genuine ROUTE contract — auth/admin gate, HTTP status, response shape, and
 * correct delegation to the use case — without coupling to internal DB-call
 * ordering. The mocks return distinguishable values that the assertions check
 * for, so a route that fails to wire/forward/map would FAIL (non-tautological).
 *
 * Run (test-bed ritual):
 *   DB_HOST=127.0.0.1 DB_PORT=3407 DB_USER=root DB_PASSWORD=rootpass \
 *   DB_NAME=juggler_test REDIS_URL=redis://localhost:6479 \
 *   npx jest tests/api/req-endpoints-coverage.test.js
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@test.com';

// ── DB mock (app boot touches src/db / lib/db on require) ──────────────────────
const { createMockChainDb } = require('../helpers/mockChainDb');
const { mockDb, resolveQueue } = createMockChainDb();
jest.mock('../../src/db', () => mockDb);
jest.mock('../../src/lib/db', () => {
  const actual = jest.requireActual('../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

// ── JWT mock — regular user by default; admin when x-test-admin header present ──
const TEST_USER = { id: 'user-123', email: 'test@test.com', name: 'Test', timezone: 'America/New_York' };
const ADMIN_USER = { id: 'admin-456', email: 'admin@test.com', name: 'Admin', timezone: 'America/New_York' };
jest.mock('../../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer '))
      return res.status(401).json({ error: 'Authentication required' });
    req.user = req.headers['x-test-admin'] === 'true' ? { ...ADMIN_USER } : { ...TEST_USER };
    req.auth = { plans: {}, apps: ['juggler'] };
    next();
  },
  verifyToken: jest.fn()
}));

// ── Plan-features mock — unlimited (projects route requires it) ────────────────
jest.mock('../../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => {
    req.planId = 'enterprise';
    req.planFeatures = {
      limits: { active_tasks: -1, recurring_templates: -1, projects: -1, locations: -1, schedule_templates: -1, ai_commands_per_month: -1 },
      ai: { natural_language_commands: true },
      calendar: { max_providers: -1, auto_sync: true },
      scheduling: { dependencies: true, travel_time: true },
      tasks: { rigid: true },
      data: { export: true, import: true, mcp_access: true }
    };
    next();
  },
  PRODUCT_ID: 'juggler',
  refreshPlanFeatures: jest.fn(),
  getCachedPlanFeatures: jest.fn()
}));

// ── Infra mocks ───────────────────────────────────────────────────────────────
jest.mock('../../src/lib/redis', () => ({
  getClient: jest.fn().mockReturnValue(null),
  invalidateTasks: jest.fn(() => Promise.resolve()),
  invalidateConfig: jest.fn(() => Promise.resolve()),
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve()),
  del: jest.fn(() => Promise.resolve())
}));
jest.mock('../../src/lib/sse-emitter', () => ({ emit: jest.fn(), addClient: jest.fn() }));
jest.mock('../../src/lib/sync-lock', () => ({
  withSyncLock: (fn) => fn,
  acquireLock: jest.fn(() => Promise.resolve(true)),
  releaseLock: jest.fn(() => Promise.resolve()),
  refreshLock: jest.fn(() => Promise.resolve())
}));
jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(() => Promise.resolve({ queued: true })),
  stopPollLoop: jest.fn()
}));
// W3: getSchedulePlacements removed; route GET /api/schedule/placements deleted.
jest.mock('../../src/scheduler/runSchedule', () => ({
  runScheduleAndPersist: jest.fn(() => Promise.resolve({ dayPlacements: {}, unplaced: [], score: { total: 100 }, warnings: [] }))
}));

// ── Slice facade mock — tools, project delete, impersonation targets ───────────
// The config + impersonation controllers are thin adapters over this facade.
// Returning distinguishable envelopes lets the route-contract assertions verify
// status + body mapping genuinely.
jest.mock('../../src/slices/user-config/facade', () => {
  const actual = jest.requireActual('../../src/slices/user-config/facade');
  return Object.assign({}, actual, {
    getTools: jest.fn(),
    replaceTools: jest.fn(),
    deleteProject: jest.fn(),
    getImpersonationTargets: jest.fn()
  });
});

// ── Weather facade mock — ingest ───────────────────────────────────────────────
jest.mock('../../src/slices/weather/facade', () => {
  const actual = jest.requireActual('../../src/slices/weather/facade');
  return Object.assign({}, actual, { ingest: jest.fn() });
});

const facade = require('../../src/slices/user-config/facade');
const weatherFacade = require('../../src/slices/weather/facade');

const VALID_TOKEN = 'valid-test-token';
let app, request;

beforeAll(() => {
  app = require('../../src/app');
  request = require('supertest');
});

beforeEach(() => {
  resolveQueue.length = 0;
  jest.clearAllMocks();
});

// R44.1 — GET /api/schedule/placements: ROUTE DELETED (W3 DB single source).
// The MCP get_schedule tool now calls deriveSchedulePlacements server-side.
// No route test needed; coverage of the new helper lives in
// tests/scheduler/deriveSchedulePlacements.test.js.

// ════════════════════════════════════════════════════════════════════════════
// R44.2 — POST /api/schedule/nudge (auth; enqueue nudge → { queued: true })
// ════════════════════════════════════════════════════════════════════════════
describe('R44.2 — POST /api/schedule/nudge', () => {
  test('auth user → 200 { queued: true }, enqueues with source frontend:task-end-nudge', async () => {
    const { enqueueScheduleRun } = require('../../src/scheduler/scheduleQueue');
    const res = await request(app)
      .post('/api/schedule/nudge')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ queued: true });
    expect(enqueueScheduleRun).toHaveBeenCalledWith('user-123', 'frontend:task-end-nudge');
  });

  test('no token → 401', async () => {
    const res = await request(app).post('/api/schedule/nudge');
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// R45.1 — GET /api/impersonation/targets (auth + admin; non-admin → 403)
// ════════════════════════════════════════════════════════════════════════════
describe('R45.1 — GET /api/impersonation/targets', () => {
  test('admin → 200 with list of impersonatable users', async () => {
    facade.getImpersonationTargets.mockResolvedValue({
      status: 200,
      body: { targets: [{ id: 'u1', email: 'u1@test.com' }], total: 1 }
    });

    const res = await request(app)
      .get('/api/impersonation/targets')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('x-test-admin', 'true');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ targets: [{ id: 'u1', email: 'u1@test.com' }], total: 1 });
    expect(facade.getImpersonationTargets).toHaveBeenCalledTimes(1);
  });

  test('non-admin → 403 (admin gate enforced) and facade NOT reached', async () => {
    const res = await request(app)
      .get('/api/impersonation/targets')
      .set('Authorization', `Bearer ${VALID_TOKEN}`); // regular user

    expect(res.status).toBe(403);
    expect(facade.getImpersonationTargets).not.toHaveBeenCalled();
  });

  test('no token → 401', async () => {
    const res = await request(app).get('/api/impersonation/targets');
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// R45.2 — POST /api/weather/ingest (auth; populate weather cache)
// ════════════════════════════════════════════════════════════════════════════
describe('R45.2 — POST /api/weather/ingest', () => {
  const validBody = () => ({
    lat: 37.7,
    lon: -122.4,
    hourly: {
      time: ['2026-06-06T00:00'],
      temperature_2m: [72],
      precipitation_probability: [10],
      cloudcover: [30],
      weathercode: [1],
      precipitation: [0],
      relativehumidity_2m: [60]
    }
  });

  test('auth user + valid payload → 200, delegates to weather.ingest, returns cache result', async () => {
    weatherFacade.ingest.mockResolvedValue({ cachedAt: '2026-06-06T00:00:00Z', expiresAt: '2026-06-06T01:00:00Z' });

    const res = await request(app)
      .post('/api/weather/ingest')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send(validBody());

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('cachedAt', '2026-06-06T00:00:00Z');
    expect(res.body).toHaveProperty('expiresAt', '2026-06-06T01:00:00Z');
    expect(weatherFacade.ingest).toHaveBeenCalledTimes(1);
    // The validated body is forwarded to the ingest use case.
    expect(weatherFacade.ingest).toHaveBeenCalledWith(expect.objectContaining({ lat: 37.7, lon: -122.4 }));
  });

  test('invalid payload (missing hourly) → 400, ingest NOT called', async () => {
    const res = await request(app)
      .post('/api/weather/ingest')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ lat: 37.7, lon: -122.4 });

    expect(res.status).toBe(400);
    expect(weatherFacade.ingest).not.toHaveBeenCalled();
  });

  test('no token → 401', async () => {
    const res = await request(app).post('/api/weather/ingest').send(validBody());
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// R47.1 — DELETE /api/projects/:id (auth; delete project; unknown → 404)
// ════════════════════════════════════════════════════════════════════════════
describe('R47.1 — DELETE /api/projects/:id', () => {
  test('auth user + existing id → 200 and delegates to deleteProject with userId + id', async () => {
    facade.deleteProject.mockResolvedValue({ status: 200, body: { message: 'Project deleted' } });

    const res = await request(app)
      .delete('/api/projects/proj-1')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Project deleted' });
    expect(facade.deleteProject).toHaveBeenCalledWith({ userId: 'user-123', id: 'proj-1' });
  });

  test('non-existent id → 404 (envelope status mapped through)', async () => {
    facade.deleteProject.mockResolvedValue({ status: 404, body: { error: 'Project not found' } });

    const res = await request(app)
      .delete('/api/projects/does-not-exist')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  test('no token → 401', async () => {
    const res = await request(app).delete('/api/projects/proj-1');
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// R48.1 — GET /api/tools/ (auth; list all user-defined tools)
// ════════════════════════════════════════════════════════════════════════════
describe('R48.1 — GET /api/tools/', () => {
  test('auth user → 200 with tool inventory, delegates with userId', async () => {
    facade.getTools.mockResolvedValue({ status: 200, body: { tools: ['phone', 'laptop'] } });

    const res = await request(app)
      .get('/api/tools/')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tools: ['phone', 'laptop'] });
    expect(facade.getTools).toHaveBeenCalledWith({ userId: 'user-123' });
  });

  test('no token → 401', async () => {
    const res = await request(app).get('/api/tools/');
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// R48.2 — PUT /api/tools/ (auth; replace the entire tool inventory)
// ════════════════════════════════════════════════════════════════════════════
describe('R48.2 — PUT /api/tools/', () => {
  test('auth user + tool list → 200, replaces inventory, forwards body to replaceTools', async () => {
    // 999.1247 gate triage: tools are OBJECTS ({ name, icon? } — facade.js
    // toolsBodySchema), not bare strings. The route-level toolReplaceSchema
    // (route-schemas.js, BUG-999.1221) enforces the object shape BEFORE the
    // mocked facade, so the old string-array fixture now 400s at the route.
    const TOOLS = [{ name: 'phone' }, { name: 'car' }];
    facade.replaceTools.mockResolvedValue({ status: 200, body: { tools: TOOLS } });

    const res = await request(app)
      .put('/api/tools/')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ tools: TOOLS });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tools: TOOLS });
    expect(facade.replaceTools).toHaveBeenCalledTimes(1);
    expect(facade.replaceTools).toHaveBeenCalledWith({ userId: 'user-123', body: { tools: TOOLS } });
  });

  test('no token → 401', async () => {
    const res = await request(app).put('/api/tools/').send({ tools: [] });
    expect(res.status).toBe(401);
  });
});
