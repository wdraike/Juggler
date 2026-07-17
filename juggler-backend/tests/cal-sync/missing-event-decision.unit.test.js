/**
 * missing-event-decision.unit.test.js — DB-FREE decision-table unit tests for
 * the pure miss-ladder use-case extracted from cal-sync.controller.js's sync()
 * (999.1025 increment 3, FIRST EXTRACTION SEAM).
 *
 * The use-case owns the `task && !event` branch of the per-ledger loop: the
 * miss_count ladder (increment / reset / threshold-delete), CDN-grace gating,
 * the recurring/repush ledger-cleanup branches, and the multi-provider
 * miss-guard (Apple soak Bug #4 class). It is PURE — decisions in, effects out:
 * given a resolved context + injected pure helpers, it returns a plain
 * descriptor of the mutations the controller must apply (ledger updates, task
 * deletes, recreate ids, sync_history logs, stat deltas, loop-stop flag). No DB,
 * no HTTP, no provider clients.
 *
 * This is the DB-FREE companion pin. The DB-backed byte-for-byte behavior is
 * owned by the W4 golden master (axes E/E2/J/K/P + Q-T, test-bed only). The
 * CDN-grace WIRING order is additionally source-pinned by W5 A2.
 *
 * NOTE: withinCdnGrace's raw `new Date(ledger.last_pushed_at)` parse is a KNOWN
 * pinned bug (DIGEST-2026-07-16 / W5 A1-5) — this use-case treats grace as an
 * injected boolean-returning dependency and does NOT re-implement or fix it.
 */

'use strict';

var { decideMissingEventSync } = require('../../src/slices/calendar/domain/missing-event-decision');

var MISS_THRESHOLD = 3;
var JUGGLER_ORIGIN = 'juggler';

// ── Fixture builders ─────────────────────────────────────────────────────────

var NOW = new Date('2026-07-16T12:00:00Z');
var WINDOW_START = new Date('2026-07-02T12:00:00Z');   // now - 14d
var WINDOW_END = new Date('2026-09-14T12:00:00Z');     // now + 60d
var IN_WINDOW = '2026-07-20T09:00:00Z';                // between start/end
var OUT_OF_WINDOW = '2026-12-01T09:00:00Z';            // past window end

function makeLedger(over) {
  return Object.assign({
    id: 'led-1',
    task_id: 't-1',
    origin: JUGGLER_ORIGIN,
    provider_event_id: 'evt-1',
    miss_count: 0,
    last_user_hash: 'uh-stored',
    last_pushed_hash: 'ph-stored',
    event_start: IN_WINDOW,
    status: 'active'
  }, over || {});
}

function makeTask(over) {
  return Object.assign({
    id: 't-1',
    text: 'Mow lawn',
    taskType: 'one-off',
    // dateStrings shape (mysql2 tz-less 'YYYY-MM-DD HH:MM:SS') — the real caller
    // feeds _scheduled_at this way; the branch does .replace(' ','T') + 'Z'.
    _scheduled_at: '2026-07-20 09:00:00',
    dependsOn: []
  }, over || {});
}

// Default deps: grace off, hashes MATCH the stored ledger hashes (so hash-change
// branches are NOT triggered unless a case overrides).
function makeDeps(over) {
  return Object.assign({
    withinCdnGrace: function () { return false; },
    userHash: function () { return 'uh-stored'; },
    taskHash: function () { return 'ph-stored'; }
  }, over || {});
}

function makeCtx(over) {
  var base = {
    task: makeTask(),
    ledger: makeLedger(),
    pid: 'gcal',
    pd: { partialFailure: false },
    now: NOW,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    providerIds: ['gcal'],
    ledgerByProvider: { gcal: [] },
    allTasks: [],
    calendarLabels: { gcal: 'Google Calendar' },
    MISS_THRESHOLD: MISS_THRESHOLD,
    JUGGLER_ORIGIN: JUGGLER_ORIGIN
  };
  return Object.assign(base, over || {});
}

function decide(ctxOver, depsOver) {
  return decideMissingEventSync(makeCtx(ctxOver), makeDeps(depsOver));
}

function isNoop(d) {
  return d.ledgerUpdates.length === 0 &&
    d.taskDeletes.length === 0 &&
    d.recreateTaskIds.length === 0 &&
    d.logs.length === 0 &&
    d.statsDelta.deleted_remote === 0 &&
    d.stop === false;
}

// ── Decision table ───────────────────────────────────────────────────────────

describe('decideMissingEventSync — no-op branches', function () {
  it('1: partialFailure → no mutation at all (task kept alive)', function () {
    var d = decide({ pd: { partialFailure: true } });
    expect(isNoop(d)).toBe(true);
  });

  it('2: no provider_event_id → no mutation (nothing to reconcile)', function () {
    var d = decide({ ledger: makeLedger({ provider_event_id: null }) });
    expect(isNoop(d)).toBe(true);
  });

  it('4: withinCdnGrace → no mutation (CDN lag, not a deletion)', function () {
    var d = decide({ ledger: makeLedger({ miss_count: 2 }) },
      { withinCdnGrace: function () { return true; } });
    expect(isNoop(d)).toBe(true);
  });

  it('11: event cached start outside sync window → no mutation', function () {
    var d = decide({ ledger: makeLedger({ event_start: OUT_OF_WINDOW, miss_count: 2 }) });
    expect(isNoop(d)).toBe(true);
  });
});

describe('decideMissingEventSync — ledger-only cleanup branches', function () {
  it('3: past-time recurring instance → ledger cleanup only, task preserved', function () {
    var d = decide({
      task: makeTask({ taskType: 'recurring_instance', _scheduled_at: '2026-07-10 09:00:00' })
    });
    expect(d.taskDeletes).toHaveLength(0);
    expect(d.ledgerUpdates).toHaveLength(1);
    expect(d.ledgerUpdates[0].fields).toMatchObject({ status: 'deleted_local', task_id: null, miss_count: 0 });
    expect(d.logs.map(function (l) { return l.action; })).toEqual(['past_recurring_cleanup']);
    expect(d.stop).toBe(false);
  });

  it('5: recurring instance (ponytail) event missing + miss>=1 → ledger cleanup, no re-create', function () {
    var d = decide({
      task: makeTask({ taskType: 'recurring_instance' }),
      ledger: makeLedger({ miss_count: 1 })
    });
    expect(d.ledgerUpdates[0].fields).toMatchObject({ status: 'deleted_local', task_id: null, miss_count: 0 });
    expect(d.recreateTaskIds).toHaveLength(0);
    expect(d.logs.map(function (l) { return l.action; })).toEqual(['recurring_ledger_cleanup']);
  });
});

describe('decideMissingEventSync — repush (user-content changed) branch', function () {
  it('6: user hash changed + miss>=1 → recreate + ledger replaced', function () {
    var d = decide(
      { ledger: makeLedger({ miss_count: 1 }) },
      { userHash: function () { return 'uh-CHANGED'; } }
    );
    expect(d.recreateTaskIds).toEqual(['t-1']);
    expect(d.ledgerUpdates[0].fields).toMatchObject({ status: 'replaced', task_id: null, provider_event_id: null, miss_count: 0 });
    expect(d.logs.map(function (l) { return l.action; })).toEqual(['repush']);
  });

  it('6b: user hash changed but last_user_hash is null (legacy row) → NOT repush, falls to ladder', function () {
    var d = decide(
      { ledger: makeLedger({ miss_count: 1, last_user_hash: null }) },
      { userHash: function () { return 'uh-CHANGED'; } }
    );
    // legacy rows fall through to the miss-count ladder (miss 1 -> 2, kept alive)
    expect(d.recreateTaskIds).toHaveLength(0);
    expect(d.ledgerUpdates[0].fields).toEqual({ miss_count: 2 });
    expect(d.logs).toHaveLength(0);
  });
});

describe('decideMissingEventSync — miss_count ladder', function () {
  it('7: task hash changed + miss===0 → wait one cycle (miss_count -> 1), no log', function () {
    var d = decide(
      { ledger: makeLedger({ miss_count: 0 }) },
      { taskHash: function () { return 'ph-CHANGED'; } }
    );
    expect(d.ledgerUpdates[0].fields).toEqual({ miss_count: 1 });
    expect(d.logs).toHaveLength(0);
    expect(d.taskDeletes).toHaveLength(0);
  });

  it('10: in-window miss below threshold → increment miss_count only', function () {
    var d = decide({ ledger: makeLedger({ miss_count: 1 }) });
    expect(d.ledgerUpdates[0].fields).toEqual({ miss_count: 2 });
    expect(d.logs).toHaveLength(0);
    expect(d.taskDeletes).toHaveLength(0);
  });

  it('9: in-window miss reaches threshold, no other provider → delete task + ledger deleted_remote', function () {
    var d = decide({ ledger: makeLedger({ miss_count: 2 }) });
    expect(d.taskDeletes).toEqual([{ id: 't-1', dependencyTransfers: [] }]);
    expect(d.ledgerUpdates[0].fields).toMatchObject({ status: 'deleted_remote', task_id: null, miss_count: 3 });
    expect(d.statsDelta.deleted_remote).toBe(1);
    expect(d.logs.map(function (l) { return l.action; })).toEqual(['deleted_remote']);
    expect(d.stop).toBe(false);
  });

  it('9b: threshold delete transfers dependencies of the deleted task to its dependents', function () {
    var dependent = { id: 't-2', dependsOn: ['t-1', 't-9'] };
    var d = decide({
      task: makeTask({ dependsOn: ['t-3'] }),
      ledger: makeLedger({ miss_count: 2 }),
      allTasks: [dependent]
    });
    expect(d.taskDeletes[0].dependencyTransfers).toEqual([
      { id: 't-2', newDepsJson: JSON.stringify(['t-9', 't-3']) }
    ]);
  });
});

describe('decideMissingEventSync — multi-provider miss-guard (Bug #4)', function () {
  it('8: threshold reached but task still active on ANOTHER provider → ledger-only delete, task kept, stop', function () {
    var d = decide({
      pid: 'gcal',
      ledger: makeLedger({ miss_count: 2 }),
      providerIds: ['gcal', 'msft'],
      ledgerByProvider: {
        gcal: [],
        msft: [{ task_id: 't-1', status: 'active' }]
      }
    });
    expect(d.taskDeletes).toHaveLength(0); // task NOT deleted — still on msft
    expect(d.ledgerUpdates[0].fields).toMatchObject({ status: 'deleted_remote', task_id: null, miss_count: 3 });
    expect(d.statsDelta.deleted_remote).toBe(1);
    expect(d.logs.map(function (l) { return l.action; })).toEqual(['deleted_remote_partial']);
    expect(d.stop).toBe(true); // was `continue;` in the loop
  });

  it('8b: other provider row exists but is NOT active → task IS deleted (only active rows count)', function () {
    var d = decide({
      pid: 'gcal',
      ledger: makeLedger({ miss_count: 2 }),
      providerIds: ['gcal', 'msft'],
      ledgerByProvider: {
        gcal: [],
        msft: [{ task_id: 't-1', status: 'deleted_local' }]
      }
    });
    expect(d.taskDeletes).toEqual([{ id: 't-1', dependencyTransfers: [] }]);
    expect(d.stop).toBe(false);
  });
});

describe('decideMissingEventSync — CDN-grace ORDER (W5 A2 behavioral pin)', function () {
  it('grace short-circuits BEFORE the miss_count increment (order matters)', function () {
    // At miss_count 2 the ladder would otherwise delete at threshold — grace must
    // suppress the increment entirely, leaving NO mutation.
    var d = decide(
      { ledger: makeLedger({ miss_count: 2 }) },
      { withinCdnGrace: function () { return true; } }
    );
    expect(isNoop(d)).toBe(true);
  });
});
