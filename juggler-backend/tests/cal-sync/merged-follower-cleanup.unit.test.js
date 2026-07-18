/**
 * merged-follower-cleanup.unit.test.js — DB-FREE decision-table unit tests for the
 * pure `planMergedFollowerCleanup(ctx)` planner extracted from the Phase 3a
 * merged-follower cleanup loop in controllers/cal-sync.controller.js
 * (999.1025 inc. 10).
 *
 * For each absorbed follower it finds the ACTIVE ledger row and decides what to
 * tear down: queue its event for delete (only if it has a provider_event_id),
 * mark the ledger row deleted_local, and drop the follower from the pushed set.
 * Followers with no active ledger row are skipped. PURE — the buffers
 * (splitDeleteQueue / ledgerUpdates / ledgeredTaskIds) stay effects at the call
 * site; W4 golden axis N owns the DB-backed choreography.
 */

'use strict';

var { planMergedFollowerCleanup } = require('../../src/slices/calendar/domain/merged-follower-cleanup');

function row(over) {
  return Object.assign({ id: 'L1', task_id: 'f1', status: 'active', provider_event_id: 'evt-1' }, over || {});
}

describe('planMergedFollowerCleanup', function () {
  it('1: no merged followers → three empty lists', function () {
    var out = planMergedFollowerCleanup({ mergedFollowers: {}, ledgerRows: [row()] });
    expect(out).toEqual({ deleteEventIds: [], ledgerDeletes: [], unledgerTaskIds: [] });
  });

  it('2: follower with an active ledger row + provider_event_id → full teardown', function () {
    var out = planMergedFollowerCleanup({
      mergedFollowers: { f1: true },
      ledgerRows: [row({ id: 'L1', task_id: 'f1', provider_event_id: 'evt-1' })]
    });
    expect(out.deleteEventIds).toEqual(['evt-1']);
    expect(out.ledgerDeletes).toEqual([{ id: 'L1' }]);
    expect(out.unledgerTaskIds).toEqual(['f1']);
  });

  it('3: active ledger row WITHOUT a provider_event_id → mark + unledger, no event delete', function () {
    var out = planMergedFollowerCleanup({
      mergedFollowers: { f1: true },
      ledgerRows: [row({ provider_event_id: null })]
    });
    expect(out.deleteEventIds).toEqual([]);
    expect(out.ledgerDeletes).toEqual([{ id: 'L1' }]);
    expect(out.unledgerTaskIds).toEqual(['f1']);
  });

  it('4: follower with NO active ledger row → skipped entirely', function () {
    var out = planMergedFollowerCleanup({
      mergedFollowers: { f1: true },
      ledgerRows: []
    });
    expect(out).toEqual({ deleteEventIds: [], ledgerDeletes: [], unledgerTaskIds: [] });
  });

  it('5: a matching-task_id row that is NOT active does not match (status gate)', function () {
    var out = planMergedFollowerCleanup({
      mergedFollowers: { f1: true },
      ledgerRows: [row({ status: 'deleted_local' })]
    });
    expect(out).toEqual({ deleteEventIds: [], ledgerDeletes: [], unledgerTaskIds: [] });
  });

  it('6: multiple followers preserve Object.keys order across all three lists', function () {
    var out = planMergedFollowerCleanup({
      mergedFollowers: { f1: true, f2: true, f3: true },
      ledgerRows: [
        row({ id: 'L1', task_id: 'f1', provider_event_id: 'evt-1' }),
        row({ id: 'L3', task_id: 'f3', provider_event_id: null }),   // no event id
        row({ id: 'L2', task_id: 'f2', provider_event_id: 'evt-2' })
      ]
    });
    // deleteEventIds skips f3 (null); ledgerDeletes/unledger keep all three in
    // follower-key order f1, f2, f3.
    expect(out.deleteEventIds).toEqual(['evt-1', 'evt-2']);
    expect(out.ledgerDeletes).toEqual([{ id: 'L1' }, { id: 'L2' }, { id: 'L3' }]);
    expect(out.unledgerTaskIds).toEqual(['f1', 'f2', 'f3']);
  });

  it('7: only the FIRST active row per follower is used (find semantics)', function () {
    var out = planMergedFollowerCleanup({
      mergedFollowers: { f1: true },
      ledgerRows: [
        row({ id: 'L1', task_id: 'f1', provider_event_id: 'evt-1' }),
        row({ id: 'L1b', task_id: 'f1', provider_event_id: 'evt-1b' })
      ]
    });
    expect(out.deleteEventIds).toEqual(['evt-1']);
    expect(out.ledgerDeletes).toEqual([{ id: 'L1' }]);
  });
});
