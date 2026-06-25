/**
 * Controller tests — exportData format negotiation (AC1, AC2)
 *
 * Covers:
 *   AC1: ?format=csv → 200 text/csv + Content-Disposition attachment + CSV body
 *   AC2: no format / format=json → sendEnvelope / JSON v7 envelope unchanged
 *
 * Pattern: supertest route test following the existing data-and-weather.test.js
 * harness exactly — mockChainDb + resolveQueue, same JWT/plan/redis mocks.
 * The resolveQueue is pre-populated to satisfy the exportData use-case's DB calls
 * (same sequence as the existing 'exports tasks as JSON with v7 flag' test).
 */

process.env.NODE_ENV = 'test';

const { createMockChainDb } = require('../helpers/mockChainDb');
const { mockDb, resolveQueue } = createMockChainDb();

mockDb.delete = mockDb.del;

jest.mock('../../src/db', () => mockDb);

jest.mock('../../src/lib/db', () => {
  const actual = jest.requireActual('../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

// JWT mock
const TEST_USER = {
  id: 'user-123', email: 'test@test.com', name: 'Test', timezone: 'America/New_York'
};
jest.mock('../../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer '))
      return res.status(401).json({ error: 'Authentication required' });
    req.user = { ...TEST_USER };
    req.auth = { plans: {}, apps: ['juggler'] };
    next();
  },
  verifyToken: jest.fn()
}));

// Plan-features mock — export enabled
let mockPlanFeatures = {
  limits: { active_tasks: -1, recurring_templates: -1, projects: -1, locations: -1, schedule_templates: -1, ai_commands_per_month: -1 },
  ai: { natural_language_commands: true },
  calendar: { max_providers: -1, auto_sync: true },
  scheduling: { dependencies: true, travel_time: true },
  tasks: { rigid: true },
  data: { export: true, import: true, mcp_access: true }
};
jest.mock('../../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => {
    req.planId = 'enterprise';
    req.planFeatures = mockPlanFeatures;
    next();
  },
  PRODUCT_ID: 'juggler',
  refreshPlanFeatures: jest.fn(),
  getCachedPlanFeatures: jest.fn()
}));

// Redis mock
jest.mock('../../src/lib/redis', () => ({
  getClient: jest.fn().mockReturnValue(null),
  invalidateTasks: jest.fn(() => Promise.resolve()),
  invalidateConfig: jest.fn(() => Promise.resolve()),
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(true)),
  del: jest.fn(() => Promise.resolve())
}));

// SSE emitter mock
jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn(),
  addClient: jest.fn()
}));

// scheduleQueue mock
jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
}));

// sync-lock mock
jest.mock('../../src/lib/sync-lock', () => ({
  withSyncLock: (fn) => fn,
  acquireLock: jest.fn(() => Promise.resolve(true)),
  releaseLock: jest.fn(() => Promise.resolve()),
  refreshLock: jest.fn(() => Promise.resolve())
}));

// tasks-write mock
jest.mock('../../src/lib/tasks-write', () => ({
  insertTask: jest.fn(() => Promise.resolve()),
  updateTask: jest.fn(() => Promise.resolve()),
  deleteTasksWhere: jest.fn(() => Promise.resolve()),
  updateTasksWhere: jest.fn(() => Promise.resolve())
}));

// lib/logger mock (same shape as data-and-weather.test.js)
jest.mock('../../src/lib/logger', () => {
  const noop = jest.fn();
  const fakeLogger = { error: noop, warn: noop, info: noop, debug: noop, trace: noop };
  const createLogger = jest.fn(() => fakeLogger);
  return {
    createLogger,
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

// Mock global fetch (needed by weather controller that may be loaded)
let mockFetch;
beforeAll(() => {
  mockFetch = jest.fn();
  global.fetch = mockFetch;
});

// ── Queue helpers ─────────────────────────────────────────────────────────────
//
// exportData (in the user-config facade / ExportData use-case) makes the same
// DB calls as the existing test in data-and-weather.test.js:
//   1. fetchTasksWithEventIds: tasks_v (then terminal) → rows
//   2. fetchTasksWithEventIds: cal_sync_ledger (select terminal) → []
//   3. fetchTasksWithEventIds: user_calendars (select terminal) → []
//   4. locations query (orderBy → select terminal) → []
//   5. tools query (orderBy → select terminal) → []
//   6. projects query (orderBy → select terminal) → []
//   7. user_config query (then terminal) → []
//
// For CSV tests we push a single task row in slot 1 so the CSV body is non-empty.

/**
 * One realistic task row as returned by the DB (pre-rowToTask mapping).
 * These fields are what fetchTasksWithEventIds returns (task_masters + task_instances view).
 */
const DB_TASK_ROW = {
  id: 'task-1',
  user_id: 'user-123',
  text: 'Buy groceries',
  task_type: 'one-off',
  status: 'active',
  pri: 'P2',
  project: 'Personal',
  dur: 30,
  scheduled_at: null,
  date: '2026-06-14',
  time: '09:00',
  deadline: null,
  start_after: null,
  recurring: 0,
  location: '["Home"]',
  tools: '[]',
  notes: null,
  url: null,
  completed_at: null,
  provider_event_id: null,
  apple_event_id: null,
  display_name: null,
  provider: null
};

/**
 * Push the 7-slot resolveQueue for a successful exportData call.
 *
 * Slot consumption ORDER (mockChainDb: .select()/.first() are CHAINABLE, NOT
 * terminal — only .then resolves a queue item, in Promise.all array order):
 *   KnexTaskRepository.fetchTasksWithEventIds → Promise.all([ q, ledger, userCal ]):
 *     slot 0: tasks_v q             ← FIRST in the inner Promise.all array
 *     slot 1: cal_sync_ledger       (.select() is chainable → resolves via .then)
 *     slot 2: user_calendars        (.select() is chainable → resolves via .then)
 *   ExportData outer Promise.all then registers:
 *     slot 3: locations
 *     slot 4: tools
 *     slot 5: projects
 *     slot 6: user_config
 *
 * taskRows go into slot 0 (tasks_v) — it is the FIRST element of the inner Promise.all.
 */
function pushExportQueue(taskRows) {
  resolveQueue.push(taskRows);  // slot 0: tasks_v (first in inner Promise.all)
  resolveQueue.push([]);        // slot 1: cal_sync_ledger
  resolveQueue.push([]);        // slot 2: user_calendars
  resolveQueue.push([]);        // slot 3: locations
  resolveQueue.push([]);        // slot 4: tools
  resolveQueue.push([]);        // slot 5: projects
  resolveQueue.push([]);        // slot 6: user_config
}

// ── Test setup ────────────────────────────────────────────────────────────────

const VALID_TOKEN = 'valid-test-token';
let app, request;

beforeAll(async () => {
  app = require('../../src/app');
  request = require('supertest');
});

beforeEach(() => {
  resolveQueue.length = 0;
  jest.clearAllMocks();
  mockFetch = jest.fn();
  global.fetch = mockFetch;
  mockPlanFeatures = {
    limits: { active_tasks: -1, recurring_templates: -1, projects: -1, locations: -1, schedule_templates: -1, ai_commands_per_month: -1 },
    ai: { natural_language_commands: true },
    calendar: { max_providers: -1, auto_sync: true },
    scheduling: { dependencies: true, travel_time: true },
    tasks: { rigid: true },
    data: { export: true, import: true, mcp_access: true }
  };
});

// ── AC1: ?format=csv path ─────────────────────────────────────────────────────

describe('GET /api/data/export?format=csv (AC1)', () => {
  it('AC1: returns 200 with Content-Type text/csv', async () => {
    pushExportQueue([DB_TASK_ROW]);

    const res = await request(app)
      .get('/api/data/export?format=csv')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });

  it('AC1: returns Content-Disposition attachment header with filename', async () => {
    pushExportQueue([DB_TASK_ROW]);

    const res = await request(app)
      .get('/api/data/export?format=csv')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.headers['content-disposition']).toMatch(/filename/);
  });

  it('AC1: body is CSV (begins with the documented header row)', async () => {
    pushExportQueue([DB_TASK_ROW]);

    const res = await request(app)
      .get('/api/data/export?format=csv')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    const csvBody = res.text;
    expect(typeof csvBody).toBe('string');
    expect(csvBody.startsWith('id,text,taskType,status,')).toBe(true);
  });

  it('AC1: CSV body contains a data row for the task returned by the DB', async () => {
    pushExportQueue([DB_TASK_ROW]);

    const res = await request(app)
      .get('/api/data/export?format=csv')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    // 1 header + 1 data row
    const lines = res.text.replace(/\r\n$/, '').split('\r\n');
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('AC1: CSV body contains the task id from the DB row', async () => {
    pushExportQueue([DB_TASK_ROW]);

    const res = await request(app)
      .get('/api/data/export?format=csv')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.text).toContain('task-1');
  });

  it('AC1: CSV body contains the task text from the DB row', async () => {
    pushExportQueue([DB_TASK_ROW]);

    const res = await request(app)
      .get('/api/data/export?format=csv')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.text).toContain('Buy groceries');
  });

  it('AC1: CSV body uses CRLF line endings (RFC-4180)', async () => {
    pushExportQueue([DB_TASK_ROW]);

    const res = await request(app)
      .get('/api/data/export?format=csv')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.text).toContain('\r\n');
  });

  it('AC1: empty DB result → CSV with header row only', async () => {
    pushExportQueue([]); // no tasks in DB

    const res = await request(app)
      .get('/api/data/export?format=csv')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const lines = res.text.replace(/\r\n$/, '').split('\r\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^id,text,/);
  });

  it('AC1: returns 401 without auth token', async () => {
    const res = await request(app).get('/api/data/export?format=csv');
    expect(res.status).toBe(401);
  });

  it('AC1: returns 403 when plan does not allow export', async () => {
    mockPlanFeatures = {
      ...mockPlanFeatures,
      data: { export: false, import: true, mcp_access: true }
    };

    const res = await request(app)
      .get('/api/data/export?format=csv')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(403);
  });
});

// ── AC2: default (no format / format=json) path ───────────────────────────────

describe('GET /api/data/export (no format) (AC2)', () => {
  it('AC2: no ?format → returns JSON with v7 envelope', async () => {
    pushExportQueue([DB_TASK_ROW]);

    const res = await request(app)
      .get('/api/data/export')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toHaveProperty('v7', true);
    expect(res.body).toHaveProperty('extraTasks');
  });

  it('AC2: no ?format → response body is a JSON object, not a CSV string', async () => {
    pushExportQueue([DB_TASK_ROW]);

    const res = await request(app)
      .get('/api/data/export')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(typeof res.body).toBe('object');
    // JSON envelope has these keys; a CSV response would not have them at all
    expect(res.body).toHaveProperty('extraTasks');
  });

  it('AC2: no ?format → Content-Disposition attachment header is NOT set', async () => {
    pushExportQueue([DB_TASK_ROW]);

    const res = await request(app)
      .get('/api/data/export')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    // CSV path sets attachment; JSON path must not
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  it('AC2: ?format=json → same JSON envelope path (not CSV)', async () => {
    pushExportQueue([DB_TASK_ROW]);

    const res = await request(app)
      .get('/api/data/export?format=json')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toHaveProperty('v7', true);
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  it('AC2: JSON response extraTasks is an array', async () => {
    pushExportQueue([DB_TASK_ROW]);

    const res = await request(app)
      .get('/api/data/export')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(Array.isArray(res.body.extraTasks)).toBe(true);
  });

  it('AC2: returns 401 without auth token', async () => {
    const res = await request(app).get('/api/data/export');
    expect(res.status).toBe(401);
  });
});
