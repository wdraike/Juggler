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
});
