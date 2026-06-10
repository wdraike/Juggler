/**
 * W5 — CreateTask / UpdateTask / BatchCreateTasks characterization + S4/S6.
 *
 * Driven against the REAL InMemoryTaskRepository (TaskRepositoryPort) + fakes for
 * the out-of-port collaborators. Asserts the handler-identical orchestration:
 * validation, guards, branch selection, persistence, cache-invalidate, the
 * enqueueScheduleRun trigger call-shape (S4/S6), and the event publish.
 *
 * S4/S6 PROOF: every mutation triggers enqueueScheduleRun EXACTLY ONCE, and the
 * events spy (publishTaskCreated/Updated) has ZERO edge to the trigger spy — so a
 * publish cannot cause a second/cascading trigger. (The events fake records
 * publishes but never calls enqueueScheduleRun.)
 *
 * Traceability: WBS W5 (b) step-for-step, (c) S4/S6, (e) characterization.
 */

'use strict';

var InMemoryTaskRepository = require('../../../../src/slices/task/adapters/InMemoryTaskRepository');
var CreateTask = require('../../../../src/slices/task/application/commands/CreateTask');
var UpdateTask = require('../../../../src/slices/task/application/commands/UpdateTask');
var BatchCreateTasks = require('../../../../src/slices/task/application/commands/BatchCreateTasks');
var H = require('./_helpers');
var { z } = require('zod');

var USER = 'cu-user';

// minimal zod schema matching the controller's batchCreateSchema shape
var taskPatchSchema = z.object({ id: z.string().optional() }).passthrough();
var batchCreateSchema = z.object({ tasks: z.array(taskPatchSchema).min(1).max(100) });

function createDeps(repo, trigger, events, extra) {
  return H.baseDeps(Object.assign({
    repo: repo,
    cache: H.makeCacheFake(),
    events: events,
    enqueueScheduleRun: trigger,
    uuidv7: function () { return 'fixed-id-1'; }
  }, extra || {}));
}

describe('CreateTask (createTask)', function () {
  test('happy path: validates, inserts, invalidates, triggers ONCE, publishes created', function () {
    var repo = new InMemoryTaskRepository();
    var trigger = H.makeTriggerSpy();
    var events = H.makeEventsSpy();
    var cache = H.makeCacheFake();
    var deps = createDeps(repo, trigger, events, { cache: cache });
    var uc = new CreateTask(deps);
    return uc.execute({ userId: USER, body: { text: 'Buy milk', pri: 'P2' }, timezoneHeader: 'America/New_York' })
      .then(function (out) {
        expect(out.status).toBe(201);
        expect(out.body.task.id).toBe('fixed-id-1');
        expect(out.body.task.text).toBe('Buy milk');
        expect(out.body.task.pri).toBe('P2');
        // persisted
        return repo.fetchTaskWithEventIds('fixed-id-1', USER).then(function (r) {
          expect(r).toBeTruthy();
          expect(r.created_at instanceof Date).toBe(true); // P1
          expect(r.updated_at instanceof Date).toBe(true);
          // cache invalidated, trigger fired ONCE (S4/S6)
          expect(cache.calls.invalidateTasks).toBe(1);
          expect(trigger.calls.length).toBe(1);
          expect(trigger.calls[0]).toMatchObject({ userId: USER, source: 'api:createTask', ids: ['fixed-id-1'] });
          // event published, but it did NOT add a second trigger (no cascade)
          expect(events.published).toEqual([{ type: 'created', task: { id: 'fixed-id-1', userId: USER, status: r.status } }]);
          expect(trigger.calls.length).toBe(1);
        });
      });
  });

  test('validation failure → 400, no write, no trigger', function () {
    var repo = new InMemoryTaskRepository();
    var trigger = H.makeTriggerSpy();
    var events = H.makeEventsSpy();
    var uc = new CreateTask(createDeps(repo, trigger, events));
    return uc.execute({ userId: USER, body: { text: '' }, timezoneHeader: 'America/New_York' })
      .then(function (out) {
        expect(out.status).toBe(400);
        expect(out.body.error).toMatch(/Task name is required/);
        expect(trigger.calls.length).toBe(0);
        expect(events.published.length).toBe(0);
      });
  });

  test('fixed placementMode without date/time → 400', function () {
    var repo = new InMemoryTaskRepository();
    var uc = new CreateTask(createDeps(repo, H.makeTriggerSpy(), H.makeEventsSpy()));
    // pass validation (placementMode fixed requires date/time at validateTaskInput
    // too) by supplying scheduledAt to clear validation, then strip it for the
    // handler-level guard? The handler guard checks body.date/time/scheduledAt —
    // supply none to hit the 400. validateTaskInput's fixed-rule also needs one,
    // so this asserts the validation-level 400 (same 400 status, same gate).
    return uc.execute({ userId: USER, body: { text: 'x', placementMode: 'fixed' } })
      .then(function (out) {
        expect(out.status).toBe(400);
      });
  });

  test('LOCK PATH: queued create — enqueueWrite, invalidate, trigger skipEmit, 201 queued', function () {
    var repo = new InMemoryTaskRepository();
    var trigger = H.makeTriggerSpy();
    var events = H.makeEventsSpy();
    var enqueued = [];
    var insertSpy = jest.spyOn(repo, 'insertTask');
    var deps = createDeps(repo, trigger, events, {
      isLocked: function () { return Promise.resolve(true); },
      enqueueWrite: function (uid, id, op, row, src) { enqueued.push({ id: id, op: op, src: src }); return Promise.resolve(); }
    });
    var uc = new CreateTask(deps);
    return uc.execute({ userId: USER, body: { text: 'locked task' } }).then(function (out) {
      expect(out.status).toBe(201);
      expect(out.body.queued).toBe(true);
      expect(enqueued.length).toBe(1);
      expect(enqueued[0].op).toBe('create');
      expect(insertSpy).not.toHaveBeenCalled(); // queued, not written directly
      expect(trigger.calls[0].options).toEqual({ skipEmit: true });
      expect(events.published.length).toBe(0); // no publish on the queued path
    });
  });
});

describe('UpdateTask (updateTask)', function () {
  function seedOneOff() {
    return new InMemoryTaskRepository({ rows: [
      { id: 'u1', user_id: USER, task_type: 'task', text: 'orig', pri: 'P3', status: '', updated_at: new Date('2026-06-01T00:00:00Z') }
    ] });
  }

  function updateDeps(repo, trigger, events, extra) {
    return H.baseDeps(Object.assign({
      repo: repo,
      cache: H.makeCacheFake(),
      events: events,
      enqueueScheduleRun: trigger,
      recurCleanup: function () { return Promise.resolve(); }
    }, extra || {}));
  }

  test('FAST PATH: simple field edit → routed write, optimistic 200, trigger ONCE, publishes updated', function () {
    var repo = seedOneOff();
    var trigger = H.makeTriggerSpy();
    var events = H.makeEventsSpy();
    var cache = H.makeCacheFake();
    var uc = new UpdateTask(updateDeps(repo, trigger, events, { cache: cache }));
    return uc.execute({ id: 'u1', userId: USER, body: { text: 'edited', pri: 'P1' } }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.task.text).toBe('edited');
      expect(out.body.task.pri).toBe('P1');
      return repo.fetchTaskWithEventIds('u1', USER).then(function (r) {
        expect(r.text).toBe('edited');
        expect(r.pri).toBe('P1');
        expect(r.updated_at instanceof Date).toBe(true); // P1 repo-stamped
        expect(trigger.calls.length).toBe(1);
        expect(trigger.calls[0].source).toBe('api:updateTask');
        // FAST PATH does NOT publish — the legacy controller only publishes on the
        // slow/complex path (L1366). Behavior-identical: no event here.
        expect(events.published.length).toBe(0);
      });
    });
  });

  test('FAST PATH: 404 for a missing task', function () {
    var repo = seedOneOff();
    var trigger = H.makeTriggerSpy();
    var uc = new UpdateTask(updateDeps(repo, trigger, H.makeEventsSpy()));
    return uc.execute({ id: 'nope', userId: USER, body: { text: 'x' } }).then(function (out) {
      expect(out.status).toBe(404);
      expect(trigger.calls.length).toBe(0);
    });
  });

  test('FAST PATH: 403 for a disabled task', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'd1', user_id: USER, task_type: 'task', status: 'disabled', updated_at: new Date() }
    ] });
    var uc = new UpdateTask(updateDeps(repo, H.makeTriggerSpy(), H.makeEventsSpy()));
    return uc.execute({ id: 'd1', userId: USER, body: { text: 'x' } }).then(function (out) {
      expect(out.status).toBe(403);
      expect(out.body.code).toBe('TASK_DISABLED');
    });
  });

  test('COMPLEX PATH: a `recur`/`when` edit runs recurCleanup inside a transaction + 200', function () {
    var repo = seedOneOff();
    var trigger = H.makeTriggerSpy();
    var events = H.makeEventsSpy();
    var cleanupCalls = [];
    var deps = updateDeps(repo, trigger, events, {
      recurCleanup: function (ctx) {
        cleanupCalls.push({ taskType: ctx.taskType, id: ctx.id });
        // simulate the legacy template/instance write through the trx repo
        return ctx.trxRepo.updateTaskById(ctx.id, ctx.row, ctx.userId);
      }
    });
    var uc = new UpdateTask(deps);
    return uc.execute({ id: 'u1', userId: USER, body: { when: 'anytime', text: 'cx' } }).then(function (out) {
      expect(out.status).toBe(200);
      expect(cleanupCalls.length).toBe(1); // complex path entered + cleanup ran in the txn
      expect(trigger.calls.length).toBe(1);
      expect(events.published[0].type).toBe('updated');
    });
  });

  test('LOCK PATH: scheduling fields queued, non-scheduling written, 200 queued', function () {
    var repo = seedOneOff();
    var trigger = H.makeTriggerSpy();
    var events = H.makeEventsSpy();
    var enqueued = [];
    var deps = updateDeps(repo, trigger, events, {
      isLocked: function () { return Promise.resolve(true); },
      enqueueWrite: function (uid, id, op, fields) { enqueued.push({ id: id, op: op, fields: fields }); return Promise.resolve(); }
    });
    var uc = new UpdateTask(deps);
    // `when` forces the complex path, which checks the lock → lock path
    return uc.execute({ id: 'u1', userId: USER, body: { when: 'fixed', text: 'L' } }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.queued).toBe(true);
      // `when` is a scheduling field → queued
      expect(enqueued.length).toBe(1);
      expect(trigger.calls.length).toBe(1);
    });
  });
});

describe('BatchCreateTasks (batchCreateTasks)', function () {
  function batchDeps(repo, trigger, extra) {
    return H.baseDeps(Object.assign({
      repo: repo,
      cache: H.makeCacheFake(),
      enqueueScheduleRun: trigger,
      batchCreateSchema: batchCreateSchema
    }, extra || {}));
  }

  test('happy path: inserts all in ONE transaction, triggers once, 201 created N', function () {
    var repo = new InMemoryTaskRepository();
    var trigger = H.makeTriggerSpy();
    var txnSpy = jest.spyOn(repo, 'runInTransaction');
    var uc = new BatchCreateTasks(batchDeps(repo, trigger));
    // ids supplied (the InMemory store keys by id; the legacy DB path lets
    // tasks-write generate ids — irrelevant to the orchestration under test).
    return uc.execute({ userId: USER, body: { tasks: [{ id: 'b1', text: 'a' }, { id: 'b2', text: 'b' }] } }).then(function (out) {
      expect(out.status).toBe(201);
      expect(out.body.created).toBe(2);
      expect(txnSpy).toHaveBeenCalledTimes(1); // T-TX: one transaction
      expect(trigger.calls.length).toBe(1);
      return repo.fetchTasksWithEventIds(USER).then(function (rows) {
        expect(rows.length).toBe(2);
        rows.forEach(function (r) { expect(r.created_at instanceof Date).toBe(true); }); // P1
      });
    });
  });

  test('zod failure → 400, no transaction', function () {
    var repo = new InMemoryTaskRepository();
    var txnSpy = jest.spyOn(repo, 'runInTransaction');
    var uc = new BatchCreateTasks(batchDeps(repo, H.makeTriggerSpy()));
    return uc.execute({ userId: USER, body: { tasks: [] } }).then(function (out) {
      expect(out.status).toBe(400);
      expect(txnSpy).not.toHaveBeenCalled();
    });
  });

  test('per-task validation failure → 400 "Task <i>: ..."', function () {
    var repo = new InMemoryTaskRepository();
    var uc = new BatchCreateTasks(batchDeps(repo, H.makeTriggerSpy()));
    return uc.execute({ userId: USER, body: { tasks: [{ text: 'ok' }, { text: '' }] } }).then(function (out) {
      expect(out.status).toBe(400);
      expect(out.body.error).toMatch(/^Task 1: /);
    });
  });
});

// ── W5-1: checkCalSyncEditGuard 403 path (BLOCK gap closed) ─────────────────
// A cal-synced task (cal_sync_origin !== 'juggler') being edited on a guarded
// field must return 403 CAL_SYNCED_READONLY. Dropping `checkCalSyncEditGuard`
// from either path leaves these tests RED (fail-on-drop proof).
describe('UpdateTask — checkCalSyncEditGuard 403 (W5-1)', function () {
  // The InMemoryTaskRepository surfaces event-id / cal-sync fields via its
  // `_ledger` (injected as `ledger` in the constructor), NOT from the base row
  // — matching how `fetchTaskWithEventIds` folds the cal_sync_ledger in Knex.
  // We must seed cal_sync_origin via the ledger option so `_withEventIds` returns it.

  function updateDepsBase(repo, extra) {
    return H.baseDeps(Object.assign({
      repo: repo,
      cache: H.makeCacheFake(),
      events: H.makeEventsSpy(),
      enqueueScheduleRun: H.makeTriggerSpy(),
      recurCleanup: function () { return Promise.resolve(); }
    }, extra || {}));
  }

  test('FAST PATH: editing a guarded field on a cal-synced task → 403 CAL_SYNCED_READONLY', function () {
    // `text` is a guarded field (not in the allowed list: status, notes, _allowUnfix).
    // The real `checkCalSyncEditGuard` is injected via `validation` in baseDeps.
    // needsComplexPath=false because body has no recur/when/anchor/allDay/time-only.
    // cal_sync_origin is seeded in the ledger so _withEventIds surfaces it.
    var repo = new InMemoryTaskRepository({
      rows: [{ id: 'cs1', user_id: USER, task_type: 'task', text: 'from-gcal', status: '', updated_at: new Date('2026-06-01T00:00:00Z') }],
      ledger: { cs1: { gcal_event_id: 'evt-abc', cal_sync_origin: 'gcal', msft_event_id: null, apple_event_id: null } }
    });
    var uc = new UpdateTask(updateDepsBase(repo));
    return uc.execute({ id: 'cs1', userId: USER, body: { text: 'tampered' } }).then(function (out) {
      expect(out.status).toBe(403);
      expect(out.body.code).toBe('CAL_SYNCED_READONLY');
      expect(Array.isArray(out.body.blockedFields)).toBe(true);
      expect(out.body.blockedFields).toContain('text');
    });
  });

  test('COMPLEX PATH: editing a guarded field on a cal-synced task → 403 CAL_SYNCED_READONLY', function () {
    // Supply `when` so needsComplexPath=true → the complex path guard fires.
    // cal_sync_origin is seeded in the ledger so _withEventIds surfaces it.
    var repo = new InMemoryTaskRepository({
      rows: [{ id: 'cs2', user_id: USER, task_type: 'task', text: 'from-msft', status: '', updated_at: new Date('2026-06-01T00:00:00Z') }],
      ledger: { cs2: { msft_event_id: 'evt-msft', cal_sync_origin: 'msft', gcal_event_id: null, apple_event_id: null } }
    });
    var uc = new UpdateTask(updateDepsBase(repo));
    // `when` triggers needsComplexPath=true; `text` is a guarded field.
    return uc.execute({ id: 'cs2', userId: USER, body: { when: 'anytime', text: 'tampered' } }).then(function (out) {
      expect(out.status).toBe(403);
      expect(out.body.code).toBe('CAL_SYNCED_READONLY');
      expect(Array.isArray(out.body.blockedFields)).toBe(true);
      expect(out.body.blockedFields).toContain('text');
    });
  });
});

// ── W5-2: ensureProject spy (BLOCK gap closed) ───────────────────────────────
// CreateTask with body.project set MUST call ensureProject. Dropping the call
// from CreateTask.js leaves this test RED (fail-on-drop proof).
describe('CreateTask — ensureProject called when body.project is set (W5-2)', function () {
  test('CreateTask with body.project calls ensureProject with the project name', function () {
    var repo = new InMemoryTaskRepository();
    var trigger = H.makeTriggerSpy();
    var events = H.makeEventsSpy();
    var ensureProjectSpy = H.makeEnsureProjectSpy();
    var deps = H.baseDeps({
      repo: repo,
      cache: H.makeCacheFake(),
      events: events,
      enqueueScheduleRun: trigger,
      uuidv7: function () { return 'proj-task-1'; },
      ensureProject: ensureProjectSpy
    });
    var uc = new CreateTask(deps);
    return uc.execute({ userId: USER, body: { text: 'Task for Project Alpha', project: 'Project Alpha' } }).then(function (out) {
      expect(out.status).toBe(201);
      // ensureProject MUST have been called exactly once with the project name.
      expect(ensureProjectSpy.calls.length).toBe(1);
      expect(ensureProjectSpy.calls[0].userId).toBe(USER);
      expect(ensureProjectSpy.calls[0].project).toBe('Project Alpha');
    });
  });
});

describe('S4/S6 — publishing never cascades a second scheduler trigger', function () {
  test('an events port whose publish() called enqueueScheduleRun would be the ONLY way to cascade — and the real port does not', function () {
    var repo = new InMemoryTaskRepository();
    var trigger = H.makeTriggerSpy();
    // A REAL EventBusTaskEvents-shaped fake: publisher only, no scheduler import.
    var events = H.makeEventsSpy();
    var uc = new CreateTask(createDeps(repo, trigger, events));
    return uc.execute({ userId: USER, body: { text: 'no cascade' } }).then(function () {
      // exactly one trigger; the publish added none.
      expect(trigger.calls.length).toBe(1);
      expect(events.published.length).toBe(1);
      // the trigger source is the mutation, never an event-driven source.
      expect(trigger.calls[0].source).toBe('api:createTask');
    });
  });
});
