/**
 * AC1 (999.809) — GET /api/now
 *
 * Requirements covered: AC1
 * Layer: integration (supertest against src/app.js, DB mocked)
 *
 * Assertions:
 *   - 200 response with shape { epochMs: number, iso: string }
 *   - epochMs is a number within ±5000 ms of Date.now() at request time
 *   - iso is a valid ISO-8601 string that parses to the same instant as epochMs
 *   - 401 when no Authorization header is provided
 */

process.env.NODE_ENV = 'test';

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
  chain.then = jest.fn((resolve, reject) =>
    Promise.resolve(resolveQueue.length ? resolveQueue.shift() : []).then(resolve, reject));
  chain.catch = jest.fn((fn) => Promise.resolve([]).catch(fn));
  chain.fn = { now: () => 'MOCK_NOW' };
  chain.raw = jest.fn((s) => s);
  chain.transaction = jest.fn(async (cb) => cb(chain));
  return chain;
}

const mockDb = createChainMock();
jest.mock('../../src/db', () => mockDb);
jest.mock('../../src/lib/db', () => {
  const actual = jest.requireActual('../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

const TEST_USER = { id: 'user-now', email: 'now@test.com', name: 'NowUser', timezone: 'America/New_York' };

// Authenticate when an Authorization header is present; reject without one.
jest.mock('../../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Auth required' });
    }
    req.user = { ...TEST_USER };
    req.auth = { plans: {}, apps: ['juggler'] };
    next();
  },
  verifyToken: jest.fn()
}));

jest.mock('../../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => {
    req.planId = 'enterprise';
    req.planFeatures = { limits: { active_tasks: -1 }, calendar: {}, scheduling: {}, tasks: {} };
    next();
  },
  PRODUCT_ID: 'juggler',
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

jest.mock('../../src/lib/rate-limit-store', () => ({
  maybeRedisStore: () => ({
    init: jest.fn(),
    increment: jest.fn(() => Promise.resolve({ totalHits: 1, resetTime: new Date(Date.now() + 60000) })),
    decrement: jest.fn(() => Promise.resolve()),
    resetKey: jest.fn(() => Promise.resolve()),
    resetAll: jest.fn(() => Promise.resolve())
  })
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
});

// ---------------------------------------------------------------------------
// AC1: GET /api/now — authenticated, returns { epochMs, iso }
// ---------------------------------------------------------------------------
describe('AC1 (999.809): GET /api/now', () => {

  test('AC1-shape: returns 200 with { epochMs, iso } when authenticated', async () => {
    const before = Date.now();
    const res = await request(app)
      .get('/api/now')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    const after = Date.now();

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('epochMs');
    expect(res.body).toHaveProperty('iso');
    // epochMs must be a number
    expect(typeof res.body.epochMs).toBe('number');
    // epochMs within [before-100, after+100] — a few ms tolerance for execution time
    expect(res.body.epochMs).toBeGreaterThanOrEqual(before - 100);
    expect(res.body.epochMs).toBeLessThanOrEqual(after + 100);
  });

  test('AC1-epochMs-tolerance: epochMs is within 5000 ms of Date.now()', async () => {
    const res = await request(app)
      .get('/api/now')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    const delta = Math.abs(res.body.epochMs - Date.now());
    expect(delta).toBeLessThan(5000);
  });

  test('AC1-iso-parseable: iso field is a valid ISO-8601 string', async () => {
    const res = await request(app)
      .get('/api/now')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    const parsed = new Date(res.body.iso);
    expect(isNaN(parsed.getTime())).toBe(false);
  });

  test('AC1-iso-epochMs-consistency: iso parses to the same instant as epochMs (within 1 ms)', async () => {
    const res = await request(app)
      .get('/api/now')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    const fromIso = new Date(res.body.iso).getTime();
    // iso and epochMs are stamped from the same new Date() call so they must be identical
    expect(fromIso).toBe(res.body.epochMs);
  });

  test('AC1-iso-format: iso ends with Z (UTC)', async () => {
    const res = await request(app)
      .get('/api/now')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.iso).toMatch(/Z$/);
  });

  test('AC1-auth: returns 401 without Authorization header', async () => {
    const res = await request(app).get('/api/now');
    expect(res.status).toBe(401);
  });

  test('AC1-auth: returns 401 with malformed Authorization header (no Bearer prefix)', async () => {
    const res = await request(app)
      .get('/api/now')
      .set('Authorization', 'not-a-bearer-token');
    expect(res.status).toBe(401);
  });

  test('AC1-no-fallback: epochMs is never null or undefined (no fallback substitution)', async () => {
    const res = await request(app)
      .get('/api/now')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.epochMs).not.toBeNull();
    expect(res.body.epochMs).not.toBeUndefined();
    // Must be a positive integer
    expect(res.body.epochMs).toBeGreaterThan(0);
    expect(Number.isInteger(res.body.epochMs)).toBe(true);
  });
});
