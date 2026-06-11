/**
 * AP-72: POST /api/ai/command — AI enrichment command endpoint
 *
 * Covers:
 *   AP-72a: 401 without auth token
 *   AP-72b: 400 when `command` field is missing from body
 *   AP-72c: 200 with valid body (AI call mocked) — response has `ops` and `msg`
 *   AP-72d: unsupported command flagged by AI returns unsupported:true shape
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
  chain.then = jest.fn((resolve, reject) => Promise.resolve(resolveQueue.length ? resolveQueue.shift() : []).then(resolve, reject));
  chain.catch = jest.fn((fn) => Promise.resolve([]).catch(fn));
  chain.fn = { now: () => 'MOCK_NOW' };
  chain.raw = jest.fn((s) => s);
  chain.transaction = jest.fn(async (cb) => cb(chain));
  return chain;
}

const mockDb = createChainMock();
jest.mock('../../src/db', () => mockDb);
// H4/W6: feature-gate's checkUsageLimit is now a THIN adapter over the user-config
// slice facade, whose checkAndIncrement reaches the DB via lib/db.getDefaultDb()
// (ADR-0002), NOT src/db.js. Point lib/db's default at the SAME mockDb so the
// plan_usage upsert/read still resolves from resolveQueue (the H3 dual-mock lesson).
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
    req.auth = { plans: {} };
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

// Mock the rate-limit-store so the per-user AI limiter (max 2/min) uses a
// no-op store instead of MemoryStore. Without this the limiter accumulates
// hits across tests in the same process and 429s after the first 2 requests.
jest.mock('../../src/lib/rate-limit-store', () => ({
  maybeRedisStore: () => ({
    init: jest.fn(),
    increment: jest.fn(() => Promise.resolve({ totalHits: 1, resetTime: new Date(Date.now() + 60000) })),
    decrement: jest.fn(() => Promise.resolve()),
    resetKey: jest.fn(() => Promise.resolve()),
    resetAll: jest.fn(() => Promise.resolve())
  })
}));

// Mock the Gemini tracked-call — keeps tests hermetic and fast
jest.mock('../../src/services/gemini-tracked-call', () => ({
  trackedGeminiCall: jest.fn()
}));

// Mock lib/logger so that ai.controller.js (which incorrectly does
//   const logger = require('../lib/logger')
// instead of destructuring a named logger) gets a no-op logger object
// rather than the bare module export (which has no .error method).
// This is a test-level shim; the src bug is tracked separately.
jest.mock('../../src/lib/logger', () => {
  const noop = jest.fn();
  const fakeLogger = { error: noop, warn: noop, info: noop, debug: noop, trace: noop };
  const createLogger = jest.fn(() => fakeLogger);
  // Re-expose every named export that production code destructures
  return {
    createLogger,
    Logger: class {},
    clearLoggerCache: jest.fn(),
    LOG_LEVELS: ['error', 'warn', 'info', 'debug', 'trace'],
    DEFAULT_LOG_LEVEL: 'debug',
    loggers: {},
    // pre-built named loggers used by feature-gate, usage-reporter, etc.
    aiControllerLogger: fakeLogger,
    dataControllerLogger: fakeLogger,
    weatherControllerLogger: fakeLogger,
    schedulerLogger: fakeLogger,
    schedulerRunLogger: fakeLogger,
    schedulerUnifiedLogger: fakeLogger,
    taskControllerLogger: fakeLogger,
    calSyncControllerLogger: fakeLogger,
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
    // also expose as the default object so that
    //   const logger = require('../lib/logger')
    // calls like logger.error() do not throw
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
  };
});

// Mock the AI usage queue so it doesn't try to flush to DB
jest.mock('../../src/services/ai-usage-queue.service', () => ({
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

  // Daily quota check: db('ai_command_log').where(...).count().first()
  // Returns count=0 so quota is always available, then insert succeeds
  const { trackedGeminiCall } = require('../../src/services/gemini-tracked-call');
  trackedGeminiCall.mockReset();

  const writeQueue = require('../../src/lib/task-write-queue');
  writeQueue.isLocked.mockResolvedValue(false);
  writeQueue.splitFields.mockImplementation((fields) => ({ schedulingFields: {}, nonSchedulingFields: fields }));

  const redis = require('../../src/lib/redis');
  redis.get.mockResolvedValue(null);
  redis.set.mockResolvedValue(undefined);
  redis.del.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// AP-72a: 401 without auth token
// ---------------------------------------------------------------------------
describe('AP-72a: POST /api/ai/command — unauthenticated', () => {
  test('returns 401 when no Authorization header is provided', async () => {
    const res = await request(app)
      .post('/api/ai/command')
      .send({ command: 'add a task to buy milk' });
    expect(res.status).toBe(401);
  });

  test('returns 401 with malformed bearer token', async () => {
    const res = await request(app)
      .post('/api/ai/command')
      .set('Authorization', 'Token not-a-bearer')
      .send({ command: 'add a task' });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// AP-72b: 400 when `command` field is missing
// ---------------------------------------------------------------------------
describe('AP-72b: POST /api/ai/command — missing command field', () => {
  test('returns 400 when body has no command field', async () => {
    // Seed the daily quota check: count=0 → allowed
    resolveQueue.push({ cnt: 0 });

    const res = await request(app)
      .post('/api/ai/command')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ tasks: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/command/i);
  });

  test('returns 400 when command is an empty string', async () => {
    resolveQueue.push({ cnt: 0 });

    const res = await request(app)
      .post('/api/ai/command')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ command: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/command/i);
  });
});

// ---------------------------------------------------------------------------
// AP-72c: 200 with valid body — AI call mocked to return valid JSON ops
// ---------------------------------------------------------------------------
describe('AP-72c: POST /api/ai/command — success with mocked AI', () => {
  test('returns 200 with ops and msg when AI responds with valid JSON', async () => {
    const { trackedGeminiCall } = require('../../src/services/gemini-tracked-call');

    // Seed the daily quota check (count query)
    resolveQueue.push({ cnt: 0 });

    // Mock Gemini to return a well-formed ops response
    trackedGeminiCall.mockResolvedValueOnce({
      text: JSON.stringify({
        ops: [{ op: 'add', task: { id: 'ai001', text: 'Buy milk', date: '', time: '', dur: 30 } }],
        msg: 'Added task: Buy milk'
      })
    });

    const res = await request(app)
      .post('/api/ai/command')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ command: 'add a task to buy milk', tasks: [], statuses: {}, config: {} });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.ops)).toBe(true);
    expect(typeof res.body.msg).toBe('string');
  });

  test('returns 200 with ops array even when AI returns empty ops', async () => {
    const { trackedGeminiCall } = require('../../src/services/gemini-tracked-call');

    resolveQueue.push({ cnt: 0 });

    trackedGeminiCall.mockResolvedValueOnce({
      text: JSON.stringify({ ops: [], msg: 'Nothing to do.' })
    });

    const res = await request(app)
      .post('/api/ai/command')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ command: 'do nothing', tasks: [] });

    expect(res.status).toBe(200);
    expect(res.body.ops).toEqual([]);
    expect(res.body.msg).toBe('Nothing to do.');
  });
});

// ---------------------------------------------------------------------------
// AP-72d: AI flags unsupported command → returns unsupported shape (200, unsupported:true)
// ---------------------------------------------------------------------------
describe('AP-72d: POST /api/ai/command — unsupported command type', () => {
  test('returns 200 with unsupported:true when AI flags out-of-scope request', async () => {
    const { trackedGeminiCall } = require('../../src/services/gemini-tracked-call');

    resolveQueue.push({ cnt: 0 });

    // AI model returns unsupported:true shape as defined in controller scope constraint
    trackedGeminiCall.mockResolvedValueOnce({
      text: JSON.stringify({
        ops: [],
        msg: "I can only help with Juggler tasks and scheduling. Try: 'add a task to buy milk'.",
        unsupported: true
      })
    });

    const res = await request(app)
      .post('/api/ai/command')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ command: 'Write me a poem about the ocean', tasks: [] });

    expect(res.status).toBe(200);
    expect(res.body.unsupported).toBe(true);
    expect(Array.isArray(res.body.ops)).toBe(true);
    expect(typeof res.body.msg).toBe('string');
  });

  test('returns 429 when daily AI quota is exhausted', async () => {
    // checkUsageLimit('ai_commands_per_month') middleware runs before the controller.
    // It calls db('plan_usage').where(...).first() → must return a valid row so
    // the middleware does not crash. With isUnlimited=true (limit=-1 or undefined),
    // the plan_usage row just needs to exist; count<=effectiveLimit is always true.
    resolveQueue.push({ count: 1 }); // consumed by checkUsageLimit.checkAndIncrement

    // Then checkAndLogDailyQuota in the controller reads: count=50 → at limit → 429
    resolveQueue.push({ cnt: 50 });

    const res = await request(app)
      .post('/api/ai/command')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ command: 'add a task', tasks: [] });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/daily/i);
  });

  test('returns 200 with msg fallback when AI unsupported response omits msg field', async () => {
    const { trackedGeminiCall } = require('../../src/services/gemini-tracked-call');

    resolveQueue.push({ cnt: 0 });

    trackedGeminiCall.mockResolvedValueOnce({
      text: JSON.stringify({ ops: [], unsupported: true })
    });

    const res = await request(app)
      .post('/api/ai/command')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ command: 'who won the 2026 World Cup?', tasks: [] });

    expect(res.status).toBe(200);
    expect(res.body.unsupported).toBe(true);
    expect(typeof res.body.msg).toBe('string');
    expect(res.body.msg.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AP-72e: op coverage — each supported AI op type returns correct shape
// ---------------------------------------------------------------------------
describe('AP-72e: POST /api/ai/command — supported op shapes', () => {
  // Helper: seed quota and mock Gemini, fire the request, return the response
  async function sendCommand(ops, msg = 'Done.') {
    const { trackedGeminiCall } = require('../../src/services/gemini-tracked-call');
    resolveQueue.push({ cnt: 0 });
    trackedGeminiCall.mockResolvedValueOnce({
      text: JSON.stringify({ ops, msg })
    });
    return request(app)
      .post('/api/ai/command')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ command: 'any command', tasks: [], statuses: {}, config: {} });
  }

  test('status op — AI sets task status to done', async () => {
    const res = await sendCommand([{ op: 'status', id: 't01', value: 'done' }], 'Marked t01 done');
    expect(res.status).toBe(200);
    expect(res.body.ops[0]).toMatchObject({ op: 'status', id: 't01', value: 'done' });
  });

  test('edit op — AI edits task fields', async () => {
    const res = await sendCommand([{ op: 'edit', id: 't02', fields: { date: '5/20', pri: 'P1', dur: 60 } }], 'Edited t02');
    expect(res.status).toBe(200);
    expect(res.body.ops[0]).toMatchObject({ op: 'edit', id: 't02' });
    expect(res.body.ops[0].fields).toMatchObject({ date: '5/20', pri: 'P1' });
  });

  test('delete op — AI deletes a task', async () => {
    const res = await sendCommand([{ op: 'delete', id: 't03' }], 'Deleted t03');
    expect(res.status).toBe(200);
    expect(res.body.ops[0]).toMatchObject({ op: 'delete', id: 't03' });
  });

  test('set_weekly config op — AI sets weekly location', async () => {
    const res = await sendCommand([{ op: 'set_weekly', day: 'Mon', location: 'work' }], 'Set Monday to office');
    expect(res.status).toBe(200);
    expect(res.body.ops[0]).toMatchObject({ op: 'set_weekly', day: 'Mon', location: 'work' });
  });

  test('set_block_loc config op — AI sets one time block location', async () => {
    const res = await sendCommand([{ op: 'set_block_loc', day: 'Tue', blockTag: 'morning', location: 'home' }], 'Set morning block');
    expect(res.status).toBe(200);
    expect(res.body.ops[0]).toMatchObject({ op: 'set_block_loc', day: 'Tue', blockTag: 'morning' });
  });

  test('add_location config op — AI adds a new location', async () => {
    const res = await sendCommand([{ op: 'add_location', id: 'gym', name: 'Gym', icon: '🏋️' }], 'Added Gym');
    expect(res.status).toBe(200);
    expect(res.body.ops[0]).toMatchObject({ op: 'add_location', id: 'gym', name: 'Gym' });
  });

  test('add_tool config op — AI adds a new tool', async () => {
    const res = await sendCommand([{ op: 'add_tool', id: 'tablet', name: 'Tablet', icon: '📱' }], 'Added Tablet');
    expect(res.status).toBe(200);
    expect(res.body.ops[0]).toMatchObject({ op: 'add_tool', id: 'tablet', name: 'Tablet' });
  });

  test('set_tool_matrix config op — AI sets tool matrix', async () => {
    const res = await sendCommand([{ op: 'set_tool_matrix', location: 'home', tools: ['phone', 'personal_pc'] }], 'Set tool matrix');
    expect(res.status).toBe(200);
    expect(res.body.ops[0]).toMatchObject({ op: 'set_tool_matrix', location: 'home' });
  });

  test('set_blocks config op — AI sets time blocks for a day', async () => {
    const blocks = [{ id: 'b1', tag: 'morning', name: 'Morning', start: 360, end: 480, color: '#F59E0B', icon: '☀️' }];
    const res = await sendCommand([{ op: 'set_blocks', day: 'Mon', blocks }], 'Set blocks');
    expect(res.status).toBe(200);
    expect(res.body.ops[0]).toMatchObject({ op: 'set_blocks', day: 'Mon' });
    expect(Array.isArray(res.body.ops[0].blocks)).toBe(true);
  });

  test('clone_blocks config op — AI clones blocks across days', async () => {
    const res = await sendCommand([{ op: 'clone_blocks', from: 'Mon', to: ['Tue', 'Wed', 'Thu', 'Fri'] }], 'Cloned blocks');
    expect(res.status).toBe(200);
    expect(res.body.ops[0]).toMatchObject({ op: 'clone_blocks', from: 'Mon' });
  });

  test('multi-op — add with dependsOn chain returns all ops', async () => {
    const ops = [
      { op: 'add', task: { id: 'ai001', text: 'Design wireframes', date: '', time: '', dur: 120, dependsOn: [] } },
      { op: 'add', task: { id: 'ai002', text: 'Build frontend', date: '', time: '', dur: 240, dependsOn: ['ai001'] } }
    ];
    const res = await sendCommand(ops, 'Created 2 tasks');
    expect(res.status).toBe(200);
    expect(res.body.ops).toHaveLength(2);
    expect(res.body.ops[1].task.dependsOn).toContain('ai001');
  });
});

// ---------------------------------------------------------------------------
// AP-72f: error path coverage — bad AI response, Gemini failure, feature gate
// ---------------------------------------------------------------------------
describe('AP-72f: POST /api/ai/command — error paths', () => {
  test('returns 422 when AI returns completely unparseable text', async () => {
    const { trackedGeminiCall } = require('../../src/services/gemini-tracked-call');
    resolveQueue.push({ cnt: 0 });

    trackedGeminiCall.mockResolvedValueOnce({ text: 'Sorry, I cannot help with that.' });

    const res = await request(app)
      .post('/api/ai/command')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ command: 'add a task', tasks: [] });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/bad json/i);
  });

  test('recovers valid JSON from markdown-fenced AI response', async () => {
    const { trackedGeminiCall } = require('../../src/services/gemini-tracked-call');
    resolveQueue.push({ cnt: 0 });

    // Gemini wraps response in ```json ... ``` fences — controller must strip and parse
    const jsonPayload = JSON.stringify({ ops: [{ op: 'status', id: 't01', value: 'done' }], msg: 'Done.' });
    trackedGeminiCall.mockResolvedValueOnce({ text: '```json\n' + jsonPayload + '\n```' });

    const res = await request(app)
      .post('/api/ai/command')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ command: 'mark t01 done', tasks: [] });

    expect(res.status).toBe(200);
    expect(res.body.ops[0]).toMatchObject({ op: 'status', id: 't01', value: 'done' });
  });

  test('returns 500 when Gemini call throws', async () => {
    const { trackedGeminiCall } = require('../../src/services/gemini-tracked-call');
    resolveQueue.push({ cnt: 0 });

    trackedGeminiCall.mockRejectedValueOnce(new Error('Gemini API quota exceeded'));

    const res = await request(app)
      .post('/api/ai/command')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ command: 'add a task', tasks: [] });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Gemini|AI command failed/i);
  });

  test('returns 403 when ai.natural_language_commands feature flag is off', async () => {
    // Override the plan-features mock just for this test to disable the flag
    jest.resetModules();

    const restrictedApp = (() => {
      jest.doMock('../../src/middleware/plan-features.middleware', () => ({
        resolvePlanFeatures: (req, res, next) => {
          req.planId = 'free';
          req.planFeatures = {
            limits: { active_tasks: 5 },
            calendar: { max_providers: 1 },
            scheduling: {},
            tasks: {},
            ai: { natural_language_commands: false }
          };
          next();
        },
        PRODUCT_ID: 'juggler',
        refreshPlanFeatures: jest.fn(),
        invalidateUserPlanCache: jest.fn(),
        getCachedPlanFeatures: jest.fn()
      }));
      return require('../../src/app');
    })();

    const res = await require('supertest')(restrictedApp)
      .post('/api/ai/command')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ command: 'add a task', tasks: [] });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FEATURE_NOT_AVAILABLE');

    jest.resetModules();
  });
});
