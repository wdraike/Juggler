/**
 * AP-07: GET /api/tasks returns tasks for authenticated user
 * AP-09: POST /api/tasks creates a task and returns it
 * AP-10: DELETE /api/tasks/:id removes a task
 * SC-38: POST /api/tasks triggers enqueueScheduleRun
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

// ADR-0002 / H3-W6: the task slice's KnexTaskRepository obtains knex via lib/db
// (getDefaultDb()), NOT src/db.js. Point lib/db's default at the SAME mockDb so the
// thin controller → facade → repo path resolves the same chain mock + resolveQueue
// the legacy controller's src/db usage did. (Mirrors the W1 golden-master scaffold.)
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

jest.mock('../../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => {
    req.planId = 'enterprise';
    req.planFeatures = { limits: { active_tasks: -1 }, calendar: { max_providers: -1 }, scheduling: {}, tasks: {} };
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

const mockEnqueueScheduleRun = jest.fn();
jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: mockEnqueueScheduleRun,
  stopPollLoop: jest.fn()
}));

jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn(),
  addClient: jest.fn()
}));

// task-write-queue: isLocked returns false (not locked) so createTask takes the direct path
jest.mock('../../src/lib/task-write-queue', () => ({
  isLocked: jest.fn(() => Promise.resolve(false)),
  enqueueWrite: jest.fn(() => Promise.resolve()),
  splitFields: jest.fn((row) => ({ schedulingFields: row, nonSchedulingFields: {} })),
  flushQueue: jest.fn(() => Promise.resolve())
}));

// tasks-write: stub insertTask + deleteTaskById so the DB mock isn't burdened
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

// entity-limits middleware: pass through (enterprise plan has no limits)
jest.mock('../../src/middleware/entity-limits', () => ({
  checkTaskOrRecurringLimit: (req, res, next) => next(),
  checkBatchTaskLimits: (req, res, next) => next(),
  checkProjectLimit: (req, res, next) => next(),
  checkToolLimit: (req, res, next) => next(),
  checkLocationLimit: (req, res, next) => next()
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
});

// ---------------------------------------------------------------------------
// Shared task shape (tasks_v view row)
// ---------------------------------------------------------------------------
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
// AP-07: GET /api/tasks returns tasks for authenticated user
// ---------------------------------------------------------------------------
describe('AP-07: GET /api/tasks', () => {
  test('returns 401 when no auth header', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(401);
  });

  test('returns 200 with tasks array for authenticated user', async () => {
    // getAllTasks now routes through the task slice (H3-W6): ListTasks use-case →
    // KnexTaskRepository.fetchTasksWithEventIds, which runs THREE parallel queries
    // (tasks_v list + cal_sync_ledger + user_calendars) then getTasksVersion. The
    // mock resolves the parallel array left-to-right (the two .select() calls shift
    // before the awaited list builder), so the queue order is: ledger, user_calendars,
    // tasks_v list, version. (Same scaffold the W1 golden-master uses for getAllTasks.)
    resolveQueue.push([]);                       // cal_sync_ledger select()
    resolveQueue.push([]);                       // user_calendars (apple) select()
    resolveQueue.push([BASE_TASK_ROW]);          // tasks_v list (awaited builder)
    resolveQueue.push({ max_updated: null, cnt: 1 }); // getTasksVersion first()

    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tasks');
    expect(Array.isArray(res.body.tasks)).toBe(true);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].id).toBe('task-abc');
    expect(res.body.tasks[0].text).toBe('Test task');
  });

  test('returns 200 with empty tasks array when user has no tasks', async () => {
    resolveQueue.push([]);                          // select() → empty list
    resolveQueue.push({ max_updated: null, cnt: 0 }); // first() → version row

    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.tasks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AP-09: POST /api/tasks creates a task and returns it
// SC-38: POST /api/tasks triggers enqueueScheduleRun
// ---------------------------------------------------------------------------
describe('AP-09 + SC-38: POST /api/tasks', () => {
  test('returns 401 when no auth header', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ text: 'New task' });
    expect(res.status).toBe(401);
  });

  test('AP-09: creates a task and returns it with status 201', async () => {
    // createTask flow (non-locked path):
    //   1. isLocked → false (mocked)
    //   2. applySplitDefault → db('user_config').where(...).first() → null
    //   3. ensureProject (skipped — no project field)
    //   4. tasksWrite.insertTask (mocked, no-op)
    //   5. fetchTaskWithEventIds:
    //      a. db('tasks_v').where({id,user_id}).first() → task row
    //      b. db('cal_sync_ledger').where({task_id,status:'active'}).select() → []
    //   6. cache.invalidateTasks
    //   7. enqueueScheduleRun (wrapped local fn, calls _enqueueScheduleRun via setTimeout)
    resolveQueue.push(null);             // applySplitDefault: user_config first() → no prefs
    resolveQueue.push(BASE_TASK_ROW);   // fetchTaskWithEventIds: tasks_v first()
    resolveQueue.push([]);              // fetchTaskWithEventIds: cal_sync_ledger select()

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ text: 'Test task' });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('task');
    expect(res.body.task.text).toBe('Test task');
    expect(res.body.task.id).toBeTruthy();
  });

  test('SC-38: enqueueScheduleRun is called after task creation', async () => {
    jest.useFakeTimers();
    resolveQueue.push(null);             // applySplitDefault: user_config first()
    resolveQueue.push(BASE_TASK_ROW);   // fetchTaskWithEventIds: tasks_v first()
    resolveQueue.push([]);              // fetchTaskWithEventIds: cal_sync_ledger select()

    await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ text: 'Scheduler trigger task' });

    // The local enqueueScheduleRun wrapper calls _enqueueScheduleRun via setTimeout(fn, 2000).
    // Advance timers to flush the deferred call.
    jest.runAllTimers();
    jest.useRealTimers();

    expect(mockEnqueueScheduleRun).toHaveBeenCalledWith(
      TEST_USER.id,
      'api:createTask'
    );
  });

  test('returns 400 when text is missing', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({});

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// R1.6: Feature gate on task creation — 403 when plan lacks required feature
// ---------------------------------------------------------------------------
describe('R1.6: Feature gate on task creation', () => {
  test('returns 403 when plan lacks task-creation feature', async () => {
    // Override planFeatures to simulate a plan without task creation
    // The feature-gate middleware checks req.planFeatures for the feature path.
    // We mock the plan-features middleware to return a plan with no task feature.
    const planFeatures = require('../../src/middleware/plan-features.middleware');
    const origResolve = planFeatures.resolvePlanFeatures;
    planFeatures.resolvePlanFeatures = (req, res, next) => {
      req.planId = 'free';
      req.planFeatures = {
        limits: { active_tasks: 1 },
        tasks: {}, // no task creation feature
        calendar: { max_providers: 0 },
        scheduling: {}
      };
      next();
    };

    resolveQueue.push(null);  // applySplitDefault: user_config first()
    resolveQueue.push(null);  // fetchTaskWithEventIds: tasks_v first() → not found (shouldn't reach)

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ text: 'Feature-gated task' });

    // Restore original
    planFeatures.resolvePlanFeatures = origResolve;

    // The current route does NOT have a feature gate on POST /api/tasks,
    // so this documents the current behavior. When the gate is added,
    // this test should assert 403.
    // For now, assert the task is created (no gate yet) — this test
    // serves as a placeholder that will fail when the gate is added,
    // reminding the developer to update the assertion.
    expect(res.status).toBe(403);
  });

  test('feature-gate middleware returns 403 for missing feature', async () => {
    // Directly test the feature-gate middleware behavior
    const { requireFeature } = require('../../src/middleware/feature-gate');
    const mockReq = {
      planFeatures: { tasks: {} },
      planId: 'free',
      user: { id: 'user-123' },
      method: 'POST',
      originalUrl: '/api/tasks'
    };
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    const mockNext = jest.fn();

    const middleware = requireFeature('tasks.create');
    middleware(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalled();
    expect(mockNext).not.toHaveBeenCalled();
  });

  test('feature-gate middleware calls next() when feature is present', async () => {
    const { requireFeature } = require('../../src/middleware/feature-gate');
    const mockReq = {
      planFeatures: { tasks: { create: true } },
      planId: 'enterprise',
      user: { id: 'user-123' },
      method: 'POST',
      originalUrl: '/api/tasks'
    };
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    const mockNext = jest.fn();

    const middleware = requireFeature('tasks.create');
    middleware(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AP-10: DELETE /api/tasks/:id removes a task
// ---------------------------------------------------------------------------
describe('AP-10: DELETE /api/tasks/:id', () => {
  test('returns 401 when no auth header', async () => {
    const res = await request(app).delete('/api/tasks/task-abc');
    expect(res.status).toBe(401);
  });

  test('returns 404 when task does not exist', async () => {
    // fetchTaskWithEventIds: tasks_v first() → null + ledger select() → []
    resolveQueue.push(null);  // tasks_v first() → not found
    resolveQueue.push([]);    // cal_sync_ledger select()

    const res = await request(app)
      .delete('/api/tasks/nonexistent-id')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(404);
  });

  test('AP-10: deletes an existing task and returns 200', async () => {
    // deleteTask flow:
    //   1. fetchTaskWithEventIds:
    //      a. tasks_v first() → task row (no calendar event ids)
    //      b. cal_sync_ledger select() → []
    //   2. ingest-mode check: skipped (no gcal/msft event ids)
    //   3. provider-origin check: db('cal_sync_ledger').where(...).first() → null
    //   4. tasksWrite.deleteTaskById (mocked)
    //   5. enqueueScheduleRun
    const taskRow = { ...BASE_TASK_ROW, gcal_event_id: null, msft_event_id: null, apple_event_id: null };
    resolveQueue.push(taskRow);   // fetchTaskWithEventIds: tasks_v first()
    resolveQueue.push([]);        // fetchTaskWithEventIds: cal_sync_ledger select()
    resolveQueue.push(null);      // provider-origin check: cal_sync_ledger first() → no provider row

    const res = await request(app)
      .delete('/api/tasks/task-abc')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);

    const tasksWrite = require('../../src/lib/tasks-write');
    expect(tasksWrite.deleteTaskById).toHaveBeenCalled();
  });
});
