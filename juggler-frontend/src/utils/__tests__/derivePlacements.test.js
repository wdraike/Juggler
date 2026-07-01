/**
 * Characterization tests for derivePlacements (W3 — DB single source).
 *
 * Covers: W3 (useTaskState placements derived from tasks, not /schedule/placements).
 * Layer: unit (pure function, no DB, no React render, no network).
 *
 * derivePlacements routing rules:
 *   1. t.unscheduled=true                        → unplaced[]
 *   2. t._unplacedReason && !t.scheduledAt       → unplaced[]
 *   3. t.date && t.time && parseable time         → dayPlacements[t.date] as {task, start, end}
 *   4. t.date && t.time && UNparseable time       → skipped (WARN-2 guard, neither array)
 *   5. multiple tasks same date                  → grouped under one dateKey
 *   6. plain backlog task (date=null, no markers) → absent from both
 */
import { derivePlacements } from '../derivePlacements';

// ---------------------------------------------------------------------------
// Case 1: placed task with date + parseable time + dur
// ---------------------------------------------------------------------------
describe('derivePlacements — Case 1: placed task', () => {
  const placedTask = {
    id: 'task-placed-1',
    text: 'Morning standup',
    date: '2026-06-22',
    time: '8:00 AM',
    dur: 30,
  };

  it('routes to dayPlacements[date], NOT to unplaced', () => {
    const result = derivePlacements([placedTask]);
    expect(result.unplaced).toHaveLength(0);
    expect(result.dayPlacements['2026-06-22']).toBeDefined();
    expect(result.dayPlacements['2026-06-22']).toHaveLength(1);
  });

  it('start = 480 (8:00 AM = 8*60)', () => {
    const result = derivePlacements([placedTask]);
    expect(result.dayPlacements['2026-06-22'][0].start).toBe(480);
  });

  it('end = start + dur = 480 + 30 = 510', () => {
    const result = derivePlacements([placedTask]);
    expect(result.dayPlacements['2026-06-22'][0].end).toBe(510);
  });

  it('placement entry carries the original task reference', () => {
    const result = derivePlacements([placedTask]);
    expect(result.dayPlacements['2026-06-22'][0].task).toBe(placedTask);
  });

  it('end = start when dur is absent (defaults to 0)', () => {
    const nodur = { id: 'nd', text: 'no dur', date: '2026-06-22', time: '8:00 AM' };
    const result = derivePlacements([nodur]);
    expect(result.dayPlacements['2026-06-22'][0].start).toBe(480);
    expect(result.dayPlacements['2026-06-22'][0].end).toBe(480);
  });
});

// ---------------------------------------------------------------------------
// Case 2: unscheduled task → unplaced[]
// ---------------------------------------------------------------------------
describe('derivePlacements — Case 2: unscheduled=true → unplaced', () => {
  const unscheduledTask = {
    id: 'task-unscheduled-1',
    text: 'Floating task',
    date: null,
    time: null,
    unscheduled: true,
  };

  it('routes to unplaced[], NOT to dayPlacements', () => {
    const result = derivePlacements([unscheduledTask]);
    expect(result.unplaced).toContain(unscheduledTask);
    expect(Object.keys(result.dayPlacements)).toHaveLength(0);
  });

  it('unscheduled=true with date+time still goes to unplaced (unscheduled wins)', () => {
    // A task can have date/time set but still be flagged unscheduled (e.g. re-submitted
    // recurring with stale date). The unscheduled flag takes priority.
    const t = { id: 'us-w-date', text: 'stale', date: '2026-06-22', time: '9:00 AM', unscheduled: true };
    const result = derivePlacements([t]);
    expect(result.unplaced).toContain(t);
    expect(Object.keys(result.dayPlacements)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Case 3: _unplacedReason + no scheduledAt → unplaced[]
// ---------------------------------------------------------------------------
describe('derivePlacements — Case 3: _unplacedReason && !scheduledAt → unplaced', () => {
  const unplacedReasonTask = {
    id: 'task-unplaced-reason-1',
    text: 'No slot available',
    _unplacedReason: 'no_slot',
    scheduledAt: null,
  };

  it('routes to unplaced[], NOT to dayPlacements', () => {
    const result = derivePlacements([unplacedReasonTask]);
    expect(result.unplaced).toContain(unplacedReasonTask);
    expect(Object.keys(result.dayPlacements)).toHaveLength(0);
  });

  it('_unplacedReason + scheduledAt PRESENT → NOT unplaced (e.g. overdue task still placed)', () => {
    // A task with _unplacedReason but a scheduledAt is an overdue/placed task —
    // the unplaced routing fires only when scheduledAt is falsy.
    const overdue = {
      id: 'task-overdue',
      text: 'Overdue placed',
      _unplacedReason: 'missed',
      scheduledAt: '2026-06-21T09:00:00Z',
      date: '2026-06-21',
      time: '9:00 AM',
      dur: 60,
    };
    const result = derivePlacements([overdue]);
    // Should fall through to the date+time path, NOT go to unplaced
    expect(result.unplaced).not.toContain(overdue);
    expect(result.dayPlacements['2026-06-21']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Case 4: date+time but UNparseable time → skipped (WARN-2 guard)
// ---------------------------------------------------------------------------
describe('derivePlacements — Case 4: unparseable time → skipped from grid', () => {
  const garbageTimeTask = {
    id: 'task-garbage-time',
    text: 'Bad time format',
    date: '2026-06-22',
    time: 'garbage',
  };

  it('absent from dayPlacements (not gridded)', () => {
    const result = derivePlacements([garbageTimeTask]);
    expect(result.dayPlacements['2026-06-22']).toBeUndefined();
  });

  it('absent from unplaced (not an unplaced task either)', () => {
    const result = derivePlacements([garbageTimeTask]);
    expect(result.unplaced).not.toContain(garbageTimeTask);
  });

  it('null time string also skipped', () => {
    // parseTimeToMinutes(null) returns null → guard fires, skipped
    const t = { id: 'null-time', text: 'null time', date: '2026-06-22', time: null };
    const result = derivePlacements([t]);
    // time is falsy — the date+time guard (`t.date && t.time`) fails, so not entered
    expect(result.dayPlacements['2026-06-22']).toBeUndefined();
    expect(result.unplaced).not.toContain(t);
  });

  /**
   * Mutation verification (inline — Stryker not wired).
   *
   * The WARN-2 guard is `if (start != null)`. If we remove that guard and always
   * push (even when start === null), the garbage-time task would appear in dayPlacements
   * with start=null. This test proves the guard is real: with the guard active, the
   * garbage task is absent from the grid. To manually verify the mutation kills this
   * test, temporarily change `if (start != null)` to `if (true)` in derivePlacements.js
   * — the "absent from dayPlacements" assertion above would then flip RED.
   * (Manual verification was done during authoring; see TEST-CATALOG.md Step 6b.)
   */
  it('MUTATION-VERIFY: parseable time IS gridded (contrast — confirms guard path distinction)', () => {
    // A task with the same date but a PARSEABLE time must be in dayPlacements.
    // This confirms that the `start != null` guard is the discriminator between
    // Cases 1 and 4 — not some other condition. A mutant that always-pushes would
    // merge both into dayPlacements; a mutant that never-pushes would remove both.
    const goodTime = { id: 'good-time', text: 'Good time', date: '2026-06-22', time: '9:00 AM', dur: 30 };
    const resultGood = derivePlacements([goodTime]);
    const resultGarbage = derivePlacements([garbageTimeTask]);

    // Good time: in dayPlacements, start is a number
    expect(resultGood.dayPlacements['2026-06-22']).toHaveLength(1);
    expect(typeof resultGood.dayPlacements['2026-06-22'][0].start).toBe('number');

    // Garbage time: NOT in dayPlacements
    expect(resultGarbage.dayPlacements['2026-06-22']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Case 5: multiple tasks same date → grouped under one dateKey
// ---------------------------------------------------------------------------
describe('derivePlacements — Case 5: multiple tasks same date', () => {
  const tasks = [
    { id: 't1', text: 'First',  date: '2026-06-22', time: '8:00 AM',  dur: 30 },
    { id: 't2', text: 'Second', date: '2026-06-22', time: '9:00 AM',  dur: 60 },
    { id: 't3', text: 'Third',  date: '2026-06-22', time: '10:00 AM', dur: 45 },
    { id: 't4', text: 'Other day', date: '2026-06-23', time: '8:00 AM', dur: 30 },
  ];

  it('all three same-date tasks appear under one dateKey', () => {
    const result = derivePlacements(tasks);
    expect(result.dayPlacements['2026-06-22']).toHaveLength(3);
  });

  it('other-date task is in its own dateKey', () => {
    const result = derivePlacements(tasks);
    expect(result.dayPlacements['2026-06-23']).toHaveLength(1);
    expect(result.dayPlacements['2026-06-23'][0].task.id).toBe('t4');
  });

  it('start values are correct per task (8:00→480, 9:00→540, 10:00→600)', () => {
    const result = derivePlacements(tasks);
    const starts = result.dayPlacements['2026-06-22'].map(p => p.start);
    expect(starts).toContain(480);
    expect(starts).toContain(540);
    expect(starts).toContain(600);
  });

  it('end values respect each task dur', () => {
    const result = derivePlacements(tasks);
    const entries = result.dayPlacements['2026-06-22'];
    const byStart = {};
    entries.forEach(e => { byStart[e.start] = e; });
    expect(byStart[480].end).toBe(510);  // 8:00 AM + 30 min
    expect(byStart[540].end).toBe(600);  // 9:00 AM + 60 min
    expect(byStart[600].end).toBe(645);  // 10:00 AM + 45 min
  });
});

// ---------------------------------------------------------------------------
// Case 6: plain backlog task (no date, no markers) → absent from both
// ---------------------------------------------------------------------------
describe('derivePlacements — Case 6: plain backlog task absent from both', () => {
  const backlogTask = {
    id: 'task-backlog-1',
    text: 'Fix the thing',
    pri: 'P2',
    // no date, no time, no unscheduled, no _unplacedReason
  };

  it('not in dayPlacements', () => {
    const result = derivePlacements([backlogTask]);
    expect(Object.keys(result.dayPlacements)).toHaveLength(0);
  });

  it('not in unplaced', () => {
    const result = derivePlacements([backlogTask]);
    expect(result.unplaced).toHaveLength(0);
  });

  it('task with date but no time also absent from both', () => {
    // date alone is not enough; requires both date AND time to be placed
    const dateOnly = { id: 'date-only', text: 'Date only', date: '2026-06-22' };
    const result = derivePlacements([dateOnly]);
    expect(result.dayPlacements['2026-06-22']).toBeUndefined();
    expect(result.unplaced).not.toContain(dateOnly);
  });
});

// ---------------------------------------------------------------------------
// Edge: null / undefined / empty input
// ---------------------------------------------------------------------------
describe('derivePlacements — edge cases', () => {
  it('null input returns empty structures without throwing', () => {
    const result = derivePlacements(null);
    expect(result.dayPlacements).toEqual({});
    expect(result.unplaced).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('undefined input returns empty structures without throwing', () => {
    const result = derivePlacements(undefined);
    expect(result.dayPlacements).toEqual({});
    expect(result.unplaced).toEqual([]);
  });

  it('empty array returns empty structures', () => {
    const result = derivePlacements([]);
    expect(result.dayPlacements).toEqual({});
    expect(result.unplaced).toEqual([]);
  });

  it('null entry in array is skipped without throwing', () => {
    const result = derivePlacements([null, { id: 't', text: 'ok', date: '2026-06-22', time: '8:00 AM', dur: 30 }]);
    expect(result.dayPlacements['2026-06-22']).toHaveLength(1);
    expect(result.unplaced).toHaveLength(0);
  });

  it('returns warnings array (always empty in current implementation)', () => {
    const result = derivePlacements([]);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('PM time parsed correctly: 1:30 PM → 810', () => {
    const t = { id: 'pm', text: 'pm test', date: '2026-06-22', time: '1:30 PM', dur: 0 };
    const result = derivePlacements([t]);
    expect(result.dayPlacements['2026-06-22'][0].start).toBe(810); // 13*60+30
  });

  it('midnight 12:00 AM → 0', () => {
    const t = { id: 'midnight', text: 'midnight', date: '2026-06-22', time: '12:00 AM', dur: 0 };
    const result = derivePlacements([t]);
    expect(result.dayPlacements['2026-06-22'][0].start).toBe(0);
  });

  it('noon 12:00 PM → 720', () => {
    const t = { id: 'noon', text: 'noon', date: '2026-06-22', time: '12:00 PM', dur: 0 };
    const result = derivePlacements([t]);
    expect(result.dayPlacements['2026-06-22'][0].start).toBe(720);
  });
});

// ---------------------------------------------------------------------------
// Mixed: placed + unplaced + skipped + backlog in one call
// ---------------------------------------------------------------------------
describe('derivePlacements — mixed task array', () => {
  const placed    = { id: 'p1', text: 'Placed', date: '2026-06-22', time: '9:00 AM', dur: 30 };
  const unscheduled = { id: 'u1', text: 'Unscheduled', unscheduled: true };
  const reasoned  = { id: 'r1', text: 'Reasoned', _unplacedReason: 'no_slot', scheduledAt: null };
  const garbage   = { id: 'g1', text: 'Garbage time', date: '2026-06-22', time: 'not-a-time' };
  const backlog   = { id: 'b1', text: 'Backlog' };

  it('places only the placed task into dayPlacements', () => {
    const result = derivePlacements([placed, unscheduled, reasoned, garbage, backlog]);
    expect(result.dayPlacements['2026-06-22']).toHaveLength(1);
    expect(result.dayPlacements['2026-06-22'][0].task).toBe(placed);
  });

  it('unplaced[] contains unscheduled + reasoned only', () => {
    const result = derivePlacements([placed, unscheduled, reasoned, garbage, backlog]);
    expect(result.unplaced).toContain(unscheduled);
    expect(result.unplaced).toContain(reasoned);
    expect(result.unplaced).toHaveLength(2);
  });

  it('garbage-time and backlog tasks are in neither array', () => {
    const result = derivePlacements([placed, unscheduled, reasoned, garbage, backlog]);
    expect(result.unplaced).not.toContain(garbage);
    expect(result.unplaced).not.toContain(backlog);
    // dayPlacements has only the one 2026-06-22 entry (the placed task)
    const allGridded = Object.values(result.dayPlacements).flat();
    expect(allGridded.map(p => p.task)).not.toContain(garbage);
    expect(allGridded.map(p => p.task)).not.toContain(backlog);
  });
});

// ---------------------------------------------------------------------------
// Terminal status: a done/skip/missed task is NEVER unplaced (bug: done tasks
// shown in the Unplaced list — orphaned split chunks with unscheduled=1)
// ---------------------------------------------------------------------------
describe('derivePlacements — terminal-status tasks are never unplaced', () => {
  it('done + unscheduled=1 → NOT in unplaced (with a slot, grids instead)', () => {
    const doneUnsched = { id: 'd1', text: 'Pay for COBRA', status: 'done', unscheduled: true, date: '2026-05-31', time: '10:45 AM', dur: 30 };
    const result = derivePlacements([doneUnsched]);
    expect(result.unplaced).not.toContain(doneUnsched);
    expect(result.dayPlacements['2026-05-31']).toHaveLength(1);
  });

  // JUG-CLOSE-NOW (David ruling: actual elapsed, not estimated).
  it('done with completedAtTime → end = actual elapsed, not start+dur', () => {
    const closedNow = { id: 'd2', text: '5-min task closed after 2h', status: 'done', date: '2026-05-31', time: '9:00 AM', dur: 5, completedAtTime: '11:00 AM' };
    const result = derivePlacements([closedNow]);
    expect(result.dayPlacements['2026-05-31'][0].start).toBe(540); // 9:00 AM
    expect(result.dayPlacements['2026-05-31'][0].end).toBe(660);   // 11:00 AM, not 545
  });

  it('done with completedAtTime before start (midnight rollover) → falls back to estimated end', () => {
    const rollover = { id: 'd3', text: 'crossed midnight', status: 'done', date: '2026-05-31', time: '11:30 PM', dur: 30, completedAtTime: '12:15 AM' };
    const result = derivePlacements([rollover]);
    expect(result.dayPlacements['2026-05-31'][0].start).toBe(1410); // 11:30 PM
    expect(result.dayPlacements['2026-05-31'][0].end).toBe(1440);   // 11:30 PM + 30 (estimated fallback)
  });

  it('done without completedAtTime → end = start+dur (unchanged legacy behavior)', () => {
    const legacy = { id: 'd4', text: 'no completedAtTime', status: 'done', date: '2026-05-31', time: '9:00 AM', dur: 30 };
    const result = derivePlacements([legacy]);
    expect(result.dayPlacements['2026-05-31'][0].end).toBe(570); // 9:30 AM
  });

  it('skip + unscheduled=1 + no slot → in neither array (not unplaced)', () => {
    const skipOrphan = { id: 's1', text: 'Apply for Jobs', status: 'skip', unscheduled: true, date: null, time: null };
    const result = derivePlacements([skipOrphan]);
    expect(result.unplaced).not.toContain(skipOrphan);
    expect(Object.keys(result.dayPlacements)).toHaveLength(0);
  });

  // NOTE: the former "missed + unscheduled=1 → NOT in unplaced" case was removed
  // with the 'missed' status itself (commit df8adfa, 2026-06-28 — "overdue is the
  // display concept"). 'missed' is no longer a status nor a TERMINAL_STATUSES
  // member, so the case asserted dead behavior (999.998 test-rot). done/skip/
  // cancel/pause terminal handling stays covered by the cases above + below.

  it('a NON-terminal unscheduled task still goes to unplaced (guard not over-broad)', () => {
    const pending = { id: 'p9', text: 'Real unplaced', status: '', unscheduled: true };
    expect(derivePlacements([pending]).unplaced).toContain(pending);
  });
});

// ---------------------------------------------------------------------------
// 999.882 — TERMINAL_STATUSES must match shared/task-status.js (which includes
// 'cancelled' and 'pause'). A placed cancelled/pause task carrying unscheduled=1
// must be treated as terminal (→ grid when it has a slot, NOT unplaced), exactly
// like done/skip/missed. RED-first: the local set omits cancelled + pause.
// ---------------------------------------------------------------------------
describe('derivePlacements — 999.882 cancelled + pause are terminal', () => {
  it("cancelled + unscheduled=1 → NOT in unplaced", () => {
    const cancelled = { id: 'c1', text: 'Call off', status: 'cancelled', unscheduled: true, date: null, time: null };
    expect(derivePlacements([cancelled]).unplaced).not.toContain(cancelled);
  });

  it("pause + unscheduled=1 → NOT in unplaced", () => {
    const paused = { id: 'pz1', text: 'On hold', status: 'pause', unscheduled: true, date: null, time: null };
    expect(derivePlacements([paused]).unplaced).not.toContain(paused);
  });

  it("placed cancelled task (date+time) routes to the grid, not unplaced", () => {
    const cancelled = { id: 'c2', text: 'Cancelled meeting', status: 'cancelled', date: '2026-06-22', time: '9:00 AM', dur: 30, unscheduled: true };
    const result = derivePlacements([cancelled]);
    expect(result.unplaced).not.toContain(cancelled);
    expect(result.dayPlacements['2026-06-22']).toBeDefined();
    expect(result.dayPlacements['2026-06-22'][0].task).toBe(cancelled);
  });

  it("placed pause task (date+time) routes to the grid, not unplaced", () => {
    const paused = { id: 'pz2', text: 'Paused chore', status: 'pause', date: '2026-06-22', time: '10:00 AM', dur: 30, unscheduled: true };
    const result = derivePlacements([paused]);
    expect(result.unplaced).not.toContain(paused);
    expect(result.dayPlacements['2026-06-22']).toBeDefined();
    expect(result.dayPlacements['2026-06-22'][0].task).toBe(paused);
  });
});
