/**
 * Task data endpoint tests — R46.1–R46.2
 *
 * R46.1: GET /api/tasks/version — returns current data version for cache invalidation
 * R46.2: GET /api/tasks/disabled — returns list of disabled (soft-deleted) tasks
 *
 * Source: src/routes/task.routes.js, src/controllers/task.controller.js
 *   - GET /api/tasks/version → taskController.getVersion → facade.getVersion
 *   - GET /api/tasks/disabled → taskController.getDisabledTasks → facade.getDisabledTasks
 *
 * Pattern: supertest against the real Express app with mocked DB, auth, and facade.
 * Follows the established pattern from tests/api/misc-routes.test.js and
 * tests/api/health-detail-weather-string-contract.test.js.
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
    req.auth = { plans: {} };
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
  archiveInstances: jest.fn(() => Promise.resolve()),
  archiveCompletedInstances: jest.fn(() => Promise.resolve()),
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

// ── Task facade mock ──────────────────────────────────────────────────────────

const mockGetVersion = jest.fn();
const mockGetDisabledTasks = jest.fn();

jest.mock('../../src/slices/task/facade', () => ({
  getAllTasks: jest.fn(() => Promise.resolve({ status: 200, body: [] })),
  getTask: jest.fn(() => Promise.resolve({ status: 200, body: {} })),
  getVersion: (...args) => mockGetVersion(...args),
  getDisabledTasks: (...args) => mockGetDisabledTasks(...args),
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

// ── R46.1: GET /api/tasks/version ─────────────────────────────────────────────

describe('R46.1 — GET /api/tasks/version (data version endpoint)', () => {
  test('returns 401 without auth token', async () => {
    const res = await supertest(app).get('/api/tasks/version');
    expect(res.status).toBe(401);
  });

  test('returns 200 with version object for authenticated user', async () => {
    mockGetVersion.mockResolvedValue({ status: 200, body: { version: 'v1' } });

    const res = await supertest(app)
      .get('/api/tasks/version')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('version');
  });

  test('version is a string or number that changes when tasks are modified', async () => {
    // First call returns version 'v1'
    mockGetVersion.mockResolvedValueOnce({ status: 200, body: { version: 'v1' } });
    const res1 = await supertest(app)
      .get('/api/tasks/version')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res1.body.version).toBe('v1');

    // Second call returns version 'v2' (simulating a task modification)
    mockGetVersion.mockResolvedValueOnce({ status: 200, body: { version: 'v2' } });
    const res2 = await supertest(app)
      .get('/api/tasks/version')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res2.body.version).toBe('v2');

    // Versions differ after modification
    expect(res1.body.version).not.toBe(res2.body.version);
  });

  test('version can be a timestamp-based string', async () => {
    const ts = new Date().toISOString();
    mockGetVersion.mockResolvedValue({ status: 200, body: { version: ts } });

    const res = await supertest(app)
      .get('/api/tasks/version')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.version).toBe('string');
  });

  test('version can be a numeric counter', async () => {
    mockGetVersion.mockResolvedValue({ status: 200, body: { version: 42 } });

    const res = await supertest(app)
      .get('/api/tasks/version')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.version).toBe('number');
  });

  test('passes userId to facade.getVersion', async () => {
    mockGetVersion.mockResolvedValue({ status: 200, body: { version: 'v1' } });

    await supertest(app)
      .get('/api/tasks/version')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(mockGetVersion).toHaveBeenCalledWith(
      expect.objectContaining({ userId: TEST_USER.id })
    );
  });

  test('returns 500 when facade throws', async () => {
    mockGetVersion.mockRejectedValue(new Error('DB error'));

    const res = await supertest(app)
      .get('/api/tasks/version')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(500);
  });
});

// ── R46.2: GET /api/tasks/disabled ─────────────────────────────────────────────

describe('R46.2 — GET /api/tasks/disabled (disabled tasks list)', () => {
  test('returns 401 without auth token', async () => {
    const res = await supertest(app).get('/api/tasks/disabled');
    expect(res.status).toBe(401);
  });

  test('returns 200 with tasks array for authenticated user', async () => {
    mockGetDisabledTasks.mockResolvedValue({ status: 200, body: { tasks: [] } });

    const res = await supertest(app)
      .get('/api/tasks/disabled')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tasks');
    expect(Array.isArray(res.body.tasks)).toBe(true);
  });

  test('returns disabled tasks with their fields', async () => {
    const disabledTasks = [
      { id: 'task-disabled-1', text: 'Old task', status: 'disabled', priority: 'P3', dur: 30, project: 'Work', created_at: '2026-01-15T10:00:00Z' },
      { id: 'task-disabled-2', text: 'Another disabled', status: 'disabled', priority: 'P2', dur: 60, project: 'Personal', created_at: '2026-02-20T14:30:00Z' },
    ];
    mockGetDisabledTasks.mockResolvedValue({ status: 200, body: { tasks: disabledTasks } });

    const res = await supertest(app)
      .get('/api/tasks/disabled')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.tasks.length).toBe(2);
    expect(res.body.tasks[0].id).toBe('task-disabled-1');
    expect(res.body.tasks[0].status).toBe('disabled');
    expect(res.body.tasks[1].id).toBe('task-disabled-2');
  });

  test('returns empty array when no disabled tasks exist', async () => {
    mockGetDisabledTasks.mockResolvedValue({ status: 200, body: { tasks: [] } });

    const res = await supertest(app)
      .get('/api/tasks/disabled')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.tasks).toEqual([]);
  });

  test('passes userId to facade.getDisabledTasks', async () => {
    mockGetDisabledTasks.mockResolvedValue({ status: 200, body: { tasks: [] } });

    await supertest(app)
      .get('/api/tasks/disabled')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(mockGetDisabledTasks).toHaveBeenCalledWith(
      expect.objectContaining({ userId: TEST_USER.id })
    );
  });

  test('returns 500 when facade throws', async () => {
    mockGetDisabledTasks.mockRejectedValue(new Error('DB error'));

    const res = await supertest(app)
      .get('/api/tasks/disabled')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(500);
  });

  test('disabled tasks are scoped to the authenticated user (not cross-user)', async () => {
    // The facade receives the user's ID from the JWT middleware
    mockGetDisabledTasks.mockImplementation(({ userId }) => {
      if (userId === TEST_USER.id) {
        return Promise.resolve({ status: 200, body: { tasks: [{ id: 't1', text: 'My disabled task', status: 'disabled' }] } });
      }
      return Promise.resolve({ status: 200, body: { tasks: [] } });
    });

    const res = await supertest(app)
      .get('/api/tasks/disabled')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.tasks.length).toBe(1);
    expect(res.body.tasks[0].id).toBe('t1');
  });
});
