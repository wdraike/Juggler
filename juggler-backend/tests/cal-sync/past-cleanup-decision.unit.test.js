/**
 * past-cleanup-decision.unit.test.js — DB-FREE decision-table unit tests for the
 * pure "past non-done juggler-origin cleanup" use-case extracted from the
 * per-ledger sync loop in controllers/cal-sync.controller.js (999.1025 inc. 5).
 *
 * The use-case owns the branch that deletes a still-live provider event whose
 * juggler-origin task has slipped into the past without being finished: a past,
 * non-done/non-skip task's calendar event is removed so the external calendar
 * matches Juggler's UI (which hides past-time slots). It is PURE — decisions in,
 * effects out: given a resolved context it returns a plain descriptor
 * {action, deleteTarget, taskUpdates, ledgerUpdates, statsDelta}. The
 * deleteEvent/throttle effect (and its 404/410 swallow) is applied by the
 * controller at the call site via the shared applyTerminalDelete applier — the
 * delete-effect semantics are byte-identical to the terminal-delete path (same
 * deleteTarget shape, same buffers, same statsDelta), so the effect is REUSED,
 * not re-implemented. No DB, no HTTP, no provider clients.
 *
 * DB-FREE companion pin; the DB-backed byte-for-byte behavior stays owned by the
 * W4 golden master. Boundary distinction pinned here: recurring_instance uses
 * `now` (today's past-time slots cleaned once their window passes), one-off/chain
 * uses `todayStart` (previous-day boundary only, so an in-progress task keeps its
 * event mid-session). deleteTarget preserves `event._url || ledger.provider_event_id`
 * exactly (axis T / R).
 */

'use strict';

var { decidePastCleanupSync } = require('../../src/slices/calendar/domain/past-cleanup-decision');

var JUGGLER_ORIGIN = 'juggler';

// Fixed clock: now = 15:00Z; local midnight (todayStart) = 04:00Z same day.
var NOW = new Date('2026-07-17T15:00:00Z');
var TODAY_START = new Date('2026-07-17T04:00:00Z');

// ── Fixture builders ─────────────────────────────────────────────────────────

function makeTask(over) {
  return Object.assign({
    id: 't-1', text: 'Mow lawn', status: 'pending',
    taskType: 'one-off', _scheduled_at: '2026-07-16 10:00:00'
  }, over || {});
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
    now: NOW,
    todayStart: TODAY_START,
    isIngestOnly: false,
    JUGGLER_ORIGIN: JUGGLER_ORIGIN,
    eventIdColumn: 'provider_event_id'
  }, over || {});
}
function decide(over) {
  return decidePastCleanupSync(makeCtx(over));
}
function isNoop(d) {
  return d.action === 'none' &&
    d.deleteTarget === null &&
    d.taskUpdates.length === 0 &&
    d.ledgerUpdates.length === 0 &&
    d.statsDelta.deleted_local === 0;
}

// ── No-op guards ─────────────────────────────────────────────────────────────

describe('decidePastCleanupSync — no-op guards (action none, no mutation)', function () {
  it('1: no task → none', function () {
    expect(isNoop(decide({ task: null }))).toBe(true);
  });

  it('2: no event → none (nothing on the provider to delete)', function () {
    expect(isNoop(decide({ event: null }))).toBe(true);
  });

  it('3: non-juggler origin → none (read-only foreign event)', function () {
    expect(isNoop(decide({ ledger: makeLedger({ origin: 'gcal' }) }))).toBe(true);
  });

  it('4: no _scheduled_at → none (unplaced task has no past window)', function () {
    expect(isNoop(decide({ task: makeTask({ _scheduled_at: null }) }))).toBe(true);
  });

  it('5: ingest-only provider → none (pull-only; never mutates provider)', function () {
    expect(isNoop(decide({ isIngestOnly: true }))).toBe(true);
  });
});

// ── Past + status gating ─────────────────────────────────────────────────────

describe('decidePastCleanupSync — past-window + status gating', function () {
  it('6: future task → none (not past its boundary)', function () {
    expect(isNoop(decide({ task: makeTask({ _scheduled_at: '2026-07-18 10:00:00' }) }))).toBe(true);
  });

  it('7: past + done → none (done tasks keep their event; terminal path owns them)', function () {
    expect(isNoop(decide({ task: makeTask({ status: 'done' }) }))).toBe(true);
  });

  it('8: past + skip → none (skip is excluded exactly like done)', function () {
    expect(isNoop(decide({ task: makeTask({ status: 'skip' }) }))).toBe(true);
  });

  it('9: past one-off + not done → delete (clears event id + ledger deleted_local + stat)', function () {
    var d = decide({ task: makeTask({ status: 'pending', _scheduled_at: '2026-07-16 10:00:00' }) });
    expect(d.action).toBe('delete');
    expect(d.deleteTarget).toBe('https://caldav.icloud.com/home/w4t-1.ics');
    expect(d.taskUpdates).toEqual([{ id: 't-1', fields: { provider_event_id: null } }]);
    expect(d.ledgerUpdates).toEqual([{ id: 'led-1', fields: { status: 'deleted_local', provider_event_id: null } }]);
    expect(d.statsDelta.deleted_local).toBe(1);
  });
});

// ── Boundary distinction: recurring uses `now`, one-off uses `todayStart` ─────

describe('decidePastCleanupSync — pastBoundary (recurring=now vs one-off=todayStart)', function () {
  // _scheduled_at 10:00Z is AFTER todayStart (04:00Z) but BEFORE now (15:00Z).
  it('10: recurring_instance earlier-today → delete (boundary is `now`)', function () {
    var d = decide({ task: makeTask({ taskType: 'recurring_instance', status: 'pending', _scheduled_at: '2026-07-17 10:00:00' }) });
    expect(d.action).toBe('delete');
  });

  it('11: one-off earlier-today → none (boundary is `todayStart`, event kept mid-session)', function () {
    var d = decide({ task: makeTask({ taskType: 'one-off', status: 'pending', _scheduled_at: '2026-07-17 10:00:00' }) });
    expect(isNoop(d)).toBe(true);
  });
});

// ── deleteTarget selection + eventIdColumn ───────────────────────────────────

describe('decidePastCleanupSync — deleteTarget (event._url || ledger.provider_event_id)', function () {
  it('12: event._url present → deleteTarget is the CalDAV URL (axis T/R)', function () {
    var d = decide({
      event: makeEvent({ _url: 'https://caldav.icloud.com/w4/calendars/home/w4t-1.ics' }),
      ledger: makeLedger({ provider_event_id: 'APPLE-VEVENT-UID-1' })
    });
    expect(d.deleteTarget).toBe('https://caldav.icloud.com/w4/calendars/home/w4t-1.ics');
    expect(d.deleteTarget).not.toBe('APPLE-VEVENT-UID-1');
  });

  it('13: no event._url → deleteTarget falls back to ledger.provider_event_id', function () {
    var d = decide({
      event: makeEvent({ _url: undefined }),
      ledger: makeLedger({ provider_event_id: 'gcal-evt-999' })
    });
    expect(d.deleteTarget).toBe('gcal-evt-999');
  });

  it('14: eventIdColumn honored — clears the provider-specific column passed in ctx', function () {
    var d = decide({ eventIdColumn: 'gcal_event_id' });
    expect(d.taskUpdates).toEqual([{ id: 't-1', fields: { gcal_event_id: null } }]);
  });

  it('15: _scheduled_at already a Date is used as-is (no string reparse)', function () {
    var d = decide({ task: makeTask({ _scheduled_at: new Date('2026-07-16T10:00:00Z') }) });
    expect(d.action).toBe('delete');
  });
});
