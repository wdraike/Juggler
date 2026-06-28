/**
 * R1.6: Task creation routes — end-to-end via API
 *
 * The requireFeature('tasks.create') gate was removed because no plan in the
 * catalog has a tasks.create key (they have tasks.rigid), so the gate always
 * returned 403 for every user on every plan. Task creation is a core feature
 * on all plans; the real limits are enforced by checkTaskOrRecurringLimit /
 * checkBatchTaskLimits (limits.active_tasks).
 *
 * These tests verify that task creation works regardless of plan (no feature
 * gate), and that 401 is returned when unauthenticated.
 */

process.env.NODE_ENV = 'test';

let resolveQueue = [];
let updateCalls = [];

function createChainMock() {
  const chain = jest.fn(() => chain);
  ['where', 'whereRaw', 'whereNotNull', 'whereNull', 'whereNot', 'whereNotIn',
   'whereIn', 'orWhere', 'orWhereNot', 'orderBy', 'orderByRaw', 'limit', 'offset',
   'join', 'leftJoin', 'count', 'max', 'clearSelect', 'clearOrder', 'clone',
   'groupBy', 'having'].forEach(m => { chain[m] = jest.fn(() => chain); });

  chain.select = jest.fn(() => Promise.resolve(resolveQueue.length ? resolveQueue.shift() : []));
  chain.first = jest.fn(() => Promise.resolve(resolveQueue.length ? resolveQueue.shift() : null));
  chain.insert = jest.fn(() => Promise.resolve());
  chain.update = jest.fn((fields) => { updateCalls.push(fields); return Promise.resolve(1); });
  chain.del = jest.fn(() => Promise.resolve(1));
  chain.then = jest.fn((resolve, reject) => Promise.resolve(resolveQueue.length ? resolveQueue.shift() : []).then(resolve, reject));
  chain.catch = jest.fn((fn) => Promise.resolve([]).catch(fn));
  chain.fn = { now: () => 'MOCK_NOW' };
  chain.raw = (s) => s;
  chain.transaction = jest.fn(async (cb) => cb(chain));
  return chain;
}

const mockDb = createChainMock();
jest.mock('../../src/db', () => mockDb);

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

jest.mock('../../src/lib/redis', () => ({
  getClient: jest.fn().mockReturnValue(null),
  invalidateTasks: jest.fn(() => Promise.resolve()),
  invalidateConfig: jest.fn(() => Promise.resolve()),
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve()),
  del: jest.fn(() => Promise.resolve())
}));

const mockEnqueueScheduleRun = jest.fn();
jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: mockEnqueueScheduleRun,
  stopPollLoop: jest.fn()
}));

jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn(),
  addClient: jest.fn()
}));

jest.mock('../../src/lib/task-write-queue', () => ({
  isLocked: jest.fn(() => Promise.resolve(false)),
  enqueueWrite: jest.fn(() => Promise.resolve()),
  splitFields: jest.fn((row) => ({ schedulingFields: row, nonSchedulingFields: {} })),
  flushQueue: jest.fn(() => Promise.resolve())
}));

jest.mock('../../src/lib/tasks-write', () => ({
  insertTask: jest.fn(() => Promise.resolve()),
  deleteTaskById: jest.fn(() => Promise.resolve(1)),
  deleteTasksWhere: jest.fn(() => Promise.resolve()),
  updateTaskById: jest.fn(() => Promise.resolve(1)),
  updateTasksWhere: jest.fn(() => Promise.resolve()),
  updateInstancesWhere: jest.fn(() => Promise.resolve()),
  insertTasksBatch: jest.fn(() => Promise.resolve()),
  resetRecurringInstances: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../src/middleware/entity-limits', () => ({
  checkTaskOrRecurringLimit: (req, res, next) => next(),
  checkBatchTaskLimits: (req, res, next) => next(),
  checkProjectLimit: (req, res, next) => next(),
  checkToolLimit: (req, res, next) => next(),
  checkLocationLimit: (req, res, next) => next()
}));

// Mock plan-features.middleware so we can control planFeatures per test.
// This must be mocked BEFORE requiring the app so the route registration
// picks up our mock.
const mockResolvePlanFeatures = jest.fn((req, res, next) => {
  // Default: enterprise plan
  req.planId = 'enterprise';
  req.planFeatures = {
    limits: { active_tasks: -1 },
    tasks: { rigid: true },
    calendar: { max_providers: 1 },
    scheduling: {}
  };
  next();
});

jest.mock('../../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: mockResolvePlanFeatures
}));

const VALID_TOKEN = 'valid-test-token';
let app, request;

beforeAll(async () => {
  app = require('../../src/app');
  request = require('supertest');
});

beforeEach(() => {
  resolveQueue = [];
  updateCalls = [];
  jest.clearAllMocks();
  // Reset mock to default (enterprise)
  mockResolvePlanFeatures.mockImplementation((req, res, next) => {
    req.planId = 'enterprise';
    req.planFeatures = {
      limits: { active_tasks: -1 },
      tasks: { rigid: true },
      calendar: { max_providers: 1 },
      scheduling: {}
    };
    next();
  });
});

const BASE_TASK_ROW = {
  id: 'task-abc',
  master_id: 'task-abc',
  user_id: 'user-123',
  task_type: 'task',
  status: '',
  scheduled_at: null,
  text: 'Test task',
  dur: 30,
  pri: 'P3',
  when: '',
  recurring: 0,
  generated: 0,
  day_req: 'any',
  location: '[]',
  tools: '[]',
  depends_on: '[]'
};

// ---------------------------------------------------------------------------
// R1.6: Feature gate end-to-end via API
// ---------------------------------------------------------------------------
describe('R1.6: Task creation — E2E via API', () => {
  test('POST /api/tasks on free plan → 201 (no feature gate, 999.585 gate removed)', async () => {
    // The requireFeature('tasks.create') gate was removed because no plan has
    // a tasks.create key. Free plan users can create tasks — the real limit
    // is enforced by checkTaskOrRecurringLimit (limits.active_tasks).
    mockResolvePlanFeatures.mockImplementation((req, res, next) => {
      req.planId = 'free';
      req.planFeatures = {
        limits: { active_tasks: 50 },
        tasks: { rigid: true },
        calendar: { max_providers: 1 },
        scheduling: {}
      };
      next();
    });

    resolveQueue.push(null);             // applySplitDefault: user_config first()
    resolveQueue.push(BASE_TASK_ROW);   // fetchTaskWithEventIds: tasks_v first()
    resolveQueue.push([]);              // fetchTaskWithEventIds: cal_sync_ledger select()

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ text: 'Free plan task' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('task');
  });

  test('POST /api/tasks on enterprise plan → 201', async () => {
    // Default mock: enterprise plan
    resolveQueue.push(null);             // applySplitDefault: user_config first()
    resolveQueue.push(BASE_TASK_ROW);   // fetchTaskWithEventIds: tasks_v first()
    resolveQueue.push([]);              // fetchTaskWithEventIds: cal_sync_ledger select()

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ text: 'Allowed task' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('task');
    // Mock DB returns BASE_TASK_ROW, not the request body text
    expect(res.body.task.text).toBe('Test task');
  });

  test('POST /api/tasks returns 401 when no auth header (gate is after auth)', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ text: 'No auth task' });

    expect(res.status).toBe(401);
  });
});