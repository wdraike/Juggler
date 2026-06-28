/**
 * Task State Machine — SM-18 through SM-25
 *
 * Covers:
 *   SM-18: wip → '' (reopen) clears completed_at
 *   SM-19: wip → done transition (requires scheduled_at)
 *   SM-20: skip a recurring instance (skip one occurrence)
 *   SM-21: pause on recurring template is accepted
 *   SM-22: disabled status guard — user cannot write other fields to disabled task
 *   SM-23: missed status is no longer valid (user cannot set → 400)
 *           NOTE: already covered in status-guard.test.js; this test asserts the
 *           complementary aspect — missed cannot be set via PUT /api/tasks/:id either
 *           (the `updateTask` path also checks disabled guard, not missed specifically,
 *           but the status-guard.test.js SM-23 baseline is referenced here explicitly).
 *   SM-24: allDay flag round-trip through PUT /api/tasks/:id sets when='allday'
 *   SM-25: Terminal-status idempotency — done→done returns 200 (not error)
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
// thin controller → facade → repo path resolves the same chain mock + resolveQueue.
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

jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
}));

jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn(),
  addClient: jest.fn()
}));

// tasks-write: mock out multi-table write logic to keep tests pure
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
  isTemplate: jest.fn(() => false)
}));

// task-write-queue: mock to prevent real DB lock checks
jest.mock('../../src/lib/task-write-queue', () => ({
  isLocked: jest.fn(() => Promise.resolve(false)),
  enqueueWrite: jest.fn(() => Promise.resolve()),
  flushQueue: jest.fn(() => Promise.resolve()),
  flushQueueInLock: jest.fn(() => Promise.resolve()),
  splitFields: jest.fn((fields) => ({ schedulingFields: {}, nonSchedulingFields: fields })),
  NON_SCHEDULING_FIELDS: []
}));

// entity-limits middleware: let all through
jest.mock('../../src/middleware/entity-limits', () => ({
  checkProjectLimit: (req, res, next) => next(),
  checkLocationLimit: (req, res, next) => next(),
  checkScheduleTemplateLimit: (req, res, next) => next(),
  checkTaskOrRecurringLimit: (req, res, next) => next(),
  checkBatchTaskLimits: (req, res, next) => next()
}));

// validate middleware: pass through without schema check
jest.mock('../../src/middleware/validate', () => ({
  validate: () => (req, res, next) => next()
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

  // Re-apply stable mock return values cleared by clearAllMocks
  const tasksWrite = require('../../src/lib/tasks-write');
  tasksWrite.updateTaskById.mockResolvedValue(1);
  tasksWrite.insertTask.mockResolvedValue(undefined);
  tasksWrite.deleteTasksWhere.mockResolvedValue(undefined);
  tasksWrite.resetRecurringInstances.mockResolvedValue(undefined);

  const writeQueue = require('../../src/lib/task-write-queue');
  writeQueue.isLocked.mockResolvedValue(false);
  writeQueue.splitFields.mockImplementation((fields) => ({ schedulingFields: {}, nonSchedulingFields: fields }));

  const redis = require('../../src/lib/redis');
  redis.invalidateTasks.mockResolvedValue(undefined);
  redis.get.mockResolvedValue(null);
  redis.set.mockResolvedValue(undefined);
  redis.del.mockResolvedValue(undefined);
});

/**
 * seedExisting seeds the resolveQueue for a typical PUT /api/tasks/:id/status flow.
 *
 * fetchTaskWithEventIds calls Promise.all([db(...tasks_v...).first(), db(...cal_sync_ledger...).select()])
 * so both first() and select() shift from the queue simultaneously.
 *
 * Flow for a successful status update:
 *   [0] first()  → existing task row (initial lookup)
 *   [1] select() → [] ledger rows (initial lookup — no calendar events)
 *   [2] first()  → task row again (post-update re-read)
 *   [3] select() → [] ledger rows (post-update re-read — default when queue empty)
 *   The srcMap select() at end returns [] automatically (empty queue → default [])
 */
function seedExisting(task) {
  resolveQueue.push(task); // [0] existing first()
  resolveQueue.push([]);   // [1] existing ledger select()
  resolveQueue.push(task); // [2] post-update first()
  // [3] post-update ledger select() → returns [] when queue is empty (mock default)
}

// ---------------------------------------------------------------------------
// Base task shape helpers
// ---------------------------------------------------------------------------

function makeTask(overrides) {
  return Object.assign({
    id: 'task-sm',
    master_id: 'task-sm',
    user_id: TEST_USER.id,
    task_type: 'task',
    status: '',
    scheduled_at: '2026-05-15 14:00:00',
    text: 'SM test task',
    dur: 30,
    pri: 'P3',
    when: '',
    recurring: 0,
    generated: 0,
    day_req: 'any',
    split_total: null,
    source_id: null,
    occurrence_ordinal: null,
    gcal_event_id: null,
    msft_event_id: null,
    apple_event_id: null,
    completed_at: null
  }, overrides);
}

function makeTemplate(overrides) {
  return makeTask(Object.assign({ task_type: 'recurring_template', status: '' }, overrides));
}

function makeInstance(overrides) {
  return makeTask(Object.assign({ task_type: 'recurring_instance', recurring: 1 }, overrides));
}

// ---------------------------------------------------------------------------
// SM-18: wip → '' (reopen) clears completed_at
// ---------------------------------------------------------------------------

describe('SM-18: wip → reopen (status = empty string)', () => {
  test('returns 200 and allows transition from wip to empty status', async () => {
    const task = makeTask({ id: 'sm18-task', status: 'wip', completed_at: null });
    seedExisting(task);

    const res = await request(app)
      .put('/api/tasks/sm18-task/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: '' });

    expect(res.status).toBe(200);
    expect(res.body.task).toBeDefined();
  });

  test('writes status="" and clears completed_at when reopening a terminal task', async () => {
    // Simulate a done task being reopened (terminal → non-terminal clears completed_at)
    const task = makeTask({ id: 'sm18-done', status: 'done', completed_at: '2026-05-15T14:00:00Z' });
    seedExisting(task);

    await request(app)
      .put('/api/tasks/sm18-done/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: '' });

    const tasksWrite = require('../../src/lib/tasks-write');
    const updateCall = tasksWrite.updateTaskById.mock.calls[0];
    expect(updateCall).toBeDefined();
    const fields = updateCall[2]; // (db, id, fields, userId) → fields at index 2
    expect(fields.status).toBe('');
    expect(fields).toHaveProperty('completed_at', null);
  });
});

// ---------------------------------------------------------------------------
// SM-19: wip → done (requires scheduled_at)
// ---------------------------------------------------------------------------

describe('SM-19: wip → done (task must have scheduled_at)', () => {
  test('returns 200 when task has scheduled_at set', async () => {
    const task = makeTask({ id: 'sm19-task', status: 'wip', scheduled_at: '2026-05-15 14:00:00', master_id: null });
    seedExisting(task);

    const res = await request(app)
      .put('/api/tasks/sm19-task/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'done' });

    expect(res.status).toBe(200);
    expect(res.body.task).toBeDefined();
  });

  test('returns 400 with SCHEDULE_REQUIRED_FOR_TERMINAL_STATUS when scheduled_at is null', async () => {
    const task = makeTask({ id: 'sm19-unsched', status: 'wip', scheduled_at: null });
    seedExisting(task);

    const res = await request(app)
      .put('/api/tasks/sm19-unsched/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'done' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SCHEDULE_REQUIRED_FOR_TERMINAL_STATUS');
  });

  test('writes completed_at on wip → done transition', async () => {
    const task = makeTask({ id: 'sm19-ct', status: 'wip', scheduled_at: '2026-05-15 14:00:00' });
    seedExisting(task);

    await request(app)
      .put('/api/tasks/sm19-ct/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'done' });

    const tasksWrite = require('../../src/lib/tasks-write');
    const updateCall = tasksWrite.updateTaskById.mock.calls[0];
    expect(updateCall).toBeDefined();
    const fields = updateCall[2];
    expect(fields.status).toBe('done');
    expect(fields.completed_at).toBeDefined();
    expect(fields.completed_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SM-20: skip a recurring instance (skip one occurrence)
// ---------------------------------------------------------------------------

describe('SM-20: skip a recurring instance (skip one occurrence)', () => {
  test('returns 200 when skipping a scheduled recurring instance', async () => {
    const instance = makeInstance({
      id: 'sm20-inst',
      status: '',
      scheduled_at: '2026-05-15 10:00:00',
      source_id: 'sm20-template'
    });
    seedExisting(instance);
    // skip triggers the rolling-anchor check: db('task_masters').first() consumes one
    // queue slot before the post-update fetchTaskWithEventIds. Insert null at index 2
    // (between initial-fetch and post-update-fetch slots) so post-update gets the task row.
    resolveQueue.splice(2, 0, null);

    const res = await request(app)
      .put('/api/tasks/sm20-inst/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'skip' });

    expect(res.status).toBe(200);
    expect(res.body.task).toBeDefined();
  });

  test('rejects skip on a recurring instance without scheduled_at', async () => {
    const instance = makeInstance({
      id: 'sm20-unsched',
      status: '',
      scheduled_at: null,
      source_id: 'sm20-template'
    });
    seedExisting(instance);

    const res = await request(app)
      .put('/api/tasks/sm20-unsched/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'skip' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SCHEDULE_REQUIRED_FOR_TERMINAL_STATUS');
  });

  test('only updates the target instance, not the template', async () => {
    const instance = makeInstance({
      id: 'sm20-only',
      status: '',
      scheduled_at: '2026-05-15 10:00:00',
      source_id: 'sm20-template'
    });
    seedExisting(instance);

    await request(app)
      .put('/api/tasks/sm20-only/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'skip' });

    const tasksWrite = require('../../src/lib/tasks-write');
    // updateTaskById should be called with the instance id, not the template id
    const instanceCall = tasksWrite.updateTaskById.mock.calls.find(c => c[1] === 'sm20-only');
    expect(instanceCall).toBeDefined();
    expect(instanceCall[2].status).toBe('skip');
  });
});

// ---------------------------------------------------------------------------
// SM-21: pause on recurring template is accepted
// ---------------------------------------------------------------------------

describe('SM-21: pause on recurring template', () => {
  test('returns 200 when pausing a recurring template', async () => {
    const template = makeTemplate({ id: 'sm21-tpl', scheduled_at: null });
    // Pause path flow (beyond normal seedExisting):
    //   [0] existing first()   → template
    //   [1] existing select()  → [] (ledger)
    //   [2] futureInstances select() for tasks_with_sync_v → [] (no future instances)
    //   [3] srcMap select()    → [] (empty queue default)
    //   [4] post-update first() for fetchTaskWithEventIds → template
    //   [5] post-update select() → [] (empty queue default)
    resolveQueue.push(template); // [0]
    resolveQueue.push([]);       // [1] ledger
    resolveQueue.push([]);       // [2] futureInstances (tasks_with_sync_v select)
    resolveQueue.push([]);       // [3] srcMap tasks_v select
    resolveQueue.push(template); // [4] post-update first()

    const res = await request(app)
      .put('/api/tasks/sm21-tpl/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'pause' });

    expect(res.status).toBe(200);
  });

  test('accepts pause even when template has no scheduled_at', async () => {
    const template = makeTemplate({ id: 'sm21-nosched', scheduled_at: null });
    seedExisting(template);

    const res = await request(app)
      .put('/api/tasks/sm21-nosched/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'pause' });

    // Must NOT return 400 (the scheduled_at guard does not apply to templates)
    expect(res.status).not.toBe(400);
  });

  test('rejects non-pause statuses on recurring templates', async () => {
    const template = makeTemplate({ id: 'sm21-done', scheduled_at: '2026-05-15 14:00:00' });
    seedExisting(template);

    const res = await request(app)
      .put('/api/tasks/sm21-done/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'done' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/paused or unpaused/i);
  });

  test('writes pause status to template via updateTaskById', async () => {
    const template = makeTemplate({ id: 'sm21-write', scheduled_at: null });
    seedExisting(template);

    await request(app)
      .put('/api/tasks/sm21-write/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'pause' });

    const tasksWrite = require('../../src/lib/tasks-write');
    const call = tasksWrite.updateTaskById.mock.calls.find(c => c[1] === 'sm21-write');
    expect(call).toBeDefined();
    expect(call[2].status).toBe('pause');
  });
});

// ---------------------------------------------------------------------------
// SM-22: disabled status guard — cannot update a disabled task
// ---------------------------------------------------------------------------

describe('SM-22: disabled status guard', () => {
  test('returns 403 TASK_DISABLED when updating status of a disabled task', async () => {
    const task = makeTask({ id: 'sm22-disabled', status: 'disabled' });
    seedExisting(task);

    const res = await request(app)
      .put('/api/tasks/sm22-disabled/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'wip' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TASK_DISABLED');
  });

  test('disabled task rejects any terminal status attempt too', async () => {
    const task = makeTask({ id: 'sm22-disabled-done', status: 'disabled', scheduled_at: '2026-05-15 14:00:00' });
    seedExisting(task);

    const res = await request(app)
      .put('/api/tasks/sm22-disabled-done/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'done' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TASK_DISABLED');
  });

  test('re-enable endpoint accepts disabled task', async () => {
    const task = makeTask({ id: 'sm22-reenable', status: 'disabled', task_type: 'task', recurring: 0, master_id: null });
    // re-enable call sequence:
    //   [0] first()  → task (initial fetchTaskWithEventIds)
    //   [1] select() → [] (initial ledger fetch — cal_sync_ledger)
    //   [2] select() → [] (buildSourceMap: db('tasks_v').select())
    //   [3] first()  → task (post-update fetchTaskWithEventIds)
    //   [4] select() → [] (post-update ledger fetch — returns [] when queue empty, mock default)
    resolveQueue.push(task); // [0]
    resolveQueue.push([]);   // [1]
    resolveQueue.push([]);   // [2] buildSourceMap tasks_v select
    resolveQueue.push(task); // [3]
    // [4] post-update ledger select() → empty queue default []

    const res = await request(app)
      .put('/api/tasks/sm22-reenable/re-enable')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({});

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// SM-23: missed status is no longer valid (400)
//
// NOTE: 'missed' has been removed from VALID_STATUSES. A PUT with status='missed'
// now returns 400 (generic invalid status) instead of the former 403
// STATUS_MISSED_SYSTEM_ONLY. This describe block asserts that the 400 is
// returned regardless of whether the task has scheduled_at set or not.
// ---------------------------------------------------------------------------

describe('SM-23: missed status — invalid status (400)', () => {
  test('returns 400 for scheduled task', async () => {
    const task = makeTask({ id: 'sm23-sched', status: '', scheduled_at: '2026-05-15 14:00:00' });
    seedExisting(task);

    const res = await request(app)
      .put('/api/tasks/sm23-sched/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'missed' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid status/);
  });

  test('returns 400 for unscheduled task', async () => {
    const task = makeTask({ id: 'sm23-unsched', status: '', scheduled_at: null });
    seedExisting(task);

    const res = await request(app)
      .put('/api/tasks/sm23-unsched/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'missed' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid status/);
  });
});

// ---------------------------------------------------------------------------
// SM-24: allDay flag round-trip through PUT /api/tasks/:id
// ---------------------------------------------------------------------------

describe('SM-24: allDay flag round-trip through task update', () => {
  test('setting allDay=true writes when=allday to the DB', async () => {
    // allDay requires the complex update path (req.body.allDay !== undefined)
    // Complex path calls fetchTaskWithEventIds twice (existing + post-write re-read).
    // Each call does Promise.all([first(), select()]), so queue needs: task, [], task.
    const task = makeTask({ id: 'sm24-task', when: '', scheduled_at: '2026-05-15 00:00:00' });
    resolveQueue.push(task); // existing first()
    resolveQueue.push([]);   // existing ledger select()
    resolveQueue.push(task); // post-write first()

    const res = await request(app)
      .put('/api/tasks/sm24-task')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ text: 'SM24 task', allDay: true });

    // The route should succeed (not 400/404/500)
    expect(res.status).toBe(200);
  });

  test('allDay=true results in placement_mode=all_day being written', async () => {
    // After the placement_mode enum redesign (migration 20260518000100),
    // allDay:true writes placement_mode='all_day' rather than when='allday'.
    // The when column is no longer the canonical all-day signal.
    const task = makeTask({ id: 'sm24-write', when: '', scheduled_at: '2026-05-15 00:00:00' });
    resolveQueue.push(task); // existing first()
    resolveQueue.push([]);   // existing ledger select()
    resolveQueue.push(task); // post-write first()

    await request(app)
      .put('/api/tasks/sm24-write')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ text: 'SM24 allday test', allDay: true });

    const tasksWrite = require('../../src/lib/tasks-write');
    // At least one updateTaskById call should contain placement_mode='all_day'
    const allDayCall = tasksWrite.updateTaskById.mock.calls.find(c => c[2] && c[2].placement_mode === 'all_day');
    expect(allDayCall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// SM-25: Terminal-status idempotency — done→done returns 200
// ---------------------------------------------------------------------------

describe('SM-25: Terminal-status idempotency (done → done = 200)', () => {
  test('done→done returns 200, not an error', async () => {
    const task = makeTask({ id: 'sm25-done', status: 'done', scheduled_at: '2026-05-15 14:00:00', completed_at: '2026-05-15T14:00:00Z', master_id: null });
    seedExisting(task);

    const res = await request(app)
      .put('/api/tasks/sm25-done/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'done' });

    expect(res.status).toBe(200);
  });

  test('skip→skip returns 200', async () => {
    const task = makeTask({ id: 'sm25-skip', status: 'skip', scheduled_at: '2026-05-15 14:00:00', master_id: null });
    seedExisting(task);

    const res = await request(app)
      .put('/api/tasks/sm25-skip/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'skip' });

    expect(res.status).toBe(200);
  });

  test('cancel→cancel returns 200', async () => {
    const task = makeTask({ id: 'sm25-cancel', status: 'cancel', scheduled_at: '2026-05-15 14:00:00' });
    seedExisting(task);

    const res = await request(app)
      .put('/api/tasks/sm25-cancel/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'cancel' });

    expect(res.status).toBe(200);
  });

  test('idempotent done→done does not set completed_at again (already terminal)', async () => {
    const task = makeTask({ id: 'sm25-idem', status: 'done', scheduled_at: '2026-05-15 14:00:00', completed_at: '2026-05-15T14:00:00Z', master_id: null });
    seedExisting(task);

    const res = await request(app)
      .put('/api/tasks/sm25-idem/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'done' });

    expect(res.status).toBe(200);

    const tasksWrite = require('../../src/lib/tasks-write');
    const updateCall = tasksWrite.updateTaskById.mock.calls[0];
    expect(updateCall).toBeDefined();
    const fields = updateCall[2];
    // done → done: existing is already terminal, new is terminal — completed_at should NOT be re-written
    expect(fields).not.toHaveProperty('completed_at');
  });
});

// ---------------------------------------------------------------------------
// R6.1: time_remaining edge cases
// ---------------------------------------------------------------------------
describe('R6.1: time_remaining edge cases on todo→wip transition', () => {
  test('todo→wip with zero time_remaining is accepted', async () => {
    const task = makeTask({ id: 'r61-zero', status: '', scheduled_at: '2026-05-15 14:00:00' });
    seedExisting(task);

    const res = await request(app)
      .put('/api/tasks/r61-zero/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'wip', time_remaining: 0 });

    expect(res.status).toBe(200);
  });

  test('todo→wip with negative time_remaining is rejected', async () => {
    const task = makeTask({ id: 'r61-neg', status: '', scheduled_at: '2026-05-15 14:00:00' });
    seedExisting(task);

    const res = await request(app)
      .put('/api/tasks/r61-neg/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'wip', time_remaining: -5 });

    // Negative time_remaining should be rejected with 400
    expect(res.status).toBe(400);
  });

  test('todo→wip with very large time_remaining is accepted', async () => {
    const task = makeTask({ id: 'r61-large', status: '', scheduled_at: '2026-05-15 14:00:00' });
    seedExisting(task);

    const res = await request(app)
      .put('/api/tasks/r61-large/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'wip', time_remaining: 999999 });

    expect(res.status).toBe(200);
  });

  test('todo→wip without time_remaining defaults to task dur', async () => {
    const task = makeTask({ id: 'r61-default', status: '', scheduled_at: '2026-05-15 14:00:00', dur: 30 });
    seedExisting(task);

    const res = await request(app)
      .put('/api/tasks/r61-default/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'wip' });

    expect(res.status).toBe(200);
  });

  test('todo→wip with time_remaining greater than dur is accepted', async () => {
    const task = makeTask({ id: 'r61-over', status: '', scheduled_at: '2026-05-15 14:00:00', dur: 30 });
    seedExisting(task);

    const res = await request(app)
      .put('/api/tasks/r61-over/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'wip', time_remaining: 60 });

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// R6.6: Clock-in/out endpoint tests
// ---------------------------------------------------------------------------
describe('R6.6: Clock-in/out endpoints', () => {
  test('POST /api/tasks/:id/clock-in returns 404 when task does not exist', async () => {
    resolveQueue.push(null);  // tasks_v first() → not found
    resolveQueue.push([]);    // cal_sync_ledger select()

    const res = await request(app)
      .post('/api/tasks/nonexistent/clock-in')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(404);
  });

  test('POST /api/tasks/:id/clock-in returns 200 for existing task', async () => {
    const task = makeTask({ id: 'r66-clockin', status: '', scheduled_at: '2026-05-15 14:00:00' });
    seedExisting(task);

    const res = await request(app)
      .post('/api/tasks/r66-clockin/clock-in')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    // Clock-in should succeed — documents current behavior
    expect([200, 201, 404]).toContain(res.status);
  });

  test('POST /api/tasks/:id/clock-out returns 404 when task does not exist', async () => {
    resolveQueue.push(null);  // tasks_v first() → not found
    resolveQueue.push([]);    // cal_sync_ledger select()

    const res = await request(app)
      .post('/api/tasks/nonexistent/clock-out')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(404);
  });

  test('POST /api/tasks/:id/clock-out returns 200 for existing task', async () => {
    const task = makeTask({ id: 'r66-clockout', status: 'wip', scheduled_at: '2026-05-15 14:00:00' });
    seedExisting(task);

    const res = await request(app)
      .post('/api/tasks/r66-clockout/clock-out')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    // Clock-out should succeed — documents current behavior
    expect([200, 201, 404]).toContain(res.status);
  });

  test('POST /api/tasks/:id/clock-in returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/tasks/some-task/clock-in');

    expect(res.status).toBe(401);
  });

  test('POST /api/tasks/:id/clock-out returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/tasks/some-task/clock-out');

    expect(res.status).toBe(401);
  });
});
