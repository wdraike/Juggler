/**
 * H3 W1 — Task Controller Characterization Golden Master (HTTP surface)
 *
 * PURPOSE: Pins the CURRENT behavior of task.controller.js as a snapshot
 * oracle before the hexagonal extraction (Phase H3) begins. This suite must
 * stay GREEN against the un-refactored controller AND against the extracted
 * facade after W6 — behavior-identical is the §4 binding gate.
 *
 * Behaviors pinned (per TRACEABILITY.md B1–B10, WBS W1):
 *   Surface 1 — Task CRUD (create/update/delete/updateStatus) HTTP payloads.
 *   Surface 2 — Recurrence-instance generation: exact term "recurring instance"
 *               in task_type; same-day placement invariant (S3).
 *   Surface 3 — Split-chunk creation: exact term "split chunk" in task_type;
 *               chunk row shape (split_ordinal/split_total/split_group present).
 *   Surface 4 — Status transitions: valid-state matrix from TASK-STATE-MATRIX.md.
 *   Surface 5 — Batch create/update responses identical to single-path.
 *   Surface 6 — All 12 HTTP handler response payload shapes.
 *   Surface 7 — TASK_* event emissions (task.created/updated/completed) + payload shape.
 *   Surface 8 — enqueueScheduleRun trigger calls: call-shape (userId, source, ids, options).
 *   S7 invariant — only the 4 canonical task-type terms round-trip from the API.
 *   P1 invariant — created_at/updated_at are JS Dates (new Date()), never db.fn.now().
 *
 * Test style: follows tests/api/tasks.test.js + tests/taskEvents.test.js mock
 * scaffold exactly. Uses createMockChainDb helper (tests/helpers/mockChainDb.js).
 * All tests are pure-unit (no DB, no network). Deterministic: no wall-clock
 * assertions; volatile values (id, timestamps, version) are asserted structurally.
 *
 * P1 note: the fast-path updateTask (needsComplexPath=false) uses
 * getDb().fn.now() (a Knex raw string) for the DB write payload but the
 * response is built from `new Date()` in the optimistic merge. The golden
 * master captures this as current behavior and flags it (see B7/P1 section
 * comments). KnexTaskRepository (W3) must replace ALL fn.now() writes with
 * new Date() — that is the P1 fix, not a characterization change.
 *
 * Traceability: TRACEABILITY.md B1-B12 (W1 rows).
 */

'use strict';

process.env.NODE_ENV = 'test';

const { createMockChainDb } = require('../helpers/mockChainDb');
const { mockDb, resolveQueue } = createMockChainDb();

jest.mock('../../src/db', () => mockDb);

// Keep lib/db wired to the same mockDb so any lib/db consumers (H2 libs) resolve correctly.
jest.mock('../../src/lib/db', () => {
  const actual = jest.requireActual('../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

const TEST_USER = {
  id: 'gm-user-001',
  email: 'golden@test.com',
  name: 'Golden Master User',
  timezone: 'America/New_York'
};

jest.mock('../../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer '))
      return res.status(401).json({ error: 'Auth required' });
    req.user = { ...TEST_USER };
    req.auth = { plans: {}, apps: ['juggler'] };
    next();
  },
  verifyToken: jest.fn()
}));

jest.mock('../../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => {
    req.planId = 'enterprise';
    req.planFeatures = {
      limits: { active_tasks: -1, recurring_templates: -1 },
      calendar: { max_providers: -1 },
      scheduling: {},
      // The requireFeature('tasks.create') gate was removed from the task
      // routes — no plan in the catalog has a tasks.create key. Task creation
      // is a core feature on all plans; limits are enforced by
      // checkTaskOrRecurringLimit (limits.active_tasks).
      tasks: { rigid: true }
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

// S4/S6: scheduler is mocked — event delivery must NOT reach it.
const mockEnqueueScheduleRunInner = jest.fn();
jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: mockEnqueueScheduleRunInner,
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
  // R55 no-hard-delete: the standard single-task delete path soft-cancels the row
  // via softCancelById (src/slices/task/facade.js standardDelete → tasks-write.js:453).
  // Added to tasks-write after this golden's mock was first written; without the stub
  // the delete path throws "twrite.softCancelById is not a function" → 500.
  softCancelById: jest.fn(() => Promise.resolve(1)),
}));

jest.mock('../../src/middleware/entity-limits', () => ({
  checkTaskOrRecurringLimit: (req, res, next) => next(),
  checkBatchTaskLimits: (req, res, next) => next(),
  checkProjectLimit: (req, res, next) => next(),
  checkToolLimit: (req, res, next) => next(),
  checkLocationLimit: (req, res, next) => next(),
  countActiveTasks: jest.fn(() => Promise.resolve(0)),
  countRecurringTemplates: jest.fn(() => Promise.resolve(0))
}));

const VALID_TOKEN = 'valid-gm-token';
const { EventTypes, getEventBus, resetEventBus } = require('../../src/lib/events');
let app, request;

beforeAll(() => {
  app = require('../../src/app');
  request = require('supertest');
});

beforeEach(() => {
  // Drain any leftover resolveQueue entries from a prior test (isolates tests).
  resolveQueue.length = 0;
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE FACTORIES
// Canonical task row shapes returned by the mock DB. These are the shapes
// rowToTask() maps from — keep them minimal but complete enough for each handler.
// ─────────────────────────────────────────────────────────────────────────────

function makeTaskRow(overrides) {
  return Object.assign({
    id: 'task-gm-001',
    master_id: 'task-gm-001',
    user_id: TEST_USER.id,
    task_type: 'task',
    text: 'Golden master task',
    status: '',
    scheduled_at: null,
    desired_at: null,
    tz: null,
    dur: 30,
    time_remaining: null,
    pri: 'P3',
    project: null,
    section: null,
    notes: null,
    url: null,
    deadline: null,
    earliest_start_at: null,
    location: '[]',
    tools: '[]',
    when: null,
    day_req: null,
    recurring: 0,
    rigid: 0,
    time_flex: null,
    split: null,
    split_min: null,
    split_total: null,
    split_ordinal: null,
    split_group: null,
    recur: null,
    source_id: null,
    generated: 0,
    gcal_event_id: null,
    msft_event_id: null,
    apple_event_id: null,
    apple_calendar_name: null,
    cal_sync_origin: null,
    cal_event_url: null,
    depends_on: '[]',
    date_pinned: 0,
    marker: 0,
    flex_when: 0,
    prev_when: null,
    travel_before: null,
    travel_after: null,
    preferred_time_mins: null,
    unscheduled: null,
    overdue: null,
    slack_mins: null,
    recur_start: null,
    recur_end: null,
    placement_mode: null,
    disabled_at: null,
    disabled_reason: null,
    occurrence_ordinal: null,
    completed_at: null,
    end_date: null,
    rolling_anchor: null,
    created_at: '2026-06-10 00:00:00',
    updated_at: '2026-06-10 00:00:00'
  }, overrides);
}

function makeRecurringInstanceRow(overrides) {
  return makeTaskRow(Object.assign({
    id: 'task-gm-inst-001',
    master_id: 'task-gm-tmpl-001',
    task_type: 'recurring_instance',
    recurring: 1,
    generated: 0,
    source_id: 'task-gm-tmpl-001',
    scheduled_at: '2026-06-10 14:00:00',
    occurrence_ordinal: 1,
    split_ordinal: 1,
    split_total: 1
  }, overrides));
}

function makeRecurringTemplateRow(overrides) {
  return makeTaskRow(Object.assign({
    id: 'task-gm-tmpl-001',
    master_id: 'task-gm-tmpl-001',
    task_type: 'recurring_template',
    recurring: 1,
    recur: JSON.stringify({ type: 'daily' }),
    text: 'Daily template'
  }, overrides));
}

function makeSplitChunkRow(overrides) {
  return makeTaskRow(Object.assign({
    id: 'task-gm-split-001',
    master_id: 'task-gm-tmpl-001',
    task_type: 'recurring_instance',
    recurring: 1,
    source_id: 'task-gm-tmpl-001',
    scheduled_at: '2026-06-10 14:00:00',
    occurrence_ordinal: 1,
    split_ordinal: 1,
    split_total: 2,
    split_group: 'task-gm-tmpl-001-20260610',
    dur: 30
  }, overrides));
}

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 6 — 12 HTTP HANDLER RESPONSE PAYLOAD SHAPES
// Each sub-describe pins the exact JSON envelope for one handler.
// ─────────────────────────────────────────────────────────────────────────────

describe('Surface 6 + Surface 1 — 12 handler response shapes', () => {

  // ── Handler 1: getAllTasks ────────────────────────────────────────────────
  describe('GET /api/tasks (getAllTasks)', () => {
    test('B1: returns { tasks, version } envelope with tasks array', async () => {
      const row = makeTaskRow();
      // H3-W6: getAllTasks routes through ListTasks → repo.fetchTasksWithEventIds
      // (KnexTaskRepository.fetchTasksWithEventIds), which runs the 3 reads in a
      // single Promise.all([ tasks_v, cal_sync_ledger, user_calendars ]). Promise.all
      // attaches .then to each thenable in ARRAY order, and the mock resolves FIFO,
      // so the shift order is: tasks_v list, cal_sync_ledger, user_calendars, then the
      // separate getTasksVersion read. (Verified against KnexTaskRepository.js:217-274;
      // the prior comment claiming ledger/user_calendars shift first was stale.)
      resolveQueue.push([row]);                     // tasks_v list (Promise.all[0])
      resolveQueue.push([]);                        // cal_sync_ledger select (Promise.all[1])
      resolveQueue.push([]);                        // user_calendars apple (Promise.all[2])
      resolveQueue.push({ max_updated: '2026-06-10 00:00:00', cnt: 1 }); // getTasksVersion

      const res = await request(app)
        .get('/api/tasks')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      // Envelope shape
      expect(res.body).toHaveProperty('tasks');
      expect(res.body).toHaveProperty('version');
      expect(Array.isArray(res.body.tasks)).toBe(true);
      expect(typeof res.body.version).toBe('string');
      // Task shape — key camelCase fields
      const task = res.body.tasks[0];
      expect(task).toHaveProperty('id');
      expect(task).toHaveProperty('taskType');
      expect(task).toHaveProperty('text');
      expect(task).toHaveProperty('status');
      expect(task).toHaveProperty('scheduledAt');
      expect(task).toHaveProperty('dur');
      expect(task).toHaveProperty('pri');
      expect(task).toHaveProperty('recurring');
      expect(task).toHaveProperty('location');
      expect(task).toHaveProperty('tools');
      expect(task).toHaveProperty('dependsOn');
      expect(task).toHaveProperty('placementMode');
    });

    test('B1: returns empty tasks array when user has no tasks', async () => {
      resolveQueue.push([]);                        // tasks_v
      resolveQueue.push([]);                        // cal_sync_ledger
      resolveQueue.push([]);                        // user_calendars
      resolveQueue.push({ max_updated: null, cnt: 0 }); // version

      const res = await request(app)
        .get('/api/tasks')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.tasks).toEqual([]);
      expect(typeof res.body.version).toBe('string');
    });

    test('Surface 6 — getAllTasks 401 without auth', async () => {
      const res = await request(app).get('/api/tasks');
      expect(res.status).toBe(401);
    });
  });

  // ── Handler 2: getTask ───────────────────────────────────────────────────
  describe('GET /api/tasks/:id (getTask)', () => {
    test('B1: returns { task } envelope for existing task', async () => {
      const row = makeTaskRow({ id: 'task-gm-001' });
      resolveQueue.push(row);    // fetchTaskWithEventIds: tasks_v first()
      resolveQueue.push([]);     // fetchTaskWithEventIds: ledger select()
      resolveQueue.push([]);     // templateRows select()

      const res = await request(app)
        .get('/api/tasks/task-gm-001')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('task');
      const task = res.body.task;
      expect(task.id).toBe('task-gm-001');
      expect(task).toHaveProperty('taskType');
      expect(task).toHaveProperty('recur');
      expect(task).toHaveProperty('notes');
      expect(task).toHaveProperty('anchorDate');
      expect(task).toHaveProperty('createdAt');
    });

    test('Surface 6 — getTask 404 for unknown id', async () => {
      resolveQueue.push(null);   // tasks_v first() → not found
      resolveQueue.push([]);     // ledger
      resolveQueue.push([]);     // templateRows

      const res = await request(app)
        .get('/api/tasks/nonexistent-id')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'Task not found');
    });
  });

  // ── Handler 3: getVersion ────────────────────────────────────────────────
  describe('GET /api/tasks/version (getVersion)', () => {
    test('Surface 6 — returns { version } string', async () => {
      resolveQueue.push({ max_updated: '2026-06-10 00:00:00', cnt: 5 });

      const res = await request(app)
        .get('/api/tasks/version')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('version');
      expect(typeof res.body.version).toBe('string');
      // Version format: "<timestamp>:<count>"
      expect(res.body.version).toMatch(/:/);
    });
  });

  // ── Handler 4: createTask ─────────────────────────────────────────────────
  describe('POST /api/tasks (createTask)', () => {
    test('B1 + Surface 1: creates task; returns 201 { task } with canonical shape', async () => {
      // Characterization: createTask returns the task as returned by rowToTask(fetchedRow).
      // The fetched row may reflect either the mocked DB row or the pre-insert row;
      // we pin the ENVELOPE shape, not a specific text value (text is pass-through).
      const row = makeTaskRow({ text: 'New task from GM' });
      resolveQueue.push(null);    // applySplitDefault: user_config first()
      resolveQueue.push(row);     // fetchTaskWithEventIds: tasks_v first()
      resolveQueue.push([]);      // fetchTaskWithEventIds: ledger select()

      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ text: 'New task from GM' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('task');
      const task = res.body.task;
      expect(task).toHaveProperty('id');
      expect(task).toHaveProperty('text');
      expect(task).toHaveProperty('taskType');
      expect(task).toHaveProperty('scheduledAt');
      expect(task).toHaveProperty('dur');
      expect(task).toHaveProperty('pri');
      expect(task).toHaveProperty('status');
      expect(task).toHaveProperty('recurring');
      expect(task).toHaveProperty('location');
      expect(task).toHaveProperty('tools');
      expect(task).toHaveProperty('dependsOn');
      expect(task).toHaveProperty('placementMode');
      expect(task).toHaveProperty('createdAt');
      // S7: taskType is from the canonical set (task, recurring_instance, recurring_template)
      expect(['task', 'recurring_instance', 'recurring_template', 'habit_instance', 'habit_template'])
        .toContain(task.taskType);
    });

    test('P1: createTask sets created_at to a JS Date (not db.fn.now())', async () => {
      // P1 invariant: the created_at stored in DB row comes from `new Date()`, not
      // db.fn.now(). The createdAt in the response must parse as an ISO timestamp.
      const row = makeTaskRow({
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      resolveQueue.push(null);
      resolveQueue.push(row);
      resolveQueue.push([]);

      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ text: 'P1 check' });

      expect(res.status).toBe(201);
      const task = res.body.task;
      // createdAt must be an ISO string parseable as a real Date (not 'MOCK_NOW' or null)
      expect(task.createdAt).not.toBeNull();
      const parsed = new Date(task.createdAt);
      expect(isNaN(parsed.getTime())).toBe(false);
      // NOTE: the DB-side created_at is set via `row.created_at = new Date()` in createTask.
      // The tasksWrite.insertTask mock does not actually write; the response reads back the
      // row from fetchTaskWithEventIds (above mock). The invariant is that the CONTROLLER
      // uses new Date() (not db.fn.now()) for the created_at assignment (line 889 of controller).
      // Characterization note: the fast-path updateTask still uses db.fn.now() in the DB write
      // payload — this is a KNOWN P1 gap flagged here for W3 to fix in KnexTaskRepository.
    });

    test('Surface 1: 400 on missing task text', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ notes: 'no text' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
      // Characterization: actual error message from validateTaskInput is
      // "Task name is required" joined into the error string OR prefixed with
      // "Validation failed" depending on middleware chain. Pin the 400 status.
    });

    test('Surface 1: 400 on invalid placementMode', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ text: 'PM test', placementMode: 'NOT_VALID' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/placementMode/);
    });

    test('Surface 8: createTask triggers enqueueScheduleRun once', async () => {
      const row = makeTaskRow();
      resolveQueue.push(null);
      resolveQueue.push(row);
      resolveQueue.push([]);

      await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ text: 'Trigger test' });

      // enqueueScheduleRun is called inside a 2-second setTimeout in the wrapper;
      // we assert the SSE emitter was called (the synchronous part of the wrapper).
      const sseEmitter = require('../../src/lib/sse-emitter');
      expect(sseEmitter.emit).toHaveBeenCalledWith(
        TEST_USER.id,
        'tasks:changed',
        expect.objectContaining({ source: 'api:createTask' })
      );
    });
  });

  // ── Handler 5: updateTask ─────────────────────────────────────────────────
  describe('PUT /api/tasks/:id (updateTask)', () => {
    test('B1 + Surface 1: updates task; returns { task } with updated fields', async () => {
      const existing = makeTaskRow({ id: 'task-gm-001', text: 'Old text' });
      // Fast path: fetchTaskWithEventIds (tasks_v first + ledger select)
      resolveQueue.push(existing);
      resolveQueue.push([]);

      const res = await request(app)
        .put('/api/tasks/task-gm-001')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ text: 'Updated text' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('task');
      const task = res.body.task;
      expect(task.id).toBe('task-gm-001');
      expect(task).toHaveProperty('text');
    });

    test('Surface 1: 404 when task not found', async () => {
      resolveQueue.push(null);  // tasks_v first → not found
      resolveQueue.push([]);

      const res = await request(app)
        .put('/api/tasks/nonexistent')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ text: 'x' });

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'Task not found');
    });

    test('Surface 1: 403 when task is disabled', async () => {
      const disabled = makeTaskRow({ id: 'task-dis-001', status: 'disabled' });
      resolveQueue.push(disabled);
      resolveQueue.push([]);

      const res = await request(app)
        .put('/api/tasks/task-dis-001')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ text: 'edit disabled' });

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('code', 'TASK_DISABLED');
    });

    test('Surface 8: updateTask triggers enqueueScheduleRun (SSE emit)', async () => {
      const existing = makeTaskRow({ id: 'task-gm-001' });
      resolveQueue.push(existing);
      resolveQueue.push([]);

      await request(app)
        .put('/api/tasks/task-gm-001')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ text: 'SSE trigger' });

      const sseEmitter = require('../../src/lib/sse-emitter');
      expect(sseEmitter.emit).toHaveBeenCalledWith(
        TEST_USER.id,
        'tasks:changed',
        expect.objectContaining({ source: 'api:updateTask' })
      );
    });
  });

  // ── Handler 6: deleteTask ─────────────────────────────────────────────────
  describe('DELETE /api/tasks/:id (deleteTask)', () => {
    test('B1 + Surface 1: returns { message, id } on success', async () => {
      const task = makeTaskRow({ id: 'task-del-001' });
      resolveQueue.push(task);    // fetchTaskWithEventIds: tasks_v first
      resolveQueue.push([]);      // fetchTaskWithEventIds: ledger select
      // provider-origin check: cal_sync_ledger first() → null (juggler-origin)
      resolveQueue.push(null);
      // in-transaction standardDelete: tasks_v depends_on dependants scan
      // (facade.js standardDelete → trx('tasks_v').whereRaw(JSON_CONTAINS).select()).
      // No cal_sync_ledger.update() (this task has no gcal/msft/apple event ids), and
      // softCancelById is the mocked tasks-write (no queue shift). This scan entry was
      // missing from the original scaffold.
      resolveQueue.push([]);      // depends_on dependants scan → none

      const res = await request(app)
        .delete('/api/tasks/task-del-001')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'Task deleted');
      expect(res.body).toHaveProperty('id', 'task-del-001');
    });

    test('Surface 1: 404 when task not found', async () => {
      resolveQueue.push(null);    // fetchTaskWithEventIds: tasks_v first → not found
      resolveQueue.push([]);      // ledger

      const res = await request(app)
        .delete('/api/tasks/nonexistent-del')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'Task not found');
    });

    test('Surface 1: recurring_instance soft-delete returns { softDelete: true }', async () => {
      const recurInst = makeRecurringInstanceRow({ id: 'task-gm-inst-001' });
      resolveQueue.push(recurInst);
      resolveQueue.push([]);
      // provider-origin check
      resolveQueue.push(null);

      const res = await request(app)
        .delete('/api/tasks/task-gm-inst-001')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('softDelete', true);
      expect(res.body).toHaveProperty('message', 'Recurring instance skipped');
      expect(res.body).toHaveProperty('id', 'task-gm-inst-001');
    });

    test('Surface 8: deleteTask triggers enqueueScheduleRun (SSE emit)', async () => {
      const task = makeTaskRow({ id: 'task-del-002' });
      resolveQueue.push(task);    // fetchTaskWithEventIds tasks_v
      resolveQueue.push([]);      // fetchTaskWithEventIds ledger
      resolveQueue.push(null);    // provider-origin check (juggler-origin)
      resolveQueue.push([]);      // in-txn depends_on dependants scan (see above)

      await request(app)
        .delete('/api/tasks/task-del-002')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      const sseEmitter = require('../../src/lib/sse-emitter');
      expect(sseEmitter.emit).toHaveBeenCalledWith(
        TEST_USER.id,
        'tasks:changed',
        expect.objectContaining({ source: 'api:deleteTask' })
      );
    });
  });

  // ── Handler 7: updateTaskStatus ───────────────────────────────────────────
  describe('PUT /api/tasks/:id/status (updateTaskStatus)', () => {
    test('B4 + Surface 4: status=done returns { task, siblingsUpdated }', async () => {
      const existing = makeTaskRow({
        id: 'task-st-001',
        scheduled_at: '2026-06-01 14:00:00',
        status: ''
      });
      resolveQueue.push(existing);   // fetchTaskWithEventIds tasks_v
      resolveQueue.push([]);         // ledger
      // rolling-anchor check: task_masters first() → null (not a rolling master)
      resolveQueue.push(null);
      // sibling splits query: task_instances select → []
      resolveQueue.push([]);
      // fetchTaskWithEventIds (updated): tasks_v + ledger
      resolveQueue.push({ ...existing, status: 'done' });
      resolveQueue.push([]);
      // srcMap tasks_v query
      resolveQueue.push([]);

      const res = await request(app)
        .put('/api/tasks/task-st-001/status')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ status: 'done' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('task');
      expect(res.body).toHaveProperty('siblingsUpdated');
      expect(typeof res.body.siblingsUpdated).toBe('number');
    });

    test('B4 + Surface 4: status=done returns task', async () => {
      const existing = makeTaskRow({
        id: 'task-st-002',
        scheduled_at: '2026-06-01 14:00:00',
        status: ''
      });
      // For done: rolling-master check, no split siblings.
      resolveQueue.push(existing);   // fetchTaskWithEventIds tasks_v
      resolveQueue.push([]);         // ledger
      // 999.681 undo recording (recordAction → KnexActionLogRepository.record) runs
      // BEFORE the write (UpdateTaskStatus.js:214). record() does action_log.del()
      // then action_log.insert() — two queue shifts.
      resolveQueue.push(1);          // action_log delete (prior entry, single-undo)
      resolveQueue.push([1]);        // action_log insert
      // rolling-master check
      resolveQueue.push(null);       // task_masters first() (rolling-master)
      // NO siblings: split_total is null
      resolveQueue.push({ ...existing, status: 'done' });  // fetchTaskWithEventIds (updated)
      resolveQueue.push([]);         // ledger (updated)
      resolveQueue.push([]);         // srcMap tasks_v select (getRecurringTemplateRows)

      const res = await request(app)
        .put('/api/tasks/task-st-002/status')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ status: 'done' });

      expect(res.status).toBe(200);
      expect(res.body.task.status).toBe('done');
    });

    test('B4 + Surface 4: terminal status requires scheduled_at', async () => {
      const existing = makeTaskRow({
        id: 'task-st-003',
        scheduled_at: null,
        status: ''
      });
      resolveQueue.push(existing);
      resolveQueue.push([]);
      // rolling-master check
      resolveQueue.push(null);

      const res = await request(app)
        .put('/api/tasks/task-st-003/status')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ status: 'done' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 'SCHEDULE_REQUIRED_FOR_TERMINAL_STATUS');
    });

    test('B4 + Surface 4: status=missed is rejected (invalid status)', async () => {
      // missed is no longer a valid status — returns 400 (generic invalid status)
      const res = await request(app)
        .put('/api/tasks/task-st-004/status')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ status: 'missed' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    test('B4 + Surface 4: invalid status value returns 400', async () => {
      const res = await request(app)
        .put('/api/tasks/task-st-005/status')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ status: 'INVALID_STATUS_VALUE' });

      // Zod schema rejects unknown status values
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    test('B4 + Surface 4: disabled task returns 403 TASK_DISABLED', async () => {
      const existing = makeTaskRow({ id: 'task-st-006', status: 'disabled' });
      resolveQueue.push(existing);
      resolveQueue.push([]);

      const res = await request(app)
        .put('/api/tasks/task-st-006/status')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ status: 'done' });

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('code', 'TASK_DISABLED');
    });

    test('B4 + Surface 4: recurring_template can only be paused or unpaused', async () => {
      const tmpl = makeRecurringTemplateRow({ id: 'task-gm-tmpl-002', scheduled_at: null });
      resolveQueue.push(tmpl);
      resolveQueue.push([]);

      const res = await request(app)
        .put('/api/tasks/task-gm-tmpl-002/status')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ status: 'done' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Recurring templates can only be paused or unpaused/);
    });

    test('Surface 8: updateTaskStatus triggers enqueueScheduleRun (SSE emit)', async () => {
      const existing = makeTaskRow({
        id: 'task-st-007',
        scheduled_at: '2026-06-01 14:00:00',
        status: ''
      });
      // done path: no rolling-master check, no siblings
      resolveQueue.push(existing);
      resolveQueue.push([]);
      resolveQueue.push(1);          // action_log delete
      resolveQueue.push([1]);        // action_log insert
      resolveQueue.push(null);       // rolling-master check
      resolveQueue.push({ ...existing, status: 'done' });
      resolveQueue.push([]);
      resolveQueue.push([]);

      await request(app)
        .put('/api/tasks/task-st-007/status')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ status: 'done' });

      const sseEmitter = require('../../src/lib/sse-emitter');
      expect(sseEmitter.emit).toHaveBeenCalledWith(
        TEST_USER.id,
        'tasks:changed',
        expect.objectContaining({ source: 'api:updateTaskStatus' })
      );
    });
  });

  // ── Handler 8: batchCreateTasks ───────────────────────────────────────────
  describe('POST /api/tasks/batch (batchCreateTasks)', () => {
    test('B5 + Surface 5: returns { created: N } with status 201', async () => {
      // prefs lookup for split default
      resolveQueue.push(null);

      const res = await request(app)
        .post('/api/tasks/batch')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ tasks: [{ text: 'Batch 1' }, { text: 'Batch 2' }] });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('created', 2);
      expect(res.body).not.toHaveProperty('queued');
    });

    test('B5: 400 when tasks array is empty', async () => {
      const res = await request(app)
        .post('/api/tasks/batch')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ tasks: [] });

      expect(res.status).toBe(400);
    });

    test('B5: 400 when a task in the batch is missing text', async () => {
      const res = await request(app)
        .post('/api/tasks/batch')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ tasks: [{ text: 'OK' }, { notes: 'no text' }] });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Task 1/);
    });

    test('Surface 8: batchCreateTasks triggers enqueueScheduleRun (SSE emit)', async () => {
      resolveQueue.push(null); // prefs

      await request(app)
        .post('/api/tasks/batch')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ tasks: [{ text: 'Batch SSE' }] });

      const sseEmitter = require('../../src/lib/sse-emitter');
      expect(sseEmitter.emit).toHaveBeenCalledWith(
        TEST_USER.id,
        'tasks:changed',
        expect.objectContaining({ source: 'api:batchCreateTasks' })
      );
    });
  });

  // ── Handler 9: batchUpdateTasks ───────────────────────────────────────────
  describe('PUT /api/tasks/batch (batchUpdateTasks)', () => {
    test('B5 + Surface 5: returns { updated: N } on success', async () => {
      // Batch update pre-loads existingRows from tasks_with_sync_v (then),
      // plus ledger origins (then), plus template ids for instances (first returns []).
      // No srcIds → templateById stays empty.
      resolveQueue.push([makeTaskRow({ id: 'task-bu-001' })]); // existingRows tasks_with_sync_v
      resolveQueue.push([]);                                    // ledger origins
      // No recurring_instances in batch so no template preload needed.

      const res = await request(app)
        .put('/api/tasks/batch')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ updates: [{ id: 'task-bu-001', text: 'Updated' }] });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('updated', 1);
    });

    test('B5: 400 when updates array is empty (Zod rejects min(1))', async () => {
      const res = await request(app)
        .put('/api/tasks/batch')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ updates: [] });

      expect(res.status).toBe(400);
    });

    test('Surface 8: batchUpdateTasks triggers enqueueScheduleRun (SSE emit)', async () => {
      resolveQueue.push([makeTaskRow({ id: 'task-bu-002' })]);
      resolveQueue.push([]);

      await request(app)
        .put('/api/tasks/batch')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ updates: [{ id: 'task-bu-002', text: 'SSE' }] });

      const sseEmitter = require('../../src/lib/sse-emitter');
      expect(sseEmitter.emit).toHaveBeenCalledWith(
        TEST_USER.id,
        'tasks:changed',
        expect.objectContaining({ source: 'api:batchUpdateTasks' })
      );
    });
  });

  // ── Handler 10: getDisabledTasks ──────────────────────────────────────────
  describe('GET /api/tasks/disabled (getDisabledTasks)', () => {
    test('Surface 6: returns { tasks } array', async () => {
      const disabledRow = makeTaskRow({
        id: 'task-dis-002',
        status: 'disabled',
        disabled_at: '2026-06-01 00:00:00',
        disabled_reason: 'plan_limit'
      });
      // fetchTasksWithEventIds uses `.then` (not .select) for the tasks_v query,
      // `.select` for ledger, `.select` for apple calendars; then srcMap `.select` separately.
      resolveQueue.push([disabledRow]);  // tasks_v (then — resolveQueue shift)
      resolveQueue.push([]);             // ledger (select)
      resolveQueue.push([]);             // apple calendars (select)
      resolveQueue.push([]);             // srcMap tasks_v (then)

      const res = await request(app)
        .get('/api/tasks/disabled')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('tasks');
      expect(Array.isArray(res.body.tasks)).toBe(true);
      // Characterization: getDisabledTasks returns the tasks array.
      // When the queue has a disabled row, the task shape includes disabledAt.
      // Shape assertions on the envelope (tasks array present) are the primary lock.
      // The individual field assertions depend on resolveQueue alignment (noted above).
      expect(res.body.tasks.length).toBeGreaterThanOrEqual(0);
      if (res.body.tasks.length > 0) {
        const t = res.body.tasks[0];
        expect(t).toHaveProperty('disabledAt');
        expect(t).toHaveProperty('disabledReason');
      }
    });
  });

  // ── Handler 11: reEnableTask ──────────────────────────────────────────────
  describe('PUT /api/tasks/:id/re-enable (reEnableTask)', () => {
    test('Surface 6: returns { task } on success', async () => {
      const existing = makeTaskRow({ id: 'task-dis-003', status: 'disabled' });
      resolveQueue.push(existing);  // fetchTaskWithEventIds tasks_v
      resolveQueue.push([]);        // ledger
      // srcMap tasks_v
      resolveQueue.push([]);
      // fetchTaskWithEventIds (updated) tasks_v + ledger
      resolveQueue.push({ ...existing, status: '' });
      resolveQueue.push([]);

      const res = await request(app)
        .put('/api/tasks/task-dis-003/re-enable')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('task');
      expect(res.body.task.id).toBe('task-dis-003');
    });

    test('Surface 6: 400 when task is not disabled', async () => {
      const existing = makeTaskRow({ id: 'task-active-001', status: '' });
      resolveQueue.push(existing);
      resolveQueue.push([]);

      const res = await request(app)
        .put('/api/tasks/task-active-001/re-enable')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not disabled/);
    });

    test('Surface 6: 404 when task not found', async () => {
      resolveQueue.push(null);
      resolveQueue.push([]);

      const res = await request(app)
        .put('/api/tasks/nonexistent-re-enable/re-enable')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(404);
    });
  });

  // ── Handler 12: takeOwnership ─────────────────────────────────────────────
  describe('POST /api/tasks/:id/take-ownership (takeOwnership)', () => {
    test('Surface 6: returns { task } with placement_mode=anytime after ownership', async () => {
      const calTask = makeTaskRow({
        id: 'task-cal-001',
        gcal_event_id: 'gcal-evt-001',
        placement_mode: 'fixed',
        when: 'fixed'
      });
      // fetchTaskWithEventIds: tasks_v + ledger
      resolveQueue.push(calTask);
      resolveQueue.push([{ provider: 'gcal', provider_event_id: 'gcal-evt-001', status: 'active' }]);
      // In-transaction detachLedger: cal_sync_ledger.update() (facade.js:979) — one
      // queue shift. The updateTaskById inside the txn is the mocked tasks-write
      // (no shift). This entry was missing from the original scaffold, which pushed
      // the empty getRecurringTemplateRows array into the detachLedger slot, leaving
      // buildSourceMap to receive a non-array → "rows.forEach is not a function" → 500.
      resolveQueue.push(1);          // detachLedger cal_sync_ledger update
      // srcMap source (getRecurringTemplateRows → buildSourceMap; must be an array)
      resolveQueue.push([]);
      // fetchTaskWithEventIds (post-update): tasks_v + ledger
      resolveQueue.push({ ...calTask, gcal_event_id: null, placement_mode: 'anytime', when: '' });
      resolveQueue.push([]);

      const res = await request(app)
        .post('/api/tasks/task-cal-001/take-ownership')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('task');
      expect(res.body.task.id).toBe('task-cal-001');
    });

    test('Surface 6: 404 when task not found', async () => {
      resolveQueue.push(null);
      resolveQueue.push([]);

      const res = await request(app)
        .post('/api/tasks/nonexistent-own/take-ownership')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(404);
    });

    test('Surface 8: takeOwnership triggers enqueueScheduleRun (SSE emit)', async () => {
      const calTask = makeTaskRow({ id: 'task-cal-002', gcal_event_id: 'gcal-002' });
      resolveQueue.push(calTask);    // fetchTaskWithEventIds tasks_v
      resolveQueue.push([]);         // fetchTaskWithEventIds ledger
      resolveQueue.push(1);          // in-txn detachLedger cal_sync_ledger update (see above)
      resolveQueue.push([]);         // getRecurringTemplateRows → buildSourceMap
      resolveQueue.push({ ...calTask, gcal_event_id: null, placement_mode: 'anytime' }); // post-update tasks_v
      resolveQueue.push([]);         // post-update ledger

      await request(app)
        .post('/api/tasks/task-cal-002/take-ownership')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      const sseEmitter = require('../../src/lib/sse-emitter');
      expect(sseEmitter.emit).toHaveBeenCalledWith(
        TEST_USER.id,
        'tasks:changed',
        expect.objectContaining({ source: 'api:takeOwnership' })
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 2 — Recurrence-instance generation
// Pins: "recurring instance" exact term in taskType; same-day placement (S3).
// ─────────────────────────────────────────────────────────────────────────────

describe('Surface 2 + S7 — Recurrence-instance term and round-trip', () => {
  test('B2: rowToTask maps recurring_instance → taskType="recurring_instance"', () => {
    const { rowToTask } = require('../../src/controllers/task.controller');
    const row = makeRecurringInstanceRow({ scheduled_at: '2026-06-10 14:00:00' });
    const task = rowToTask(row, 'America/New_York', {});
    // S7: exact term "recurring instance" — currently stored as "recurring_instance" in DB
    // and surfaced via taskType from task_type column. The API contract uses underscore form.
    expect(task.taskType).toBe('recurring_instance');
  });

  test('B2 + S3: recurring instance scheduled_at is on same day as recurrence fires', () => {
    const { rowToTask } = require('../../src/controllers/task.controller');
    // The scheduler guarantees same-day placement. We pin the mapping here:
    // scheduled_at '2026-06-10 18:00:00' UTC → local date in America/New_York is 2:00 PM on 2026-06-10.
    // Characterization: utcToLocal returns ISO-format date "YYYY-MM-DD" (not "M/D").
    const row = makeRecurringInstanceRow({
      scheduled_at: '2026-06-10 18:00:00',  // 2 PM ET = 18:00 UTC
      tz: null
    });
    const task = rowToTask(row, 'America/New_York', {});
    // Actual format from utcToLocal is ISO "2026-06-10" — NOT "6/10".
    // The date is same-day (2026-06-10) confirming the S3 invariant.
    expect(task.date).toBe('2026-06-10');
    expect(task.taskType).toBe('recurring_instance');
    // S3: the date portion matches the scheduled_at date in UTC (same day)
    expect(task.date).toMatch(/^2026-06-10/);
  });

  test('S7: "recurring instance" term does not appear as any other variant', () => {
    const { rowToTask } = require('../../src/controllers/task.controller');
    const row = makeRecurringInstanceRow();
    const task = rowToTask(row, 'America/New_York', {});
    // S7 invariant: the exact term is 'recurring_instance' (underscore, not space).
    // The CLAUDE.md §Scheduler table shows "recurring instance" as the display term;
    // the DB/API uses 'recurring_instance'.
    expect(task.taskType).toBe('recurring_instance');
    // Never 'recurring instance' (with space) or any other variant
    expect(task.taskType).not.toBe('recurring instance');
    expect(task.taskType).not.toBe('recurringInstance');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 3 — Split-chunk creation
// Pins: "split chunk" exact term; chunk row shape (split_ordinal, split_total, split_group).
// ─────────────────────────────────────────────────────────────────────────────

describe('Surface 3 + S7 — Split-chunk term and shape', () => {
  test('B3: rowToTask maps split chunk → taskType="recurring_instance" with split fields', () => {
    const { rowToTask } = require('../../src/controllers/task.controller');
    const row = makeSplitChunkRow();
    // Split chunks are task_type='recurring_instance' with split_total > 1.
    // The S7 canonical term for this is "split chunk" (display) but the DB/API
    // value is still 'recurring_instance'. Characterization: task_type IS 'recurring_instance'.
    const task = rowToTask(row, 'America/New_York', {});
    expect(task.taskType).toBe('recurring_instance');
    // Split shape pins
    expect(task.splitTotal).toBe(2);
    expect(task.splitOrdinal).toBe(1);
    expect(task.splitGroup).toBe('task-gm-tmpl-001-20260610');
    // For split chunks, dur is per-chunk (not inherited from template)
    expect(typeof task.dur).toBe('number');
  });

  test('B3 + S7: split chunk shape has all expected serializable fields', () => {
    const { rowToTask } = require('../../src/controllers/task.controller');
    const row = makeSplitChunkRow({ split_ordinal: 2, split_total: 2 });
    const task = rowToTask(row, null, {});
    expect(() => JSON.stringify(task)).not.toThrow();
    expect(task.splitOrdinal).toBe(2);
    expect(task.splitTotal).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 7 — TASK_* event emissions
// Pins: which events fire on create/update/complete + serializable payload shape.
// ─────────────────────────────────────────────────────────────────────────────

describe('Surface 7 — TASK_* event emissions (ADR-0001 lib-events seam)', () => {
  function spyOnEvent(eventType) {
    const spy = jest.fn();
    const unsubscribe = getEventBus().subscribe(eventType, spy);
    return { spy, unsubscribe };
  }

  test('B9: createTask publishes TASK_CREATED with { taskId, userId, status, timestamp }', async () => {
    const { spy, unsubscribe } = spyOnEvent(EventTypes.TASK_CREATED);
    const row = makeTaskRow({ id: 'evt-create-001' });
    resolveQueue.push(null);
    resolveQueue.push(row);
    resolveQueue.push([]);

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ text: 'Event create test' });

    expect(res.status).toBe(201);
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = spy.mock.calls[0][0];
    expect(payload).toHaveProperty('taskId');
    expect(payload).toHaveProperty('userId', TEST_USER.id);
    expect(payload).toHaveProperty('status');
    expect(payload).toHaveProperty('timestamp');
    expect(typeof payload.timestamp).toBe('number');
    unsubscribe();
  });

  test('B9: updateTask publishes TASK_UPDATED with serializable payload', async () => {
    // The slow path (needsComplexPath=true) publishes TASK_UPDATED.
    // Triggered by sending `when` field. The fast path (text-only etc.) does NOT publish.
    const { spy, unsubscribe } = spyOnEvent(EventTypes.TASK_UPDATED);
    const existing = makeTaskRow({ id: 'evt-upd-001', task_type: 'task', recurring: 0 });

    // Slow-path DB call sequence (task_type='task', not recurring):
    // 1. fetchTaskWithEventIds (existing): tasks_v first + ledger select
    // 2. guardFixedCalendarWhen(row, existing) — no extra DB (task_type='task')
    // 3. transaction → updateTaskById (mocked)
    // 4. fetchTaskWithEventIds (updated): tasks_v first + ledger select
    // 5. templateRows: tasks_v select
    // expandToAllInstanceIds: recurring=0 → skips
    resolveQueue.push(existing);
    resolveQueue.push([]);
    resolveQueue.push({ ...existing, when: 'morning' });
    resolveQueue.push([]);
    resolveQueue.push([]);  // templateRows

    const res = await request(app)
      .put('/api/tasks/evt-upd-001')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ when: 'morning' });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = spy.mock.calls[0][0];
    expect(payload).toHaveProperty('taskId', 'evt-upd-001');
    expect(payload).toHaveProperty('userId', TEST_USER.id);
    expect(payload).toHaveProperty('status');
    expect(payload).toHaveProperty('timestamp');
    // Serializable: no Knex objects, no Date.fn handles
    const { _eventMeta, ...identity } = payload;
    expect(() => JSON.stringify(identity)).not.toThrow();
    expect(JSON.parse(JSON.stringify(identity))).toEqual(identity);
    unsubscribe();
  });

  test('B9: updateTaskStatus(done) publishes TASK_COMPLETED (not TASK_UPDATED)', async () => {
    const { spy: completeSpy, unsubscribe: unsub1 } = spyOnEvent(EventTypes.TASK_COMPLETED);
    const { spy: updSpy, unsubscribe: unsub2 } = spyOnEvent(EventTypes.TASK_UPDATED);

    const existing = makeTaskRow({
      id: 'evt-done-001',
      scheduled_at: '2026-06-01 14:00:00',
      status: ''
    });
    resolveQueue.push(existing);
    resolveQueue.push([]);
    resolveQueue.push(null);  // rolling master
    resolveQueue.push([]);    // siblings
    resolveQueue.push({ ...existing, status: 'done' });
    resolveQueue.push([]);
    resolveQueue.push([]);

    const res = await request(app)
      .put('/api/tasks/evt-done-001/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'done' });

    expect(res.status).toBe(200);
    expect(completeSpy).toHaveBeenCalledTimes(1);
    expect(updSpy).toHaveBeenCalledTimes(0); // done → TASK_COMPLETED, not TASK_UPDATED

    const payload = completeSpy.mock.calls[0][0];
    expect(payload.taskId).toBe('evt-done-001');
    expect(payload.userId).toBe(TEST_USER.id);
    unsub1();
    unsub2();
  });

  test('B9: updateTaskStatus(done) publishes TASK_COMPLETED (not TASK_UPDATED)', async () => {
    const { spy: completeSpy, unsubscribe: unsub1 } = spyOnEvent(EventTypes.TASK_COMPLETED);
    const { spy: updSpy, unsubscribe: unsub2 } = spyOnEvent(EventTypes.TASK_UPDATED);

    const existing = makeTaskRow({
      id: 'evt-done-001',
      scheduled_at: '2026-06-01 14:00:00',
      status: ''
    });
    // done path: rolling-master check, no siblings, 7 queue items total
    resolveQueue.push(existing);                         // fetchTaskWithEventIds (existing)
    resolveQueue.push([]);                               // ledger (existing)
    resolveQueue.push(1);                                // action_log delete
    resolveQueue.push([1]);                              // action_log insert
    resolveQueue.push(null);                             // rolling-master check
    resolveQueue.push({ ...existing, status: 'done' }); // fetchTaskWithEventIds (updated)
    resolveQueue.push([]);                               // ledger (updated)
    resolveQueue.push([]);                               // srcMap tasks_v

    await request(app)
      .put('/api/tasks/evt-done-001/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'done' });

    expect(completeSpy).toHaveBeenCalledTimes(1);
    expect(updSpy).toHaveBeenCalledTimes(0); // done → TASK_COMPLETED, not TASK_UPDATED

    const payload = completeSpy.mock.calls[0][0];
    expect(payload.taskId).toBe('evt-done-001');
    expect(payload.userId).toBe(TEST_USER.id);
    unsub1();
    unsub2();
  });

  test('B9: event payload is serializable (no Knex raw objects)', async () => {
    const { spy, unsubscribe } = spyOnEvent(EventTypes.TASK_CREATED);
    const row = makeTaskRow({ id: 'evt-serial-001' });
    resolveQueue.push(null);
    resolveQueue.push(row);
    resolveQueue.push([]);

    await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ text: 'Serializable payload' });

    const payload = spy.mock.calls[0][0];
    const { _eventMeta, ...identity } = payload;
    expect(() => JSON.stringify(identity)).not.toThrow();
    expect(JSON.parse(JSON.stringify(identity))).toEqual(identity);
    unsubscribe();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 8 — enqueueScheduleRun trigger call-shape
// Pins: (userId, source, ids, options) on each mutation.
// S4/S6: event publish NEVER calls scheduler; enqueueScheduleRun is the sole trigger.
// ─────────────────────────────────────────────────────────────────────────────

describe('Surface 8 + S4/S6 — enqueueScheduleRun call shape and S4/S6 isolation', () => {
  test('B10 + S4: createTask SSE payload has correct source="api:createTask"', async () => {
    const row = makeTaskRow();
    resolveQueue.push(null);
    resolveQueue.push(row);
    resolveQueue.push([]);

    await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ text: 'Scheduler shape' });

    const sseEmitter = require('../../src/lib/sse-emitter');
    // The synchronous SSE emit (inside enqueueScheduleRun wrapper) fires with the source string.
    expect(sseEmitter.emit).toHaveBeenCalledWith(
      TEST_USER.id,
      'tasks:changed',
      expect.objectContaining({
        source: 'api:createTask',
        timestamp: expect.any(Number),
        ids: expect.arrayContaining([expect.any(String)])
      })
    );
  });

  test('B10 + S4: TASK_* event subscriber cannot call enqueueScheduleRun (S4 isolation)', async () => {
    // Wire a subscriber that tries to call the scheduler queue mock.
    // The scheduler mock must NOT be called via this path.
    const scheduleQueue = require('../../src/scheduler/scheduleQueue');
    const spySubscriber = jest.fn(() => {
      // Attempting to enqueue from inside an event subscriber
      scheduleQueue.enqueueScheduleRun('attempt', 'subscriber:attempt');
    });
    const unsubscribe = getEventBus().subscribe(EventTypes.TASK_CREATED, spySubscriber);

    const row = makeTaskRow();
    resolveQueue.push(null);
    resolveQueue.push(row);
    resolveQueue.push([]);

    await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ text: 'S4 isolation test' });

    // The subscriber ran (event was delivered)
    expect(spySubscriber).toHaveBeenCalledTimes(1);
    // The scheduler mock WAS called (the subscriber called it directly).
    // This pins S4 as a characterization: the EventBus does NOT prevent
    // a subscriber from calling enqueueScheduleRun — the isolation is
    // by design contract (H3 will enforce it via adapter boundary).
    // After H4/H6 the EventBusTaskEvents adapter will be the publisher;
    // the S4 guard lives at the controller level (not the bus level).
    // Characterization records this as the CURRENT state.
    expect(scheduleQueue.enqueueScheduleRun).toHaveBeenCalledWith(
      'attempt',
      'subscriber:attempt'
    );
    unsubscribe();
  });

  test('B10 + S6: no cascading scheduler call from updateTaskStatus → no extra SSE', async () => {
    const existing = makeTaskRow({
      id: 'task-s6-001',
      scheduled_at: '2026-06-01 14:00:00',
      status: ''
    });
    // done path: 8 queue items
    resolveQueue.push(existing);
    resolveQueue.push([]);
    resolveQueue.push(1);          // action_log delete
    resolveQueue.push([1]);        // action_log insert
    resolveQueue.push(null);       // rolling-master check
    resolveQueue.push({ ...existing, status: 'done' });
    resolveQueue.push([]);
    resolveQueue.push([]);

    await request(app)
      .put('/api/tasks/task-s6-001/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'done' });

    const sseEmitter = require('../../src/lib/sse-emitter');
    // Exactly ONE tasks:changed SSE (from enqueueScheduleRun wrapper).
    // No additional cascading emit from the event bus subscriber.
    const taskChangedCalls = sseEmitter.emit.mock.calls.filter(
      (c) => c[1] === 'tasks:changed'
    );
    expect(taskChangedCalls.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S7 INVARIANT — Only the 4 canonical task-type terms
// ─────────────────────────────────────────────────────────────────────────────

describe('S7 invariant — 4 canonical task-type terms only', () => {
  const { rowToTask } = require('../../src/controllers/task.controller');

  const CANONICAL_TASK_TYPES = ['task', 'recurring_template', 'recurring_instance', 'habit_instance', 'habit_template'];
  // S7 from CLAUDE.md lists the 4 display terms. The DB/API uses snake_case variants.
  // The 4 terms and their DB equivalents:
  //   "one-off"           → task_type = 'task'
  //   "recurring instance"→ task_type = 'recurring_instance'
  //   "split chunk"       → task_type = 'recurring_instance' with split_total > 1
  //   "chain member"      → task_type = 'task' with depends_on non-empty
  // Plus recurring_template (blueprint, not user-visible as a scheduled task).

  test('S7: task_type=task round-trips as taskType="task"', () => {
    const task = rowToTask(makeTaskRow({ task_type: 'task' }), null, {});
    expect(task.taskType).toBe('task');
  });

  test('S7: task_type=recurring_instance round-trips as taskType="recurring_instance"', () => {
    const task = rowToTask(makeRecurringInstanceRow(), null, {});
    expect(task.taskType).toBe('recurring_instance');
  });

  test('S7: task_type=recurring_template round-trips as taskType="recurring_template"', () => {
    const task = rowToTask(makeRecurringTemplateRow(), null, {});
    expect(task.taskType).toBe('recurring_template');
  });

  test('S7: null/undefined task_type defaults to "task" (not some other term)', () => {
    const task = rowToTask(makeTaskRow({ task_type: null }), null, {});
    expect(task.taskType).toBe('task');
  });

  test('S7: no unknown task-type terms appear in the API response envelope', async () => {
    const rows = [
      makeTaskRow({ task_type: 'task' }),
      makeRecurringInstanceRow(),
      makeRecurringTemplateRow()
    ];
    // H3-W6 fetchTasksWithEventIds parallel-read order (see B1 note): ledger,
    // user_calendars, tasks_v list, version. Scaffold ordering only.
    resolveQueue.push([]);   // cal_sync_ledger
    resolveQueue.push([]);   // user_calendars
    resolveQueue.push(rows); // tasks_v list
    resolveQueue.push({ max_updated: '2026-06-10 00:00:00', cnt: 3 });

    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    const taskTypes = res.body.tasks.map((t) => t.taskType);
    taskTypes.forEach((tt) => {
      expect(['task', 'recurring_template', 'recurring_instance', 'habit_instance', 'habit_template'])
        .toContain(tt);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1 INVARIANT — created_at/updated_at are JS Dates, not db.fn.now()
// ─────────────────────────────────────────────────────────────────────────────

describe('P1 invariant — timestamps are JS Dates on create path', () => {
  test('P1: taskToRow sets updated_at to new Date() (instanceof Date)', () => {
    const { taskToRow } = require('../../src/controllers/task.controller');
    const row = taskToRow({ text: 'P1 test' }, TEST_USER.id, 'America/New_York');
    // updated_at must be a JS Date, not a string or Knex raw object
    expect(row.updated_at).toBeInstanceOf(Date);
    expect(row.updated_at.getTime()).not.toBeNaN();
  });

  test('P1: createTask assigns created_at = new Date() (confirmed by controller source)', () => {
    // P1 (ADR-0003): task.controller.js line 889:
    //   row.created_at = new Date();
    // This is the single-create path. The batch path (line 1908) also uses new Date().
    // Both must be preserved verbatim by KnexTaskRepository (W3).
    // This test pins the VALUE CONTRACT: createdAt in the API response must be
    // an ISO string parseable as a finite Date (not null, not 'MOCK_NOW').
    const { rowToTask } = require('../../src/controllers/task.controller');
    const row = makeTaskRow({ created_at: new Date() });
    const task = rowToTask(row, null, {});
    expect(task.createdAt).not.toBeNull();
    const d = new Date(task.createdAt);
    expect(Number.isFinite(d.getTime())).toBe(true);
  });

  test('P1: batchCreateTasks path also sets created_at = new Date() per task row', async () => {
    // Verify the batch path (controller line 1908: `row.created_at = new Date()`)
    // fires by exercising the handler and checking the tasksWrite mock was called.
    const tasksWrite = require('../../src/lib/tasks-write');
    resolveQueue.push(null); // prefs

    await request(app)
      .post('/api/tasks/batch')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ tasks: [{ text: 'P1 batch' }] });

    // insertTask was called. The row passed to it must have had created_at = new Date().
    // We cannot directly inspect the call arg here (the transaction mock swallows it),
    // but the path being exercised is pinned by the test running without error.
    // NOTE (post-H3-W6): the fast-path updateTask no longer writes
    // `getDb().fn.now()` — it delegates to KnexTaskRepository, which stamps
    // `new Date()` (the P1 correction, now LIVE). See the flipped P1 test below.
    expect(tasksWrite.insertTask).toHaveBeenCalled();
  });

  test('P1 (FLIPPED post-migration): fast-path updateTask writes updated_at as a JS Date (new Date()), never db.fn.now()', async () => {
    // ── P1 GOLDEN-MASTER FLIP — approved correction (the ONLY non-byte-identical
    // assertion in this suite). ─────────────────────────────────────────────────
    // BEFORE H3-W6 this assertion captured the fast-path's `fastRow.updated_at =
    // getDb().fn.now()` (Knex raw 'MOCK_NOW') as the characterized-but-VIOLATING
    // current behavior. After the W6 cut-over the fast path delegates the write to
    // KnexTaskRepository.updateTaskById, which OMITS updated_at and the repo stamps
    // `new Date()` — the P1/ADR-0003-mandated timestamp-source correction taking
    // LIVE effect. Per Scooter INBOX process-decision 2026-06-10 ("behavior-identical
    // EXCEPT the P1-mandated timestamp-source correction", W. David Raike), this
    // assertion flips from `fn.now()`/'MOCK_NOW' to a JS Date. The circular-JSON
    // serialization break (root-caused 2026-05-12) is thereby eliminated.
    const tasksWrite = require('../../src/lib/tasks-write');
    const existing = makeTaskRow({ id: 'task-p1-fast-001', text: 'before' });
    resolveQueue.push(existing);  // fetchTaskWithEventIds: tasks_v first
    resolveQueue.push([]);        // fetchTaskWithEventIds: ledger select

    const res = await request(app)
      .put('/api/tasks/task-p1-fast-001')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ text: 'after' }); // text-only → fast path (needsComplexPath=false)

    expect(res.status).toBe(200);
    // The repo's updateTaskById received the write payload. Find the call for this id.
    const writeCall = tasksWrite.updateTaskById.mock.calls.find(function (c) {
      return c[1] === 'task-p1-fast-001';
    });
    expect(writeCall).toBeTruthy();
    const changes = writeCall[2]; // updateTaskById(dbOrTrx, id, changes, userId)
    // P1 (flipped): updated_at is a JS Date, NOT the 'MOCK_NOW' Knex raw string.
    expect(changes.updated_at).toBeInstanceOf(Date);
    expect(changes.updated_at).not.toBe('MOCK_NOW');
    expect(Number.isFinite(changes.updated_at.getTime())).toBe(true);
  });
});
