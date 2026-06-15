/**
 * taskEvents.test.js — W3 (ADR-0001 "adopt lib-events as TaskEventPort bus").
 *
 * Covers three concerns:
 *   1. PUBLISHING — create/update/complete a task publishes the matching event
 *      (task.created / task.updated / task.completed) with the right payload.
 *   2. ERROR ISOLATION — a subscriber that throws does NOT break the task write;
 *      the HTTP response is unchanged.
 *   3. S4/S6 GUARD (critical) — event delivery to the benign subscriber does NOT
 *      call the scheduler. The ONLY scheduler trigger is the existing direct
 *      enqueueScheduleRun call. A subscriber added on the bus cannot reach the
 *      scheduler.
 *
 * Mirrors the mock scaffold of tests/api/tasks.test.js so the controller runs
 * against a fully stubbed DB / queue / sse layer.
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
  chain.raw = (s) => s;
  chain.transaction = jest.fn(async (cb) => cb(chain));
  return chain;
}

const mockDb = createChainMock();
jest.mock('../src/db', () => mockDb);

// ADR-0002 / H3-W6: the task slice's KnexTaskRepository obtains knex via lib/db
// (getDefaultDb()), NOT src/db.js. Point lib/db's default at the SAME mockDb so the
// thin controller → facade → repo path resolves the same chain mock + resolveQueue.
jest.mock('../src/lib/db', () => {
  const actual = jest.requireActual('../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

const TEST_USER = { id: 'user-123', email: 'test@test.com', name: 'Test', timezone: 'America/New_York' };
jest.mock('../src/middleware/jwt-auth', () => ({
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

jest.mock('../src/middleware/plan-features.middleware', () => ({
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

jest.mock('../src/lib/redis', () => ({
  getClient: jest.fn().mockReturnValue(null),
  invalidateTasks: jest.fn(() => Promise.resolve()),
  invalidateConfig: jest.fn(() => Promise.resolve()),
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve()),
  del: jest.fn(() => Promise.resolve())
}));

// CRITICAL: the scheduler queue is mocked so the S4/S6 guard can assert event
// delivery never reaches it.
const mockEnqueueScheduleRun = jest.fn();
jest.mock('../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: mockEnqueueScheduleRun,
  stopPollLoop: jest.fn()
}));

jest.mock('../src/lib/sse-emitter', () => ({
  emit: jest.fn(),
  addClient: jest.fn()
}));

jest.mock('../src/lib/task-write-queue', () => ({
  isLocked: jest.fn(() => Promise.resolve(false)),
  enqueueWrite: jest.fn(() => Promise.resolve()),
  splitFields: jest.fn((row) => ({ schedulingFields: row, nonSchedulingFields: {} })),
  flushQueue: jest.fn(() => Promise.resolve())
}));

jest.mock('../src/lib/tasks-write', () => ({
  insertTask: jest.fn(() => Promise.resolve()),
  deleteTaskById: jest.fn(() => Promise.resolve(1)),
  deleteTasksWhere: jest.fn(() => Promise.resolve()),
  updateTaskById: jest.fn(() => Promise.resolve(1)),
  updateTasksWhere: jest.fn(() => Promise.resolve()),
  updateInstancesWhere: jest.fn(() => Promise.resolve()),
  insertTasksBatch: jest.fn(() => Promise.resolve()),
  archiveInstances: jest.fn(() => Promise.resolve()),
  getOrCreateArchivedMasterId: jest.fn(() => Promise.resolve('archive-master-id')),
  resetRecurringInstances: jest.fn(() => Promise.resolve()),
  archiveCompletedInstances: jest.fn(() => Promise.resolve())
}));

jest.mock('../src/middleware/entity-limits', () => ({
  checkTaskOrRecurringLimit: (req, res, next) => next(),
  checkBatchTaskLimits: (req, res, next) => next(),
  checkProjectLimit: (req, res, next) => next(),
  checkToolLimit: (req, res, next) => next(),
  checkLocationLimit: (req, res, next) => next()
}));

const VALID_TOKEN = 'valid-test-token';
const { EventTypes, getEventBus, resetEventBus } = require('../src/lib/events');

let app, request;

beforeAll(() => {
  app = require('../src/app');
  request = require('supertest');
});

beforeEach(() => {
  resolveQueue = [];
  jest.clearAllMocks();
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

// Subscribe a spy on the shared singleton bus. Returns { spy, unsubscribe }.
function spyOn(eventType) {
  const spy = jest.fn();
  const unsubscribe = getEventBus().subscribe(eventType, spy);
  return { spy, unsubscribe };
}

// -------------------------------------------------------------------------
// 1. PUBLISHING
// -------------------------------------------------------------------------
describe('W3 publishing — task lifecycle events', () => {
  test('createTask publishes task.created with {taskId, userId, status}', async () => {
    const { spy, unsubscribe } = spyOn(EventTypes.TASK_CREATED);
    resolveQueue.push(null);            // applySplitDefault: user_config first()
    resolveQueue.push(BASE_TASK_ROW);   // fetchTaskWithEventIds: tasks_v first()
    resolveQueue.push([]);              // fetchTaskWithEventIds: cal_sync_ledger select()

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ text: 'Test task' });

    expect(res.status).toBe(201);
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = spy.mock.calls[0][0];
    expect(payload.taskId).toBe('task-abc');
    expect(payload.userId).toBe('user-123');
    expect(payload).toHaveProperty('status');
    unsubscribe();
  });

  test('updateTaskStatus (status=done) publishes task.completed', async () => {
    const { spy, unsubscribe } = spyOn(EventTypes.TASK_COMPLETED);
    const scheduledRow = { ...BASE_TASK_ROW, scheduled_at: '2026-01-01T10:00:00Z' };
    // fetchTaskWithEventIds (existing): tasks_v first() + ledger select()
    resolveQueue.push(scheduledRow);
    resolveQueue.push([]);
    // buildSourceMap recurring-template query
    resolveQueue.push([]);
    // fetchTaskWithEventIds (updated): tasks_v first() + ledger select()
    resolveQueue.push({ ...scheduledRow, status: 'done' });
    resolveQueue.push([]);
    // srcMap query (tasks_v)
    resolveQueue.push([]);

    const res = await request(app)
      .put('/api/tasks/task-abc/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'done' });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = spy.mock.calls[0][0];
    expect(payload.taskId).toBe('task-abc');
    expect(payload.userId).toBe('user-123');
    unsubscribe();
  });

  test('payload is serializable — no knex / Date.fn handles leak through', async () => {
    const { spy, unsubscribe } = spyOn(EventTypes.TASK_CREATED);
    resolveQueue.push(null);
    resolveQueue.push(BASE_TASK_ROW);
    resolveQueue.push([]);

    await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ text: 'Serializable check' });

    const payload = spy.mock.calls[0][0];
    // Stripping _eventMeta (bus-attached Date), the identity payload must
    // round-trip through JSON unchanged.
    const { _eventMeta, ...identity } = payload;
    expect(() => JSON.stringify(identity)).not.toThrow();
    expect(JSON.parse(JSON.stringify(identity))).toEqual(identity);
    expect(typeof identity.taskId).toBe('string');
    expect(typeof identity.userId).toBe('string');
    expect(typeof identity.status).toBe('string');
    expect(typeof identity.timestamp).toBe('number');
    unsubscribe();
  });
});

// -------------------------------------------------------------------------
// 1b. PAYLOAD↔TYPEDEF CONTRACT (999.333)
//
// The publisher (lib/events/taskEvents.js) must emit EXACTLY the flat/minimal
// shape documented by the TaskCreated/Updated/CompletedPayload typedefs in
// lib/events/index.js and bound by ADR-0001 E-3: { taskId, userId, status,
// timestamp }. No `task` / `changes` fields (the stale typedef shape that no
// publisher emitted and no consumer read). This is a fail-on-drift guard: if a
// publisher starts emitting a richer/different shape without the typedef being
// updated to match, this test goes RED.
// -------------------------------------------------------------------------
describe('999.333 payload↔typedef contract — publisher emits the flat E-3 shape', () => {
  const taskEvents = require('../src/lib/events/taskEvents');

  // The exact key set the typedefs document (sans the bus-attached _eventMeta).
  const EXPECTED_KEYS = ['taskId', 'userId', 'status', 'timestamp'].sort();

  function captureFor(eventType, publishFn) {
    const spy = jest.fn();
    const unsubscribe = getEventBus().subscribe(eventType, spy);
    publishFn();
    unsubscribe();
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = spy.mock.calls[0][0];
    const { _eventMeta, ...identity } = payload; // strip bus metadata
    return identity;
  }

  function assertFlatShape(identity) {
    expect(Object.keys(identity).sort()).toEqual(EXPECTED_KEYS);
    expect(typeof identity.taskId).toBe('string');
    expect(typeof identity.userId).toBe('string');
    expect(typeof identity.status).toBe('string');
    expect(typeof identity.timestamp).toBe('number'); // Date.now(), not a Date
    // The stale richer shape must NOT leak through.
    expect(identity).not.toHaveProperty('task');
    expect(identity).not.toHaveProperty('changes');
  }

  test('publishTaskCreated payload matches the TaskCreatedPayload typedef (flat)', () => {
    const identity = captureFor(EventTypes.TASK_CREATED, () =>
      taskEvents.publishTaskCreated({ id: 'task-1', userId: 'user-1', status: '' }));
    assertFlatShape(identity);
    expect(identity.taskId).toBe('task-1');
    expect(identity.userId).toBe('user-1');
  });

  test('publishTaskUpdated payload matches the TaskUpdatedPayload typedef (flat)', () => {
    const identity = captureFor(EventTypes.TASK_UPDATED, () =>
      taskEvents.publishTaskUpdated({ id: 'task-2', userId: 'user-2', status: 'active' }));
    assertFlatShape(identity);
    expect(identity.taskId).toBe('task-2');
    expect(identity.status).toBe('active');
  });

  test('publishTaskCompleted payload matches the TaskCompletedPayload typedef (flat)', () => {
    const identity = captureFor(EventTypes.TASK_COMPLETED, () =>
      taskEvents.publishTaskCompleted({ id: 'task-3', userId: 'user-3', status: 'done' }));
    assertFlatShape(identity);
    expect(identity.status).toBe('done');
  });
});

// -------------------------------------------------------------------------
// 2. ERROR ISOLATION — a throwing subscriber must not break the write
// -------------------------------------------------------------------------
describe('W3 error isolation — throwing subscriber cannot break the write', () => {
  test('createTask still returns 201 + correct body when a subscriber throws', async () => {
    const thrower = jest.fn(() => { throw new Error('subscriber boom'); });
    const unsubscribe = getEventBus().subscribe(EventTypes.TASK_CREATED, thrower);

    resolveQueue.push(null);
    resolveQueue.push(BASE_TASK_ROW);
    resolveQueue.push([]);

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ text: 'Test task' });

    // Response unchanged despite the throwing subscriber.
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('task');
    expect(res.body.task.id).toBe('task-abc');
    expect(res.body.task.text).toBe('Test task');
    expect(thrower).toHaveBeenCalledTimes(1); // it ran (and threw) but was isolated
    unsubscribe();
  });
});

// -------------------------------------------------------------------------
// 3. S4/S6 GUARD (critical) — event delivery must NOT trigger the scheduler
// -------------------------------------------------------------------------
describe('W3 S4/S6 guard — benign subscriber does not trigger the scheduler', () => {
  test('a subscriber receiving task.created does NOT call enqueueScheduleRun', () => {
    // Directly exercise the bus: publishing/delivery must never reach the
    // scheduler queue. The benign taskEventLogger subscriber is already
    // registered (via app require in beforeAll).
    mockEnqueueScheduleRun.mockClear();

    const observed = jest.fn();
    const unsub = getEventBus().subscribe(EventTypes.TASK_CREATED, observed);

    const taskEvents = require('../src/lib/events/taskEvents');
    taskEvents.publishTaskCreated({ id: 'task-xyz', userId: 'user-123', status: '' });
    taskEvents.publishTaskUpdated({ id: 'task-xyz', userId: 'user-123', status: '' });
    taskEvents.publishTaskCompleted({ id: 'task-xyz', userId: 'user-123', status: 'done' });

    expect(observed).toHaveBeenCalled(); // delivery happened
    // The critical invariant: no scheduler trigger from event delivery.
    expect(mockEnqueueScheduleRun).not.toHaveBeenCalled();
    unsub();
  });

  test('taskEventLogger subscriber is registered (importer count > 0) and is scheduler-free', () => {
    const logger = require('../src/lib/events/taskEventLogger');
    // Re-register is idempotent and returns the live unsubscribers.
    logger.register();
    expect(getEventBus().subscriberCount(EventTypes.TASK_CREATED)).toBeGreaterThan(0);
    expect(getEventBus().subscriberCount(EventTypes.TASK_UPDATED)).toBeGreaterThan(0);
    expect(getEventBus().subscriberCount(EventTypes.TASK_COMPLETED)).toBeGreaterThan(0);
    // Delivering to it does not touch the scheduler.
    mockEnqueueScheduleRun.mockClear();
    getEventBus().publish(EventTypes.TASK_CREATED, { taskId: 't', userId: 'u', status: '' });
    expect(mockEnqueueScheduleRun).not.toHaveBeenCalled();
  });
});
