/**
 * Controller tests — importData CSV branch (AC1, AC2, AC4, AC6)
 *
 * Covers:
 *   AC1: text/csv POST → facade.importData called with mode='merge' + parsed extraTasks
 *   AC1: ?format=csv POST → same CSV branch
 *   AC2: merge is additive — facade.importData always receives mode='merge' on CSV path
 *   AC4: malformed CSV body → 400 {error}, facade.importData NOT called (zero DB writes)
 *   AC6: JSON body (application/json) → facade called with data=req.body and
 *        mode=req.query.mode (NOT forced merge, NOT the CSV branch)
 *
 * Strategy: mock facade.importData directly so we can assert:
 *   - what mode it receives (must be 'merge' on CSV path, req.query.mode on JSON path)
 *   - what data.extraTasks it receives (deterministic task from parsed CSV)
 *   - that it is NOT called at all when CSV parse fails (AC4 zero-write guarantee)
 *
 * The mock facade pattern follows data-and-weather.test.js / data-export-csv.test.js
 * exactly. We mock at the facade module level — the controller requires it, so the spy
 * intercepts the call without any DB involvement.
 */

process.env.NODE_ENV = 'test';

// ── Facade mock — must be declared before any require of app/controller ───────

const mockFacadeImportData = jest.fn();
const mockFacadeExportData = jest.fn();

jest.mock('../../src/slices/user-config/facade', () => ({
  importData: mockFacadeImportData,
  exportData: mockFacadeExportData,
}));

// ── Standard harness mocks (matching data-export-csv.test.js pattern) ────────

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
    req.auth = { plans: {} };
    next();
  },
  verifyToken: jest.fn()
}));

// Plan-features mock — import enabled for all tests by default
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

// lib/logger mock (identical shape to data-export-csv.test.js)
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

// ── Test data ─────────────────────────────────────────────────────────────────

const VALID_TOKEN = 'valid-test-token';

/**
 * Minimal valid CSV with a single task row.
 * Uses the real 18-column header to match the controller's csvToTasks call exactly.
 */
const MINIMAL_CSV =
  'id,text,taskType,status,pri,project,dur,scheduledAt,date,time,deadline,startAfter,recurring,location,tools,notes,url,completedAt\r\n' +
  'task-csv-1,Buy groceries,one-off,active,P2,Personal,30,,2026-06-15,09:00,,,false,Home,,,,\r\n';

/**
 * Standard facade response for a successful merge import.
 * Mirrors what _mergeImportData.execute returns (body with mode=merge, counts, tasksRekeyed).
 */
const MERGE_SUCCESS_RESPONSE = {
  status: 200,
  body: {
    message: 'Import successful',
    mode: 'merge',
    counts: { tasks: 1 },
    tasksRekeyed: 0
  }
};

let app, request;

beforeAll(async () => {
  app = require('../../src/app');
  request = require('supertest');
});

beforeEach(() => {
  resolveQueue.length = 0;
  jest.clearAllMocks();
  // Default facade response for all tests that expect a successful call
  mockFacadeImportData.mockResolvedValue(MERGE_SUCCESS_RESPONSE);
  mockPlanFeatures = {
    limits: { active_tasks: -1, recurring_templates: -1, projects: -1, locations: -1, schedule_templates: -1, ai_commands_per_month: -1 },
    ai: { natural_language_commands: true },
    calendar: { max_providers: -1, auto_sync: true },
    scheduling: { dependencies: true, travel_time: true },
    tasks: { rigid: true },
    data: { export: true, import: true, mcp_access: true }
  };
});

// ── AC1: Content-Type: text/csv → CSV branch ──────────────────────────────────

describe('POST /api/data/import — text/csv (AC1)', () => {
  it('AC1: text/csv request → 200 response', async () => {
    const res = await request(app)
      .post('/api/data/import')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('Content-Type', 'text/csv')
      .send(MINIMAL_CSV);

    expect(res.status).toBe(200);
  });

  it('AC1: text/csv request → facade.importData called exactly once', async () => {
    await request(app)
      .post('/api/data/import')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('Content-Type', 'text/csv')
      .send(MINIMAL_CSV);

    expect(mockFacadeImportData).toHaveBeenCalledTimes(1);
  });

  it('AC2: text/csv request → facade.importData called with mode=\'merge\' (forced, additive)', async () => {
    await request(app)
      .post('/api/data/import')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('Content-Type', 'text/csv')
      .send(MINIMAL_CSV);

    const callArgs = mockFacadeImportData.mock.calls[0][0];
    expect(callArgs.mode).toBe('merge');
  });

  it('AC1: text/csv request → facade receives v7:true in data', async () => {
    await request(app)
      .post('/api/data/import')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('Content-Type', 'text/csv')
      .send(MINIMAL_CSV);

    const callArgs = mockFacadeImportData.mock.calls[0][0];
    expect(callArgs.data).toHaveProperty('v7', true);
  });

  it('AC1: text/csv request → facade receives extraTasks array with parsed task', async () => {
    await request(app)
      .post('/api/data/import')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('Content-Type', 'text/csv')
      .send(MINIMAL_CSV);

    const callArgs = mockFacadeImportData.mock.calls[0][0];
    expect(Array.isArray(callArgs.data.extraTasks)).toBe(true);
    expect(callArgs.data.extraTasks).toHaveLength(1);
    expect(callArgs.data.extraTasks[0].text).toBe('Buy groceries');
  });

  it('AC1: text/csv request → facade receives correct userId', async () => {
    await request(app)
      .post('/api/data/import')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('Content-Type', 'text/csv')
      .send(MINIMAL_CSV);

    const callArgs = mockFacadeImportData.mock.calls[0][0];
    expect(callArgs.userId).toBe(TEST_USER.id);
  });

  it('AC1: text/csv request → response body contains merge envelope from facade', async () => {
    const res = await request(app)
      .post('/api/data/import')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('Content-Type', 'text/csv')
      .send(MINIMAL_CSV);

    expect(res.body).toHaveProperty('mode', 'merge');
    expect(res.body).toHaveProperty('counts');
  });
});

// ── AC1: ?format=csv path (query-param CSV branch) ───────────────────────────

describe('POST /api/data/import?format=csv (AC1)', () => {
  it('AC1: ?format=csv → facade called with mode=\'merge\'', async () => {
    // Content-Type is application/json but format=csv triggers CSV branch
    await request(app)
      .post('/api/data/import?format=csv')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('Content-Type', 'text/csv')
      .send(MINIMAL_CSV);

    expect(mockFacadeImportData).toHaveBeenCalledTimes(1);
    const callArgs = mockFacadeImportData.mock.calls[0][0];
    expect(callArgs.mode).toBe('merge');
  });

  it('AC1: ?format=csv → facade receives v7:true and extraTasks', async () => {
    await request(app)
      .post('/api/data/import?format=csv')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('Content-Type', 'text/csv')
      .send(MINIMAL_CSV);

    const callArgs = mockFacadeImportData.mock.calls[0][0];
    expect(callArgs.data.v7).toBe(true);
    expect(Array.isArray(callArgs.data.extraTasks)).toBe(true);
    expect(callArgs.data.extraTasks.length).toBeGreaterThan(0);
  });
});

// ── AC4: malformed CSV → 400, zero DB writes ─────────────────────────────────

describe('POST /api/data/import — malformed CSV (AC4)', () => {
  it('AC4: unbalanced quote in CSV body → 400 response', async () => {
    const malformedCsv =
      'id,text,taskType,status,pri,project,dur,scheduledAt,date,time,deadline,startAfter,recurring,location,tools,notes,url,completedAt\r\n' +
      '"unclosed quote,task,one-off,active,P1,,,,,,,,false,,,,,\r\n';

    const res = await request(app)
      .post('/api/data/import')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('Content-Type', 'text/csv')
      .send(malformedCsv);

    expect(res.status).toBe(400);
  });

  it('AC4: unbalanced quote → response has error field', async () => {
    const malformedCsv =
      'id,text,taskType,status,pri,project,dur,scheduledAt,date,time,deadline,startAfter,recurring,location,tools,notes,url,completedAt\r\n' +
      '"unclosed,task,one-off,active,P1,,,,,,,,false,,,,,\r\n';

    const res = await request(app)
      .post('/api/data/import')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('Content-Type', 'text/csv')
      .send(malformedCsv);

    expect(res.body).toHaveProperty('error');
    expect(typeof res.body.error).toBe('string');
  });

  it('AC4: unbalanced quote → facade.importData NOT called (zero DB writes)', async () => {
    const malformedCsv =
      'id,text,taskType,status,pri,project,dur,scheduledAt,date,time,deadline,startAfter,recurring,location,tools,notes,url,completedAt\r\n' +
      '"unclosed,task,one-off,active,P1,,,,,,,,false,,,,,\r\n';

    await request(app)
      .post('/api/data/import')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('Content-Type', 'text/csv')
      .send(malformedCsv);

    // The facade must NEVER be called — parse error is a hard guard before any DB work
    expect(mockFacadeImportData).not.toHaveBeenCalled();
  });

  it('AC4: ragged row (missing column) → 400, facade NOT called', async () => {
    // Header has 18 cols; data row has only 2 → ragged
    const raggedCsv =
      'id,text,taskType,status,pri,project,dur,scheduledAt,date,time,deadline,startAfter,recurring,location,tools,notes,url,completedAt\r\n' +
      'task-1,Buy milk\r\n';

    const res = await request(app)
      .post('/api/data/import')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('Content-Type', 'text/csv')
      .send(raggedCsv);

    expect(res.status).toBe(400);
    expect(mockFacadeImportData).not.toHaveBeenCalled();
  });

  it('AC4: CSV with header missing "text" column → 400, facade NOT called', async () => {
    const noTextCsv = 'id,status\r\ntask-1,active\r\n';

    const res = await request(app)
      .post('/api/data/import')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('Content-Type', 'text/csv')
      .send(noTextCsv);

    expect(res.status).toBe(400);
    expect(mockFacadeImportData).not.toHaveBeenCalled();
  });

  it('AC4: completely empty CSV body → 400, facade NOT called', async () => {
    const res = await request(app)
      .post('/api/data/import')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('Content-Type', 'text/csv')
      .send('');

    expect(res.status).toBe(400);
    expect(mockFacadeImportData).not.toHaveBeenCalled();
  });
});

// ── AC6: JSON path unchanged ──────────────────────────────────────────────────
// JSON body (application/json) must go through the existing path:
//   data=req.body, mode=req.query.mode — NOT forced merge, NOT the CSV branch.

describe('POST /api/data/import — JSON path unchanged (AC6)', () => {
  const JSON_IMPORT_BODY = {
    extraTasks: [{ id: 'task-json-1', text: 'JSON task', dur: 30, pri: 'P2' }],
    statuses: {},
    locations: [],
    tools: [],
    projects: []
  };

  it('AC6: JSON body with ?confirm=delete_all → facade called with req.body as data', async () => {
    await request(app)
      .post('/api/data/import?confirm=delete_all')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('Content-Type', 'application/json')
      .send(JSON_IMPORT_BODY);

    expect(mockFacadeImportData).toHaveBeenCalledTimes(1);
    const callArgs = mockFacadeImportData.mock.calls[0][0];
    // data must be req.body directly (not wrapped in {extraTasks, v7})
    expect(callArgs.data).toMatchObject({
      extraTasks: expect.arrayContaining([
        expect.objectContaining({ id: 'task-json-1', text: 'JSON task' })
      ])
    });
  });

  it('AC6: JSON body → mode is req.query.mode (undefined when not supplied)', async () => {
    await request(app)
      .post('/api/data/import?confirm=delete_all')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('Content-Type', 'application/json')
      .send(JSON_IMPORT_BODY);

    const callArgs = mockFacadeImportData.mock.calls[0][0];
    // No ?mode= supplied → mode is undefined (not 'merge')
    expect(callArgs.mode).toBeUndefined();
  });

  it('AC6: JSON body with ?mode=merge → mode passed through as \'merge\'', async () => {
    await request(app)
      .post('/api/data/import?mode=merge')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('Content-Type', 'application/json')
      .send(JSON_IMPORT_BODY);

    const callArgs = mockFacadeImportData.mock.calls[0][0];
    expect(callArgs.mode).toBe('merge');
  });

  it('AC6: JSON body with ?mode=replace → mode passed through as \'replace\'', async () => {
    await request(app)
      .post('/api/data/import?mode=replace&confirm=delete_all')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('Content-Type', 'application/json')
      .send(JSON_IMPORT_BODY);

    const callArgs = mockFacadeImportData.mock.calls[0][0];
    expect(callArgs.mode).toBe('replace');
  });

  it('AC6: JSON body → data.v7 NOT injected by controller (JSON path is passthrough)', async () => {
    await request(app)
      .post('/api/data/import?confirm=delete_all')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('Content-Type', 'application/json')
      .send(JSON_IMPORT_BODY);

    const callArgs = mockFacadeImportData.mock.calls[0][0];
    // On the JSON path the controller passes req.body directly — it must NOT inject v7:true
    // (the JSON body doesn't have it; only the CSV branch injects it)
    expect(callArgs.data.v7).toBeUndefined();
  });
});

// ── Auth gate (AC5 sampling) ──────────────────────────────────────────────────

describe('POST /api/data/import — auth gate', () => {
  it('returns 401 without Authorization header on CSV path', async () => {
    const res = await request(app)
      .post('/api/data/import')
      .set('Content-Type', 'text/csv')
      .send(MINIMAL_CSV);

    expect(res.status).toBe(401);
    expect(mockFacadeImportData).not.toHaveBeenCalled();
  });

  it('returns 401 without Authorization header on JSON path', async () => {
    const res = await request(app)
      .post('/api/data/import')
      .set('Content-Type', 'application/json')
      .send({ extraTasks: [] });

    expect(res.status).toBe(401);
    expect(mockFacadeImportData).not.toHaveBeenCalled();
  });
});
