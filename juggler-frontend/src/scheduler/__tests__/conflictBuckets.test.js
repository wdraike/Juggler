/**
 * 999.862 — the Issues badge and the Issues page must agree.
 * conflictBuckets is the single source of truth both consume, so these tests
 * lock its bucketing + the action-vs-info split that the badge keys on.
 */
import { computeConflictBuckets } from '../conflictBuckets';

// Z suffix: the instant must be past 09:00 in America/New_York (the default
// display tz) regardless of the runner's local tz — without it, a UTC CI runner
// parses 12:00 as 12:00 UTC = 08:00 EDT, BEFORE the 09:00 slot, and the test
// false-fails (999.15886).
var TODAY = new Date('2026-06-24T16:00:00Z'); // 12:00 EDT — a 09:00 slot has passed.

function run(tasks, extra) {
  return computeConflictBuckets(Object.assign({
    allTasks: tasks, statuses: (extra && extra.statuses) || {},
    unplaced: (extra && extra.unplaced) || [],
    backlog: (extra && extra.backlog) || [],
    schedulerWarnings: (extra && extra.warnings) || [],
    today: TODAY
  }, {}));
}

test('overdue = past deadline OR backend overdue flag', () => {
  var r = run([
    { id: 'a', deadline: '2026-06-20' },              // past deadline
    { id: 'b', overdue: true },                        // backend flag, no deadline
    { id: 'c', deadline: '2026-12-01' }                // future deadline → not overdue
  ]);
  expect(r.overdue.map(t => t.id).sort()).toEqual(['a', 'b']);
});

test('stale (past scheduled date, no deadline) is informational, not overdue', () => {
  var r = run([{ id: 's', date: '2026-06-10' }]);
  expect(r.overdue).toHaveLength(0);
  expect(r.stale.map(t => t.id)).toEqual(['s']);
});

test('terminal / template / floating-generated tasks are excluded', () => {
  var r = run([
    { id: 'done', deadline: '2026-06-01' },
    { id: 'tmpl', deadline: '2026-06-01', taskType: 'recurring_template' },
    { id: 'gen', deadline: '2026-06-01', generated: true }  // generated && !overdue → skip
  ], { statuses: { done: 'done' } });
  expect(r.overdue).toHaveLength(0);
});

test('generated instance carrying overdue flag DOES surface', () => {
  var r = run([{ id: 'gi', generated: true, overdue: true }]);
  expect(r.overdue.map(t => t.id)).toEqual(['gi']);
});

test('blocked-by-deps is informational, not action-required', () => {
  var r = run([
    { id: 'dep', deadline: '2026-12-01' },
    { id: 'blk', deadline: '2026-12-01', dependsOn: ['dep'] }
  ], { statuses: { dep: '' } });  // dep not done → blk blocked
  expect(r.blocked.map(t => t.id)).toEqual(['blk']);
  // blocked must NOT inflate the badge
  expect(r.actionCount).toBe(0);
});

test('actionCount = overdue + unplaced + warnings ONLY (the badge number)', () => {
  var r = run(
    [
      { id: 'od', deadline: '2026-06-01' },   // overdue
      { id: 'st', date: '2026-06-01' },        // stale → info
      { id: 'dep', deadline: '2026-12-01' },
      { id: 'blk', deadline: '2026-12-01', dependsOn: ['dep'] } // blocked → info
    ],
    { unplaced: [{ id: 'u1' }], warnings: [{ type: 'fixedOverlap' }], backlog: [{ id: 'bk' }], statuses: { dep: '' } }
  );
  expect(r.actionCount).toBe(3);                 // 1 overdue + 1 unplaced + 1 warning
  expect(r.infoCount).toBe(3);                   // stale + blocked + backlog
});

test('no double-counting: a task counted once even if overdue (matches page render)', () => {
  // The old badge summed bucket sizes and double-counted; the page shows each once.
  var r = run([{ id: 'x', deadline: '2026-06-01', overdue: true }]);
  expect(r.overdue).toHaveLength(1);
  expect(r.actionCount).toBe(1);
});

// 999.15685 acceptance tests: conflictBuckets now uses isTaskOverdue (display SSOT)
// instead of an inline deadline/flag check. The inline rule missed FIXED intra-day
// catch-up and all_day past-day checks.

test('999.15685: FIXED task placed earlier today (past slot) appears in Overdue bucket', () => {
  // A fixed task with a slot time that has already passed today.
  // isTaskOverdue derives past-due from the slot time (intra-day check).
  // TODAY = 2026-06-24T16:00:00Z (12:00 EDT) — a 09:00 slot has passed.
  var r = run([
    { id: 'fixed-past', placementMode: 'fixed', date: '2026-06-24', time: '09:00' }
  ]);
  expect(r.overdue.map(t => t.id)).toContain('fixed-past');
});

test('999.15685: date-only-deadline task due today does NOT appear in Overdue bucket', () => {
  // A task with a deadline of today — the day hasn't turned over yet.
  // isTaskOverdue checks deadlineKey < todayKey (strict less-than), so today == today is NOT overdue.
  var r = run([
    { id: 'due-today', deadline: '2026-06-24' }
  ]);
  expect(r.overdue.map(t => t.id)).not.toContain('due-today');
});
