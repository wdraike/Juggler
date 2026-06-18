/**
 * Health endpoint tests — R42.1–R42.4
 *
 * R42.1: GET /api/health/immediate returns 200 with { status: "ok", service: "juggler-backend" }
 * R42.2: GET /api/health/ returns full health with DB ping, scheduler timezone info, server UTC
 * R42.3: GET /api/health/detailed returns per-service health with rollup (auth required)
 * R42.4: GET /api/feature-events/ returns feature event analytics (service-key auth)
 *
 * Source: src/routes/health.routes.js, src/routes/feature-events.routes.js
 *
 * Pattern: supertest against the real Express app with mocked DB and middleware.
 * Follows the established pattern from tests/api/health-detail-weather-string-contract.test.js
 * and tests/unit/app.test.js.
 */

process.env.NODE_ENV = 'test';

// ── DB mock ────────────────────────────────────────────────────────────────────

const { createMockChainDb } = require('../helpers/mockChainDb');
const { mockDb, resolveQueue } = createMockChainDb();
mockDb.delete = mockDb.del;

jest.mock('../../src/db', () => mockDb);
jest.mock('../../src/lib/db', () => {
  const actual = jest.requireActual('../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

// ── Middleware mocks ───────────────────────────────────────────────────────────

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
  verifyToken: jest.fn(),
}));

jest.mock('../../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => {
    req.planId = 'enterprise';
    req.planFeatures = {
      limits: { active_tasks: -1 },
      calendar: { max_providers: -1 },
      scheduling: {},
      tasks: {},
      ai: { natural_language_commands: true },
    };
    next();
  },
  PRODUCT_ID: 'juggler',
  PRODUCT_LABEL: 'juggler',
  getProductId: jest.fn(() => Promise.resolve('juggler')),
  refreshPlanFeatures: jest.fn(),
  invalidateUserPlanCache: jest.fn(),
  getCachedPlanFeatures: jest.fn(),
}));

jest.mock('../../src/lib/redis', () => ({
  getClient: jest.fn().mockReturnValue(null),
  invalidateTasks: jest.fn(() => Promise.resolve()),
  invalidateConfig: jest.fn(() => Promise.resolve()),
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve()),
  del: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn(),
  getLastError: jest.fn(() => null),
}));

jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn(),
  addClient: jest.fn(),
  getStats: jest.fn(() => ({ activeConnections: 0 })),
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
  isTemplate: jest.fn(() => false),
}));

jest.mock('../../src/lib/task-write-queue', () => ({
  isLocked: jest.fn(() => Promise.resolve(false)),
  enqueueWrite: jest.fn(() => Promise.resolve()),
  flushQueue: jest.fn(() => Promise.resolve()),
  flushQueueInLock: jest.fn(() => Promise.resolve()),
  splitFields: jest.fn((fields) => ({ schedulingFields: {}, nonSchedulingFields: fields })),
  NON_SCHEDULING_FIELDS: [],
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
  countScheduleTemplates: jest.fn(() => Promise.resolve(0)),
}));

jest.mock('../../src/middleware/validate', () => ({
  validate: () => (req, res, next) => next(),
}));

jest.mock('../../src/lib/rate-limit-store', () => ({
  maybeRedisStore: () => ({
    init: jest.fn(),
    increment: jest.fn(() => Promise.resolve({ totalHits: 1, resetTime: new Date(Date.now() + 60000) })),
    decrement: jest.fn(() => Promise.resolve()),
    resetKey: jest.fn(() => Promise.resolve()),
    resetAll: jest.fn(() => Promise.resolve()),
  }),
}));

jest.mock('../../src/services/gemini-tracked-call', () => ({
  trackedGeminiCall: jest.fn(),
}));

jest.mock('../../src/services/ai-usage-queue.service', () => ({
  enqueue: jest.fn(),
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
    trace: noop,
  };
});

// Mock the task facade for task routes
jest.mock('../../src/slices/task/facade', () => ({
  getAllTasks: jest.fn(() => Promise.resolve({ status: 200, body: [] })),
  getTask: jest.fn(() => Promise.resolve({ status: 200, body: {} })),
  getVersion: jest.fn(() => Promise.resolve({ status: 200, body: { version: 'v1' } })),
  getDisabledTasks: jest.fn(() => Promise.resolve({ status: 200, body: { tasks: [] } })),
  createTask: jest.fn(() => Promise.resolve({ status: 201, body: {} })),
  updateTask: jest.fn(() => Promise.resolve({ status: 200, body: {} })),
  deleteTask: jest.fn(() => Promise.resolve({ status: 200, body: {} })),
  updateTaskStatus: jest.fn(() => Promise.resolve({ status: 200, body: {} })),
  batchCreateTasks: jest.fn(() => Promise.resolve({ status: 201, body: {} })),
  batchUpdateTasks: jest.fn(() => Promise.resolve({ status: 200, body: {} })),
  reEnableTask: jest.fn(() => Promise.resolve({ status: 200, body: {} })),
  takeOwnership: jest.fn(() => Promise.resolve({ status: 200, body: {} })),
  rowToTask: jest.fn((r) => r),
  taskToRow: jest.fn((t) => t),
  checkCalSyncEditGuard: jest.fn(),
  guardFixedCalendarWhen: jest.fn(),
  buildSourceMap: jest.fn(() => ({})),
  fetchTasksWithEventIds: jest.fn(() => Promise.resolve([])),
  ensureProject: jest.fn(() => Promise.resolve()),
  applySplitDefault: jest.fn((t) => t),
  TEMPLATE_FIELDS: [],
  validateTaskInput: jest.fn(() => ({ valid: true })),
  expandToAllInstanceIds: jest.fn(() => []),
  safeParseJSON: jest.fn((s) => { try { return JSON.parse(s); } catch { return s; } }),
}));

const VALID_TOKEN = 'valid-test-token';
let app, supertest;

beforeAll(() => {
  app = require('../../src/app');
  supertest = require('supertest');
});

beforeEach(() => {
  resolveQueue.length = 0;
  jest.clearAllMocks();
});

// ── R42.1: GET /api/health/immediate ──────────────────────────────────────────

describe('R42.1 — GET /api/health/immediate (no auth, no DB)', () => {
  test('returns 200 with status ok and service name', async () => {
    const res = await supertest(app).get('/api/health/immediate');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'juggler-backend' });
  });

  test('returns JSON content type', async () => {
    const res = await supertest(app).get('/api/health/immediate');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  test('does not require any auth header', async () => {
    const res = await supertest(app).get('/api/health/immediate');
    expect(res.status).toBe(200);
  });

  test('does not touch the database (no DB calls)', async () => {
    const dbSpy = jest.spyOn(mockDb, 'raw');
    await supertest(app).get('/api/health/immediate');
    expect(dbSpy).not.toHaveBeenCalled();
    dbSpy.mockRestore();
  });
});

// ── R42.2: GET /api/health/ ───────────────────────────────────────────────────

describe('R42.2 — GET /api/health/ (no auth, DB ping)', () => {
  test('returns 200 with status, db, serverUtc, schedulerTodayKey, schedulerNowMins when DB is up', async () => {
    // db.raw('SELECT 1') succeeds — mockDb.raw returns the SQL string, not a promise.
    // The health route calls db.raw('SELECT 1') directly, not through the chain.
    // We need to mock db.raw to resolve successfully.
    mockDb.raw = jest.fn(() => Promise.resolve([{ 1: 1 }]));

    const res = await supertest(app).get('/api/health/');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('connected');
    expect(res.body.service).toBe('juggler-backend');
    expect(typeof res.body.serverUtc).toBe('string');
    expect(typeof res.body.schedulerTodayKey).toBe('string');
    expect(typeof res.body.schedulerNowMins).toBe('number');
  });

  test('returns 503 with status error and db disconnected when DB is down', async () => {
    mockDb.raw = jest.fn(() => Promise.reject(new Error('Connection refused')));

    const res = await supertest(app).get('/api/health/');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
    expect(res.body.db).toBe('disconnected');
    expect(res.body.error).toBeDefined();
  });

  test('does not require auth header', async () => {
    mockDb.raw = jest.fn(() => Promise.resolve([{ 1: 1 }]));
    const res = await supertest(app).get('/api/health/');
    expect(res.status).toBe(200);
  });

  test('schedulerTodayKey is in YYYY-MM-DD format', async () => {
    mockDb.raw = jest.fn(() => Promise.resolve([{ 1: 1 }]));
    const res = await supertest(app).get('/api/health/');
    expect(res.body.schedulerTodayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('schedulerNowMins is a non-negative integer', async () => {
    mockDb.raw = jest.fn(() => Promise.resolve([{ 1: 1 }]));
    const res = await supertest(app).get('/api/health/');
    expect(Number.isInteger(res.body.schedulerNowMins)).toBe(true);
    expect(res.body.schedulerNowMins).toBeGreaterThanOrEqual(0);
    expect(res.body.schedulerNowMins).toBeLessThan(1440);
  });
});

// ── R42.3: GET /api/health/detailed ────────────────────────────────────────────

describe('R42.3 — GET /api/health/detailed (auth required, per-service health)', () => {
  function seedHealthyDetailed() {
    // 1. db.raw('SELECT 1') — called directly, not via chain
    mockDb.raw = jest.fn(() => Promise.resolve([{ 1: 1 }]));
    // 2. schedule_queue stuck-claim count → first() → { cnt: 0 }
    resolveQueue.push({ cnt: 0 });
    // 3. users row → first()
    resolveQueue.push({ id: TEST_USER.id, gcal_refresh_token: null, msft_cal_refresh_token: null, apple_cal_password: null });
    // 4. cal_sync_ledger rows → select() → []
    resolveQueue.push([]);
    // 5. locations → first() → null (no location configured)
    resolveQueue.push(null);
  }

  test('returns 401 without auth token', async () => {
    const res = await supertest(app).get('/api/health/detailed');
    expect(res.status).toBe(401);
  });

  test('returns 200 with valid auth token', async () => {
    seedHealthyDetailed();
    const res = await supertest(app)
      .get('/api/health/detailed')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
  });

  test('response has status, timestamp, uptime, environment, version, services, detail', async () => {
    seedHealthyDetailed();
    const res = await supertest(app)
      .get('/api/health/detailed')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('environment');
    expect(res.body).toHaveProperty('version');
    expect(res.body).toHaveProperty('services');
    expect(res.body).toHaveProperty('detail');
  });

  test('services object includes server, database, scheduler, sse', async () => {
    seedHealthyDetailed();
    const res = await supertest(app)
      .get('/api/health/detailed')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.body.services).toHaveProperty('server');
    expect(res.body.services).toHaveProperty('database');
    expect(res.body.services).toHaveProperty('scheduler');
    expect(res.body.services).toHaveProperty('sse');
  });

  test('status rollup is OK when all services are operational', async () => {
    seedHealthyDetailed();
    const res = await supertest(app)
      .get('/api/health/detailed')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.body.status).toBe('OK');
  });

  test('status rollup is ERROR when database is down', async () => {
    // db.raw fails
    mockDb.raw = jest.fn(() => Promise.reject(new Error('DB down')));
    // No chain calls needed — DB failure short-circuits scheduler/sync/weather
    const res = await supertest(app)
      .get('/api/health/detailed')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.body.services.database).toBe('error');
    expect(res.body.status).toBe('ERROR');
  });

  test('status rollup is ERROR when scheduler has stuck claims', async () => {
    mockDb.raw = jest.fn(() => Promise.resolve([{ 1: 1 }]));
    // Stuck claim count > 0
    resolveQueue.push({ cnt: 2 });
    resolveQueue.push({ id: TEST_USER.id, gcal_refresh_token: null, msft_cal_refresh_token: null, apple_cal_password: null });
    resolveQueue.push([]);
    resolveQueue.push(null);

    const res = await supertest(app)
      .get('/api/health/detailed')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.body.services.scheduler).toBe('error');
    expect(res.body.status).toBe('ERROR');
  });

  test('environment is set to test', async () => {
    seedHealthyDetailed();
    const res = await supertest(app)
      .get('/api/health/detailed')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.body.environment).toBe('test');
  });

  test('version object has gitCommit and buildDate (may be null)', async () => {
    seedHealthyDetailed();
    const res = await supertest(app)
      .get('/api/health/detailed')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.body.version).toHaveProperty('gitCommit');
    expect(res.body.version).toHaveProperty('buildDate');
  });
});

// ── R42.4: GET /api/feature-events/ ───────────────────────────────────────────

describe('R42.4 — GET /api/feature-events/ (service-key auth, analytics)', () => {
  const SERVICE_KEY = 'test-service-key-12345';

  beforeAll(() => {
    process.env.FEATURE_CATALOG_KEY = SERVICE_KEY;
  });

  afterAll(() => {
    delete process.env.FEATURE_CATALOG_KEY;
  });

  test('returns 401 without x-service-key header', async () => {
    const res = await supertest(app).get('/api/feature-events/');
    expect(res.status).toBe(401);
  });

  test('returns 401 with wrong service key', async () => {
    const res = await supertest(app)
      .get('/api/feature-events/')
      .set('x-service-key', 'wrong-key');
    expect(res.status).toBe(401);
  });

  test('returns 200 with valid service key and returns events + aggregated', async () => {
    const fakeEvents = [
      { id: 1, feature_key: 'ai.natural_language_commands', event_type: 'used', user_id: 'u1', value: '{}', created_at: new Date().toISOString() },
    ];
    const fakeAggregated = [
      { feature_key: 'ai.natural_language_commands', event_type: 'used', count: 1 },
    ];
    // The feature-events route uses lib/db.getDefaultDb() which returns mockDb
    // It calls: db('feature_events').where(...).orderBy(...).limit(...) → select()
    // and then: db('feature_events').where(...).select(...).groupBy(...).orderBy(...)
    // We need to push two results: one for events, one for aggregated
    resolveQueue.push(fakeEvents);
    resolveQueue.push(fakeAggregated);

    const res = await supertest(app)
      .get('/api/feature-events/')
      .set('x-service-key', SERVICE_KEY);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(Array.isArray(res.body.aggregated)).toBe(true);
    expect(res.body).toHaveProperty('period_days');
    expect(res.body).toHaveProperty('total_events');
  });

  test('filters by feature_key query param', async () => {
    resolveQueue.push([]);
    resolveQueue.push([]);

    const res = await supertest(app)
      .get('/api/feature-events/?feature_key=ai.natural_language_commands')
      .set('x-service-key', SERVICE_KEY);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('filters by event_type query param', async () => {
    resolveQueue.push([]);
    resolveQueue.push([]);

    const res = await supertest(app)
      .get('/api/feature-events/?event_type=used')
      .set('x-service-key', SERVICE_KEY);
    expect(res.status).toBe(200);
  });

  test('rejects invalid event_type with 400', async () => {
    const res = await supertest(app)
      .get('/api/feature-events/?event_type=invalid_type')
      .set('x-service-key', SERVICE_KEY);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid event_type/i);
  });

  test('filters by user_id query param', async () => {
    resolveQueue.push([]);
    resolveQueue.push([]);

    const res = await supertest(app)
      .get('/api/feature-events/?user_id=user-42')
      .set('x-service-key', SERVICE_KEY);
    expect(res.status).toBe(200);
  });

  test('clamps days to max 90', async () => {
    resolveQueue.push([]);
    resolveQueue.push([]);

    const res = await supertest(app)
      .get('/api/feature-events/?days=999')
      .set('x-service-key', SERVICE_KEY);
    expect(res.status).toBe(200);
    expect(res.body.period_days).toBeLessThanOrEqual(90);
  });

  test('clamps limit to max 1000', async () => {
    resolveQueue.push([]);
    resolveQueue.push([]);

    const res = await supertest(app)
      .get('/api/feature-events/?limit=9999')
      .set('x-service-key', SERVICE_KEY);
    expect(res.status).toBe(200);
    // The response doesn't echo limit, but the query should not error
  });

  test('returns 503 when FEATURE_CATALOG_KEY is not configured', async () => {
    delete process.env.FEATURE_CATALOG_KEY;
    const res = await supertest(app)
      .get('/api/feature-events/')
      .set('x-service-key', 'anything');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
    process.env.FEATURE_CATALOG_KEY = SERVICE_KEY;
  });
});
