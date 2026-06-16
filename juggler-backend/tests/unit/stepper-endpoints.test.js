/**
 * Scheduler Stepper endpoint tests — R44.3–R44.7
 *
 * R44.3: POST /api/schedule/debug — admin debug scheduler endpoint
 * R44.4: POST /api/schedule/step/start — stepper session start
 * R44.5: GET /api/schedule/step/:sessionId/summary — stepper session summary
 * R44.6: GET /api/schedule/step/:sessionId/:stepIndex — individual step
 * R44.7: POST /api/schedule/step/:sessionId/stop — stop stepper session
 *
 * Source: src/routes/schedule.routes.js
 *
 * Pattern: supertest against the real Express app with mocked DB, auth, and
 * scheduler session dependencies. Follows the established pattern from
 * tests/api/health-detail-weather-string-contract.test.js and
 * tests/unit/schedulerSession.test.js.
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

const TEST_USER = { id: 'user-42', email: 'admin@test.com', name: 'Admin', timezone: 'America/New_York' };

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

// Admin middleware: check if user email is in ADMIN_EMAILS env var
jest.mock('../../src/middleware/authenticateAdmin', () => {
  return (req, res, next) => {
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!adminEmails.includes(req.user.email)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  };
});

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

// Mock the task facade
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
  unifiedScheduleV2: jest.fn(() => ({
    placedCount: 0,
    unplaced: [],
    score: { total: 0 },
    warnings: [],
    phaseSnapshots: [],
  })),
}));

// Mock the scheduler session module
const mockSchedulerSession = {
  startSession: jest.fn(),
  getSession: jest.fn(),
  getStep: jest.fn(),
  getSummary: jest.fn(),
  stopSession: jest.fn(),
  _computeStep: jest.fn(),
  _computeSummary: jest.fn(),
};

jest.mock('../../src/scheduler/schedulerSession', () => mockSchedulerSession);

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

// ── R44.3: POST /api/schedule/debug ────────────────────────────────────────────

describe('R44.3 — POST /api/schedule/debug (admin debug scheduler)', () => {
  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'admin@test.com';
  });

  afterEach(() => {
    delete process.env.ADMIN_EMAILS;
  });

  test('returns 401 without auth token', async () => {
    const res = await supertest(app).post('/api/schedule/debug');
    expect(res.status).toBe(401);
  });

  test('returns 403 for non-admin user', async () => {
    process.env.ADMIN_EMAILS = 'other-admin@test.com';
    const res = await supertest(app)
      .post('/api/schedule/debug')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(403);
  });

  test('returns 200 with debug result for admin user', async () => {
    // The debug endpoint loads tasks from DB and config, then calls unifiedSchedule
    // Mock: tasks_v query → select() → [], user_config query → select() → []
    resolveQueue.push([]); // tasks_v
    resolveQueue.push([]); // user_config

    const res = await supertest(app)
      .post('/api/schedule/debug')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('todayKey');
    expect(res.body).toHaveProperty('nowMins');
    expect(res.body).toHaveProperty('timezone');
    expect(res.body).toHaveProperty('taskCount');
    expect(res.body).toHaveProperty('placedCount');
    expect(res.body).toHaveProperty('unplacedCount');
    expect(res.body).toHaveProperty('score');
    expect(res.body).toHaveProperty('warnings');
    expect(res.body).toHaveProperty('phaseSnapshots');
  });

  test('returns phaseSnapshots as an array', async () => {
    resolveQueue.push([]);
    resolveQueue.push([]);

    const res = await supertest(app)
      .post('/api/schedule/debug')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(Array.isArray(res.body.phaseSnapshots)).toBe(true);
  });

  test('taskCount reflects number of tasks loaded', async () => {
    resolveQueue.push([]);
    resolveQueue.push([]);

    const res = await supertest(app)
      .post('/api/schedule/debug')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(typeof res.body.taskCount).toBe('number');
  });
});

// ── R44.4: POST /api/schedule/step/start ───────────────────────────────────────

describe('R44.4 — POST /api/schedule/step/start (stepper session start)', () => {
  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'admin@test.com';
  });

  afterEach(() => {
    delete process.env.ADMIN_EMAILS;
  });

  test('returns 401 without auth token', async () => {
    const res = await supertest(app).post('/api/schedule/step/start');
    expect(res.status).toBe(401);
  });

  test('returns 403 for non-admin user', async () => {
    process.env.ADMIN_EMAILS = 'other-admin@test.com';
    const res = await supertest(app)
      .post('/api/schedule/step/start')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(403);
  });

  test('returns 200 with session info for admin user', async () => {
    mockSchedulerSession.startSession.mockResolvedValue({
      sessionId: 'sess-abc-123',
      totalSteps: 5,
      todayKey: '2026-06-16',
      nowMins: 540,
      timezone: 'America/New_York',
      summary: { taskCount: 3, placedCount: 2, unplacedCount: 1, score: { total: 42 } },
    });

    const res = await supertest(app)
      .post('/api/schedule/step/start')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe('sess-abc-123');
    expect(res.body.totalSteps).toBe(5);
    expect(res.body.todayKey).toBe('2026-06-16');
    expect(res.body.nowMins).toBe(540);
    expect(res.body.timezone).toBe('America/New_York');
    expect(res.body.summary).toBeDefined();
  });

  test('calls schedulerSession.startSession with user id and timezone', async () => {
    mockSchedulerSession.startSession.mockResolvedValue({
      sessionId: 'sess-xyz',
      totalSteps: 0,
      todayKey: '2026-06-16',
      nowMins: 540,
      timezone: 'America/New_York',
      summary: { taskCount: 0, placedCount: 0, unplacedCount: 0, score: {} },
    });

    await supertest(app)
      .post('/api/schedule/step/start')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('x-timezone', 'America/Los_Angeles');

    expect(mockSchedulerSession.startSession).toHaveBeenCalledWith(
      TEST_USER.id,
      expect.objectContaining({ timezone: 'America/Los_Angeles' })
    );
  });

  test('uses default timezone when x-timezone header is not provided', async () => {
    mockSchedulerSession.startSession.mockResolvedValue({
      sessionId: 'sess-xyz',
      totalSteps: 0,
      todayKey: '2026-06-16',
      nowMins: 540,
      timezone: 'America/New_York',
      summary: { taskCount: 0, placedCount: 0, unplacedCount: 0, score: {} },
    });

    await supertest(app)
      .post('/api/schedule/step/start')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(mockSchedulerSession.startSession).toHaveBeenCalledWith(
      TEST_USER.id,
      expect.objectContaining({ timezone: 'America/New_York' })
    );
  });
});

// ── R44.5: GET /api/schedule/step/:sessionId/summary ───────────────────────────

describe('R44.5 — GET /api/schedule/step/:sessionId/summary (stepper summary)', () => {
  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'admin@test.com';
  });

  afterEach(() => {
    delete process.env.ADMIN_EMAILS;
  });

  test('returns 401 without auth token', async () => {
    const res = await supertest(app).get('/api/schedule/step/sess-abc/summary');
    expect(res.status).toBe(401);
  });

  test('returns 403 for non-admin user', async () => {
    process.env.ADMIN_EMAILS = 'other-admin@test.com';
    const res = await supertest(app)
      .get('/api/schedule/step/sess-abc/summary')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(403);
  });

  test('returns 404 when session not found', async () => {
    mockSchedulerSession.getSession.mockResolvedValue(null);

    const res = await supertest(app)
      .get('/api/schedule/step/sess-nonexistent/summary')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(404);
  });

  test('returns 404 when session belongs to another user', async () => {
    mockSchedulerSession.getSession.mockResolvedValue({
      sessionId: 'sess-other',
      userId: 'other-user',
      todayKey: '2026-06-16',
      nowMins: 540,
      timezone: 'America/New_York',
      snapshots: [],
      tasksById: {},
      unplaced: [],
      score: {},
      warnings: [],
      slackByTaskId: {},
    });

    const res = await supertest(app)
      .get('/api/schedule/step/sess-other/summary')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(404);
  });

  test('returns 200 with summary for valid session owned by user', async () => {
    const sessionObj = {
      sessionId: 'sess-my',
      userId: TEST_USER.id,
      todayKey: '2026-06-16',
      nowMins: 540,
      timezone: 'America/New_York',
      snapshots: [
        { stepIndex: 0, phase: 'V2: Unconstrained', taskId: 't1', taskText: 'Task 1', project: 'proj', pri: 'P3', orderingSlack: 120, placement: { dateKey: '2026-06-16', start: 480, dur: 30 } },
        { stepIndex: 1, phase: 'V2: Constrained', taskId: 't2', taskText: 'Task 2', project: 'proj', pri: 'P2', orderingSlack: 60, placement: { dateKey: '2026-06-16', start: 510, dur: 45 } },
      ],
      tasksById: {},
      unplaced: [],
      score: { total: 85 },
      warnings: [],
      slackByTaskId: {},
    };
    mockSchedulerSession.getSession.mockResolvedValue(sessionObj);
    mockSchedulerSession._computeSummary.mockReturnValue({
      sessionId: 'sess-my',
      totalSteps: 2,
      todayKey: '2026-06-16',
      nowMins: 540,
      timezone: 'America/New_York',
      unplaced: [],
      score: { total: 85 },
      warnings: [],
      queue: [
        { stepIndex: 0, phase: 'V2: Unconstrained', taskId: 't1', taskText: 'Task 1', project: 'proj', pri: 'P3', orderingSlack: 120, placement: { dateKey: '2026-06-16', start: 480, dur: 30 } },
        { stepIndex: 1, phase: 'V2: Constrained', taskId: 't2', taskText: 'Task 2', project: 'proj', pri: 'P2', orderingSlack: 60, placement: { dateKey: '2026-06-16', start: 510, dur: 45 } },
      ],
    });

    const res = await supertest(app)
      .get('/api/schedule/step/sess-my/summary')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe('sess-my');
    expect(res.body.totalSteps).toBe(2);
    expect(Array.isArray(res.body.queue)).toBe(true);
    expect(res.body.queue.length).toBe(2);
  });

  test('summary includes totalSteps, queue, score, unplaced, warnings', async () => {
    const sessionObj = {
      sessionId: 'sess-my',
      userId: TEST_USER.id,
      todayKey: '2026-06-16',
      nowMins: 540,
      timezone: 'America/New_York',
      snapshots: [],
      tasksById: {},
      unplaced: [],
      score: { total: 0 },
      warnings: [],
      slackByTaskId: {},
    };
    mockSchedulerSession.getSession.mockResolvedValue(sessionObj);
    mockSchedulerSession._computeSummary.mockReturnValue({
      sessionId: 'sess-my',
      totalSteps: 0,
      todayKey: '2026-06-16',
      nowMins: 540,
      timezone: 'America/New_York',
      unplaced: [],
      score: { total: 0 },
      warnings: [],
      queue: [],
    });

    const res = await supertest(app)
      .get('/api/schedule/step/sess-my/summary')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalSteps');
    expect(res.body).toHaveProperty('queue');
    expect(res.body).toHaveProperty('score');
    expect(res.body).toHaveProperty('unplaced');
    expect(res.body).toHaveProperty('warnings');
  });
});

// ── R44.6: GET /api/schedule/step/:sessionId/:stepIndex ────────────────────────

describe('R44.6 — GET /api/schedule/step/:sessionId/:stepIndex (individual step)', () => {
  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'admin@test.com';
  });

  afterEach(() => {
    delete process.env.ADMIN_EMAILS;
  });

  test('returns 401 without auth token', async () => {
    const res = await supertest(app).get('/api/schedule/step/sess-abc/0');
    expect(res.status).toBe(401);
  });

  test('returns 403 for non-admin user', async () => {
    process.env.ADMIN_EMAILS = 'other-admin@test.com';
    const res = await supertest(app)
      .get('/api/schedule/step/sess-abc/0')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(403);
  });

  test('returns 400 when stepIndex is not an integer', async () => {
    const res = await supertest(app)
      .get('/api/schedule/step/sess-abc/not-a-number')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/integer/i);
  });

  test('returns 404 when session not found', async () => {
    mockSchedulerSession.getSession.mockResolvedValue(null);

    const res = await supertest(app)
      .get('/api/schedule/step/sess-nonexistent/0')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(404);
  });

  test('returns 404 when session belongs to another user', async () => {
    mockSchedulerSession.getSession.mockResolvedValue({
      sessionId: 'sess-other',
      userId: 'other-user',
      todayKey: '2026-06-16',
      nowMins: 540,
      timezone: 'America/New_York',
      snapshots: [],
      tasksById: {},
      unplaced: [],
      score: {},
      warnings: [],
      slackByTaskId: {},
    });

    const res = await supertest(app)
      .get('/api/schedule/step/sess-other/0')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(404);
  });

  test('returns 404 when stepIndex is out of range', async () => {
    const sessionObj = {
      sessionId: 'sess-my',
      userId: TEST_USER.id,
      todayKey: '2026-06-16',
      nowMins: 540,
      timezone: 'America/New_York',
      snapshots: [{ stepIndex: 0, phase: 'V2: Unconstrained', taskId: 't1', taskText: 'Task 1', project: 'proj', pri: 'P3', orderingSlack: 120, placement: { dateKey: '2026-06-16', start: 480, dur: 30 } }],
      tasksById: {},
      unplaced: [],
      score: {},
      warnings: [],
      slackByTaskId: {},
    };
    mockSchedulerSession.getSession.mockResolvedValue(sessionObj);
    mockSchedulerSession._computeStep.mockReturnValue(null);

    const res = await supertest(app)
      .get('/api/schedule/step/sess-my/99')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(404);
  });

  test('returns 200 with step data for valid session and step index', async () => {
    const sessionObj = {
      sessionId: 'sess-my',
      userId: TEST_USER.id,
      todayKey: '2026-06-16',
      nowMins: 540,
      timezone: 'America/New_York',
      snapshots: [{ stepIndex: 0, phase: 'V2: Unconstrained', taskId: 't1', taskText: 'Task 1', project: 'proj', pri: 'P3', orderingSlack: 120, placement: { dateKey: '2026-06-16', start: 480, dur: 30 } }],
      tasksById: { t1: { id: 't1', text: 'Task 1', project: 'proj', pri: 'P3', dur: 30, when: '', deadline: null, startAfter: null, recurring: false, split: false, splitMin: null, location: [], tools: [] } },
      unplaced: [],
      score: {},
      warnings: [],
      slackByTaskId: {},
    };
    mockSchedulerSession.getSession.mockResolvedValue(sessionObj);
    mockSchedulerSession._computeStep.mockReturnValue({
      stepIndex: 0,
      totalSteps: 1,
      phase: 'V2: Unconstrained',
      taskId: 't1',
      taskText: 'Task 1',
      orderingSlack: 120,
      placement: { dateKey: '2026-06-16', start: 480, dur: 30 },
      task: { id: 't1', text: 'Task 1', project: 'proj', pri: 'P3', dur: 30 },
      upcoming: [],
    });

    const res = await supertest(app)
      .get('/api/schedule/step/sess-my/0')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.stepIndex).toBe(0);
    expect(res.body.totalSteps).toBe(1);
    expect(res.body.phase).toBe('V2: Unconstrained');
    expect(res.body.task).toBeDefined();
  });

  test('step response includes upcoming preview', async () => {
    const sessionObj = {
      sessionId: 'sess-my',
      userId: TEST_USER.id,
      todayKey: '2026-06-16',
      nowMins: 540,
      timezone: 'America/New_York',
      snapshots: [
        { stepIndex: 0, phase: 'V2: Unconstrained', taskId: 't1', taskText: 'Task 1', project: 'proj', pri: 'P3', orderingSlack: 120, placement: { dateKey: '2026-06-16', start: 480, dur: 30 } },
        { stepIndex: 1, phase: 'V2: Constrained', taskId: 't2', taskText: 'Task 2', project: 'proj', pri: 'P2', orderingSlack: 60, placement: { dateKey: '2026-06-16', start: 510, dur: 45 } },
      ],
      tasksById: {},
      unplaced: [],
      score: {},
      warnings: [],
      slackByTaskId: {},
    };
    mockSchedulerSession.getSession.mockResolvedValue(sessionObj);
    mockSchedulerSession._computeStep.mockReturnValue({
      stepIndex: 0,
      totalSteps: 2,
      phase: 'V2: Unconstrained',
      taskId: 't1',
      taskText: 'Task 1',
      orderingSlack: 120,
      placement: { dateKey: '2026-06-16', start: 480, dur: 30 },
      task: null,
      upcoming: [{ stepIndex: 1, phase: 'V2: Constrained', taskId: 't2', taskText: 'Task 2', orderingSlack: 60 }],
    });

    const res = await supertest(app)
      .get('/api/schedule/step/sess-my/0')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.upcoming)).toBe(true);
  });
});

// ── R44.7: POST /api/schedule/step/:sessionId/stop ─────────────────────────────

describe('R44.7 — POST /api/schedule/step/:sessionId/stop (stop stepper session)', () => {
  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'admin@test.com';
  });

  afterEach(() => {
    delete process.env.ADMIN_EMAILS;
  });

  test('returns 401 without auth token', async () => {
    const res = await supertest(app).post('/api/schedule/step/sess-abc/stop');
    expect(res.status).toBe(401);
  });

  test('returns 403 for non-admin user', async () => {
    process.env.ADMIN_EMAILS = 'other-admin@test.com';
    const res = await supertest(app)
      .post('/api/schedule/step/sess-abc/stop')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(403);
  });

  test('returns 403 when session belongs to another user', async () => {
    mockSchedulerSession.getSession.mockResolvedValue({
      sessionId: 'sess-other',
      userId: 'other-user',
      todayKey: '2026-06-16',
      nowMins: 540,
      timezone: 'America/New_York',
      snapshots: [],
      tasksById: {},
      unplaced: [],
      score: {},
      warnings: [],
      slackByTaskId: {},
    });

    const res = await supertest(app)
      .post('/api/schedule/step/sess-other/stop')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not your session/i);
  });

  test('returns 200 with ok:true for valid session owned by user', async () => {
    mockSchedulerSession.getSession.mockResolvedValue({
      sessionId: 'sess-my',
      userId: TEST_USER.id,
      todayKey: '2026-06-16',
      nowMins: 540,
      timezone: 'America/New_York',
      snapshots: [],
      tasksById: {},
      unplaced: [],
      score: {},
      warnings: [],
      slackByTaskId: {},
    });
    mockSchedulerSession.stopSession.mockResolvedValue();

    const res = await supertest(app)
      .post('/api/schedule/step/sess-my/stop')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('stop is idempotent — returns ok:true for already-expired session', async () => {
    // Session not found in memory (expired), but check raw DB for ownership
    mockSchedulerSession.getSession.mockResolvedValue(null);
    // The route falls through to check raw DB: db('scheduler_sessions').where('session_id', ...).first()
    resolveQueue.push({ session_id: 'sess-expired', user_id: TEST_USER.id });

    const res = await supertest(app)
      .post('/api/schedule/step/sess-expired/stop')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('returns 403 when expired session belongs to another user (checked via raw DB)', async () => {
    mockSchedulerSession.getSession.mockResolvedValue(null);
    // Raw DB check: session exists but belongs to another user
    resolveQueue.push({ session_id: 'sess-expired-other', user_id: 'other-user' });

    const res = await supertest(app)
      .post('/api/schedule/step/sess-expired-other/stop')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not your session/i);
  });

  test('calls stopSession on schedulerSession module', async () => {
    mockSchedulerSession.getSession.mockResolvedValue({
      sessionId: 'sess-my',
      userId: TEST_USER.id,
      todayKey: '2026-06-16',
      nowMins: 540,
      timezone: 'America/New_York',
      snapshots: [],
      tasksById: {},
      unplaced: [],
      score: {},
      warnings: [],
      slackByTaskId: {},
    });
    mockSchedulerSession.stopSession.mockResolvedValue();

    await supertest(app)
      .post('/api/schedule/step/sess-my/stop')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(mockSchedulerSession.stopSession).toHaveBeenCalledWith('sess-my');
  });
});
