/**
 * terminal-task-decision.unit.test.js — DB-FREE decision-table unit tests for the
 * pure terminal-status use-case extracted from cal-sync-helpers.js's (impure)
 * handleTerminalTaskSync (999.1025 increment 4).
 *
 * The use-case owns the terminal branch of the per-ledger sync loop: for a
 * juggler-origin task with a live provider event, in push (non-ingest) mode, it
 * decides done/cancel × calCompletedBehavior update/delete. It is PURE —
 * decisions in, effects out: given a resolved context it returns a plain
 * descriptor {action, deleteTarget, taskUpdates, ledgerUpdates, logs, statsDelta}.
 * The deleteEvent/throttle effect (and its 404/410 swallow) is applied by the
 * controller at the call site, NOT here. No DB, no HTTP, no provider clients.
 *
 * This is the DB-FREE companion pin. The DB-backed byte-for-byte behavior is
 * owned by the W4 golden master (axes D, D2, T — terminal update/delete incl.
 * Apple delete-by-URL, test-bed only). The `event._url || ledger.provider_event_id`
 * delete-target semantics are preserved EXACTLY (both halves pinned below — axis
 * T pins only the URL-vs-UID half because both sides hold the URL there).
 */

'use strict';

var { decideTerminalTaskSync } = require('../../src/slices/calendar/domain/terminal-task-decision');

var JUGGLER_ORIGIN = 'juggler';

// ── Fixture builders ─────────────────────────────────────────────────────────

function makeTask(over) {
  return Object.assign({ id: 't-1', text: 'Mow lawn', status: 'done' }, over || {});
}
function makeEvent(over) {
  return Object.assign({ _url: 'https://caldav.icloud.com/home/w4t-1.ics' }, over || {});
}
function makeLedger(over) {
  return Object.assign({
    id: 'led-1', origin: JUGGLER_ORIGIN, provider_event_id: 'prov-123'
  }, over || {});
}
function makeCtx(over) {
  return Object.assign({
    task: makeTask(),
    event: makeEvent(),
    ledger: makeLedger(),
    calCompletedBehavior: 'update',
    isIngestOnly: false,
    JUGGLER_ORIGIN: JUGGLER_ORIGIN,
    eventIdColumn: 'provider_event_id'
  }, over || {});
}
function decide(over) {
  return decideTerminalTaskSync(makeCtx(over));
}
function isNoop(d) {
  return d.action === 'none' &&
    d.deleteTarget === null &&
    d.taskUpdates.length === 0 &&
    d.ledgerUpdates.length === 0 &&
    d.logs.length === 0 &&
    d.statsDelta.deleted_local === 0;
}

// ── Decision table ───────────────────────────────────────────────────────────

describe('decideTerminalTaskSync — no-op guards (action none, no mutation)', function () {
  it('1: non-terminal status → none (nothing to reconcile)', function () {
    expect(isNoop(decide({ task: makeTask({ status: '' }) }))).toBe(true);
  });

  it('2: non-juggler origin → none (read-only foreign event)', function () {
    expect(isNoop(decide({ ledger: makeLedger({ origin: 'gcal' }) }))).toBe(true);
  });

  it('3: ingest-only provider → none (pull-only; never mutates provider)', function () {
    expect(isNoop(decide({ isIngestOnly: true }))).toBe(true);
  });

  it('4: no event → none (nothing on the provider to delete)', function () {
    expect(isNoop(decide({ event: null }))).toBe(true);
  });

  it('5: no task → none', function () {
    expect(isNoop(decide({ task: null }))).toBe(true);
  });
});

describe('decideTerminalTaskSync — done × calCompletedBehavior', function () {
  it('6: done × update → action update, fall-through repush (no delete, no mutation)', function () {
    var d = decide({ task: makeTask({ status: 'done' }), calCompletedBehavior: 'update' });
    expect(d.action).toBe('update');
    expect(d.deleteTarget).toBe(null);
    expect(d.taskUpdates).toHaveLength(0);
    expect(d.ledgerUpdates).toHaveLength(0);
    expect(d.statsDelta.deleted_local).toBe(0);
  });

  it('7: done × behavior default (undefined) → action update (only delete when explicit)', function () {
    var d = decide({ task: makeTask({ status: 'done' }), calCompletedBehavior: undefined });
    expect(d.action).toBe('update');
    expect(d.taskUpdates).toHaveLength(0);
  });

  it('8: done × delete → action delete, clears event id + ledger deleted_local + stat', function () {
    var d = decide({ task: makeTask({ status: 'done' }), calCompletedBehavior: 'delete' });
    expect(d.action).toBe('delete');
    expect(d.deleteTarget).toBe('https://caldav.icloud.com/home/w4t-1.ics');
    expect(d.taskUpdates).toEqual([{ id: 't-1', fields: { provider_event_id: null } }]);
    expect(d.ledgerUpdates).toEqual([{ id: 'led-1', fields: { status: 'deleted_local', provider_event_id: null } }]);
    expect(d.statsDelta.deleted_local).toBe(1);
    expect(d.logs).toHaveLength(0);
  });
});

describe('decideTerminalTaskSync — cancel (non-done terminal always deletes)', function () {
  it('9: cancel × update → action delete (non-done terminal deletes even in update mode)', function () {
    var d = decide({ task: makeTask({ status: 'cancel' }), calCompletedBehavior: 'update' });
    expect(d.action).toBe('delete');
    expect(d.deleteTarget).toBe('https://caldav.icloud.com/home/w4t-1.ics');
    expect(d.statsDelta.deleted_local).toBe(1);
  });

  it('10: cancel × delete → action delete', function () {
    var d = decide({ task: makeTask({ status: 'cancel' }), calCompletedBehavior: 'delete' });
    expect(d.action).toBe('delete');
    expect(d.statsDelta.deleted_local).toBe(1);
  });
});

describe('decideTerminalTaskSync — delete target selection (event._url || ledger.provider_event_id)', function () {
  it('11: Apple URL-vs-UID — event._url present → deleteTarget is the CalDAV URL (axis T)', function () {
    var d = decide({
      task: makeTask({ status: 'done' }),
      calCompletedBehavior: 'delete',
      event: makeEvent({ _url: 'https://caldav.icloud.com/w4/calendars/home/w4t-1.ics' }),
      ledger: makeLedger({ provider_event_id: 'APPLE-VEVENT-UID-1' })
    });
    expect(d.deleteTarget).toBe('https://caldav.icloud.com/w4/calendars/home/w4t-1.ics');
    expect(d.deleteTarget).not.toBe('APPLE-VEVENT-UID-1');
  });

  it('12: fallback half — no event._url → deleteTarget falls back to ledger.provider_event_id', function () {
    var d = decide({
      task: makeTask({ status: 'done' }),
      calCompletedBehavior: 'delete',
      event: makeEvent({ _url: undefined }),
      ledger: makeLedger({ provider_event_id: 'gcal-evt-999' })
    });
    expect(d.deleteTarget).toBe('gcal-evt-999');
  });
});

describe('decideTerminalTaskSync — eventIdColumn is honored (per-provider column)', function () {
  it('13: clears the provider-specific event-id column passed in ctx', function () {
    var d = decide({
      task: makeTask({ status: 'cancel' }),
      calCompletedBehavior: 'delete',
      eventIdColumn: 'gcal_event_id'
    });
    expect(d.taskUpdates).toEqual([{ id: 't-1', fields: { gcal_event_id: null } }]);
  });
});
