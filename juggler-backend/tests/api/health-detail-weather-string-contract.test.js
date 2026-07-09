/**
 * BUG-487 (I1) — Regression: GET /api/health/detailed — detail.weather must be a STRING
 *
 * ROOT CAUSE: health.routes.js ~line 241 — operational weather branch sets
 *   healthStatus.detail.weather = { fetchedAt: weatherRow.fetched_at }
 * which is an OBJECT. Contract: every value in detail.* is a display string.
 *
 * This test is RED on pre-fix code (detail.weather is an object, not a string).
 * It becomes GREEN after bert's fix emits a string (e.g. 'fetched X min ago').
 *
 * Pattern: matches tests/api/data-and-weather.test.js and tests/api/misc-routes.test.js
 * (mock-DB unit-style, supertest against real app, no test-bed DB required).
 */

process.env.NODE_ENV = 'test';

const { createMockChainDb } = require('../helpers/mockChainDb');
const { mockDb, resolveQueue } = createMockChainDb();

// health.routes.js uses both .del and .delete (alias) — add alias to be safe
mockDb.delete = mockDb.del;

jest.mock('../../src/db', () => mockDb);
jest.mock('../../src/lib/db', () => {
  const actual = jest.requireActual('../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

// JWT mock — makes authenticateJWT pass and sets req.user
const TEST_USER = { id: 'user-42', email: 'test@test.com', name: 'Test', timezone: 'America/New_York' };
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

// scheduleQueue: getLastError returns null (no recent scheduler errors)
jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn(),
  getLastError: jest.fn(() => null)
}));

// SSE emitter: getStats returns 0 connections
jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn(),
  addClient: jest.fn(),
  getStats: jest.fn(() => ({ activeConnections: 0 }))
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

jest.mock('../../src/lib/logger', () => {
  const noop = jest.fn();
  const fakeLogger = { error: noop, warn: noop, info: noop, debug: noop, trace: noop };
  return {
    createLogger: jest.fn(() => fakeLogger),
    Logger: class {},
    clearLoggerCache: jest.fn(),
    LOG_LEVELS: ['error', 'warn', 'info', 'debug', 'trace'],
    DEFAULT_LOG_LEVEL: 'debug',
    loggers: {},
    dataControllerLogger: fakeLogger,
    weatherControllerLogger: fakeLogger,
    taskControllerLogger: fakeLogger,
    calSyncControllerLogger: fakeLogger,
    aiControllerLogger: fakeLogger,
    schedulerLogger: fakeLogger,
    schedulerRunLogger: fakeLogger,
    schedulerUnifiedLogger: fakeLogger,
    configControllerLogger: fakeLogger,
    libUsageReporterLogger: fakeLogger,
    libGcalLogger: fakeLogger,
    libMsftLogger: fakeLogger,
    libAppleLogger: fakeLogger,
    libDbLogger: fakeLogger,
    libRedisLogger: fakeLogger,
    libTasksWriteLogger: fakeLogger,
    libTaskWriteQueueLogger: fakeLogger,
    libCalAdapterLogger: fakeLogger,
    libSyncLockLogger: fakeLogger,
    libRollingAnchorLogger: fakeLogger,
    libReconcileSplitsLogger: fakeLogger,
    libSseEmitterLogger: fakeLogger,
    aiUsageQueueLogger: fakeLogger,
    aiUsageFlusherLogger: fakeLogger,
    serverLogger: fakeLogger,
    cronCalHistoryLogger: fakeLogger,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop
  };
});

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

// ---------------------------------------------------------------------------
// BUG-487 (I1): detail.weather string-contract in the OPERATIONAL weather branch
// ---------------------------------------------------------------------------
describe('BUG-487 (I1): GET /api/health/detailed — detail.weather must be a string when operational', () => {

  /**
   * Seed the resolveQueue for GET /api/health/detailed with:
   *   1. db.raw('SELECT 1')     — always via raw(), not the chain — no queue needed
   *   2. schedule_queue stuck-claim count()  → first()  → { cnt: 0 }
   *   3. sse.getStats() is mocked on the module level (no queue)
   *   4. users row  → first()  → { id: 'user-42', gcal_refresh_token: null, ... }
   *   5. cal_sync_ledger rows → select() → []
   *   6. locations row (user primary location) → first() → { lat: 37.77, lon: -122.42 }
   *   7. weather_cache row (fresh, < 2h old)  → first() → { fetched_at: <recent ISO> }
   *
   * raw() bypasses the chain mock, so only the chain terminal calls matter.
   */
  function seedOperationalWeather() {
    // (2) stuck-claim count
    resolveQueue.push({ cnt: 0 });
    // (4) users row (gcal/msft/apple all null → disconnected, no sync errors)
    resolveQueue.push({ id: TEST_USER.id, gcal_refresh_token: null, msft_cal_refresh_token: null, apple_cal_password: null });
    // (5) cal_sync_ledger rows
    resolveQueue.push([]);
    // (6) locations → lat/lon present
    resolveQueue.push({ lat: 37.77, lon: -122.42 });
    // (7) weather_cache → FRESH row (fetched 5 minutes ago)
    const freshFetchedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    resolveQueue.push({ fetched_at: freshFetchedAt });
  }

  test('BUG-487-BE: detail.weather is a string (not an object) when weather is operational', async () => {
    seedOperationalWeather();

    const res = await request(app)
      .get('/api/health/detailed')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.services.weather).toBe('operational');

    // REGRESSION ASSERTION — this is the contract violation.
    // Pre-fix: detail.weather = { fetchedAt: '...' }  → typeof === 'object' → FAIL
    // Post-fix: detail.weather = '<some string>'       → typeof === 'string' → PASS
    expect(typeof res.body.detail.weather).toBe('string');
  });

  test('BUG-487-BE: detail.weather is not an object with fetchedAt key when weather is operational', async () => {
    seedOperationalWeather();

    const res = await request(app)
      .get('/api/health/detailed')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    // Belt-and-suspenders: explicitly confirm it is NOT the buggy object shape
    expect(res.body.detail.weather).not.toEqual(expect.objectContaining({ fetchedAt: expect.anything() }));
  });

  test('detail.weather is absent or a string when weather is degraded (stale cache)', async () => {
    // Degraded branch does set a string — confirm it is still a string post-fix too
    // Seed: stuck=0, users, cal_sync, location present, weather stale (> 2h)
    resolveQueue.push({ cnt: 0 });
    resolveQueue.push({ id: TEST_USER.id, gcal_refresh_token: null, msft_cal_refresh_token: null, apple_cal_password: null });
    resolveQueue.push([]);
    resolveQueue.push({ lat: 37.77, lon: -122.42 });
    const staleAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // 3h ago
    resolveQueue.push({ fetched_at: staleAt });

    const res = await request(app)
      .get('/api/health/detailed')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.services.weather).toBe('degraded');
    // Degraded branch already emits a string — confirm it stays string
    if (res.body.detail.weather !== undefined) {
      expect(typeof res.body.detail.weather).toBe('string');
    }
  });

  test('detail.weather is absent or a string when no location is configured', async () => {
    // no location → services.weather = 'not_configured', detail.weather should be absent
    resolveQueue.push({ cnt: 0 });
    resolveQueue.push({ id: TEST_USER.id, gcal_refresh_token: null, msft_cal_refresh_token: null, apple_cal_password: null });
    resolveQueue.push([]);
    resolveQueue.push(null); // no location row

    const res = await request(app)
      .get('/api/health/detailed')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.services.weather).toBe('not_configured');
    // When not configured, detail.weather should not be an object
    if (res.body.detail.weather !== undefined) {
      expect(typeof res.body.detail.weather).toBe('string');
    }
  });
});
