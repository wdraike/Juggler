/**
 * hash-push-decision.unit.test.js — DB-FREE decision-table unit tests for the pure
 * `decideHashPushSync(ctx)` use-case extracted from the juggler-origin push/pull/
 * skip routing of the per-ledger loop in controllers/cal-sync.controller.js
 * (999.1025 inc. 10).
 *
 * This is reached only for JUGGLER_ORIGIN, non-ingest ledgers where BOTH the task
 * and its event exist. It routes on the taskHash-vs-last_pushed_hash change flag,
 * the external-edit predicate, the merged-follower flag, and terminal status:
 *   - merged follower                          → 'skip-merged' (+ 'skipped' log)
 *   - task changed, event stable               → 'push' (no log)
 *   - task changed, event modified externally  → 'external-edit' (caller delegates)
 *   - task stable, event modified, non-terminal→ 'pull' (caller owns log)
 *   - task stable, event modified, terminal    → 'push-terminal-conflict' (+ log)
 *   - neither changed                          → 'skip' (+ 'skipped' log)
 *
 * PURE — decisions in, effects out. taskHash is INJECTED (so the table can drive
 * taskChanged deterministically); isEventModifiedExternally is the real inc.6
 * predicate, driven here via event.lastModified vs ledger.last_modified_at (>1000ms
 * tolerance). The DB-backed behavior stays owned by the W4 golden master (axes
 * A/C/D/K). This test pins the ACTION + newHash + log DESCRIPTORS byte-for-byte.
 */

'use strict';

var { decideHashPushSync } = require('../../src/slices/calendar/domain/hash-push-decision');

// ── fixtures ─────────────────────────────────────────────────────────────────
// Event is "modified externally" when lastModified beats ledger.last_modified_at
// by >1000ms; "stable" when the fields are absent.
var LEDGER_MOD = '2026-06-10 00:00:00';           // ledger.last_modified_at (tz-less)
var EVENT_NEWER = '2026-06-10T00:00:05Z';         // +5s → modified externally
function hashOf() { return 'HASH_NEW'; }          // default injected taskHash

function makeTask(over) {
  return Object.assign({ id: 't1', text: 'Buy groceries', status: 'active' }, over || {});
}
function makeEvent(over) {
  return Object.assign({ _url: null }, over || {});
}
function makeLedger(over) {
  return Object.assign({ id: 'L1', provider_event_id: 'evt-123', last_pushed_hash: 'HASH_OLD' }, over || {});
}
function ctx(over) {
  return Object.assign({
    task: makeTask(), event: makeEvent(), ledger: makeLedger(), pid: 'gcal',
    isMergedFollower: false, isTaskTerminal: false,
    taskHash: hashOf, calendarLabels: { gcal: 'Work' }
  }, over || {});
}
// helper: an event that IS modified externally, paired with a ledger that records
// the older modified-at so the >1000ms predicate returns true.
function modifiedEvent() { return makeEvent({ lastModified: EVENT_NEWER }); }
function modifiedLedgerFields() { return { last_modified_at: LEDGER_MOD }; }

// ── skip-merged: checked FIRST, short-circuits everything ────────────────────

describe('decideHashPushSync — skip-merged (merged follower)', function () {
  it('1: merged follower → action skip-merged + skipped log, regardless of hash/event', function () {
    var d = decideHashPushSync(ctx({
      isMergedFollower: true,
      // even with BOTH sides changed, merged wins
      ledger: makeLedger(Object.assign({ last_pushed_hash: 'HASH_OLD' }, modifiedLedgerFields())),
      event: modifiedEvent()
    }));
    expect(d.action).toBe('skip-merged');
    expect(d.newHash).toBe('HASH_NEW');
    expect(d.logs).toHaveLength(1);
    expect(d.logs[0].provider).toBe('gcal');
    expect(d.logs[0].action).toBe('skipped');
    expect(d.logs[0].opts).toEqual({
      taskId: 't1', taskText: 'Buy groceries', eventId: 'evt-123', calendarName: 'Work'
    });
  });
});

// ── push: task changed, event stable ─────────────────────────────────────────

describe('decideHashPushSync — push (task changed, event stable)', function () {
  it('2: newHash !== last_pushed_hash, event has no lastModified → action push, empty logs', function () {
    var d = decideHashPushSync(ctx());   // HASH_NEW vs HASH_OLD, event stable
    expect(d.action).toBe('push');
    expect(d.newHash).toBe('HASH_NEW');
    expect(d.logs).toEqual([]);
  });
});

// ── external-edit: both changed → caller delegates to decideExternalEditSync ──

describe('decideHashPushSync — external-edit (both changed)', function () {
  it('3: task changed AND event modified externally → action external-edit, empty logs', function () {
    var d = decideHashPushSync(ctx({
      ledger: makeLedger(Object.assign({ last_pushed_hash: 'HASH_OLD' }, modifiedLedgerFields())),
      event: modifiedEvent()
    }));
    expect(d.action).toBe('external-edit');
    expect(d.newHash).toBe('HASH_NEW');
    expect(d.logs).toEqual([]);
  });
});

// ── pull: task stable, event modified, non-terminal → caller owns the log ─────

describe('decideHashPushSync — pull (event moved on a stable, non-terminal task)', function () {
  it('4: newHash === last_pushed_hash, event modified, not terminal → action pull, empty logs', function () {
    var d = decideHashPushSync(ctx({
      taskHash: function () { return 'SAME'; },
      ledger: makeLedger(Object.assign({ last_pushed_hash: 'SAME' }, modifiedLedgerFields())),
      event: modifiedEvent(),
      isTaskTerminal: false
    }));
    expect(d.action).toBe('pull');
    expect(d.newHash).toBe('SAME');
    expect(d.logs).toEqual([]);
  });
});

// ── push-terminal-conflict: task stable, event modified, terminal → push + log ─

describe('decideHashPushSync — push-terminal-conflict (calendar moved a terminal task)', function () {
  it('5: stable + event modified + terminal → action push-terminal-conflict, conflict_juggler log', function () {
    var d = decideHashPushSync(ctx({
      task: makeTask({ status: 'done' }),
      taskHash: function () { return 'SAME'; },
      ledger: makeLedger(Object.assign({ last_pushed_hash: 'SAME' }, modifiedLedgerFields())),
      event: modifiedEvent(),
      isTaskTerminal: true
    }));
    expect(d.action).toBe('push-terminal-conflict');
    expect(d.newHash).toBe('SAME');
    expect(d.logs).toHaveLength(1);
    expect(d.logs[0].provider).toBe('gcal');
    expect(d.logs[0].action).toBe('conflict_juggler');
    expect(d.logs[0].opts).toEqual({
      taskId: 't1', taskText: 'Buy groceries', eventId: 'evt-123',
      detail: 'Calendar moved completed task — pushed correct date back (terminal tasks are immutable)',
      calendarName: 'Work'
    });
  });
});

// ── skip: neither changed ────────────────────────────────────────────────────

describe('decideHashPushSync — skip (neither side changed)', function () {
  it('6: newHash === last_pushed_hash, event stable → action skip, skipped log', function () {
    var d = decideHashPushSync(ctx({
      taskHash: function () { return 'SAME'; },
      ledger: makeLedger({ last_pushed_hash: 'SAME' })   // event stable (no lastModified)
    }));
    expect(d.action).toBe('skip');
    expect(d.logs).toHaveLength(1);
    expect(d.logs[0].action).toBe('skipped');
    expect(d.logs[0].opts).toEqual({
      taskId: 't1', taskText: 'Buy groceries', eventId: 'evt-123', calendarName: 'Work'
    });
  });

  it('7: stable + event modified + terminal is NOT skip (only stable+unmodified skips)', function () {
    // guards against a terminal short-circuit swallowing the push-terminal branch
    var d = decideHashPushSync(ctx({
      taskHash: function () { return 'SAME'; },
      ledger: makeLedger(Object.assign({ last_pushed_hash: 'SAME' }, modifiedLedgerFields())),
      event: modifiedEvent(),
      isTaskTerminal: true
    }));
    expect(d.action).toBe('push-terminal-conflict');
  });
});

// ── boundary + log detail ────────────────────────────────────────────────────

describe('decideHashPushSync — boundaries and log resolution', function () {
  it('8: last_pushed_hash null vs a real hash → taskChanged true (strict !==) → push', function () {
    var d = decideHashPushSync(ctx({ ledger: makeLedger({ last_pushed_hash: null }) }));
    expect(d.action).toBe('push');
  });

  it('9: event newer by only 1000ms (boundary, > not >=) → NOT modified → push', function () {
    var d = decideHashPushSync(ctx({
      ledger: makeLedger(Object.assign({ last_pushed_hash: 'HASH_OLD' }, modifiedLedgerFields())),
      event: makeEvent({ lastModified: '2026-06-10T00:00:01Z' })   // exactly +1000ms
    }));
    // task changed + NOT modified externally → push (not external-edit)
    expect(d.action).toBe('push');
  });

  it('10: calendarLabels missing the provider → skipped log calendarName null', function () {
    var d = decideHashPushSync(ctx({
      taskHash: function () { return 'SAME'; },
      ledger: makeLedger({ last_pushed_hash: 'SAME' }),
      pid: 'apple', calendarLabels: {}
    }));
    expect(d.action).toBe('skip');
    expect(d.logs[0].provider).toBe('apple');
    expect(d.logs[0].opts.calendarName).toBeNull();
  });

  it('11: newHash is always the injected taskHash(task) result, even on a skip', function () {
    var seen = null;
    var theTask = makeTask();
    var d = decideHashPushSync(ctx({
      task: theTask,
      taskHash: function (t) { seen = t; return 'COMPUTED'; },
      ledger: makeLedger({ last_pushed_hash: 'COMPUTED' })
    }));
    expect(d.action).toBe('skip');            // stable + event stable
    expect(d.newHash).toBe('COMPUTED');
    expect(seen).toBe(theTask);               // taskHash was called with the resolved task
  });
});
