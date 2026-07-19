/**
 * stale-instance-heal-decision.unit.test.js — DB-FREE decision-table unit tests
 * for the pure `decideStaleInstanceHeal(ctx)` decision carved from the
 * self-heal-stale-instance block in controllers/cal-sync.controller.js
 * (999.2062, residual [self-heal-stale-instance]).
 *
 * Reconcile re-numbers occurrence_ordinal over time; ledger task_ids end up
 * pointing at replaced instance rows. The decision rewrites the ledger to the
 * current live instance by (master, date) — or marks the row replaced when the
 * healed task is already tracked by another active ledger row (which would
 * otherwise violate the active_task_key unique constraint). PURE — the
 * ledgerUpdates.push / in-memory rebind effects stay at the call site.
 */

'use strict';

var { decideStaleInstanceHeal } = require('../../src/slices/calendar/domain/stale-instance-heal-decision');

function makeLedger(over) {
  return Object.assign({
    id: 'L1',
    task_id: 'master-uuid-3',
    event_start: '2026-06-15T09:00:00Z',
    status: 'active'
  }, over || {});
}

function ctx(over) {
  return Object.assign({
    task: null,
    ledger: makeLedger(),
    tasksByMasterDate: { 'master-uuid|2026-06-15': { id: 'healed-1' } },
    activeLedgers: []
  }, over || {});
}

describe('decideStaleInstanceHeal — guards (action none)', function () {
  it('task already resolved → none', function () {
    expect(decideStaleInstanceHeal(ctx({ task: { id: 'x' } })).action).toBe('none');
  });

  it('ledger has no task_id → none', function () {
    expect(decideStaleInstanceHeal(ctx({ ledger: makeLedger({ task_id: null }) })).action).toBe('none');
  });

  it('ledger has no event_start → none', function () {
    expect(decideStaleInstanceHeal(ctx({ ledger: makeLedger({ event_start: null }) })).action).toBe('none');
  });

  it('task_id without a trailing -<ordinal> (not a recurring instance) → none', function () {
    expect(decideStaleInstanceHeal(ctx({ ledger: makeLedger({ task_id: 'plainid' }) })).action).toBe('none');
  });

  it('split-chunk _part<N> suffix (underscore) is NOT matched → none', function () {
    expect(decideStaleInstanceHeal(ctx({ ledger: makeLedger({ task_id: 'master_part2' }) })).action).toBe('none');
  });

  it('event_start without a leading YYYY-MM-DD → none', function () {
    expect(decideStaleInstanceHeal(ctx({ ledger: makeLedger({ event_start: 'garbage' }) })).action).toBe('none');
  });

  it('no live instance for (master, date) → none', function () {
    expect(decideStaleInstanceHeal(ctx({ tasksByMasterDate: {} })).action).toBe('none');
  });
});

describe('decideStaleInstanceHeal — heal outcomes', function () {
  it('live instance found, untracked → relink: ledger fields {task_id: healed.id} + healedTask', function () {
    var d = decideStaleInstanceHeal(ctx());
    expect(d.action).toBe('relink');
    expect(d.ledgerId).toBe('L1');
    expect(d.fields).toEqual({ task_id: 'healed-1' });
    expect(d.healedTask.id).toBe('healed-1');
  });

  it('healed task already tracked by ANOTHER active ledger row → mark-replaced', function () {
    var d = decideStaleInstanceHeal(ctx({
      activeLedgers: [{ id: 'L2', task_id: 'healed-1' }]
    }));
    expect(d.action).toBe('mark-replaced');
    expect(d.ledgerId).toBe('L1');
    expect(d.fields).toEqual({ status: 'replaced' });
  });

  it('tracking row is the SAME ledger row → still relink (l.id !== ledger.id)', function () {
    var d = decideStaleInstanceHeal(ctx({
      activeLedgers: [{ id: 'L1', task_id: 'healed-1' }]
    }));
    expect(d.action).toBe('relink');
  });

  it('legacy short-id master (t...nuxt-1157) parses master + heals by date', function () {
    var d = decideStaleInstanceHeal(ctx({
      ledger: makeLedger({ task_id: 't1775853066082nuxt-1157' }),
      tasksByMasterDate: { 't1775853066082nuxt|2026-06-15': { id: 'healed-2' } }
    }));
    expect(d.action).toBe('relink');
    expect(d.fields).toEqual({ task_id: 'healed-2' });
  });

  it('greedy master capture: dashed UUID master keeps all but the last -<ordinal>', function () {
    var d = decideStaleInstanceHeal(ctx({
      ledger: makeLedger({ task_id: 'aaaa-bbbb-cccc-7' }),
      tasksByMasterDate: { 'aaaa-bbbb-cccc|2026-06-15': { id: 'healed-3' } }
    }));
    expect(d.action).toBe('relink');
    expect(d.fields).toEqual({ task_id: 'healed-3' });
  });
});
