/**
 * provider-origin-pull-decision.unit.test.js — DB-FREE decision-table unit tests
 * for the pure `decideProviderOriginPull(ctx)` use-case extracted from the two
 * NON-juggler-origin pull branches of the per-ledger loop in
 * controllers/cal-sync.controller.js (999.1025 inc. 8).
 *
 * The two branches (an `else if (isIngestOnly)` / `else if (ledger.origin === pid
 * && !terminal)` chain that runs whenever branch A — juggler-origin full-sync push
 * — did NOT) are unified into ONE pure decision:
 *
 *   - INGEST-ONLY provider: pull UNCONDITIONALLY (never consults the external-edit
 *     predicate) as long as the task is neither juggler-origin (MCP-created —
 *     Juggler owns its scheduling fields) nor terminal. The pull forces
 *     placement_mode = FIXED and emits NO log.
 *   - PROVIDER-ORIGIN full-sync (ledger.origin === pid, task not terminal): pull
 *     ONLY when the event was modified externally (isEventModifiedExternally). The
 *     pull does NOT force placement_mode (the adapter's own change-detection sets
 *     FIXED only on genuine date/time changes — ROADMAP 999.012 BUG-2) and emits a
 *     'pulled' log.
 *   - anything else (ingest juggler-origin/terminal, provider-origin terminal,
 *     foreign origin, unmodified provider event) → 'noop'.
 *
 * PURE — decisions in, effects out. No DB, no HTTP, no clock: the caller keeps
 * pAdapter.applyEventToTaskFields, taskUpdates, pStats/stats.pulled, and the actual
 * logSyncAction effect. This test pins action + forcePlacementFixed + the log
 * DESCRIPTORS byte-for-byte; the DB-backed behavior stays owned by the W4 golden.
 */

'use strict';

var { decideProviderOriginPull } = require('../../src/slices/calendar/domain/provider-origin-pull-decision');

function makeTask(over) {
  return Object.assign({
    id: 't1', text: 'Buy groceries', status: 'active', dur: 30
  }, over || {});
}
function makeEvent(over) {
  return Object.assign({
    title: 'Groceries (edited)', durationMinutes: 45,
    lastModified: '2026-06-10T00:00:05Z'
  }, over || {});
}
function makeLedger(over) {
  return Object.assign({
    id: 'L1', provider_event_id: 'evt-123', origin: 'gcal',
    last_modified_at: '2026-06-10 00:00:00'
  }, over || {});
}
function ctx(over) {
  return Object.assign({
    task: makeTask(), event: makeEvent(), ledger: makeLedger(), pid: 'gcal',
    isIngestOnly: false, jugglerOrigin: 'juggler',
    isTaskTerminal: false, calendarLabels: { gcal: 'Work' }
  }, over || {});
}

// ── ingest-only branch: unconditional pull, force FIXED, no log ───────────────

describe('decideProviderOriginPull — ingest-only provider', function () {
  it('1: non-juggler-origin, non-terminal → pull, forcePlacementFixed true, EMPTY logs', function () {
    var d = decideProviderOriginPull(ctx({
      isIngestOnly: true, ledger: makeLedger({ origin: 'gcal' })
    }));
    expect(d.action).toBe('pull');
    expect(d.forcePlacementFixed).toBe(true);
    expect(d.logs).toEqual([]);
  });

  it('2: ingest pull is UNCONDITIONAL — pulls even when the event was NOT modified', function () {
    // event.lastModified === ledger.last_modified_at → isEventModifiedExternally
    // would be false, yet ingest still pulls (it never consults the predicate).
    var d = decideProviderOriginPull(ctx({
      isIngestOnly: true,
      event: makeEvent({ lastModified: '2026-06-10T00:00:00Z' }),
      ledger: makeLedger({ origin: 'gcal', last_modified_at: '2026-06-10 00:00:00' })
    }));
    expect(d.action).toBe('pull');
    expect(d.forcePlacementFixed).toBe(true);
  });

  it('3: juggler-origin task (MCP-created) → noop (Juggler owns its scheduling)', function () {
    var d = decideProviderOriginPull(ctx({
      isIngestOnly: true, ledger: makeLedger({ origin: 'juggler' })
    }));
    expect(d.action).toBe('noop');
    expect(d.forcePlacementFixed).toBe(false);
    expect(d.logs).toEqual([]);
  });

  it('4: terminal task → noop', function () {
    var d = decideProviderOriginPull(ctx({
      isIngestOnly: true, ledger: makeLedger({ origin: 'gcal' }),
      task: makeTask({ status: 'done' }), isTaskTerminal: true
    }));
    expect(d.action).toBe('noop');
  });
});

// ── provider-origin full-sync branch: pull only on external edit, with 'pulled' log

describe('decideProviderOriginPull — provider-origin full-sync', function () {
  it('5: event modified externally → pull, forcePlacementFixed FALSE, pulled log pinned', function () {
    var d = decideProviderOriginPull(ctx());
    expect(d.action).toBe('pull');
    expect(d.forcePlacementFixed).toBe(false);
    expect(d.logs).toHaveLength(1);
    expect(d.logs[0].provider).toBe('gcal');
    expect(d.logs[0].action).toBe('pulled');
    expect(d.logs[0].opts).toEqual({
      taskId: 't1', taskText: 'Buy groceries', eventId: 'evt-123',
      oldValues: { dur: 30, text: 'Buy groceries' },
      newValues: { dur: 45, text: 'Groceries (edited)' },
      detail: 'Provider-origin event edited — task refreshed from gcal',
      calendarName: 'Work'
    });
  });

  it('6: event NOT modified since last sync → noop, EMPTY logs', function () {
    var d = decideProviderOriginPull(ctx({
      event: makeEvent({ lastModified: '2026-06-10T00:00:00Z' }),
      ledger: makeLedger({ origin: 'gcal', last_modified_at: '2026-06-10 00:00:00' })
    }));
    expect(d.action).toBe('noop');
    expect(d.logs).toEqual([]);
  });

  it('7: within the 1s tolerance (exactly 1000ms newer) → NOT modified → noop', function () {
    var d = decideProviderOriginPull(ctx({
      event: makeEvent({ lastModified: '2026-06-10T00:00:01Z' }),
      ledger: makeLedger({ origin: 'gcal', last_modified_at: '2026-06-10 00:00:00' })
    }));
    expect(d.action).toBe('noop');
  });

  it('8: Apple ETag fallback (no lastModified) → modified when etags differ → pull', function () {
    var d = decideProviderOriginPull(ctx({
      pid: 'apple', calendarLabels: { apple: 'iCloud' },
      event: makeEvent({ lastModified: null, _etag: 'etag-2' }),
      ledger: makeLedger({ origin: 'apple', last_modified_at: null, provider_etag: 'etag-1' })
    }));
    expect(d.action).toBe('pull');
    expect(d.logs[0].provider).toBe('apple');
    expect(d.logs[0].opts.detail).toBe('Provider-origin event edited — task refreshed from apple');
  });

  it('9: terminal provider-origin task → noop (never pull into a completed task)', function () {
    var d = decideProviderOriginPull(ctx({
      task: makeTask({ status: 'cancel' }), isTaskTerminal: true
    }));
    expect(d.action).toBe('noop');
  });

  it('10: pulled-log calendarName falls to null when the provider has no label', function () {
    var d = decideProviderOriginPull(ctx({ calendarLabels: {} }));
    expect(d.action).toBe('pull');
    expect(d.logs[0].opts.calendarName).toBeNull();
  });
});

// ── neither branch applies (only reachable in full-sync, i.e. not ingest) ─────

describe('decideProviderOriginPull — noop fall-through', function () {
  it('11: foreign origin (neither juggler nor pid) → noop', function () {
    var d = decideProviderOriginPull(ctx({
      pid: 'gcal', ledger: makeLedger({ origin: 'msft' })
    }));
    expect(d.action).toBe('noop');
    expect(d.logs).toEqual([]);
  });

  it('12: juggler-origin in full-sync (branch A owns it; decision is defensive) → noop', function () {
    var d = decideProviderOriginPull(ctx({
      ledger: makeLedger({ origin: 'juggler' })
    }));
    expect(d.action).toBe('noop');
  });
});
