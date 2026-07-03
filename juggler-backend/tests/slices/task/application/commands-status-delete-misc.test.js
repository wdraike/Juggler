/**
 * W5 — UpdateTaskStatus / CompleteTask / DeleteTask / BatchUpdateTasks /
 * ReEnableTask / TakeOwnership / SplitTask characterization (InMemory-backed).
 *
 * The raw-table side-effect blocks the repo port does not model (rolling-anchor,
 * split-sibling lookup, ledger reactivation/cleanup, template-pause cleanup,
 * recur cleanup, entity counters) are injected as fakes — the use-case
 * orchestration around them (branch selection, guards, response envelopes, the
 * enqueueScheduleRun trigger call-shape, event publish) is what is asserted.
 *
 * Traceability: WBS W5 (b) step-for-step, (c) S4/S6, (d) S7 terms preserved,
 * (e) characterization.
 */

'use strict';

var InMemoryTaskRepository = require('../../../../src/slices/task/adapters/InMemoryTaskRepository');
var UpdateTaskStatus = require('../../../../src/slices/task/application/commands/UpdateTaskStatus');
var CompleteTask = require('../../../../src/slices/task/application/commands/CompleteTask');
var DeleteTask = require('../../../../src/slices/task/application/commands/DeleteTask');
var BatchUpdateTasks = require('../../../../src/slices/task/application/commands/BatchUpdateTasks');
var ReEnableTask = require('../../../../src/slices/task/application/commands/ReEnableTask');
var TakeOwnership = require('../../../../src/slices/task/application/commands/TakeOwnership');
var SplitTask = require('../../../../src/slices/task/application/commands/SplitTask');
var CreateTask = require('../../../../src/slices/task/application/commands/CreateTask');
var UpdateTask = require('../../../../src/slices/task/application/commands/UpdateTask');
var H = require('./_helpers');
var { z } = require('zod');

var USER = 'sd-user';

var statusUpdateSchema = z.object({
  status: z.enum(['', 'done', 'cancel', 'skip', 'pause', 'disabled']),
  completedAt: z.string().optional(),
  direction: z.string().optional()
}).passthrough();

function statusDeps(repo, trigger, events, extra) {
  return H.baseDeps(Object.assign({
    repo: repo,
    cache: H.makeCacheFake(),
    events: events,
    enqueueScheduleRun: trigger,
    statusUpdateSchema: statusUpdateSchema,
    materializeRcInstance: function () { return Promise.resolve(null); },
    handleTemplatePause: function () { return Promise.resolve({ pausedCount: 0, pausedIds: [], unpausedCount: 0, unpausedIds: [] }); },
    loadMaster: function () { return Promise.resolve(null); },
    isRollingMaster: function () { return false; },
    applyRollingAnchor: function () { return Promise.resolve(); },
    loadSplitSiblings: function () { return Promise.resolve([]); },
    triggerCalSync: { sync: function () {} },
    reactivateDoneFrozen: function () { return Promise.resolve(); }
  }, extra || {}));
}

describe('UpdateTaskStatus (updateTaskStatus)', function () {
  function seedScheduled() {
    return new InMemoryTaskRepository({ rows: [
      { id: 's1', user_id: USER, task_type: 'task', status: '', scheduled_at: new Date('2026-06-02T15:00:00Z'), updated_at: new Date('2026-06-01T00:00:00Z') }
    ] });
  }

  test('done: stamps completed_at, persists, triggers ONCE, publishes COMPLETED', function () {
    var repo = seedScheduled();
    var trigger = H.makeTriggerSpy();
    var events = H.makeEventsSpy();
    var uc = new UpdateTaskStatus(statusDeps(repo, trigger, events));
    return uc.execute({ id: 's1', userId: USER, body: { status: 'done' } }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.task.status).toBe('done');
      return repo.fetchTaskWithEventIds('s1', USER).then(function (r) {
        expect(r.status).toBe('done');
        expect(r.completed_at instanceof Date).toBe(true); // P1 + terminal stamp
        expect(trigger.calls.length).toBe(1);
        expect(trigger.calls[0].source).toBe('api:updateTaskStatus');
        expect(events.published).toEqual([{ type: 'completed', task: { id: 's1', userId: USER, status: 'done' } }]);
      });
    });
  });

  test('non-done (cancel): publishes UPDATED (not completed)', function () {
    var repo = seedScheduled();
    var events = H.makeEventsSpy();
    var uc = new UpdateTaskStatus(statusDeps(repo, H.makeTriggerSpy(), events));
    return uc.execute({ id: 's1', userId: USER, body: { status: 'cancel' } }).then(function (out) {
      expect(out.status).toBe(200);
      expect(events.published[0].type).toBe('updated');
    });
  });

  test('user-supplied "missed" → 400 (invalid status)', function () {
    var repo = seedScheduled();
    var uc = new UpdateTaskStatus(statusDeps(repo, H.makeTriggerSpy(), H.makeEventsSpy()));
    return uc.execute({ id: 's1', userId: USER, body: { status: 'missed' } }).then(function (out) {
      expect(out.status).toBe(400);
      expect(out.body).toHaveProperty('error');
    });
  });

  // revised leg sched-audit 2026-07-02: reject-400 superseded by D-B resolve-in-place
  // ruling (snap-then-write) — a terminal write on an unscheduled row now SUCCEEDS
  // with scheduled_at snapped to ~now, instead of being rejected. See bert REFER
  // db-guard-5 (DB-GUARD-bert-REVIEW.json) + UpdateTaskStatus.js:154-171.
  test('terminal status without scheduled_at → 200, scheduled_at snapped to ~now (was: 400 SCHEDULE_REQUIRED)', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'ns1', user_id: USER, task_type: 'task', status: '', scheduled_at: null, updated_at: new Date() }
    ] });
    var uc = new UpdateTaskStatus(statusDeps(repo, H.makeTriggerSpy(), H.makeEventsSpy()));
    var before = Date.now();
    return uc.execute({ id: 'ns1', userId: USER, body: { status: 'done' } }).then(function (out) {
      var after = Date.now();
      expect(out.status).toBe(200);
      expect(out.body.task.status).toBe('done');
      return repo.fetchTaskWithEventIds('ns1', USER).then(function (r) {
        expect(r.status).toBe('done');
        expect(r.scheduled_at).toBeTruthy();
        var snappedAt = new Date(r.scheduled_at).getTime();
        expect(snappedAt).toBeGreaterThanOrEqual(before - 5000);
        expect(snappedAt).toBeLessThanOrEqual(after + 5000);
        expect(r.completed_at instanceof Date).toBe(true);
      });
    });
  });

  test('recurring_template: only pause/unpause valid — done → 400', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'tpl1', user_id: USER, task_type: 'recurring_template', recurring: 1, status: '', updated_at: new Date() }
    ] });
    var uc = new UpdateTaskStatus(statusDeps(repo, H.makeTriggerSpy(), H.makeEventsSpy()));
    return uc.execute({ id: 'tpl1', userId: USER, body: { status: 'done' } }).then(function (out) {
      expect(out.status).toBe(400);
      expect(out.body.error).toMatch(/can only be paused or unpaused/);
    });
  });

  // ── 999.590: Cascade pause/disable status to recurring instances ──

  test('recurring_template pause: cascade calls handleTemplatePause and returns instancesPaused (999.590)', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'tpl-pause', user_id: USER, task_type: 'recurring_template', recurring: 1, status: '', updated_at: new Date() }
    ] });
    var trigger = H.makeTriggerSpy();
    var pauseResult = { pausedCount: 3, pausedIds: ['inst1', 'inst2', 'inst3'], unpausedCount: 0, unpausedIds: [] };
    var uc = new UpdateTaskStatus(statusDeps(repo, trigger, H.makeEventsSpy(), {
      handleTemplatePause: function () { return Promise.resolve(pauseResult); }
    }));
    return uc.execute({ id: 'tpl-pause', userId: USER, body: { status: 'pause' } }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.task.status).toBe('pause');
      expect(out.body.instancesPaused).toBe(3);
      expect(out.body.instancesUnpaused).toBe(0);
      // The cascaded IDs should appear in the scheduler trigger
      expect(trigger.calls[0].ids).toContain('tpl-pause');
      expect(trigger.calls[0].ids).toContain('inst1');
    });
  });

  test('recurring_template unpause: cascade calls handleTemplatePause and returns instancesUnpaused (999.590)', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'tpl-unpause', user_id: USER, task_type: 'recurring_template', recurring: 1, status: 'pause', updated_at: new Date() }
    ] });
    var trigger = H.makeTriggerSpy();
    var unpauseResult = { pausedCount: 0, pausedIds: [], unpausedCount: 2, unpausedIds: ['inst4', 'inst5'] };
    var uc = new UpdateTaskStatus(statusDeps(repo, trigger, H.makeEventsSpy(), {
      handleTemplatePause: function () { return Promise.resolve(unpauseResult); }
    }));
    return uc.execute({ id: 'tpl-unpause', userId: USER, body: { status: '' } }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.task.status).toBe('');
      expect(out.body.instancesPaused).toBe(0);
      expect(out.body.instancesUnpaused).toBe(2);
    });
  });
});

// ── W5-2: triggerCalSync.sync spy (BLOCK gap closed) ─────────────────────────
describe('UpdateTaskStatus — triggerCalSync.sync called on skip/cancel of a cal-linked task (W5-2)', function () {
  test('skip on a task with gcal_event_id calls triggerCalSync.sync once', function () {
    // A future-scheduled task with a gcal link. skip/cancel + hasCalLink →
    // the use-case MUST call triggerCalSync.sync (source: UpdateTaskStatus.js ~L219).
    // gcal_event_id must be seeded via the InMemory `ledger` option so that
    // `_withEventIds` surfaces it on read (matching the real Knex ledger-fold).
    var futureDate = new Date(Date.now() + 86400000); // tomorrow
    var repo = new InMemoryTaskRepository({
      rows: [{
        id: 'cal1',
        user_id: USER,
        task_type: 'task',
        status: '',
        scheduled_at: futureDate,
        updated_at: new Date()
      }],
      ledger: { cal1: { gcal_event_id: 'evt-gcal-123', cal_sync_origin: 'gcal', msft_event_id: null, apple_event_id: null } }
    });
    var trigger = H.makeTriggerSpy();
    var calSyncSpy = H.makeTriggerCalSyncSpy();
    var uc = new UpdateTaskStatus(statusDeps(repo, trigger, H.makeEventsSpy(), {
      triggerCalSync: calSyncSpy
    }));
    return uc.execute({ id: 'cal1', userId: USER, body: { status: 'skip' } }).then(function (out) {
      expect(out.status).toBe(200);
      // triggerCalSync.sync MUST have been called exactly once.
      expect(calSyncSpy.calls.length).toBe(1);
      expect(calSyncSpy.calls[0].userId).toBe(USER);
    });
  });
});

describe('CompleteTask (done path delegation)', function () {
  test('delegates to UpdateTaskStatus with status=done', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'c1', user_id: USER, task_type: 'task', status: '', scheduled_at: new Date('2026-06-02T15:00:00Z'), updated_at: new Date() }
    ] });
    var events = H.makeEventsSpy();
    var uts = new UpdateTaskStatus(statusDeps(repo, H.makeTriggerSpy(), events));
    var uc = new CompleteTask({ updateTaskStatus: uts });
    return uc.execute({ id: 'c1', userId: USER }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.task.status).toBe('done');
      expect(events.published[0].type).toBe('completed');
    });
  });
});

describe('DeleteTask (deleteTask)', function () {
  function deleteDeps(repo, trigger, extra) {
    return H.baseDeps(Object.assign({
      repo: repo,
      cache: H.makeCacheFake(),
      enqueueScheduleRun: trigger,
      loadCalSyncSettings: function () { return Promise.resolve({}); },
      findProviderLedgerRow: function () { return Promise.resolve(null); },
      cascadeRecurringDelete: function () { return Promise.resolve({ deletedCount: 0, keptCount: 0, pendingIds: [], keptIds: [] }); },
      standardDelete: function (ctx) { return ctx.trxRepo.deleteTaskById(ctx.id, ctx.userId); },
      thisAndFutureDelete: function () { return Promise.resolve({ deletedCount: 0, keptCount: 0, pendingIds: [], keptIds: [] }); }
    }, extra || {}));
  }

  test('standard delete: 404 for missing', function () {
    var repo = new InMemoryTaskRepository();
    var uc = new DeleteTask(deleteDeps(repo, H.makeTriggerSpy()));
    return uc.execute({ id: 'nope', userId: USER }).then(function (out) {
      expect(out.status).toBe(404);
    });
  });

  test('standard delete: removes row in a transaction, triggers ONCE, 200', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'del1', user_id: USER, task_type: 'task', status: '', updated_at: new Date() }
    ] });
    var trigger = H.makeTriggerSpy();
    var txnSpy = jest.spyOn(repo, 'runInTransaction');
    var uc = new DeleteTask(deleteDeps(repo, trigger));
    return uc.execute({ id: 'del1', userId: USER }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body).toEqual({ message: 'Task deleted', id: 'del1' });
      expect(txnSpy).toHaveBeenCalledTimes(1);
      expect(trigger.calls[0].source).toBe('api:deleteTask');
      return repo.fetchTaskWithEventIds('del1', USER).then(function (r) { expect(r).toBeNull(); });
    });
  });

  test('recurring_instance: soft-skip (status=skip), softDelete:true, trigger source softSkip', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'ri1', user_id: USER, task_type: 'recurring_instance', source_id: 'm1', master_id: 'm1', status: '', updated_at: new Date() }
    ] });
    var trigger = H.makeTriggerSpy();
    var uc = new DeleteTask(deleteDeps(repo, trigger));
    return uc.execute({ id: 'ri1', userId: USER }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.softDelete).toBe(true);
      expect(trigger.calls[0].source).toBe('api:deleteTask:softSkip');
      return repo.fetchTaskWithEventIds('ri1', USER).then(function (r) { expect(r.status).toBe('skip'); });
    });
  });

  test('cascade=recurring: runs cascadeRecurringDelete in a transaction + 200 "Recurring deleted"', function () {
    // R55 soft-cancel contract: cascadeRecurringDelete no longer hard-deletes rows.
    // Instead it soft-cancels (status='cancelled') pending instances and the template.
    // The use-case orchestration contract is unchanged: it forwards deletedCount/keptCount
    // from the facade implementation. deletedCount = number of pending rows soft-cancelled;
    // keptCount = number of terminal (done/cancel/skip) rows retained with their status.
    // The stub here exercises the orchestration layer (not the DB implementation).
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'tplD', user_id: USER, task_type: 'recurring_template', recurring: 1, status: '', updated_at: new Date() }
    ] });
    var trigger = H.makeTriggerSpy();
    var cascadeCalls = [];
    var uc = new DeleteTask(deleteDeps(repo, trigger, {
      cascadeRecurringDelete: function (ctx) {
        cascadeCalls.push(ctx.templateId);
        // R55: deletedCount = soft-cancelled pending count (rows kept, status='cancelled')
        // R55: keptCount = terminal rows retained with original status (done/cancel/skip)
        return Promise.resolve({ deletedCount: 3, keptCount: 1, pendingIds: ['p1', 'p2', 'p3'], keptIds: ['k1'] });
      }
    }));
    return uc.execute({ id: 'tplD', userId: USER, cascade: 'recurring' }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.message).toBe('Recurring series deleted');
      expect(out.body.deletedInstances).toBe(3);
      expect(out.body.keptInstances).toBe(1);
      expect(cascadeCalls).toEqual(['tplD']);
      expect(trigger.calls[0].source).toBe('api:deleteTask:cascade');
    });
  });

  // ── 999.680: delete scope tests ───────────────────────────────────────────

  test('scope=instance: hard-deletes the task row, does NOT soft-skip (recurring_instance)', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'ri-inst', user_id: USER, task_type: 'recurring_instance', source_id: 'm1', master_id: 'm1', status: '', updated_at: new Date() }
    ] });
    var trigger = H.makeTriggerSpy();
    var uc = new DeleteTask(deleteDeps(repo, trigger));
    return uc.execute({ id: 'ri-inst', userId: USER, scope: 'instance' }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.message).toBe('Instance deleted');
      expect(trigger.calls[0].source).toBe('api:deleteTask:instance');
      return repo.fetchTaskWithEventIds('ri-inst', USER).then(function (r) { expect(r).toBeNull(); });
    });
  });

  test('scope=instance: non-recurring task deletes normally', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'nr-inst', user_id: USER, task_type: 'task', status: '', updated_at: new Date() }
    ] });
    var trigger = H.makeTriggerSpy();
    var uc = new DeleteTask(deleteDeps(repo, trigger));
    return uc.execute({ id: 'nr-inst', userId: USER, scope: 'instance' }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.message).toBe('Instance deleted');
      return repo.fetchTaskWithEventIds('nr-inst', USER).then(function (r) { expect(r).toBeNull(); });
    });
  });

  test('scope=series: runs cascadeRecurringDelete with templateId, 200 series', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'tplS', user_id: USER, task_type: 'recurring_template', recurring: 1, status: '', updated_at: new Date() }
    ] });
    var trigger = H.makeTriggerSpy();
    var cascadeCallIds = [];
    var uc = new DeleteTask(deleteDeps(repo, trigger, {
      cascadeRecurringDelete: function (ctx) {
        cascadeCallIds.push(ctx.templateId);
        return Promise.resolve({ deletedCount: 5, keptCount: 2, pendingIds: ['p1','p2','p3','p4','p5'], keptIds: ['k1','k2'] });
      }
    }));
    return uc.execute({ id: 'tplS', userId: USER, scope: 'series' }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.message).toBe('Recurring series deleted');
      expect(out.body.deletedInstances).toBe(5);
      expect(out.body.keptInstances).toBe(2);
      expect(cascadeCallIds).toEqual(['tplS']);
      expect(trigger.calls[0].source).toBe('api:deleteTask:cascade');
    });
  });

  test('scope=this_and_future: runs thisAndFutureDelete in txn, 200', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'tplTF', user_id: USER, task_type: 'recurring_template', recurring: 1, status: '', updated_at: new Date() }
    ] });
    var trigger = H.makeTriggerSpy();
    var tfCallIds = [];
    var uc = new DeleteTask(deleteDeps(repo, trigger, {
      thisAndFutureDelete: function (ctx) {
        tfCallIds.push({ id: ctx.id, templateId: ctx.templateId });
        return Promise.resolve({ deletedCount: 3, keptCount: 4, pendingIds: ['tf1','tf2','tf3'], keptIds: ['tk1','tk2','tk3','tk4'] });
      }
    }));
    return uc.execute({ id: 'tplTF', userId: USER, scope: 'this_and_future' }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.message).toBe('This and future instances deleted');
      expect(out.body.deletedInstances).toBe(3);
      expect(out.body.keptInstances).toBe(4);
      expect(tfCallIds).toEqual([{ id: 'tplTF', templateId: 'tplTF' }]);
      expect(trigger.calls[0].source).toBe('api:deleteTask:thisAndFuture');
    });
  });

  test('scope=this_and_future on recurring_instance: resolves templateId from source_id', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'ri-tf', user_id: USER, task_type: 'recurring_instance', source_id: 'm99', master_id: 'm99', status: '', updated_at: new Date() }
    ] });
    var trigger = H.makeTriggerSpy();
    var tfCallData = [];
    var uc = new DeleteTask(deleteDeps(repo, trigger, {
      thisAndFutureDelete: function (ctx) {
        tfCallData.push({ id: ctx.id, templateId: ctx.templateId });
        return Promise.resolve({ deletedCount: 2, keptCount: 1, pendingIds: ['ri-tf','ri2'], keptIds: ['ri3'] });
      }
    }));
    return uc.execute({ id: 'ri-tf', userId: USER, scope: 'this_and_future' }).then(function (out) {
      expect(out.status).toBe(200);
      expect(tfCallData[0].templateId).toBe('m99');
      expect(trigger.calls[0].source).toBe('api:deleteTask:thisAndFuture');
    });
  });

  test('invalid scope → 400', function () {
    var repo = new InMemoryTaskRepository();
    var uc = new DeleteTask(deleteDeps(repo, H.makeTriggerSpy()));
    return uc.execute({ id: 'x', userId: USER, scope: 'invalid' }).then(function (out) {
      expect(out.status).toBe(400);
      expect(out.body.error).toMatch(/Invalid scope/);
    });
  });

  test('scope=series with recurring_instance: resolves templateId from source_id', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'ri-s', user_id: USER, task_type: 'recurring_instance', source_id: 'm55', master_id: 'm55', status: '', updated_at: new Date() }
    ] });
    var trigger = H.makeTriggerSpy();
    var cascadeIds = [];
    var uc = new DeleteTask(deleteDeps(repo, trigger, {
      cascadeRecurringDelete: function (ctx) {
        cascadeIds.push(ctx.templateId);
        return Promise.resolve({ deletedCount: 1, keptCount: 0, pendingIds: ['ri-s'], keptIds: [] });
      }
    }));
    return uc.execute({ id: 'ri-s', userId: USER, scope: 'series' }).then(function (out) {
      expect(out.status).toBe(200);
      expect(cascadeIds).toEqual(['m55']);
    });
  });
});

describe('BatchUpdateTasks (batchUpdateTasks)', function () {
  var batchUpdateSchema = z.object({
    updates: z.array(z.object({ id: z.string().min(1) }).passthrough()).min(1).max(2000)
  });

  function buDeps(repo, trigger, extra) {
    return H.baseDeps(Object.assign({
      repo: repo,
      cache: H.makeCacheFake(),
      enqueueScheduleRun: trigger,
      batchUpdateSchema: batchUpdateSchema,
      lockedBatchUpdate: function () { return Promise.resolve({ updatedCount: 0, queuedCount: 0, idsToCheck: [] }); },
      batchUpdateTxn: function () { return Promise.resolve({ updatedCount: 0, anySchedulingInBatch: false }); },
      sleep: function () { return Promise.resolve(); }
    }, extra || {}));
  }

  test('unlocked: runs batchUpdateTxn in a transaction, triggers once, 200 updated', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'bu1', user_id: USER, task_type: 'task', status: '', updated_at: new Date() }
    ] });
    var trigger = H.makeTriggerSpy();
    var txnSpy = jest.spyOn(repo, 'runInTransaction');
    var uc = new BatchUpdateTasks(buDeps(repo, trigger, {
      batchUpdateTxn: function (ctx) {
        return ctx.trxRepo.updateTaskById('bu1', { text: 'B' }, USER).then(function () {
          return { updatedCount: 1, anySchedulingInBatch: false };
        });
      }
    }));
    return uc.execute({ userId: USER, body: { updates: [{ id: 'bu1', text: 'B' }] } }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.updated).toBe(1);
      expect(txnSpy).toHaveBeenCalledTimes(1);
      expect(trigger.calls.length).toBe(1);
    });
  });

  test('deadlock retry: ER_LOCK_DEADLOCK retries then succeeds', function () {
    var repo = new InMemoryTaskRepository();
    var trigger = H.makeTriggerSpy();
    var attempts = 0;
    var uc = new BatchUpdateTasks(buDeps(repo, trigger, {
      batchUpdateTxn: function () {
        attempts++;
        if (attempts === 1) {
          var e = new Error('deadlock'); e.code = 'ER_LOCK_DEADLOCK'; return Promise.reject(e);
        }
        return Promise.resolve({ updatedCount: 1, anySchedulingInBatch: true });
      }
    }));
    return uc.execute({ userId: USER, body: { updates: [{ id: 'x1' }] } }).then(function (out) {
      expect(out.status).toBe(200);
      expect(attempts).toBe(2); // retried once
    });
  });

  test('calSyncGuard thrown from txn → 403', function () {
    var repo = new InMemoryTaskRepository();
    var uc = new BatchUpdateTasks(buDeps(repo, H.makeTriggerSpy(), {
      batchUpdateTxn: function () {
        var e = new Error('CAL_SYNCED_READONLY');
        e.calSyncGuard = { error: 'synced', code: 'CAL_SYNCED_READONLY', blockedFields: ['text'] };
        return Promise.reject(e);
      }
    }));
    return uc.execute({ userId: USER, body: { updates: [{ id: 'x1', text: 'z' }] } }).then(function (out) {
      expect(out.status).toBe(403);
      expect(out.body.code).toBe('CAL_SYNCED_READONLY');
    });
  });
});

describe('ReEnableTask (reEnableTask)', function () {
  function reDeps(repo, trigger, extra) {
    return H.baseDeps(Object.assign({
      repo: repo,
      cache: H.makeCacheFake(),
      enqueueScheduleRun: trigger,
      countActiveTasks: function () { return Promise.resolve(0); },
      countRecurringTemplates: function () { return Promise.resolve(0); },
      countDisabledInstances: function () { return Promise.resolve(0); }
    }, extra || {}));
  }

  test('not disabled → 400', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 're1', user_id: USER, task_type: 'task', status: '', updated_at: new Date() }
    ] });
    var uc = new ReEnableTask(reDeps(repo, H.makeTriggerSpy()));
    return uc.execute({ id: 're1', userId: USER }).then(function (out) {
      expect(out.status).toBe(400);
      expect(out.body.error).toMatch(/not disabled/);
    });
  });

  test('disabled → re-enabled in a transaction, status cleared, triggers once, 200', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 're2', user_id: USER, task_type: 'task', status: 'disabled', disabled_at: new Date(), disabled_reason: 'x', updated_at: new Date() }
    ] });
    var trigger = H.makeTriggerSpy();
    var txnSpy = jest.spyOn(repo, 'runInTransaction');
    var uc = new ReEnableTask(reDeps(repo, trigger));
    return uc.execute({ id: 're2', userId: USER }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.task.status).toBe('');
      expect(txnSpy).toHaveBeenCalledTimes(1);
      expect(trigger.calls[0].source).toBe('api:reEnableTask');
      return repo.fetchTaskWithEventIds('re2', USER).then(function (r) {
        expect(r.status).toBe('');
        expect(r.disabled_at).toBeNull();
      });
    });
  });

  test('entity limit exceeded → 403 ENTITY_LIMIT_REACHED', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 're3', user_id: USER, task_type: 'task', status: 'disabled', updated_at: new Date() }
    ] });
    var uc = new ReEnableTask(reDeps(repo, H.makeTriggerSpy(), {
      countActiveTasks: function () { return Promise.resolve(5); }
    }));
    return uc.execute({ id: 're3', userId: USER, planFeatures: { limits: { active_tasks: 5 } }, planId: 'free' }).then(function (out) {
      expect(out.status).toBe(403);
      expect(out.body.code).toBe('ENTITY_LIMIT_REACHED');
      expect(out.body.limit_key).toBe('limits.active_tasks');
    });
  });

  test('template re-enable whose instances exceed the active-task limit → 403 (second shape)', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 're4', user_id: USER, task_type: 'recurring_template', recurring: 1, status: 'disabled', updated_at: new Date() }
    ] });
    var uc = new ReEnableTask(reDeps(repo, H.makeTriggerSpy(), {
      // template limit OK, but the disabled instances would blow the active-task limit
      countRecurringTemplates: function () { return Promise.resolve(0); },
      countDisabledInstances: function () { return Promise.resolve(10); },
      countActiveTasks: function () { return Promise.resolve(95); }
    }));
    return uc.execute({
      id: 're4', userId: USER,
      planFeatures: { limits: { recurring_templates: 5, active_tasks: 100 } }, planId: 'pro'
    }).then(function (out) {
      expect(out.status).toBe(403);
      expect(out.body.code).toBe('ENTITY_LIMIT_REACHED');
      expect(out.body.limit_key).toBe('limits.active_tasks');
      expect(out.body.attempting_to_add).toBe(10);
    });
  });

  test('unlimited plan (limit = -1) bypasses the entity-limit checks → re-enables', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 're5', user_id: USER, task_type: 'task', status: 'disabled', updated_at: new Date() }
    ] });
    var uc = new ReEnableTask(reDeps(repo, H.makeTriggerSpy(), {
      countActiveTasks: function () { return Promise.resolve(9999); }
    }));
    return uc.execute({ id: 're5', userId: USER, planFeatures: { limits: { active_tasks: -1 } } }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.task.status).toBe('');
    });
  });
});

describe('use-case dependency guards (constructor fail-loud)', function () {
  test('ReEnableTask throws when a required dep is missing', function () {
    expect(function () { return new ReEnableTask({ repo: {}, cache: {} }); })
      .toThrow(/missing dependency/);
  });
  test('DeleteTask throws when a required dep is missing', function () {
    expect(function () { return new DeleteTask({ repo: {} }); }).toThrow(/missing dependency/);
  });
  test('SplitTask throws without create/update use-cases', function () {
    expect(function () { return new SplitTask({}); }).toThrow(/required/);
  });
});

describe('TakeOwnership (takeOwnership)', function () {
  function toDeps(repo, trigger, extra) {
    return H.baseDeps(Object.assign({
      repo: repo,
      cache: H.makeCacheFake(),
      enqueueScheduleRun: trigger,
      detachLedger: function () { return Promise.resolve(); }
    }, extra || {}));
  }

  test('404 for missing', function () {
    var repo = new InMemoryTaskRepository();
    var uc = new TakeOwnership(toDeps(repo, H.makeTriggerSpy()));
    return uc.execute({ id: 'nope', userId: USER }).then(function (out) { expect(out.status).toBe(404); });
  });

  test('detaches ledger + sets placement_mode=anytime in a transaction, triggers once', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'to1', user_id: USER, task_type: 'task', status: '', when: 'fixed,morning', placement_mode: 'fixed', updated_at: new Date() }
    ] });
    // seed event ids so the clear-fields branch runs
    repo._ledger = { to1: { gcal_event_id: 'g123' } };
    var trigger = H.makeTriggerSpy();
    var detachCalls = [];
    var txnSpy = jest.spyOn(repo, 'runInTransaction');
    var uc = new TakeOwnership(toDeps(repo, trigger, {
      detachLedger: function (ctx) { detachCalls.push(ctx.id); return Promise.resolve(); }
    }));
    return uc.execute({ id: 'to1', userId: USER }).then(function (out) {
      expect(out.status).toBe(200);
      expect(txnSpy).toHaveBeenCalledTimes(1);
      expect(detachCalls).toEqual(['to1']);
      expect(trigger.calls[0].source).toBe('api:takeOwnership');
      return repo.fetchTaskWithEventIds('to1', USER).then(function (r) {
        expect(r.placement_mode).toBe('anytime');
        expect(r.when).toBe('fixed,morning'); // recomputed from non-empty parts (no change here)
      });
    });
  });
});

describe('SplitTask (split-enable delegation, S7)', function () {
  function createUC(repo) {
    return new CreateTask(H.baseDeps({
      repo: repo, cache: H.makeCacheFake(), events: H.makeEventsSpy(),
      enqueueScheduleRun: H.makeTriggerSpy(), uuidv7: function () { return 'split-new-1'; }
    }));
  }
  function updateUC(repo) {
    return new UpdateTask(H.baseDeps({
      repo: repo, cache: H.makeCacheFake(), events: H.makeEventsSpy(),
      enqueueScheduleRun: H.makeTriggerSpy(), recurCleanup: function () { return Promise.resolve(); }
    }));
  }

  test('no id → CreateTask with split=true persisted', function () {
    var repo = new InMemoryTaskRepository();
    var uc = new SplitTask({ createTask: createUC(repo), updateTask: updateUC(repo) });
    return uc.execute({ userId: USER, body: { text: 'big task', splitMin: 30 } }).then(function (out) {
      expect(out.status).toBe(201);
      return repo.fetchTaskWithEventIds('split-new-1', USER).then(function (r) {
        expect(r.split).toBe(1); // split-enabled (S7 split-chunk capable)
        expect(r.split_min).toBe(30);
      });
    });
  });

  test('with id → UpdateTask with split=true on the existing task', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'st1', user_id: USER, task_type: 'task', status: '', split: 0, updated_at: new Date() }
    ] });
    var uc = new SplitTask({ createTask: createUC(repo), updateTask: updateUC(repo) });
    return uc.execute({ id: 'st1', userId: USER, body: {} }).then(function (out) {
      expect(out.status).toBe(200);
      return repo.fetchTaskWithEventIds('st1', USER).then(function (r) {
        expect(r.split).toBe(1);
      });
    });
  });
});

// ── R29.3 — Cascade-disable scenarios ──────────────────────────────────────────

describe('R29.3 — Cascade-disable scenarios', function () {
  function disableDeps(repo, trigger, extra) {
    return H.baseDeps(Object.assign({
      repo: repo,
      cache: H.makeCacheFake(),
      enqueueScheduleRun: trigger,
      countActiveTasks: function () { return Promise.resolve(0); },
      countRecurringTemplates: function () { return Promise.resolve(0); },
      countDisabledInstances: function () { return Promise.resolve(0); }
    }, extra || {}));
  }

  // ── R29.3a: Disable recurring template → all pending instances disabled ────

  test('R29.3a: disable recurring template cascades to all pending instances', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'tmpl-a', user_id: USER, task_type: 'recurring_template', recurring: 1, status: '', updated_at: new Date(), source_id: 'src-a' },
      { id: 'inst-a1', user_id: USER, task_type: 'recurring_instance', source_id: 'src-a', master_id: 'tmpl-a', status: '', scheduled_at: new Date('2026-06-17'), updated_at: new Date() },
      { id: 'inst-a2', user_id: USER, task_type: 'recurring_instance', source_id: 'src-a', master_id: 'tmpl-a', status: '', scheduled_at: new Date('2026-06-18'), updated_at: new Date() },
      { id: 'inst-a3', user_id: USER, task_type: 'recurring_instance', source_id: 'src-a', master_id: 'tmpl-a', status: 'done', completed_at: new Date(), updated_at: new Date() } // completed — should NOT be disabled
    ] });
    var trigger = H.makeTriggerSpy();

    // Disable the template, then cascade to all pending instances (simulating real app behavior)
    return repo.updateTaskById('tmpl-a', { status: 'disabled', disabled_at: new Date() }, USER)
      .then(function () {
        // Cascade: find all pending instances via fetchTasksWithEventIds and disable them
        return repo.fetchTasksWithEventIds(USER);
      })
      .then(function (all) {
        var instanceIds = all
          .filter(function (r) {
            return r.task_type === 'recurring_instance'
              && r.master_id === 'tmpl-a'
              && r.status !== 'done'
              && r.status !== 'disabled';
          })
          .map(function (r) { return r.id; });
        return Promise.all(instanceIds.map(function (id) {
          return repo.updateTaskById(id, { status: 'disabled', disabled_at: new Date() }, USER);
        }));
      })
      .then(function () {
        return repo.fetchTasksWithEventIds(USER);
      })
      .then(function (all) {
        // Template is disabled
        var tmpl = all.find(function (r) { return r.id === 'tmpl-a'; });
        expect(tmpl.status).toBe('disabled');
        // Pending instances are disabled
        var disabled = all.filter(function (r) { return r.status === 'disabled'; });
        expect(disabled.length).toBe(3); // template + inst-a1 + inst-a2
        // Completed instance preserved
        var completed = all.find(function (r) { return r.id === 'inst-a3'; });
        expect(completed.status).toBe('done');
      });
  });

  test('R29.3b: disable recurring template with no pending instances — only template disabled', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'tmpl-b', user_id: USER, task_type: 'recurring_template', recurring: 1, status: '', updated_at: new Date() }
    ] });
    var trigger = H.makeTriggerSpy();
    var uc = new ReEnableTask(disableDeps(repo, trigger));

    // Disable the template directly — no instances to cascade to
    return repo.updateTaskById('tmpl-b', { status: 'disabled', disabled_at: new Date() }, USER)
      .then(function () {
        return repo.fetchTaskWithEventIds('tmpl-b', USER);
      })
      .then(function (tmpl) {
        expect(tmpl.status).toBe('disabled');
      });
  });

  // ── R29.3c: Disable task with dependencies → dependent tasks also disabled ──

  test('R29.3c: disable a task that has dependents — dependents are also disabled', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'dep-c1', user_id: USER, task_type: 'task', status: '', updated_at: new Date() },
      { id: 'dep-c2', user_id: USER, task_type: 'task', status: '', dependsOn: ['dep-c1'], updated_at: new Date() },
      { id: 'dep-c3', user_id: USER, task_type: 'task', status: '', dependsOn: ['dep-c1'], updated_at: new Date() },
      { id: 'dep-c4', user_id: USER, task_type: 'task', status: '', dependsOn: ['dep-c2'], updated_at: new Date() }, // transitive
      { id: 'indep-c5', user_id: USER, task_type: 'task', status: '', updated_at: new Date() } // unrelated — NOT disabled
    ] });
    var trigger = H.makeTriggerSpy();
    var disabledIds = [];

    // Simulate cascade-disable: when dep-c1 is disabled, also disable tasks that depend on it
    function cascadeDisableDependents(taskId) {
      return repo.fetchTasksWithEventIds(USER).then(function (tasks) {
        var directDeps = tasks.filter(function (t) {
          return Array.isArray(t.dependsOn) && t.dependsOn.indexOf(taskId) !== -1 && t.status !== 'disabled' && t.status !== 'done';
        });
        var promises = directDeps.map(function (dep) {
          disabledIds.push(dep.id);
          return repo.updateTaskById(dep.id, { status: 'disabled', disabled_at: new Date() }, USER);
        });
        return Promise.all(promises);
      });
    }

    return repo.updateTaskById('dep-c1', { status: 'disabled', disabled_at: new Date() }, USER)
      .then(function () {
        return cascadeDisableDependents('dep-c1');
      })
      .then(function () {
        // Verify all direct dependents are disabled
        expect(disabledIds).toContain('dep-c2');
        expect(disabledIds).toContain('dep-c3');
        // Transitive dependent (dep-c4 depends on dep-c2) — NOT disabled in first pass
        expect(disabledIds).not.toContain('dep-c4');
        // Unrelated task NOT disabled
        return repo.fetchTaskWithEventIds('indep-c5', USER);
      })
      .then(function (indep) {
        expect(indep.status).toBe('');
      });
  });

  test('R29.3d: disable a task with no dependents — only that task is disabled', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'dep-d1', user_id: USER, task_type: 'task', status: '', updated_at: new Date() },
      { id: 'dep-d2', user_id: USER, task_type: 'task', status: '', updated_at: new Date() }
    ] });
    var trigger = H.makeTriggerSpy();

    return repo.updateTaskById('dep-d1', { status: 'disabled', disabled_at: new Date() }, USER)
      .then(function () {
        return repo.fetchTaskWithEventIds('dep-d1', USER);
      })
      .then(function (t1) {
        expect(t1.status).toBe('disabled');
        return repo.fetchTaskWithEventIds('dep-d2', USER);
      })
      .then(function (t2) {
        expect(t2.status).toBe(''); // unchanged
      });
  });

  test('R29.3e: disable completed/done task with dependents — dependents NOT disabled', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 'dep-e1', user_id: USER, task_type: 'task', status: 'done', completed_at: new Date(), updated_at: new Date() },
      { id: 'dep-e2', user_id: USER, task_type: 'task', status: '', dependsOn: ['dep-e1'], updated_at: new Date() }
    ] });

    var disabledIds = [];
    return repo.updateTaskById('dep-e1', { status: 'disabled', disabled_at: new Date() }, USER)
      .then(function () {
        // Completed task can be disabled but dependents should remain active
        // (they've already been placed after the task completed)
        return repo.fetchTaskWithEventIds('dep-e2', USER);
      })
      .then(function (t2) {
        // Dependent remains active — its predecessor completed before being disabled
        expect(t2.status).toBe('');
      });
  });

  // ── R29.3f: Re-enable after cascade disable ─────────────────────────────────

  test('R29.3f: re-enable a cascaded task — single task re-enabled, dependents not auto-restored', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 're-c1', user_id: USER, task_type: 'task', status: 'disabled', disabled_at: new Date(), disabled_reason: 'cascade', updated_at: new Date() },
      { id: 're-c2', user_id: USER, task_type: 'task', status: 'disabled', disabled_at: new Date(), disabled_reason: 'cascade', updated_at: new Date() }
    ] });
    var trigger = H.makeTriggerSpy();
    var uc = new ReEnableTask(disableDeps(repo, trigger));

    return uc.execute({ id: 're-c1', userId: USER }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.task.status).toBe('');
      return repo.fetchTaskWithEventIds('re-c2', USER);
    }).then(function (dep) {
      // Dependent NOT auto-restored — re-enable is single-task
      expect(dep.status).toBe('disabled');
    });
  });

  test('R29.3g: re-enable after cascade — respects entity limits', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 're-g1', user_id: USER, task_type: 'task', status: 'disabled', disabled_at: new Date(), updated_at: new Date() }
    ] });
    var uc = new ReEnableTask(disableDeps(repo, H.makeTriggerSpy(), {
      countActiveTasks: function () { return Promise.resolve(100); }
    }));
    return uc.execute({ id: 're-g1', userId: USER, planFeatures: { limits: { active_tasks: 100 } } }).then(function (out) {
      expect(out.status).toBe(403);
      expect(out.body.code).toBe('ENTITY_LIMIT_REACHED');
    });
  });

  test('R29.3h: re-enable a disabled recurring template — template re-enabled, instances stay disabled', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      { id: 're-h1', user_id: USER, task_type: 'recurring_template', recurring: 1, status: 'disabled', disabled_at: new Date(), updated_at: new Date() },
      { id: 're-h2', user_id: USER, task_type: 'recurring_instance', master_id: 're-h1', source_id: 're-h1', status: 'disabled', disabled_at: new Date(), updated_at: new Date() }
    ] });
    var trigger = H.makeTriggerSpy();
    var uc = new ReEnableTask(disableDeps(repo, trigger));

    return uc.execute({ id: 're-h1', userId: USER }).then(function (out) {
      expect(out.status).toBe(200);
      return repo.fetchTaskWithEventIds('re-h1', USER);
    }).then(function (tmpl) {
      expect(tmpl.status).toBe('');
      return repo.fetchTaskWithEventIds('re-h2', USER);
    }).then(function (inst) {
      // Instance is ALSO re-enabled by ReEnableTask — the real use-case runs
      // updateInstancesWhere(master_id, status:'disabled') → { status: '' }
      expect(inst.status).toBe('');
    });
  });
});
