/**
 * Miscellaneous route tests
 *
 * Covers:
 *   AP-75: GET /api/my-plan/ — returns user's schedule plan info
 *   AP-76: POST /api/impersonation/start (admin-only) — 403 for non-admin user
 *   AP-77: POST /api/impersonation/stop — stops impersonation session
 *   E2-09: CORS headers present on OPTIONS preflight request
 */

process.env.NODE_ENV = 'test';
// ADMIN_EMAILS is intentionally empty so non-admin users get 403
delete process.env.ADMIN_EMAILS;

let resolveQueue = [];

function createChainMock() {
  const chain = jest.fn(() => chain);
  ['where', 'whereRaw', 'whereNotNull', 'whereNull', 'whereNot', 'whereNotIn',
   'whereIn', 'orWhere', 'orWhereNot', 'orderBy', 'orderByRaw', 'limit', 'offset',
   'join', 'leftJoin', 'count', 'max', 'clearSelect', 'clearOrder', 'clone',
   'groupBy', 'having'].forEach(m => { chain[m] = jest.fn(() => chain); });

  chain.select = jest.fn(() => Promise.resolve(resolveQueue.length ? resolveQueue.shift() : []));
  chain.first = jest.fn(() => Promise.resolve(resolveQueue.length ? resolveQueue.shift() : null));
  chain.insert = jest.fn(() => Promise.resolve());
  chain.update = jest.fn(() => Promise.resolve(1));
  chain.del = jest.fn(() => Promise.resolve(1));
  chain.then = jest.fn((resolve, reject) => Promise.resolve(resolveQueue.length ? resolveQueue.shift() : []).then(resolve, reject));
  chain.catch = jest.fn((fn) => Promise.resolve([]).catch(fn));
  chain.fn = { now: () => 'MOCK_NOW' };
  chain.raw = jest.fn((s) => s);
  chain.transaction = jest.fn(async (cb) => cb(chain));
  return chain;
}

const mockDb = createChainMock();
jest.mock('../../src/db', () => mockDb);

// W5 (juggler-hex-h2): my-plan.routes now default-wires from lib/db.getDefaultDb()
// (the single pool src/db re-exports), so feed the same mockDb through lib/db too.
jest.mock('../../src/lib/db', () => {
  const actual = jest.requireActual('../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

const TEST_USER = { id: 'user-123', email: 'test@test.com', name: 'Test', timezone: 'America/New_York' };
jest.mock('../../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Auth required' });
    req.user = { ...TEST_USER };
    req.auth = { plans: {}, apps: ['juggler'] };
    next();
  },
  verifyToken: jest.fn()
}));

jest.mock('../../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => {
    req.planId = 'enterprise';
    req.planFeatures = {
      limits: { active_tasks: -1 },
      calendar: { max_providers: -1 },
      scheduling: {},
      tasks: {},
      ai: { natural_language_commands: true }
    };
    next();
  },
  PRODUCT_ID: 'juggler',
  PRODUCT_LABEL: 'juggler',
  getProductId: jest.fn(() => Promise.resolve('juggler')),
  refreshPlanFeatures: jest.fn(),
  invalidateUserPlanCache: jest.fn(),
  getCachedPlanFeatures: jest.fn()
}));

jest.mock('../../src/lib/redis', () => ({
  getClient: jest.fn().mockReturnValue(null),
  invalidateTasks: jest.fn(() => Promise.resolve()),
  invalidateConfig: jest.fn(() => Promise.resolve()),
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve()),
  del: jest.fn(() => Promise.resolve())
}));

jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
}));

jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn(),
  addClient: jest.fn()
}));

jest.mock('../../src/lib/tasks-write', () => ({
  insertTask: jest.fn(() => Promise.resolve()),
  insertTasksBatch: jest.fn(() => Promise.resolve()),
  resetRecurringInstances: jest.fn(() => Promise.resolve()),
  updateTaskById: jest.fn(() => Promise.resolve(1)),
  deleteTaskById: jest.fn(() => Promise.resolve(1)),
  updateTasksWhere: jest.fn(() => Promise.resolve()),
  deleteTasksWhere: jest.fn(() => Promise.resolve()),
  deleteInstancesWhere: jest.fn(() => Promise.resolve()),
  updateInstancesWhere: jest.fn(() => Promise.resolve()),
  splitUpdateFields: jest.fn((fields) => fields),
  isTemplate: jest.fn(() => false)
}));

jest.mock('../../src/lib/task-write-queue', () => ({
  isLocked: jest.fn(() => Promise.resolve(false)),
  enqueueWrite: jest.fn(() => Promise.resolve()),
  flushQueue: jest.fn(() => Promise.resolve()),
  flushQueueInLock: jest.fn(() => Promise.resolve()),
  splitFields: jest.fn((fields) => ({ schedulingFields: {}, nonSchedulingFields: fields })),
  NON_SCHEDULING_FIELDS: []
}));

jest.mock('../../src/middleware/entity-limits', () => ({
  checkProjectLimit: (req, res, next) => next(),
  checkLocationLimit: (req, res, next) => next(),
  checkScheduleTemplateLimit: (req, res, next) => next(),
  checkTaskOrRecurringLimit: (req, res, next) => next(),
  checkBatchTaskLimits: (req, res, next) => next(),
  checkToolLimit: (req, res, next) => next(),
  countActiveTasks: jest.fn(() => Promise.resolve(0)),
  countRecurringTemplates: jest.fn(() => Promise.resolve(0)),
  countProjects: jest.fn(() => Promise.resolve(0)),
  countLocations: jest.fn(() => Promise.resolve(0)),
  countScheduleTemplates: jest.fn(() => Promise.resolve(0))
}));

jest.mock('../../src/middleware/validate', () => ({
  validate: () => (req, res, next) => next()
}));

jest.mock('../../src/lib/rate-limit-store', () => ({
  maybeRedisStore: () => ({
    init: jest.fn(),
    increment: jest.fn(() => Promise.resolve({ totalHits: 1, resetTime: new Date(Date.now() + 60000) })),
    decrement: jest.fn(() => Promise.resolve()),
    resetKey: jest.fn(() => Promise.resolve()),
    resetAll: jest.fn(() => Promise.resolve())
  })
}));

jest.mock('../../src/slices/ai-enrichment/adapters/gemini-tracked-call', () => ({
  trackedGeminiCall: jest.fn()
}));

jest.mock('../../src/slices/ai-enrichment/adapters/ai-usage-queue.service', () => ({
  enqueue: jest.fn()
}));

const VALID_TOKEN = 'valid-test-token';
let app, request;

beforeAll(async () => {
  app = require('../../src/app');
  request = require('supertest');
});

beforeEach(() => {
  resolveQueue = [];
  jest.clearAllMocks();

  const writeQueue = require('../../src/lib/task-write-queue');
  writeQueue.isLocked.mockResolvedValue(false);
  writeQueue.splitFields.mockImplementation((fields) => ({ schedulingFields: {}, nonSchedulingFields: fields }));

  const redis = require('../../src/lib/redis');
  redis.get.mockResolvedValue(null);
  redis.set.mockResolvedValue(undefined);
  redis.del.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// AP-75: GET /api/my-plan/ — returns user's schedule plan
// ---------------------------------------------------------------------------
describe('AP-75: GET /api/my-plan/', () => {
  test('returns 401 when no auth token is provided', async () => {
    const res = await request(app).get('/api/my-plan/');
    expect(res.status).toBe(401);
  });

  test('returns 200 with plan info for authenticated user', async () => {
    // my-plan route calls:
    //   1. countActiveTasks → reads resolveQueue (entity-limits is mocked, bypasses DB)
    //   2. db('tasks_v').where({ user_id, status: 'disabled' }).count().first() — disabled count
    //   3. fetch() to payment service for plan name — fails silently (no server in test)
    //   4. fetch() to payment service for subscription status — fails silently
    // Seed the disabled count query
    resolveQueue.push({ count: '2' }); // disabled_items

    const res = await request(app)
      .get('/api/my-plan/')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('plan_id');
    expect(res.body).toHaveProperty('features');
    expect(res.body).toHaveProperty('usage');
    expect(res.body).toHaveProperty('disabled_items');
  });

  test('returns plan_id matching the mocked plan', async () => {
    resolveQueue.push({ count: '0' }); // disabled_items

    const res = await request(app)
      .get('/api/my-plan/')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.plan_id).toBe('enterprise');
  });

  test('returns usage object (may be empty when no numeric limits are configured)', async () => {
    resolveQueue.push({ count: '0' }); // disabled_items

    const res = await request(app)
      .get('/api/my-plan/')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.usage).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// AP-76: POST /api/impersonation/start — admin-only; 403 for non-admin
// ---------------------------------------------------------------------------
describe('AP-76: POST /api/impersonation/start — admin-only gate', () => {
  test('returns 401 when no auth token is provided', async () => {
    const res = await request(app)
      .post('/api/impersonation/start')
      .send({ targetUserId: 'other-user', reason: 'support' });
    expect(res.status).toBe(401);
  });

  test('returns 403 for authenticated non-admin user (ADMIN_EMAILS unset)', async () => {
    // authenticateAdmin checks process.env.ADMIN_EMAILS; when unset → 403.
    const res = await request(app)
      .post('/api/impersonation/start')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ targetUserId: 'other-user', reason: 'support' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });

  test('returns 403 when ADMIN_EMAILS is set but user email is not in the list', async () => {
    const originalAdminEmails = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = 'admin@company.com,superuser@company.com';

    const res = await request(app)
      .post('/api/impersonation/start')
      .set('Authorization', `Bearer ${VALID_TOKEN}`) // TEST_USER email: test@test.com
      .send({ targetUserId: 'other-user', reason: 'support' });

    process.env.ADMIN_EMAILS = originalAdminEmails;

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });
});

// ---------------------------------------------------------------------------
// AP-77: POST /api/impersonation/stop — stops impersonation session
// ---------------------------------------------------------------------------
describe('AP-77: POST /api/impersonation/stop', () => {
  test('returns 401 when no auth token is provided', async () => {
    const res = await request(app).post('/api/impersonation/stop');
    expect(res.status).toBe(401);
  });

  test('returns 200 and a stop message for any authenticated user', async () => {
    // stopImpersonation logs an audit row (db insert) — the mock handles this silently
    const res = await request(app)
      .post('/api/impersonation/stop')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/impersonation stopped/i);
  });

  test('stop does not require admin role — any authenticated user can stop', async () => {
    // The route uses authenticateJWT only (no authenticateAdmin) for /stop
    const res = await request(app)
      .post('/api/impersonation/stop')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    // Must NOT be 403 (admin gate must not apply)
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// E2-09: CORS headers present on OPTIONS preflight request
// ---------------------------------------------------------------------------
describe('E2-09: CORS headers on OPTIONS preflight', () => {
  test('OPTIONS preflight returns CORS headers for loopback origin', async () => {
    const res = await request(app)
      .options('/api/tasks')
      .set('Origin', 'http://localhost:3002')
      .set('Access-Control-Request-Method', 'GET');
    // Either 200 or 204 is acceptable for OPTIONS
    expect([200, 204]).toContain(res.status);
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });

  test('OPTIONS preflight for POST method includes correct CORS headers', async () => {
    const res = await request(app)
      .options('/api/tasks')
      .set('Origin', 'http://localhost:3002')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type,Authorization');
    expect([200, 204]).toContain(res.status);
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });

  test('OPTIONS preflight from configured FRONTEND_URL origin is allowed', async () => {
    // Default FRONTEND_URL is http://localhost:3000 (set in app.js)
    const res = await request(app)
      .options('/api/my-plan/')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET');
    expect([200, 204]).toContain(res.status);
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });
});
