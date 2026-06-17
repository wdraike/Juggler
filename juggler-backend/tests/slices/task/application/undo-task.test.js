/**
 * W5 — UndoTask + RecordAction characterization (InMemory-backed) (999.681).
 *
 * Tests the undo feature end-to-end using InMemoryTaskRepository and
 * InMemoryActionLogRepository. Exercises:
 *   - RecordAction: status_change, field_update, delete logging
 *   - UndoTask: status_change undo, field_update undo, delete undo
 *   - Edge cases: no action log, stale action, conflict detection, missing task
 */

'use strict';

var InMemoryTaskRepository = require('../../../../src/slices/task/adapters/InMemoryTaskRepository');
var InMemoryActionLogRepository = require('../../../../src/slices/task/adapters/InMemoryActionLogRepository');
var UndoTask = require('../../../../src/slices/task/application/commands/UndoTask');
var RecordAction = require('../../../../src/slices/task/application/commands/RecordAction');
var H = require('./_helpers');
var { isTerminalStatus } = require('../../../../src/lib/task-status');

var USER = 'sd-user';

// ── helper: create a standard UndoTask instance ──────────────────────────────
function makeUndoTask(repo, actionLog, trigger, events, extra) {
  return new UndoTask(Object.assign({
    actionLog: actionLog,
    repo: repo,
    cache: H.makeCacheFake(),
    enqueueScheduleRun: trigger,
    mappers: H.mappers,
    isTerminalStatus: isTerminalStatus
  }, extra || {}));
}

// ── helper: create a standard RecordAction instance ──────────────────────────
function makeRecordAction(actionLog) {
  return new RecordAction({
    actionLog: actionLog,
    uuidv7: function () { return 'undo-' + Math.random().toString(36).slice(2, 10); }
  });
}

// ── helper: seed a scheduled task ─────────────────────────────────────────────
function seedScheduledTask(overrides) {
  return Object.assign({
    id: 't1',
    user_id: USER,
    task_type: 'task',
    status: '',
    scheduled_at: new Date('2026-06-02T15:00:00Z'),
    updated_at: new Date('2026-06-01T00:00:00Z'),
    dur: 30
  }, overrides || {});
}

// ═══════════════════════════════════════════════════════════════════════════════
// RecordAction tests
// ═══════════════════════════════════════════════════════════════════════════════
describe('RecordAction (999.681)', function () {
  test('records a status_change action log entry', function () {
    var actionLog = new InMemoryActionLogRepository();
    var recorder = makeRecordAction(actionLog);
    return recorder.execute({
      taskId: 't1',
      userId: USER,
      actionType: 'status_change',
      before: { status: '' },
      after: { status: 'done' }
    }).then(function () {
      return actionLog.findLatest('t1', USER);
    }).then(function (entry) {
      expect(entry).not.toBeNull();
      expect(entry.action_type).toBe('status_change');
      expect(entry.before.status).toBe('');
      expect(entry.after.status).toBe('done');
    });
  });

  test('replaces previous entry for the same task (single-undo semantics)', function () {
    var actionLog = new InMemoryActionLogRepository();
    var recorder = makeRecordAction(actionLog);
    return recorder.execute({
      taskId: 't1',
      userId: USER,
      actionType: 'status_change',
      before: { status: '' },
      after: { status: 'wip' }
    }).then(function () {
      return recorder.execute({
        taskId: 't1',
        userId: USER,
        actionType: 'status_change',
        before: { status: 'wip' },
        after: { status: 'done' }
      });
    }).then(function () {
      return actionLog.findLatest('t1', USER);
    }).then(function (entry) {
      // Only the latest action should be stored
      expect(entry.before.status).toBe('wip');
      expect(entry.after.status).toBe('done');
    });
  });

  test('keeps separate entries for different tasks', function () {
    var actionLog = new InMemoryActionLogRepository();
    var recorder = makeRecordAction(actionLog);
    return recorder.execute({
      taskId: 't1',
      userId: USER,
      actionType: 'status_change',
      before: { status: '' },
      after: { status: 'done' }
    }).then(function () {
      return recorder.execute({
        taskId: 't2',
        userId: USER,
        actionType: 'field_update',
        before: { text: 'old' },
        after: { text: 'new' }
      });
    }).then(function () {
      return actionLog.findLatest('t1', USER);
    }).then(function (entry1) {
      expect(entry1.action_type).toBe('status_change');
      return actionLog.findLatest('t2', USER);
    }).then(function (entry2) {
      expect(entry2.action_type).toBe('field_update');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UndoTask — status_change undo tests
// ═══════════════════════════════════════════════════════════════════════════════
describe('UndoTask — status_change undo (999.681)', function () {
  test('undoes todo → done: restores previous status and clears completed_at', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      seedScheduledTask({ id: 's1', status: 'done', completed_at: new Date('2026-06-03T10:00:00Z') })
    ]});
    var actionLog = new InMemoryActionLogRepository();
    var trigger = H.makeTriggerSpy();
    var recorder = makeRecordAction(actionLog);
    var undoer = makeUndoTask(repo, actionLog, trigger);

    // Log: status was '' (todo), changed to 'done'
    return recorder.execute({
      taskId: 's1', userId: USER, actionType: 'status_change',
      before: { status: '', completed_at: null },
      after: { status: 'done' }
    }).then(function () {
      return undoer.execute({ id: 's1', userId: USER });
    }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.task.status).toBe('');
      expect(out.body.undoneAction).toBe('status_change');
      return repo.fetchTaskWithEventIds('s1', USER);
    }).then(function (row) {
      expect(row.status).toBe('');
      expect(row.completed_at).toBeNull();
      expect(trigger.calls.length).toBe(1);
      expect(trigger.calls[0].source).toBe('api:undoTask');
    });
  });

  test('undoes todo → wip: restores previous status and time_remaining', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      seedScheduledTask({ id: 'w1', status: 'wip', time_remaining: 45 })
    ]});
    var actionLog = new InMemoryActionLogRepository();
    var trigger = H.makeTriggerSpy();
    var recorder = makeRecordAction(actionLog);
    var undoer = makeUndoTask(repo, actionLog, trigger);

    // Log: status was '' (todo), changed to 'wip' (time_remaining was null → 45)
    return recorder.execute({
      taskId: 'w1', userId: USER, actionType: 'status_change',
      before: { status: '', time_remaining: null },
      after: { status: 'wip', time_remaining: 45 }
    }).then(function () {
      return undoer.execute({ id: 'w1', userId: USER });
    }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.task.status).toBe('');
      return repo.fetchTaskWithEventIds('w1', USER);
    }).then(function (row) {
      expect(row.status).toBe('');
      expect(row.time_remaining).toBeNull();
    });
  });

  test('undoes done → wip (reactivation): restores status and completed_at', function () {
    var var_repo = new InMemoryTaskRepository({ rows: [
      seedScheduledTask({ id: 'r1', status: 'wip', completed_at: null })
    ]});
    var actionLog = new InMemoryActionLogRepository();
    var trigger = H.makeTriggerSpy();
    var recorder = makeRecordAction(actionLog);
    var undoer = makeUndoTask(var_repo, actionLog, trigger);

    // Log: status was 'done' (with completed_at), changed to 'wip'
    return recorder.execute({
      taskId: 'r1', userId: USER, actionType: 'status_change',
      before: { status: 'done', completed_at: new Date('2026-06-02T16:00:00Z') },
      after: { status: 'wip' }
    }).then(function () {
      return undoer.execute({ id: 'r1', userId: USER });
    }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.task.status).toBe('done');
      return var_repo.fetchTaskWithEventIds('r1', USER);
    }).then(function (row) {
      expect(row.status).toBe('done');
      // completed_at restored from before snapshot
      expect(row.completed_at).not.toBeNull();
    });
  });

  test('removes action log entry after successful undo (single-undo)', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      seedScheduledTask({ id: 's2', status: 'done', completed_at: new Date() })
    ]});
    var actionLog = new InMemoryActionLogRepository();
    var trigger = H.makeTriggerSpy();
    var recorder = makeRecordAction(actionLog);
    var undoer = makeUndoTask(repo, actionLog, trigger);

    return recorder.execute({
      taskId: 's2', userId: USER, actionType: 'status_change',
      before: { status: '' }, after: { status: 'done' }
    }).then(function () {
      return undoer.execute({ id: 's2', userId: USER });
    }).then(function () {
      return actionLog.findLatest('s2', USER);
    }).then(function (entry) {
      expect(entry).toBeNull();
    });
  });

  test('second undo returns 404 NO_ACTION_TO_UNDO', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      seedScheduledTask({ id: 's3', status: 'done', completed_at: new Date() })
    ]});
    var actionLog = new InMemoryActionLogRepository();
    var trigger = H.makeTriggerSpy();
    var recorder = makeRecordAction(actionLog);
    var undoer = makeUndoTask(repo, actionLog, trigger);

    return recorder.execute({
      taskId: 's3', userId: USER, actionType: 'status_change',
      before: { status: '' }, after: { status: 'done' }
    }).then(function () {
      return undoer.execute({ id: 's3', userId: USER });
    }).then(function (first) {
      expect(first.status).toBe(200);
      return undoer.execute({ id: 's3', userId: USER });
    }).then(function (second) {
      expect(second.status).toBe(404);
      expect(second.body.code).toBe('NO_ACTION_TO_UNDO');
    });
  });

  test('conflict: rejects undo if task status has changed since logged action', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      seedScheduledTask({ id: 'c1', status: 'cancel' })
    ]});
    var actionLog = new InMemoryActionLogRepository();
    var trigger = H.makeTriggerSpy();
    var recorder = makeRecordAction(actionLog);
    var undoer = makeUndoTask(repo, actionLog, trigger);

    // Log says after was 'done' but task is actually 'cancel' — conflict
    return recorder.execute({
      taskId: 'c1', userId: USER, actionType: 'status_change',
      before: { status: '' }, after: { status: 'done' }
    }).then(function () {
      return undoer.execute({ id: 'c1', userId: USER });
    }).then(function (out) {
      expect(out.status).toBe(409);
      expect(out.body.code).toBe('CONFLICT');
    });
  });

  test('returns 410 if task was deleted after the action was logged', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      seedScheduledTask({ id: 'g1', status: 'done' })
    ]});
    var actionLog = new InMemoryActionLogRepository();
    var trigger = H.makeTriggerSpy();
    var recorder = makeRecordAction(actionLog);
    var undoer = makeUndoTask(repo, actionLog, trigger);

    return recorder.execute({
      taskId: 'g1', userId: USER, actionType: 'status_change',
      before: { status: '' }, after: { status: 'done' }
    }).then(function () {
      // Simulate the task being deleted after the action was logged
      return repo.deleteTaskById('g1', USER);
    }).then(function () {
      return undoer.execute({ id: 'g1', userId: USER });
    }).then(function (out) {
      expect(out.status).toBe(410);
      expect(out.body.code).toBe('TASK_GONE');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UndoTask — field_update undo tests
// ═══════════════════════════════════════════════════════════════════════════════
describe('UndoTask — field_update undo (999.681)', function () {
  test('undoes a text change: restores previous text', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      seedScheduledTask({ id: 'f1', text: 'new text' })
    ]});
    var actionLog = new InMemoryActionLogRepository();
    var trigger = H.makeTriggerSpy();
    var recorder = makeRecordAction(actionLog);
    var undoer = makeUndoTask(repo, actionLog, trigger);

    return recorder.execute({
      taskId: 'f1', userId: USER, actionType: 'field_update',
      before: { text: 'old text' },
      after: { text: 'new text' }
    }).then(function () {
      return undoer.execute({ id: 'f1', userId: USER });
    }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.undoneAction).toBe('field_update');
      return repo.fetchTaskWithEventIds('f1', USER);
    }).then(function (row) {
      expect(row.text).toBe('old text');
    });
  });

  test('undoes multiple field changes: restores all before values', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      seedScheduledTask({ id: 'f2', text: 'new text', pri: 'P1', project: 'new-project' })
    ]});
    var actionLog = new InMemoryActionLogRepository();
    var trigger = H.makeTriggerSpy();
    var recorder = makeRecordAction(actionLog);
    var undoer = makeUndoTask(repo, actionLog, trigger);

    return recorder.execute({
      taskId: 'f2', userId: USER, actionType: 'field_update',
      before: { text: 'old text', pri: 'P3', project: 'old-project' },
      after: { text: 'new text', pri: 'P1', project: 'new-project' }
    }).then(function () {
      return undoer.execute({ id: 'f2', userId: USER });
    }).then(function (out) {
      expect(out.status).toBe(200);
      return repo.fetchTaskWithEventIds('f2', USER);
    }).then(function (row) {
      expect(row.text).toBe('old text');
      expect(row.pri).toBe('P3');
      expect(row.project).toBe('old-project');
    });
  });

  test('does not restore immutable fields (id, user_id, created_at)', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      seedScheduledTask({ id: 'f3', text: 'current' })
    ]});
    var actionLog = new InMemoryActionLogRepository();
    var trigger = H.makeTriggerSpy();
    var recorder = makeRecordAction(actionLog);
    var undoer = makeUndoTask(repo, actionLog, trigger);

    // before snapshot includes id and user_id (which shouldn't be restored)
    return recorder.execute({
      taskId: 'f3', userId: USER, actionType: 'field_update',
      before: { text: 'original', id: 'f3', user_id: USER, created_at: new Date('2020-01-01') },
      after: { text: 'current' }
    }).then(function () {
      return undoer.execute({ id: 'f3', userId: USER });
    }).then(function (out) {
      expect(out.status).toBe(200);
      return repo.fetchTaskWithEventIds('f3', USER);
    }).then(function (row) {
      expect(row.text).toBe('original');
      // id and user_id should remain unchanged
      expect(row.id).toBe('f3');
      expect(row.user_id).toBe(USER);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UndoTask — delete undo tests
// ═══════════════════════════════════════════════════════════════════════════════
describe('UndoTask — delete undo (999.681)', function () {
  test('undoes a delete: re-creates the task from the before snapshot', function () {
    var taskData = seedScheduledTask({ id: 'd1', text: 'important task', pri: 'P2', status: '', dur: 60 });
    var repo = new InMemoryTaskRepository({ rows: [taskData] });
    var actionLog = new InMemoryActionLogRepository();
    var trigger = H.makeTriggerSpy();
    var recorder = makeRecordAction(actionLog);
    var undoer = makeUndoTask(repo, actionLog, trigger);

    // Log the delete with the full before snapshot
    return recorder.execute({
      taskId: 'd1', userId: USER, actionType: 'delete',
      before: { id: 'd1', user_id: USER, text: 'important task', pri: 'P2', status: '', dur: 60, scheduled_at: new Date('2026-06-02T15:00:00Z'), created_at: new Date('2026-06-01T00:00:00Z') },
      after: null
    }).then(function () {
      // Delete the task
      return repo.deleteTaskById('d1', USER);
    }).then(function () {
      // Verify it's gone
      return repo.fetchTaskWithEventIds('d1', USER);
    }).then(function (deleted) {
      expect(deleted).toBeNull();
      // Undo the delete
      return undoer.execute({ id: 'd1', userId: USER });
    }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.undoneAction).toBe('delete');
      return repo.fetchTaskWithEventIds('d1', USER);
    }).then(function (restored) {
      expect(restored).not.toBeNull();
      expect(restored.text).toBe('important task');
      expect(restored.pri).toBe('P2');
      expect(trigger.calls.length).toBe(1);
      expect(trigger.calls[0].source).toBe('api:undoTask');
    });
  });

  test('delete undo returns 409 if task already exists (stale log)', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      seedScheduledTask({ id: 'd2', text: 'still here' })
    ]});
    var actionLog = new InMemoryActionLogRepository();
    var trigger = H.makeTriggerSpy();
    var recorder = makeRecordAction(actionLog);
    var undoer = makeUndoTask(repo, actionLog, trigger);

    return recorder.execute({
      taskId: 'd2', userId: USER, actionType: 'delete',
      before: { id: 'd2', text: 'still here' }, after: null
    }).then(function () {
      // Task was NOT actually deleted — log is stale
      return undoer.execute({ id: 'd2', userId: USER });
    }).then(function (out) {
      expect(out.status).toBe(409);
      expect(out.body.code).toBe('CONFLICT');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UndoTask — edge cases
// ═══════════════════════════════════════════════════════════════════════════════
describe('UndoTask — edge cases (999.681)', function () {
  test('returns 404 when no action log entry exists', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      seedScheduledTask({ id: 'e1' })
    ]});
    var actionLog = new InMemoryActionLogRepository();
    var undoer = makeUndoTask(repo, actionLog, H.makeTriggerSpy());

    return undoer.execute({ id: 'e1', userId: USER }).then(function (out) {
      expect(out.status).toBe(404);
      expect(out.body.code).toBe('NO_ACTION_TO_UNDO');
    });
  });

  test('returns 400 for unsupported action type', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      seedScheduledTask({ id: 'e2' })
    ]});
    var actionLog = new InMemoryActionLogRepository();
    // Manually insert an action log with an unsupported type
    actionLog._store['e2:' + USER] = {
      id: 'log-1',
      user_id: USER,
      task_id: 'e2',
      action_type: 'unknown_type',
      before: { status: '' },
      after: { status: 'done' },
      created_at: new Date()
    };
    var undoer = makeUndoTask(repo, actionLog, H.makeTriggerSpy());

    return undoer.execute({ id: 'e2', userId: USER }).then(function (out) {
      expect(out.status).toBe(400);
      expect(out.body.code).toBe('UNDO_NOT_SUPPORTED');
    });
  });

  test('undoes status change for different users independently', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      seedScheduledTask({ id: 'u1', user_id: USER, status: 'done', completed_at: new Date() }),
      seedScheduledTask({ id: 'u2', user_id: 'other-user', status: '' })
    ]});
    var actionLog = new InMemoryActionLogRepository();
    var trigger = H.makeTriggerSpy();
    var recorder = makeRecordAction(actionLog);
    var undoer = makeUndoTask(repo, actionLog, trigger);

    // Log action for user1's task
    return recorder.execute({
      taskId: 'u1', userId: USER, actionType: 'status_change',
      before: { status: '' }, after: { status: 'done' }
    }).then(function () {
      // Try to undo as a different user — should get NO_ACTION_TO_UNDO
      return undoer.execute({ id: 'u1', userId: 'other-user' });
    }).then(function (out) {
      expect(out.status).toBe(404);
      expect(out.body.code).toBe('NO_ACTION_TO_UNDO');
    });
  });

  test('undoes skip → todo: restores empty status', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      seedScheduledTask({ id: 'sk1', status: 'skip' })
    ]});
    var actionLog = new InMemoryActionLogRepository();
    var trigger = H.makeTriggerSpy();
    var recorder = makeRecordAction(actionLog);
    var undoer = makeUndoTask(repo, actionLog, trigger);

    return recorder.execute({
      taskId: 'sk1', userId: USER, actionType: 'status_change',
      before: { status: '' }, after: { status: 'skip' }
    }).then(function () {
      return undoer.execute({ id: 'sk1', userId: USER });
    }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.task.status).toBe('');
      return repo.fetchTaskWithEventIds('sk1', USER);
    }).then(function (row) {
      expect(row.status).toBe('');
      expect(row.completed_at).toBeNull();
    });
  });

  test('undoes cancel → todo: restores empty status and clears completed_at', function () {
    var repo = new InMemoryTaskRepository({ rows: [
      seedScheduledTask({ id: 'cn1', status: 'cancel', completed_at: new Date() })
    ]});
    var actionLog = new InMemoryActionLogRepository();
    var trigger = H.makeTriggerSpy();
    var recorder = makeRecordAction(actionLog);
    var undoer = makeUndoTask(repo, actionLog, trigger);

    return recorder.execute({
      taskId: 'cn1', userId: USER, actionType: 'status_change',
      before: { status: '', completed_at: null }, after: { status: 'cancel' }
    }).then(function () {
      return undoer.execute({ id: 'cn1', userId: USER });
    }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.task.status).toBe('');
      return repo.fetchTaskWithEventIds('cn1', USER);
    }).then(function (row) {
      expect(row.status).toBe('');
      expect(row.completed_at).toBeNull();
    });
  });
});