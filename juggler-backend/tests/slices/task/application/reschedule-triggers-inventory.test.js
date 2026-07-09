/**
 * R41.1–R41.5 — reschedule trigger inventory (dedicated, no DB).
 *
 * Backlog 999.730 / 999.507: the reschedule triggers (R41.1–R41.5) were tested
 * only INDIRECTLY (scattered single-command assertions + api/schedule-routes
 * route tests). No single file pins the trigger CONTRACT to its requirement IDs.
 * This is that inventory test.
 *
 * Requirements (docs/REQUIREMENTS.md):
 *   R41.1 — all scheduler triggers route through the single entry point
 *           `enqueueScheduleRun(userId, source)` with the appropriate source.
 *   R41.2 — triggers are debounced (2s window) so rapid triggers coalesce to one
 *           scheduler run. (Debounce lives in scheduleQueue.processUser; here we
 *           assert the trigger CALL is emitted per mutation — the coalescing is
 *           covered by tests/unit/scheduler/scheduleQueueRateLimit.test.js +
 *           tests/scheduleQueue.test.js. We pin the per-mutation emit shape.)
 *   R41.3 — rate limit of 10 runs/min/user (covered by
 *           tests/unit/scheduler/scheduleQueueRateLimit.test.js — NOT duplicated).
 *   R41.4 — no recursive triggering: a scheduler-adjacent side effect (the event
 *           publish) MUST NOT cause a second/cascading enqueueScheduleRun.
 *   R41.5 — non-scheduling-field updates set skipScheduler:true so the scheduler
 *           is NOT triggered (e.g. a text-only edit).
 *
 * Strategy: drive the REAL task application use-cases (CreateTask, UpdateTask,
 * DeleteTask, UpdateTaskStatus, ReEnableTask) against the REAL
 * InMemoryTaskRepository, with a SPY for the injected enqueueScheduleRun (the
 * single entry point). The spy records {userId, source, ids, options} for every
 * call — so we assert each mutation routes through it with the correct source
 * string and option flags. This is the genuine trigger surface; nothing is
 * stubbed in place of the behavior under test.
 */

'use strict';

var InMemoryTaskRepository = require('../../../../src/slices/task/adapters/InMemoryTaskRepository');
var CreateTask = require('../../../../src/slices/task/application/commands/CreateTask');
var UpdateTask = require('../../../../src/slices/task/application/commands/UpdateTask');
var DeleteTask = require('../../../../src/slices/task/application/commands/DeleteTask');
var UpdateTaskStatus = require('../../../../src/slices/task/application/commands/UpdateTaskStatus');
var ReEnableTask = require('../../../../src/slices/task/application/commands/ReEnableTask');
var H = require('./_helpers');
var { z } = require('zod');

var USER = 'r41-user';

// jug-mcp-facade telly finding jug-mcp-facade-adjacent-red-r41 (REFER->telly,
// bert-REVIEW.json): this local copy had drifted from the real enum in TWO
// ways — missing 'wip' (added) and still carrying 'missed' (removed) — see
// facade.js's statusUpdateSchema (the single real enum, ['', 'wip', 'done',
// 'cancel', 'skip', 'pause', 'disabled']). Synced to match exactly.
var statusUpdateSchema = z.object({
  status: z.enum(['', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled']),
  completedAt: z.string().optional(),
  direction: z.string().optional()
}).passthrough();

function createDeps(repo, trigger, events) {
  return H.baseDeps({
    repo: repo, cache: H.makeCacheFake(), events: events,
    enqueueScheduleRun: trigger, uuidv7: function () { return 'r41-id-1'; }
  });
}

function updateDeps(repo, trigger, events) {
  return H.baseDeps({
    repo: repo, cache: H.makeCacheFake(), events: events,
    enqueueScheduleRun: trigger, recurCleanup: function () { return Promise.resolve(); }
  });
}

function statusDeps(repo, trigger, events) {
  return H.baseDeps({
    repo: repo, cache: H.makeCacheFake(), events: events,
    enqueueScheduleRun: trigger, statusUpdateSchema: statusUpdateSchema,
    materializeRcInstance: function () { return Promise.resolve(null); },
    handleTemplatePause: function () { return Promise.resolve({ pausedCount: 0, pausedIds: [], unpausedCount: 0, unpausedIds: [] }); },
    loadMaster: function () { return Promise.resolve(null); },
    isRollingMaster: function () { return false; },
    applyRollingAnchor: function () { return Promise.resolve(); },
    loadSplitSiblings: function () { return Promise.resolve([]); },
    triggerCalSync: { sync: function () {} },
    reactivateDoneFrozen: function () { return Promise.resolve(); }
  });
}

function deleteDeps(repo, trigger) {
  return H.baseDeps({
    repo: repo, cache: H.makeCacheFake(), enqueueScheduleRun: trigger,
    loadCalSyncSettings: function () { return Promise.resolve({}); },
    findProviderLedgerRow: function () { return Promise.resolve(null); },
    // findCalLockedSeriesInstance is now a REQUIRED DeleteTask dep (bert fix
    // ernie-w2-callocked-gate-failopen-default) — supplied explicitly here.
    findCalLockedSeriesInstance: function () { return Promise.resolve(null); },
    cascadeRecurringDelete: function () { return Promise.resolve({ deletedCount: 0, keptCount: 0, pendingIds: [], keptIds: [] }); },
    standardDelete: function (ctx) { return ctx.trxRepo.deleteTaskById(ctx.id, ctx.userId); },
    thisAndFutureDelete: function () { return Promise.resolve({ deletedCount: 0 }); }
  });
}

function reEnableDeps(repo, trigger) {
  return H.baseDeps({
    repo: repo, cache: H.makeCacheFake(), enqueueScheduleRun: trigger,
    countActiveTasks: function () { return Promise.resolve(0); },
    countRecurringTemplates: function () { return Promise.resolve(0); },
    countDisabledInstances: function () { return Promise.resolve(0); }
  });
}

// ══════════════════════════════════════════════════════════════════════════
// R41.1 — every task mutation routes through enqueueScheduleRun with a source
// ══════════════════════════════════════════════════════════════════════════
describe('R41.1 — single entry point + correct source string per trigger', function () {
  test('R41.1: create task → enqueueScheduleRun(userId, "api:createTask")', function () {
    var repo = new InMemoryTaskRepository();
    var trigger = H.makeTriggerSpy();
    var uc = new CreateTask(createDeps(repo, trigger, H.makeEventsSpy()));
    return uc.execute({ userId: USER, body: { text: 'A', pri: 'P2' }, timezoneHeader: 'America/New_York' })
      .then(function () {
        expect(trigger.calls.length).toBe(1);
        expect(trigger.calls[0].userId).toBe(USER);
        expect(trigger.calls[0].source).toBe('api:createTask');
      });
  });

  test('R41.1: update task → enqueueScheduleRun(userId, "api:updateTask")', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'u1', user_id: USER, task_type: 'task', text: 'A', pri: 'P3', status: '', updated_at: new Date('2026-06-01T00:00:00Z') }
    ] });
    var trigger = H.makeTriggerSpy();
    var uc = new UpdateTask(updateDeps(repo, trigger, H.makeEventsSpy()));
    return uc.execute({ id: 'u1', userId: USER, body: { pri: 'P1' } }).then(function () {
      expect(trigger.calls.length).toBe(1);
      expect(trigger.calls[0].source).toBe('api:updateTask');
    });
  });

  test('R41.1: delete task → enqueueScheduleRun(userId, "api:deleteTask")', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'd1', user_id: USER, task_type: 'task', text: 'A', status: '', updated_at: new Date('2026-06-01T00:00:00Z') }
    ] });
    var trigger = H.makeTriggerSpy();
    var uc = new DeleteTask(deleteDeps(repo, trigger));
    return uc.execute({ id: 'd1', userId: USER, query: {} }).then(function () {
      expect(trigger.calls.length).toBe(1);
      expect(trigger.calls[0].source).toBe('api:deleteTask');
    });
  });

  test('R41.1: status change → enqueueScheduleRun(userId, "api:updateTaskStatus")', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 's1', user_id: USER, task_type: 'task', text: 'A', status: '', updated_at: new Date('2026-06-01T00:00:00Z') }
    ] });
    var trigger = H.makeTriggerSpy();
    var uc = new UpdateTaskStatus(statusDeps(repo, trigger, H.makeEventsSpy()));
    return uc.execute({ id: 's1', userId: USER, body: { status: 'wip' } }).then(function () {
      expect(trigger.calls.length).toBe(1);
      expect(trigger.calls[0].source).toBe('api:updateTaskStatus');
    });
  });

  test('R41.1: re-enable task → enqueueScheduleRun(userId, "api:reEnableTask")', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'e1', user_id: USER, task_type: 'task', text: 'A', status: 'disabled', updated_at: new Date('2026-06-01T00:00:00Z') }
    ] });
    var trigger = H.makeTriggerSpy();
    var uc = new ReEnableTask(reEnableDeps(repo, trigger));
    return uc.execute({ id: 'e1', userId: USER }).then(function () {
      expect(trigger.calls.length).toBe(1);
      expect(trigger.calls[0].source).toBe('api:reEnableTask');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// R41.2 — trigger emitted once per mutation (the burst-coalescing is in the
// queue's debounce; here we pin the per-mutation emit so coalescing has a
// well-defined input of "one trigger per mutation").
// ══════════════════════════════════════════════════════════════════════════
describe('R41.2 — exactly one trigger emitted per mutation', function () {
  test('R41.2: a single create emits exactly one trigger (not zero, not many)', function () {
    var repo = new InMemoryTaskRepository();
    var trigger = H.makeTriggerSpy();
    var uc = new CreateTask(createDeps(repo, trigger, H.makeEventsSpy()));
    return uc.execute({ userId: USER, body: { text: 'A' }, timezoneHeader: 'America/New_York' })
      .then(function () {
        expect(trigger.calls.length).toBe(1);
      });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// R41.4 — no recursion: the event publish has ZERO edge to the trigger; a
// mutation triggers exactly once and the publish does not add a second.
// ══════════════════════════════════════════════════════════════════════════
describe('R41.4 — no recursive / cascading triggers', function () {
  test('R41.4: create publishes an event but does NOT cause a second trigger', function () {
    var repo = new InMemoryTaskRepository();
    var trigger = H.makeTriggerSpy();
    var events = H.makeEventsSpy();
    var uc = new CreateTask(createDeps(repo, trigger, events));
    return uc.execute({ userId: USER, body: { text: 'A' }, timezoneHeader: 'America/New_York' })
      .then(function () {
        // event WAS published...
        expect(events.published.length).toBe(1);
        expect(events.published[0].type).toBe('created');
        // ...but the trigger fired exactly once (the publish has no scheduler edge).
        expect(trigger.calls.length).toBe(1);
      });
  });

  test('R41.4: update publishes an event but does NOT cause a second trigger', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'u1', user_id: USER, task_type: 'task', text: 'A', status: '', updated_at: new Date('2026-06-01T00:00:00Z') }
    ] });
    var trigger = H.makeTriggerSpy();
    var events = H.makeEventsSpy();
    var uc = new UpdateTask(updateDeps(repo, trigger, events));
    return uc.execute({ id: 'u1', userId: USER, body: { pri: 'P1' } }).then(function () {
      expect(events.published.length).toBe(1);
      expect(trigger.calls.length).toBe(1);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// R41.5 — non-scheduling field updates set skipScheduler:true (no reschedule)
// ══════════════════════════════════════════════════════════════════════════
describe('R41.5 — skipScheduler for non-scheduling field updates', function () {
  function seedOneOff() {
    return new InMemoryTaskRepository({ rows: [
      { id: 'u1', user_id: USER, task_type: 'task', text: 'A', pri: 'P3', status: '', updated_at: new Date('2026-06-01T00:00:00Z') }
    ] });
  }

  test('R41.5: a TEXT-ONLY update sets options.skipScheduler === true', function () {
    var repo = seedOneOff();
    var trigger = H.makeTriggerSpy();
    var uc = new UpdateTask(updateDeps(repo, trigger, H.makeEventsSpy()));
    return uc.execute({ id: 'u1', userId: USER, body: { text: 'renamed' } }).then(function () {
      expect(trigger.calls.length).toBe(1);
      expect(trigger.calls[0].source).toBe('api:updateTask');
      // text is a NON_SCHEDULING_FIELD → hasSchedulingFields(row)===false →
      // the trigger is emitted (for SSE/broadcast) but skipScheduler suppresses
      // the actual scheduler run.
      expect(trigger.calls[0].options.skipScheduler).toBe(true);
    });
  });

  test('R41.5: a SCHEDULING-field update (pri) sets options.skipScheduler === false', function () {
    var repo = seedOneOff();
    var trigger = H.makeTriggerSpy();
    var uc = new UpdateTask(updateDeps(repo, trigger, H.makeEventsSpy()));
    return uc.execute({ id: 'u1', userId: USER, body: { pri: 'P1' } }).then(function () {
      expect(trigger.calls.length).toBe(1);
      expect(trigger.calls[0].options.skipScheduler).toBe(false);
    });
  });

  test('R41.5: a duration (scheduling) update sets options.skipScheduler === false', function () {
    var repo = seedOneOff();
    var trigger = H.makeTriggerSpy();
    var uc = new UpdateTask(updateDeps(repo, trigger, H.makeEventsSpy()));
    return uc.execute({ id: 'u1', userId: USER, body: { dur: 90 } }).then(function () {
      expect(trigger.calls.length).toBe(1);
      expect(trigger.calls[0].options.skipScheduler).toBe(false);
    });
  });
});
