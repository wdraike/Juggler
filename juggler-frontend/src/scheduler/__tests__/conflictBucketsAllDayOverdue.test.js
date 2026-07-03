/**
 * conflictBucketsAllDayOverdue.test.js — regression/contract test (999.1083,
 * M-1 / SPEC FR-4, AC-8).
 *
 * conflictBuckets.js requires NO code change for this leg (verified by trace,
 * INTAKE-BRIEF.json risk_flags[1]/[2]): `if (t.overdue) isOverdue = true;`
 * (conflictBuckets.js:40) already wins over the stale-bucket branch
 * (conflictBuckets.js:44, `else if`) for ANY task carrying an overdue flag,
 * all_day or not. This file pins that CONTRACT so a future refactor of this
 * module can't silently regress it, and proves the PRE-FIX shape (an all_day
 * past task with no overdue flag set) lands in `stale` today — the exact
 * behavior the backend fix (taskMappers.js ALL_DAY branch) changes by setting
 * `overdue:true` on the read model, which this file shows flips the bucket.
 *
 * These tests are expected GREEN on current HEAD (no frontend code change is
 * required here) — they are a regression fence, not a RED-then-GREEN pair.
 *
 * Traceability: SPEC.md FR-4; TRACEABILITY.md FR-4 row.
 * Run: cd juggler/juggler-frontend && npx react-scripts test conflictBucketsAllDayOverdue --watchAll=false
 */
import { computeConflictBuckets } from '../conflictBuckets';

var TODAY = new Date('2026-06-21T12:00:00');

function run(tasks, extra) {
  return computeConflictBuckets(Object.assign({
    allTasks: tasks, statuses: (extra && extra.statuses) || {},
    unplaced: (extra && extra.unplaced) || [],
    backlog: (extra && extra.backlog) || [],
    schedulerWarnings: (extra && extra.warnings) || [],
    today: TODAY
  }, {}));
}

describe('conflictBuckets — all_day overdue contract (999.1083, AC-8)', function() {

  it('AC-8: all_day task, overdue:true, non-terminal → in overdue bucket, actionCount includes it ONCE, NOT in stale', function() {
    var task = {
      id: 'ad-od-1', placementMode: 'all_day', date: '2026-06-19', overdue: true
    };
    var r = run([task], { statuses: { 'ad-od-1': '' } });
    expect(r.overdue.map(function(t) { return t.id; })).toEqual(['ad-od-1']);
    expect(r.stale.map(function(t) { return t.id; })).not.toContain('ad-od-1');
    expect(r.actionCount).toBe(1);
  });

  it('AC-8 (pre-fix shape pin): all_day past task WITHOUT overdue flag lands in stale (no deadline, past date)', function() {
    // This is exactly the shape a not-yet-fixed backend read model produces for
    // an all_day row: no `overdue` field set, no `deadline`, but a past `date`.
    // Pinning this proves the contract is a data-shape flip (overdue:true moves
    // the row from stale → overdue), not a code change in this module.
    var task = { id: 'ad-stale-1', placementMode: 'all_day', date: '2026-06-19' };
    var r = run([task], { statuses: { 'ad-stale-1': '' } });
    expect(r.stale.map(function(t) { return t.id; })).toEqual(['ad-stale-1']);
    expect(r.overdue.map(function(t) { return t.id; })).not.toContain('ad-stale-1');
  });

  it('AC-8: overdue all_day task does not double count when also present as generated instance', function() {
    var task = { id: 'ad-od-2', placementMode: 'all_day', date: '2026-06-19', overdue: true, generated: true };
    var r = run([task], { statuses: { 'ad-od-2': '' } });
    expect(r.overdue).toHaveLength(1);
    expect(r.actionCount).toBe(1);
  });

  it('AC-8: done all_day task with stale overdue-looking date is excluded entirely (terminal status)', function() {
    var task = { id: 'ad-done-1', placementMode: 'all_day', date: '2026-06-19', overdue: true };
    var r = run([task], { statuses: { 'ad-done-1': 'done' } });
    expect(r.overdue).toHaveLength(0);
    expect(r.stale).toHaveLength(0);
    expect(r.actionCount).toBe(0);
  });

});
