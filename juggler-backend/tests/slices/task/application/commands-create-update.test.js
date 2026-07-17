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

  test('FAST PATH: simple field edit → routed write, optimistic 200, trigger ONCE, publishes updated (999.331)', function () {
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
        // 999.331: the FAST PATH now publishes TASK_UPDATED exactly once after the
        // successful write, so an H6 scheduler subscriber sees fast-path edits.
        // Reconciled FLAT shape (ADR-0001 E-3): { id, userId, status }.
        expect(events.published.length).toBe(1);
        expect(events.published[0].type).toBe('updated');
        expect(events.published[0].task).toEqual({ id: 'u1', userId: USER, status: r.status });
        // S4/S6: the publish did NOT add a second scheduler trigger (no cascade).
        expect(trigger.calls.length).toBe(1);
      });
    });
  });

  test('FAST PATH: 404 (missing task) does NOT publish TASK_UPDATED (999.331 — publish only on success)', function () {
    var repo = seedOneOff();
    var trigger = H.makeTriggerSpy();
    var events = H.makeEventsSpy();
    var uc = new UpdateTask(updateDeps(repo, trigger, events));
    return uc.execute({ id: 'nope', userId: USER, body: { text: 'x' } }).then(function (out) {
      expect(out.status).toBe(404);
      // No write happened → no publish, no trigger.
      expect(events.published.length).toBe(0);
      expect(trigger.calls.length).toBe(0);
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

  // ── 999.1394: batch matches single-item CreateTask ───────────────────────────
  test('999.1394: dangling dependsOn in a batch item → 400 "Task <i>: ...", no transaction', function () {
    var repo = new InMemoryTaskRepository();
    var txnSpy = jest.spyOn(repo, 'runInTransaction');
    var uc = new BatchCreateTasks(batchDeps(repo, H.makeTriggerSpy(), {
      validateReferences: function (_uid, body) {
        return Promise.resolve(Array.isArray(body.dependsOn) && body.dependsOn.length > 0
          ? ['dependsOn references unknown task ID(s): ' + body.dependsOn.join(', ')]
          : []);
      }
    }));
    return uc.execute({ userId: USER, body: { tasks: [{ id: 'g1', text: 'ok' }, { id: 'g2', text: 'bad', dependsOn: ['ghost'] }] } }).then(function (out) {
      expect(out.status).toBe(400);
      expect(out.body.error).toBe('Task 1: dependsOn references unknown task ID(s): ghost');
      expect(txnSpy).not.toHaveBeenCalled();
    });
  });

  test('999.1394: recurring batch item skips the dependsOn existence check (deps stripped downstream — CreateTask step-1b parity)', function () {
    var repo = new InMemoryTaskRepository();
    var seen = [];
    var uc = new BatchCreateTasks(batchDeps(repo, H.makeTriggerSpy(), {
      validateReferences: function (_uid, body) { seen.push(body); return Promise.resolve([]); }
    }));
    return uc.execute({ userId: USER, body: { tasks: [{ id: 'r1', text: 'rec', recurring: true, dependsOn: ['ghost'] }] } }).then(function (out) {
      expect(out.status).toBe(201);
      expect(seen.length).toBe(1);
      expect(seen[0].dependsOn).toBeUndefined();
    });
  });

  test('999.1394: anchor-dependent recur without recurStart → 400 (matches CreateTask\'s _requireRecurStartIfAnchor)', function () {
    var repo = new InMemoryTaskRepository();
    var uc = new BatchCreateTasks(batchDeps(repo, H.makeTriggerSpy()));
    return uc.execute({ userId: USER, body: { tasks: [{ id: 'r2', text: 'biweekly', recurring: true, recur: { type: 'biweekly' } }] } }).then(function (out) {
      expect(out.status).toBe(400);
      expect(out.body.error).toMatch(/^Task 0: /);
      expect(out.body.error).toMatch(/Recurrence start date is required/);
    });
  });

  // ── 999.589: deadlock-retry mirrors BatchUpdateTasks ────────────────────────
  // A repo fake whose runInTransaction throws ER_LOCK_DEADLOCK on the first N
  // calls then succeeds. We assert: (a) one deadlock then success → retried and
  // 201; (b) a non-deadlock error is NOT retried; (c) exhausting retries rethrows.
  function deadlockRepo(failTimes, errCode) {
    var calls = 0;
    return {
      calls: function () { return calls; },
      getUserSplitPreference: function () { return Promise.resolve(null); },
      runInTransaction: function () {
        calls++;
        if (calls <= failTimes) {
          var e = new Error(errCode === 'ER_LOCK_DEADLOCK' ? 'Deadlock found' : 'boom');
          e.code = errCode;
          return Promise.reject(e);
        }
        return Promise.resolve();
      }
    };
  }

  function retryDeps(repo, sleepSpy) {
    return batchDeps(repo, H.makeTriggerSpy(), {
      isLocked: function () { return Promise.resolve(false); },
      sleep: sleepSpy
    });
  }

  test('999.589: transaction throwing ER_LOCK_DEADLOCK once then succeeding is retried → 201', function () {
    var repo = deadlockRepo(1, 'ER_LOCK_DEADLOCK');
    var sleepCalls = [];
    var uc = new BatchCreateTasks(retryDeps(repo, function (ms) { sleepCalls.push(ms); return Promise.resolve(); }));
    return uc.execute({ userId: USER, body: { tasks: [{ id: 'd1', text: 'a' }] } }).then(function (out) {
      expect(out.status).toBe(201);
      expect(out.body.created).toBe(1);
      expect(repo.calls()).toBe(2);          // first (deadlock) + retry (success)
      expect(sleepCalls).toEqual([200]);     // one backoff, linear 200*(0+1)
    });
  });

  test('999.589: a NON-deadlock error is NOT retried (rethrown immediately)', function () {
    var repo = deadlockRepo(1, 'ER_SOME_OTHER');
    var sleepCalls = [];
    var uc = new BatchCreateTasks(retryDeps(repo, function (ms) { sleepCalls.push(ms); return Promise.resolve(); }));
    return uc.execute({ userId: USER, body: { tasks: [{ id: 'd2', text: 'a' }] } }).then(
      function () { throw new Error('expected throw'); },
      function (err) {
        expect(err.code).toBe('ER_SOME_OTHER');
        expect(repo.calls()).toBe(1);        // no retry
        expect(sleepCalls).toEqual([]);      // no backoff
      }
    );
  });

  test('999.589: exhausting MAX_RETRIES on persistent deadlock rethrows', function () {
    // Always deadlocks → 1 initial + MAX_RETRIES attempts, then rethrow.
    var repo = deadlockRepo(Infinity, 'ER_LOCK_DEADLOCK');
    var sleepCalls = [];
    var uc = new BatchCreateTasks(retryDeps(repo, function (ms) { sleepCalls.push(ms); return Promise.resolve(); }));
    return uc.execute({ userId: USER, body: { tasks: [{ id: 'd3', text: 'a' }] } }).then(
      function () { throw new Error('expected throw'); },
      function (err) {
        expect(err.code).toBe('ER_LOCK_DEADLOCK');
        expect(repo.calls()).toBe(BatchCreateTasks.MAX_RETRIES + 1); // initial + retries
        expect(sleepCalls).toEqual([200, 400, 600]);                 // linear backoff per attempt
      }
    );
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

// ── 999.2028: priority edits allowed on cal-synced tasks ────────────────────
// David ruling 2026-07-17: any task can be reprioritized regardless of origin.
// `pri` must be in the allowed-fields list for checkCalSyncEditGuard so
// cal-synced tasks (origin !== 'juggler') accept priority changes.
describe('UpdateTask — pri is allowed on cal-synced tasks (999.2028)', function () {
  function updateDepsBase(repo, extra) {
    return H.baseDeps(Object.assign({
      repo: repo,
      cache: H.makeCacheFake(),
      events: H.makeEventsSpy(),
      enqueueScheduleRun: H.makeTriggerSpy(),
      recurCleanup: function () { return Promise.resolve(); }
    }, extra || {}));
  }

  test('FAST PATH: editing pri on a cal-synced task → 200 (not 403)', function () {
    var repo = new InMemoryTaskRepository({
      rows: [{ id: 'cspri', user_id: USER, task_type: 'task', text: 'from-gcal', status: '', pri: 'P3', updated_at: new Date('2026-06-01T00:00:00Z') }],
      ledger: { cspri: { gcal_event_id: 'evt-pri', cal_sync_origin: 'gcal', msft_event_id: null, apple_event_id: null } }
    });
    var uc = new UpdateTask(updateDepsBase(repo));
    return uc.execute({ id: 'cspri', userId: USER, body: { pri: 'P1' } }).then(function (out) {
      expect(out.status).not.toBe(403);
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
      projects: ensureProjectSpy
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

// ═══════════════════════════════════════════════════════════════════════════
// 999.586 — DB-backed reference existence validation (depends_on / location /
// tools). Exercised via the injected `validateReferences` collaborator: the
// use-case must 400 (no write, no trigger) when it returns errors, and proceed
// normally when it returns []. A real-DB integration of validateTaskReferences
// itself lives in commands.db.test.js / the facade collaborators DB suite.
// ═══════════════════════════════════════════════════════════════════════════

describe('CreateTask — reference existence validation (999.586)', function () {
  // A fake validateReferences that rejects ids not in the configured allow-lists.
  function makeRefValidator(known) {
    var fn = function (userId, body) {
      var errs = [];
      (body.dependsOn || []).forEach(function (id) {
        if (known.deps.indexOf(id) === -1) errs.push('dependsOn references unknown task ID(s): ' + id);
      });
      (body.location || []).forEach(function (id) {
        if (known.locs.indexOf(id) === -1) errs.push('location references unknown location ID(s): ' + id);
      });
      (body.tools || []).forEach(function (id) {
        if (known.tools.indexOf(id) === -1) errs.push('tools references unknown tool ID(s): ' + id);
      });
      return Promise.resolve(errs);
    };
    return fn;
  }

  var KNOWN = { deps: ['dep-ok'], locs: ['home'], tools: ['phone'] };

  test('unknown depends_on ID → 400, no write, no trigger', function () {
    var repo = new InMemoryTaskRepository();
    var trigger = H.makeTriggerSpy();
    var events = H.makeEventsSpy();
    var insertSpy = jest.spyOn(repo, 'insertTask');
    var deps = createDeps(repo, trigger, events, { validateReferences: makeRefValidator(KNOWN) });
    var uc = new CreateTask(deps);
    return uc.execute({ userId: USER, body: { text: 'x', dependsOn: ['ghost'] } }).then(function (out) {
      expect(out.status).toBe(400);
      expect(out.body.error).toMatch(/dependsOn references unknown/);
      expect(insertSpy).not.toHaveBeenCalled();
      expect(trigger.calls.length).toBe(0);
      expect(events.published.length).toBe(0);
    });
  });

  test('unknown location ID → 400', function () {
    var repo = new InMemoryTaskRepository();
    var deps = createDeps(repo, H.makeTriggerSpy(), H.makeEventsSpy(), { validateReferences: makeRefValidator(KNOWN) });
    return new CreateTask(deps).execute({ userId: USER, body: { text: 'x', location: ['mars'] } }).then(function (out) {
      expect(out.status).toBe(400);
      expect(out.body.error).toMatch(/location references unknown/);
    });
  });

  test('unknown tool ID → 400', function () {
    var repo = new InMemoryTaskRepository();
    var deps = createDeps(repo, H.makeTriggerSpy(), H.makeEventsSpy(), { validateReferences: makeRefValidator(KNOWN) });
    return new CreateTask(deps).execute({ userId: USER, body: { text: 'x', tools: ['hammer'] } }).then(function (out) {
      expect(out.status).toBe(400);
      expect(out.body.error).toMatch(/tools references unknown/);
    });
  });

  test('all references valid → 201 created', function () {
    var repo = new InMemoryTaskRepository();
    var trigger = H.makeTriggerSpy();
    var deps = createDeps(repo, trigger, H.makeEventsSpy(), {
      uuidv7: function () { return 'ref-ok-1'; },
      validateReferences: makeRefValidator(KNOWN)
    });
    return new CreateTask(deps).execute({
      userId: USER,
      body: { text: 'valid refs', dependsOn: ['dep-ok'], location: ['home'], tools: ['phone'] }
    }).then(function (out) {
      expect(out.status).toBe(201);
      expect(trigger.calls.length).toBe(1);
    });
  });

  test('recurring task SKIPS dep existence check (deps stripped downstream)', function () {
    var repo = new InMemoryTaskRepository();
    var seen = [];
    var refSpy = function (userId, body) { seen.push(body); return Promise.resolve([]); };
    var deps = createDeps(repo, H.makeTriggerSpy(), H.makeEventsSpy(), {
      uuidv7: function () { return 'rec-1'; },
      validateReferences: refSpy
    });
    return new CreateTask(deps).execute({
      userId: USER,
      body: { text: 'recurring', recurring: true, dependsOn: ['ghost-but-stripped'] }
    }).then(function (out) {
      expect(out.status).toBe(201);
      // the validator was called WITHOUT dependsOn (skipped for recurring).
      expect(seen[0].dependsOn).toBeUndefined();
    });
  });
});

describe('UpdateTask — reference existence validation (999.586)', function () {
  function seedOneOff() {
    return new InMemoryTaskRepository({ rows: [
      { id: 'r1', user_id: USER, task_type: 'task', text: 'orig', pri: 'P3', status: '', updated_at: new Date('2026-06-01T00:00:00Z') }
    ] });
  }
  function updateDeps(repo, extra) {
    return H.baseDeps(Object.assign({
      repo: repo,
      cache: H.makeCacheFake(),
      events: H.makeEventsSpy(),
      enqueueScheduleRun: H.makeTriggerSpy(),
      recurCleanup: function () { return Promise.resolve(); }
    }, extra || {}));
  }

  test('FAST PATH: unknown location ID → 400, no write, no trigger', function () {
    var repo = seedOneOff();
    var trigger = H.makeTriggerSpy();
    var updateSpy = jest.spyOn(repo, 'updateTaskById');
    var deps = updateDeps(repo, {
      enqueueScheduleRun: trigger,
      validateReferences: function () { return Promise.resolve(['location references unknown location ID(s): mars']); }
    });
    return new UpdateTask(deps).execute({ id: 'r1', userId: USER, body: { location: ['mars'] } }).then(function (out) {
      expect(out.status).toBe(400);
      expect(out.body.error).toMatch(/location references unknown/);
      expect(updateSpy).not.toHaveBeenCalled();
      expect(trigger.calls.length).toBe(0);
    });
  });

  test('FAST PATH: valid reference → 200 updated', function () {
    var repo = seedOneOff();
    var deps = updateDeps(repo, {
      validateReferences: function () { return Promise.resolve([]); }
    });
    return new UpdateTask(deps).execute({ id: 'r1', userId: USER, body: { location: ['home'], tools: ['phone'] } }).then(function (out) {
      expect(out.status).toBe(200);
    });
  });

  test('COMPLEX PATH (recur present): unknown dep on a non-recurring update → 400', function () {
    var repo = seedOneOff();
    var deps = updateDeps(repo, {
      validateReferences: function (userId, body) {
        // body still carries dependsOn here (task isn't flagged recurring in body)
        return Promise.resolve(body.dependsOn ? ['dependsOn references unknown task ID(s): ghost'] : []);
      }
    });
    // `when` forces the complex path; dependsOn triggers the rejection.
    return new UpdateTask(deps).execute({ id: 'r1', userId: USER, body: { when: 'morning', dependsOn: ['ghost'] } }).then(function (out) {
      expect(out.status).toBe(400);
      expect(out.body.error).toMatch(/dependsOn references unknown/);
    });
  });

  test('partial PATCH of an ALREADY-recurring task (body omits recurring) does NOT false-reject a stale dependsOn (ernie WARN-2)', function () {
    // Existing task is recurring; the PATCH carries a stale dependsOn but no `recurring`.
    // The gate must consult the existing recurring state (fetchTaskRecurring) and strip
    // dependsOn (deps are discarded downstream), so validateReferences never sees it → no 400.
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'rec1', user_id: USER, task_type: 'recurring_template', recurring: 1, text: 'rt', pri: 'P3', status: '', updated_at: new Date('2026-06-01T00:00:00Z') }
    ] });
    var seen = [];
    var deps = updateDeps(repo, {
      validateReferences: function (userId, body) {
        seen.push(body);
        return Promise.resolve(body.dependsOn ? ['dependsOn references unknown task ID(s): ghost'] : []);
      }
    });
    return new UpdateTask(deps).execute({ id: 'rec1', userId: USER, body: { dependsOn: ['ghost'] } }).then(function (out) {
      expect(out.status).not.toBe(400);
      expect(seen[0].dependsOn).toBeUndefined(); // stripped because the existing task is recurring
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 999.558 — earliestStart > deadline cross-field validation on task update
// ═══════════════════════════════════════════════════════════════════════════

describe('UpdateTask — earliestStart > deadline cross-field (999.558)', function () {
  // Seed a task with a deadline but no earliestStart
  function seedWithDeadline() {
    return new InMemoryTaskRepository({ rows: [
      { id: 't1', user_id: USER, task_type: 'task', text: 'has deadline', pri: 'P3', status: '',
        deadline: new Date('2026-06-30'), start_after_at: null, updated_at: new Date('2026-06-01T00:00:00Z') }
    ] });
  }
  // Seed a task with a earliestStart but no deadline
  function seedWithEarliestStart() {
    return new InMemoryTaskRepository({ rows: [
      { id: 't2', user_id: USER, task_type: 'task', text: 'has earliestStart', pri: 'P3', status: '',
        deadline: null, start_after_at: new Date('2026-06-15'), updated_at: new Date('2026-06-01T00:00:00Z') }
    ] });
  }
  // Seed a task with both fields set to valid values
  function seedWithBoth() {
    return new InMemoryTaskRepository({ rows: [
      { id: 't3', user_id: USER, task_type: 'task', text: 'has both', pri: 'P3', status: '',
        deadline: new Date('2026-06-30'), start_after_at: new Date('2026-06-01'), updated_at: new Date('2026-06-01T00:00:00Z') }
    ] });
  }

  function updateDeps(repo, extra) {
    return H.baseDeps(Object.assign({
      repo: repo,
      cache: H.makeCacheFake(),
      events: H.makeEventsSpy(),
      enqueueScheduleRun: H.makeTriggerSpy(),
      recurCleanup: function () { return Promise.resolve(); }
    }, extra || {}));
  }

  test('FAST PATH: setting earliestStart after existing deadline → 400', function () {
    // Task has deadline=2026-06-30. Setting earliestStart=2026-07-01 exceeds it.
    var repo = seedWithDeadline();
    var trigger = H.makeTriggerSpy();
    var updateSpy = jest.spyOn(repo, 'updateTaskById');
    var deps = updateDeps(repo, { enqueueScheduleRun: trigger });
    return new UpdateTask(deps).execute({ id: 't1', userId: USER, body: { earliestStart: '2026-07-01' } }).then(function (out) {
      expect(out.status).toBe(400);
      expect(out.body.error).toMatch(/Deadline must be on or after earliest start date/);
      expect(updateSpy).not.toHaveBeenCalled();
      expect(trigger.calls.length).toBe(0);
    });
  });

  test('FAST PATH: setting deadline before existing earliestStart → 400', function () {
    // Task has start_after_at=2026-06-15. Setting deadline=2026-06-10 is before it.
    var repo = seedWithEarliestStart();
    var trigger = H.makeTriggerSpy();
    var updateSpy = jest.spyOn(repo, 'updateTaskById');
    var deps = updateDeps(repo, { enqueueScheduleRun: trigger });
    return new UpdateTask(deps).execute({ id: 't2', userId: USER, body: { deadline: '2026-06-10' } }).then(function (out) {
      expect(out.status).toBe(400);
      expect(out.body.error).toMatch(/Deadline must be on or after earliest start date/);
      expect(updateSpy).not.toHaveBeenCalled();
      expect(trigger.calls.length).toBe(0);
    });
  });

  test('FAST PATH: setting earliestStart before existing deadline → 200 (valid)', function () {
    var repo = seedWithDeadline();
    var deps = updateDeps(repo);
    return new UpdateTask(deps).execute({ id: 't1', userId: USER, body: { earliestStart: '2026-06-15' } }).then(function (out) {
      expect(out.status).toBe(200);
    });
  });

  test('FAST PATH: setting deadline after existing earliestStart → 200 (valid)', function () {
    var repo = seedWithEarliestStart();
    var deps = updateDeps(repo);
    return new UpdateTask(deps).execute({ id: 't2', userId: USER, body: { deadline: '2026-07-01' } }).then(function (out) {
      expect(out.status).toBe(200);
    });
  });

  test('COMPLEX PATH: setting earliestStart after existing deadline → 400', function () {
    // `when` forces the complex path; earliestStart exceeds existing deadline.
    var repo = seedWithDeadline();
    var trigger = H.makeTriggerSpy();
    var deps = updateDeps(repo, { enqueueScheduleRun: trigger });
    return new UpdateTask(deps).execute({ id: 't1', userId: USER, body: { when: 'morning', earliestStart: '2026-07-01' } }).then(function (out) {
      expect(out.status).toBe(400);
      expect(out.body.error).toMatch(/Deadline must be on or after earliest start date/);
      expect(trigger.calls.length).toBe(0);
    });
  });

  test('COMPLEX PATH: setting deadline before existing earliestStart → 400', function () {
    // `when` forces the complex path; deadline is before existing earliestStart.
    var repo = seedWithEarliestStart();
    var trigger = H.makeTriggerSpy();
    var deps = updateDeps(repo, { enqueueScheduleRun: trigger });
    return new UpdateTask(deps).execute({ id: 't2', userId: USER, body: { when: 'morning', deadline: '2026-06-10' } }).then(function (out) {
      expect(out.status).toBe(400);
      expect(out.body.error).toMatch(/Deadline must be on or after earliest start date/);
      expect(trigger.calls.length).toBe(0);
    });
  });

  test('both fields in body with earliestStart > deadline → 400 (even without existing)', function () {
    var repo = seedWithBoth();
    var trigger = H.makeTriggerSpy();
    var deps = updateDeps(repo, { enqueueScheduleRun: trigger });
    return new UpdateTask(deps).execute({ id: 't3', userId: USER, body: { earliestStart: '2026-08-01', deadline: '2026-07-01' } }).then(function (out) {
      expect(out.status).toBe(400);
      expect(out.body.error).toMatch(/Deadline must be on or after earliest start date/);
    });
  });

  test('clearing earliestStart with empty string resolves conflict → 200', function () {
    // Task has impossible window (earliestStart > deadline). Clearing earliestStart
    // should allow the update since the constraint no longer applies.
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 't4', user_id: USER, task_type: 'task', text: 'impossible', pri: 'P3', status: '',
        deadline: new Date('2026-06-15'), start_after_at: new Date('2026-07-01'), updated_at: new Date('2026-06-01T00:00:00Z') }
    ] });
    var deps = updateDeps(repo);
    return new UpdateTask(deps).execute({ id: 't4', userId: USER, body: { earliestStart: '' } }).then(function (out) {
      expect(out.status).toBe(200);
    });
  });

  test('clearing deadline with null resolves conflict → 200', function () {
    // Task has impossible window. Clearing deadline should allow the update.
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 't5', user_id: USER, task_type: 'task', text: 'impossible', pri: 'P3', status: '',
        deadline: new Date('2026-06-15'), start_after_at: new Date('2026-07-01'), updated_at: new Date('2026-06-01T00:00:00Z') }
    ] });
    var deps = updateDeps(repo);
    return new UpdateTask(deps).execute({ id: 't5', userId: USER, body: { deadline: null } }).then(function (out) {
      expect(out.status).toBe(200);
    });
  });

  test('neither field touched → no conflict check (existing bad data is not retroactively rejected)', function () {
    // A task with existing earliestStart > deadline — if neither field is in the PATCH,
    // we don't reject (the existing data predates the validation rule).
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 't6', user_id: USER, task_type: 'task', text: 'legacy bad data', pri: 'P3', status: '',
        deadline: new Date('2026-06-15'), start_after_at: new Date('2026-07-01'), updated_at: new Date('2026-06-01T00:00:00Z') }
    ] });
    var deps = updateDeps(repo);
    // Only changing text — earliestStart/deadline unchanged
    return new UpdateTask(deps).execute({ id: 't6', userId: USER, body: { text: 'updated' } }).then(function (out) {
      expect(out.status).toBe(200);
    });
  });
});
