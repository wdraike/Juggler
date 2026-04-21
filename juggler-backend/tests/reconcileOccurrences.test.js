/**
 * Unit tests for the date-based reconciliation helper.
 * Pure-function tests; no DB required.
 */

const reconcile = require('../src/scheduler/reconcileOccurrences');
const { parseDate } = require('../../shared/scheduler/dateHelpers');

function row(opts) {
  return Object.assign({
    task_type: 'recurring_instance',
    status: '',
    split_ordinal: 1,
    split_total: 1,
    occurrence_ordinal: 1,
    gcal_event_id: null,
    msft_event_id: null
  }, opts);
}

describe('reconcileOccurrences.buildExistingGroups', () => {
  test('groups chunks of the same occurrence_ordinal together', () => {
    const rows = [
      row({ id: 'm-1',    master_id: 'm', occurrence_ordinal: 1, split_ordinal: 1, split_total: 2, date: '2026-04-19' }),
      row({ id: 'm-1-2',  master_id: 'm', occurrence_ordinal: 1, split_ordinal: 2, split_total: 2, date: '2026-04-19' }),
      row({ id: 'm-2',    master_id: 'm', occurrence_ordinal: 2, split_ordinal: 1, split_total: 1, date: '2026-04-26' })
    ];
    const out = reconcile.buildExistingGroups(rows, parseDate);
    expect(Object.keys(out)).toEqual(['m']);
    expect(out['m'][1].chunkIds.sort()).toEqual(['m-1', 'm-1-2']);
    expect(out['m'][1].occId).toBe('m-1');
    expect(out['m'][1].date).toBe('2026-04-19');
    expect(out['m'][2].chunkIds).toEqual(['m-2']);
  });

  test('excludes cal-linked rows from the group pool', () => {
    const rows = [
      row({ id: 'ok',    master_id: 'm', date: '2026-04-19' }),
      row({ id: 'gcal1', master_id: 'm', date: '2026-04-20', gcal_event_id: 'abc' }),
      row({ id: 'msft1', master_id: 'm', date: '2026-04-21', msft_event_id: 'def' })
    ];
    const out = reconcile.buildExistingGroups(rows, parseDate);
    expect(out['m'][1].occId).toBe('ok');
    // Only one group remains (cal-linked are skipped)
    const groupIds = Object.values(out['m']).map(g => g.occId);
    expect(groupIds).toEqual(['ok']);
  });

  test('excludes non-pending rows (done/skip/cancel)', () => {
    const rows = [
      row({ id: 'ok',   master_id: 'm', date: '2026-04-19', status: '' }),
      row({ id: 'done', master_id: 'm', date: '2026-04-20', status: 'done' })
    ];
    const out = reconcile.buildExistingGroups(rows, parseDate);
    const groupIds = Object.values(out['m']).map(g => g.occId);
    expect(groupIds).toEqual(['ok']);
  });

  test('normalizeDate converts ISO rows to M/D so matching works', () => {
    // Simulates the production path where knex returns `r.date` as ISO strings.
    // Without the normalizer, g.date stays ISO ("2026-04-19"), parseDate fails,
    // and matchOccurrences cannot compare against M/D desired targets.
    const { isoToDateKey } = require('../src/scheduler/dateHelpers');
    const rows = [
      row({ id: 'ok', master_id: 'm', date: '2026-04-19' })
    ];
    const out = reconcile.buildExistingGroups(rows, parseDate, isoToDateKey);
    expect(out['m'][1].date).toBe('2026-04-19');
    expect(out['m'][1].dateObj).toBeInstanceOf(Date);
    expect(isNaN(out['m'][1].dateObj.getTime())).toBe(false);
  });
});

describe('reconcileOccurrences.matchOccurrences', () => {
  function makeGroup(opts) {
    return Object.assign({
      occOrd: 1, occId: 'x', date: '2026-04-19', dateObj: parseDate('2026-04-19'),
      chunkIds: ['x'], scheduledAt: null
    }, opts);
  }

  function groupMap(...groups) {
    const out = {};
    groups.forEach(g => { out[g.occOrd] = g; });
    return out;
  }

  test('exact-date match preserves id with no move', () => {
    const existing = { m: groupMap(makeGroup({ occOrd: 1, occId: 'm-1', date: '2026-04-19', dateObj: parseDate('2026-04-19'), chunkIds: ['m-1'] })) };
    const desired = [{ id: 'm-5', sourceId: 'm', date: '2026-04-19' }];
    const out = reconcile.matchOccurrences(desired, existing, parseDate);
    expect(out.occIdOverrides).toEqual({ 'm-5': 'm-1' });
    expect(out.occurrenceMoves).toEqual([]);
    expect(desired[0]._reconMatched).toBe(true);
  });

  test('nearest-first match emits a move entry', () => {
    // Existing at 4/26, 5/3. Target is 4/19 (no existing at that date).
    // Nearest-first picks 4/26 (12 days closer than 5/3 is to 4/19... actually
    // 4/26 is 7 days away, 5/3 is 14 days away — so 4/26 wins).
    const existing = { m: groupMap(
      makeGroup({ occOrd: 20, occId: 'm-20', date: '2026-04-26', dateObj: parseDate('2026-04-26'), chunkIds: ['m-20'] }),
      makeGroup({ occOrd: 21, occId: 'm-21', date: '2026-05-03',  dateObj: parseDate('2026-05-03'),  chunkIds: ['m-21'] })
    )};
    const desired = [{ id: 'm-5', sourceId: 'm', date: '2026-04-19' }];
    const out = reconcile.matchOccurrences(desired, existing, parseDate);
    expect(out.occIdOverrides).toEqual({ 'm-5': 'm-20' });
    expect(out.occurrenceMoves).toHaveLength(1);
    expect(out.occurrenceMoves[0].newDate).toBe('2026-04-19');
    expect(out.occurrenceMoves[0].chunkIds).toEqual(['m-20']);
  });

  test('exact-date matches take priority over nearest-first', () => {
    // Two existing: one at 4/26 (exact target) and one at 4/20 (near).
    // Two targets: 4/19 and 4/26. The 4/26 target should exact-match m-20.
    // The 4/19 target then picks the closest remaining (m-15 at 4/20).
    const existing = { m: groupMap(
      makeGroup({ occOrd: 15, occId: 'm-15', date: '2026-04-20', dateObj: parseDate('2026-04-20'), chunkIds: ['m-15'] }),
      makeGroup({ occOrd: 20, occId: 'm-20', date: '2026-04-26', dateObj: parseDate('2026-04-26'), chunkIds: ['m-20'] })
    )};
    const desired = [
      { id: 'm-100', sourceId: 'm', date: '2026-04-19' },
      { id: 'm-101', sourceId: 'm', date: '2026-04-26' }
    ];
    const out = reconcile.matchOccurrences(desired, existing, parseDate);
    expect(out.occIdOverrides['m-101']).toBe('m-20'); // exact
    expect(out.occIdOverrides['m-100']).toBe('m-15'); // nearest remaining
    // m-101 had exact match → no move. m-100 moved from 4/20 → 4/19.
    expect(out.occurrenceMoves).toHaveLength(1);
    expect(out.occurrenceMoves[0].newDate).toBe('2026-04-19');
    expect(out.occurrenceMoves[0].chunkIds).toEqual(['m-15']);
  });

  test('excess existing groups go unmatched (will be deleted by caller)', () => {
    // Rule tightened from 3 instances/week to 1. Existing has 3, desired 1.
    const existing = { m: groupMap(
      makeGroup({ occOrd: 1, occId: 'm-1', date: '2026-04-20', dateObj: parseDate('2026-04-20'), chunkIds: ['m-1'] }),
      makeGroup({ occOrd: 2, occId: 'm-2', date: '2026-04-22', dateObj: parseDate('2026-04-22'), chunkIds: ['m-2'] }),
      makeGroup({ occOrd: 3, occId: 'm-3', date: '2026-04-24', dateObj: parseDate('2026-04-24'), chunkIds: ['m-3'] })
    )};
    const desired = [{ id: 'm-99', sourceId: 'm', date: '2026-04-22' }];
    const out = reconcile.matchOccurrences(desired, existing, parseDate);
    // Exact match on 4/22 → m-2 reused.
    expect(out.occIdOverrides).toEqual({ 'm-99': 'm-2' });
    expect(out.occurrenceMoves).toEqual([]);
    // m-1 and m-3 have no override and are not in occurrenceMoves — caller
    // will detect them via the id-diff and delete.
  });

  test('excess targets stay unmatched (will be inserted by caller)', () => {
    // Rule loosened: existing 1, desired 3.
    const existing = { m: groupMap(
      makeGroup({ occOrd: 1, occId: 'm-1', date: '2026-04-22', dateObj: parseDate('2026-04-22'), chunkIds: ['m-1'] })
    )};
    const desired = [
      { id: 'm-10', sourceId: 'm', date: '2026-04-20' },
      { id: 'm-11', sourceId: 'm', date: '2026-04-22' },
      { id: 'm-12', sourceId: 'm', date: '2026-04-24' }
    ];
    const out = reconcile.matchOccurrences(desired, existing, parseDate);
    // 4/22 exact-matches m-1.
    expect(out.occIdOverrides).toEqual({ 'm-11': 'm-1' });
    expect(out.occurrenceMoves).toEqual([]);
    // m-10 and m-12 stay unmatched → caller inserts them as new chunks.
    expect(desired[0]._reconMatched).toBeFalsy();
    expect(desired[2]._reconMatched).toBeFalsy();
  });

  test('idempotent: same inputs twice produce same result', () => {
    const buildExisting = () => ({ m: groupMap(
      makeGroup({ occOrd: 1, occId: 'm-1', date: '2026-04-20', dateObj: parseDate('2026-04-20'), chunkIds: ['m-1'] }),
      makeGroup({ occOrd: 2, occId: 'm-2', date: '2026-04-27', dateObj: parseDate('2026-04-27'), chunkIds: ['m-2'] })
    )});
    const desired1 = [
      { id: 'new-10', sourceId: 'm', date: '2026-04-20' },
      { id: 'new-11', sourceId: 'm', date: '2026-04-27' }
    ];
    const out1 = reconcile.matchOccurrences(desired1, buildExisting(), parseDate);
    const desired2 = [
      { id: 'new-10', sourceId: 'm', date: '2026-04-20' },
      { id: 'new-11', sourceId: 'm', date: '2026-04-27' }
    ];
    const out2 = reconcile.matchOccurrences(desired2, buildExisting(), parseDate);
    expect(out1.occIdOverrides).toEqual(out2.occIdOverrides);
    expect(out1.occurrenceMoves).toEqual(out2.occurrenceMoves);
    expect(out1.occurrenceMoves).toEqual([]);
  });

  test('only matches within the same master', () => {
    const existing = {
      m1: groupMap(makeGroup({ occOrd: 1, occId: 'm1-1', date: '2026-04-19', dateObj: parseDate('2026-04-19'), chunkIds: ['m1-1'] })),
      m2: groupMap(makeGroup({ occOrd: 1, occId: 'm2-1', date: '2026-04-20', dateObj: parseDate('2026-04-20'), chunkIds: ['m2-1'] }))
    };
    const desired = [
      { id: 'm1-new', sourceId: 'm1', date: '2026-04-20' }, // closer to m2-1, but must match m1
      { id: 'm2-new', sourceId: 'm2', date: '2026-04-19' }
    ];
    const out = reconcile.matchOccurrences(desired, existing, parseDate);
    expect(out.occIdOverrides).toEqual({ 'm1-new': 'm1-1', 'm2-new': 'm2-1' });
  });
});
