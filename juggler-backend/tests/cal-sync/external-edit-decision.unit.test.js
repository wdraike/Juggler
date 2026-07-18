/**
 * external-edit-decision.unit.test.js — DB-FREE decision-table unit tests for the
 * pure `decideExternalEditSync(ctx)` use-case extracted from the "both changed —
 * conflict resolution" branch of the per-ledger loop in
 * controllers/cal-sync.controller.js (999.1025 inc. 7).
 *
 * The branch is reached only when BOTH the task changed since our last push AND
 * the event was modified externally. It decides which side wins:
 *   - fixed OR terminal task → 'push-conflict' (juggler always wins; log
 *     conflict_juggler with a fixed/terminal detail)
 *   - otherwise, event newer than task (isEventNewerThanTask) → 'pull'
 *     (the caller builds the conflict_provider log because its newValues.when
 *     depends on the freshly-built pull fields — so the pure decision returns
 *     an EMPTY logs array for pull)
 *   - otherwise (task newer / tie) → 'push' (log conflict_juggler "task is newer")
 *
 * PURE — decisions in, effects out. No DB, no HTTP, no clock: the caller keeps
 * _buildPullFields, pendingEventUpdates, taskUpdates, pStats, and the actual
 * logSyncAction effect. This test pins the ACTION + the log DESCRIPTORS
 * byte-for-byte; the DB-backed behavior stays owned by the W4 golden master.
 */

'use strict';

var { decideExternalEditSync } = require('../../src/slices/calendar/domain/external-edit-decision');

// task._updated_at reference instant (MySQL tz-less datetime form).
var TASK_UPD = '2026-06-10 00:00:00';

function makeTask(over) {
  return Object.assign({
    id: 't1', text: 'Buy groceries', status: 'active',
    placementMode: 'anytime', when: 'today', dur: 30, _updated_at: TASK_UPD
  }, over || {});
}
function makeEvent(over) {
  return Object.assign({ title: 'Groceries (edited)', durationMinutes: 45 }, over || {});
}
function makeLedger(over) {
  return Object.assign({ id: 'L1', provider_event_id: 'evt-123' }, over || {});
}
function ctx(over) {
  return Object.assign({
    task: makeTask(), event: makeEvent(), ledger: makeLedger(), pid: 'gcal',
    isTaskTerminal: false, calendarLabels: { gcal: 'Work' }
  }, over || {});
}

// ── push-conflict: fixed OR terminal task always wins ────────────────────────

describe('decideExternalEditSync — push-conflict (fixed or terminal task wins)', function () {
  it('1: FIXED task (not terminal) → action push-conflict, conflict_juggler "fixed" detail', function () {
    var d = decideExternalEditSync(ctx({
      task: makeTask({ placementMode: 'fixed' }),
      // event newer would otherwise pull — proves fixed short-circuits the tiebreaker
      event: makeEvent({ lastModified: '2026-06-10T00:00:59Z' })
    }));
    expect(d.action).toBe('push-conflict');
    expect(d.logs).toHaveLength(1);
    expect(d.logs[0].provider).toBe('gcal');
    expect(d.logs[0].action).toBe('conflict_juggler');
    expect(d.logs[0].opts.detail).toBe('Conflict: fixed task pushed over calendar edit');
    expect(d.logs[0].opts.taskId).toBe('t1');
    expect(d.logs[0].opts.taskText).toBe('Buy groceries');
    expect(d.logs[0].opts.eventId).toBe('evt-123');
    expect(d.logs[0].opts.calendarName).toBe('Work');
  });

  it('2: TERMINAL task (not fixed) → action push-conflict, conflict_juggler "terminal" detail', function () {
    var d = decideExternalEditSync(ctx({
      task: makeTask({ status: 'done', placementMode: 'anytime' }),
      isTaskTerminal: true,
      event: makeEvent({ lastModified: '2026-06-10T00:00:59Z' })
    }));
    expect(d.action).toBe('push-conflict');
    expect(d.logs[0].action).toBe('conflict_juggler');
    expect(d.logs[0].opts.detail).toBe('Conflict: terminal task pushed over calendar edit (completed tasks are immutable)');
  });

  it('3: FIXED AND terminal → terminal detail wins the ternary', function () {
    var d = decideExternalEditSync(ctx({
      task: makeTask({ status: 'cancel', placementMode: 'fixed' }),
      isTaskTerminal: true
    }));
    expect(d.action).toBe('push-conflict');
    expect(d.logs[0].opts.detail).toBe('Conflict: terminal task pushed over calendar edit (completed tasks are immutable)');
  });
});

// ── pull: flexible + non-terminal + event newer → caller pulls (empty logs) ───

describe('decideExternalEditSync — pull (event newer than a flexible non-terminal task)', function () {
  it('4: event newer by 2000ms → action pull, EMPTY logs (call site builds conflict_provider)', function () {
    var d = decideExternalEditSync(ctx({
      event: makeEvent({ lastModified: '2026-06-10T00:00:02Z' })
    }));
    expect(d.action).toBe('pull');
    // The conflict_provider log depends on _buildPullFields output (newValues.when)
    // which lives at the call site, so the pure decision emits NO log for pull.
    expect(d.logs).toEqual([]);
  });
});

// ── push: flexible + non-terminal + task newer / tie → juggler pushes ────────

describe('decideExternalEditSync — push (task newer than the event)', function () {
  it('5: event older than task → action push, conflict_juggler "task is newer" detail', function () {
    var d = decideExternalEditSync(ctx({
      event: makeEvent({ lastModified: '2026-06-09T23:59:00Z' })
    }));
    expect(d.action).toBe('push');
    expect(d.logs).toHaveLength(1);
    expect(d.logs[0].action).toBe('conflict_juggler');
    expect(d.logs[0].opts.detail).toBe('Conflict: task pushed over calendar edit (task is newer)');
  });

  it('6: event newer by exactly 1000ms (boundary) → push, NOT pull (> not >=)', function () {
    var d = decideExternalEditSync(ctx({
      event: makeEvent({ lastModified: '2026-06-10T00:00:01Z' })
    }));
    expect(d.action).toBe('push');
  });

  it('7: unparseable event.lastModified → push (NaN tiebreaker falls to task-wins)', function () {
    var d = decideExternalEditSync(ctx({
      event: makeEvent({ lastModified: 'not-a-date' })
    }));
    expect(d.action).toBe('push');
  });
});

// ── log opts: calendarName falls to null when the provider has no label ──────

describe('decideExternalEditSync — log calendarName resolution', function () {
  it('8: calendarLabels missing the provider → calendarName null', function () {
    var d = decideExternalEditSync(ctx({
      task: makeTask({ placementMode: 'fixed' }),
      pid: 'apple', calendarLabels: {}
    }));
    expect(d.action).toBe('push-conflict');
    expect(d.logs[0].provider).toBe('apple');
    expect(d.logs[0].opts.calendarName).toBeNull();
  });
});
