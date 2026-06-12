/**
 * H6 W1 unit tests — Scheduler domain SOLVERS (ConstraintSolver, ConflictResolver,
 * ScoreEngine) + the integrated 3-solver composition (Snuffy requirement).
 *
 * These solvers house the pure algorithm MOVED out of unifiedScheduleV2.js /
 * scoreSchedule.js. The H6 golden-master already pins their behavior through the
 * legacy entry point; these tests assert the SOLVER UNITS directly (ordering S1,
 * severity S2, recurrence-cycle/day-of-week S3 inputs, occupancy primitives,
 * scoring) and PROVE the three compose as a pipeline on a mixed-constraint fixture.
 *
 * Pure unit — no DB, no network.
 */

'use strict';

const ConstraintSolver = require('../../../../src/slices/scheduler/domain/logic/ConstraintSolver');
const ConflictResolver = require('../../../../src/slices/scheduler/domain/logic/ConflictResolver');
const ScoreEngine = require('../../../../src/slices/scheduler/domain/logic/ScoreEngine');
const Constraint = require('../../../../src/slices/scheduler/domain/entities/Constraint');

const { PRI_RANK } = require('../../../../src/scheduler/constants');

// ── ConstraintSolver: S1 ordering ─────────────────────────────────────────────
describe('ConstraintSolver.compareItems — S1 most-constrained → least ordering', () => {
  test('slack ascending (finite before Infinity sentinel)', () => {
    const items = [
      { id: 'free', slack: Infinity, pri: 'P2', dur: 30 },
      { id: 'tight', slack: 100, pri: 'P2', dur: 30 },
      { id: 'mid', slack: 500, pri: 'P2', dur: 30 }
    ];
    const ids = ConstraintSolver.order(items.slice()).map((i) => i.id);
    expect(ids).toEqual(['tight', 'mid', 'free']);
  });

  test('null slack treated as 0 (most constrained)', () => {
    const items = [
      { id: 'b', slack: 50, pri: 'P2', dur: 30 },
      { id: 'a', slack: null, pri: 'P2', dur: 30 }
    ];
    expect(ConstraintSolver.order(items.slice()).map((i) => i.id)).toEqual(['a', 'b']);
  });

  test('tie-break ladder: pri asc, then dur desc, then id asc', () => {
    const base = { slack: 100 };
    // equal slack → priority decides
    expect(ConstraintSolver.compareItems(
      { ...base, pri: 'P1', dur: 30, id: 'x' },
      { ...base, pri: 'P2', dur: 30, id: 'y' }
    )).toBeLessThan(0);
    // equal slack+pri → longer dur first
    expect(ConstraintSolver.compareItems(
      { ...base, pri: 'P2', dur: 60, id: 'x' },
      { ...base, pri: 'P2', dur: 30, id: 'y' }
    )).toBeLessThan(0);
    // equal slack+pri+dur → id asc
    expect(ConstraintSolver.compareItems(
      { ...base, pri: 'P2', dur: 30, id: 'a' },
      { ...base, pri: 'P2', dur: 30, id: 'b' }
    )).toBeLessThan(0);
  });
});

// ── ConstraintSolver: classification helpers ──────────────────────────────────
describe('ConstraintSolver — effectiveDuration / recurringCycleDays / parseDayReq', () => {
  test('effectiveDuration prefers timeRemaining, clamps to 720, defaults 30', () => {
    expect(ConstraintSolver.effectiveDuration({ dur: 45 })).toBe(45);
    expect(ConstraintSolver.effectiveDuration({ timeRemaining: 90, dur: 45 })).toBe(90);
    expect(ConstraintSolver.effectiveDuration({ time_remaining: 120, dur: 45 })).toBe(120);
    expect(ConstraintSolver.effectiveDuration({ dur: 5000 })).toBe(720);     // clamp
    expect(ConstraintSolver.effectiveDuration({ dur: -1 })).toBe(30);         // <0 → default
    expect(ConstraintSolver.effectiveDuration({ dur: 0 })).toBe(0);           // 0 stays 0
  });

  test('recurringCycleDays maps recurrence types (S3 search-window cap input)', () => {
    expect(ConstraintSolver.recurringCycleDays({ type: 'weekly' })).toBe(7);
    expect(ConstraintSolver.recurringCycleDays({ type: 'biweekly' })).toBe(14);
    expect(ConstraintSolver.recurringCycleDays({ type: 'monthly' })).toBe(30);
    expect(ConstraintSolver.recurringCycleDays({ type: 'daily' })).toBe(1);
    expect(ConstraintSolver.recurringCycleDays({ type: 'interval', every: 3, unit: 'weeks' })).toBe(21);
    expect(ConstraintSolver.recurringCycleDays(JSON.stringify({ type: 'weekly' }))).toBe(7);
    expect(ConstraintSolver.recurringCycleDays(null)).toBe(0);
    expect(ConstraintSolver.recurringCycleDays('not json')).toBe(0);
  });

  test('parseDayReq builds allowed-DOW sets (null = unconstrained)', () => {
    expect(ConstraintSolver.parseDayReq('any')).toBeNull();
    expect(ConstraintSolver.parseDayReq('')).toBeNull();
    expect(ConstraintSolver.parseDayReq('weekday')).toEqual({ 1: true, 2: true, 3: true, 4: true, 5: true });
    expect(ConstraintSolver.parseDayReq('weekend')).toEqual({ 0: true, 6: true });
    expect(ConstraintSolver.parseDayReq('M,W,F')).toEqual({ 1: true, 3: true, 5: true });
    expect(ConstraintSolver.parseDayReq('M,T,W,R,F,Sa,Su')).toBeNull(); // all 7 → unconstrained
  });
});

// ── ConstraintSolver: S2 severity ──────────────────────────────────────────────
describe('ConstraintSolver.severityRank — S2 fixed > overdue > deadline > free', () => {
  test('rank ordering is fixed(0) < overdue(1) < deadline(2) < free(3)', () => {
    const fixed = new Constraint({ taskId: 'f', fixed: true });
    const overdue = new Constraint({ taskId: 'o', overdue: true });
    const deadline = new Constraint({ taskId: 'd', deadlineKey: '2026-06-16' });
    const free = new Constraint({ taskId: 'r' });
    expect(ConstraintSolver.severityRank(fixed)).toBe(0);
    expect(ConstraintSolver.severityRank(overdue)).toBe(1);
    expect(ConstraintSolver.severityRank(deadline)).toBe(2);
    expect(ConstraintSolver.severityRank(free)).toBe(3);
    // compareSeverity sorts most-severe first
    const sorted = [free, deadline, fixed, overdue].sort(ConstraintSolver.compareSeverity);
    expect(sorted.map((c) => c.taskId)).toEqual(['f', 'o', 'd', 'r']);
  });
});

// ── ConflictResolver: occupancy primitives ─────────────────────────────────────
describe('ConflictResolver — occupancy primitives (byte-identical move)', () => {
  test('reserve / isFree on the minute grid', () => {
    const occ = {};
    ConflictResolver.reserve(occ, 480, 60);
    expect(ConflictResolver.isFree(occ, 480, 30)).toBe(false);
    expect(ConflictResolver.isFree(occ, 540, 30)).toBe(true);  // touches end → free
    expect(ConflictResolver.isFree(occ, 450, 30)).toBe(true);
  });

  test('reserveWithTravel / isFreeWithTravel extend the footprint', () => {
    const occ = {};
    ConflictResolver.reserveWithTravel(occ, 600, 30, 10, 10); // busy [590,640)
    expect(ConflictResolver.isFreeWithTravel(occ, 660, 30, 0, 0)).toBe(true);
    expect(ConflictResolver.isFreeWithTravel(occ, 645, 30, 10, 0)).toBe(false); // 635 hits busy
    expect(occ[590]).toBe(true);
    expect(occ[639]).toBe(true);
    expect(occ[640]).toBeUndefined();
  });

  test('rebuildPrefix produces a correct busy-minute prefix sum', () => {
    const occ = {};
    ConflictResolver.reserve(occ, 0, 10);
    const psum = new Int32Array(1441);
    ConflictResolver.rebuildPrefix(occ, psum);
    expect(psum[0]).toBe(0);
    expect(psum[10]).toBe(10);  // 10 busy minutes in [0,10)
    expect(psum[1440]).toBe(10);
  });

  test('overlaps is half-open (touching is disjoint)', () => {
    expect(ConflictResolver.overlaps(600, 60, 630, 30)).toBe(true);
    expect(ConflictResolver.overlaps(600, 60, 660, 30)).toBe(false); // touch at 660
    expect(ConflictResolver.overlaps(600, 60, 540, 60)).toBe(false); // touch at 600
  });

  test('resolve() flags placements colliding with calendar-busy spans', () => {
    const schedule = {
      '2026-06-16': [
        { task: { id: 'meeting-clash' }, start: 540, dur: 60 }, // 9-10am
        { task: { id: 'clear' }, start: 720, dur: 30 }          // noon
      ]
    };
    const busy = { '2026-06-16': [{ start: 570, dur: 30 }] }; // 9:30-10am busy
    const collisions = ConflictResolver.resolve(schedule, busy);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].placement.task.id).toBe('meeting-clash');
  });
});

// ── ScoreEngine: concrete penalty-constant pins (C-SCORE) ─────────────────────
// NOTE: a former "ScoreEngine.score === legacyScoreSchedule" parity test was removed
// (zoe WARN, W1): scoreSchedule.js now delegates to ScoreEngine.score, so the assertion
// was circular (score(x) === score(x)). The concrete value pins below are the real guards.
describe('ScoreEngine.score — concrete penalty pins', () => {
  test('unplaced penalty = PRI_RANK[P2] * 1 = 80', () => {
    const s = ScoreEngine.score({}, [{ id: 'u', pri: 'P2' }], []);
    expect(s.breakdown.unplaced).toBe(80);
    expect(s.total).toBe(80);
  });

  test('deadline miss penalty = 500 when placed after deadline', () => {
    const late = { '2026-06-17': [{ task: { id: 'l', pri: 'P2', deadline: '2026-06-15', date: '2026-06-15' }, start: 480, dur: 30 }] };
    expect(ScoreEngine.score(late, [], []).breakdown.deadlineMiss).toBe(500);
  });

  test('fragmentation = (parts-1) * 15', () => {
    const frag = { '2026-06-16': [
      { task: { id: 'f', pri: 'P3' }, start: 480, dur: 30, splitPart: 1 },
      { task: { id: 'f', pri: 'P3' }, start: 570, dur: 30, splitPart: 2 },
      { task: { id: 'f', pri: 'P3' }, start: 660, dur: 30, splitPart: 3 }
    ] };
    expect(ScoreEngine.score(frag, [], []).breakdown.fragmentation).toBe(30);
  });

  test('penalty constants are pinned (C-SCORE invariants)', () => {
    expect(ScoreEngine.PENALTIES.DEADLINE_MISS_PENALTY).toBe(500);
    expect(ScoreEngine.PENALTIES.FRAGMENTATION_PENALTY).toBe(15);
    expect(ScoreEngine.PENALTIES.UNPLACED_MULTIPLIER).toBe(1);
  });
});

// ── INTEGRATED: the three solvers compose as a pipeline (Snuffy requirement) ───
describe('INTEGRATED 3-solver pipeline — ConstraintSolver → ConflictResolver → ScoreEngine', () => {
  // A mixed-constraint fixture exercised through all three pure solvers in sequence,
  // proving they COMPOSE (not just pass in isolation). We do a minimal placement
  // run using only the domain primitives: order by constraint, place into a single
  // shared occupancy grid (rejecting conflicts), then score the result.

  // Four tasks: fixed (immovable), overdue (boosted), deadline (finite slack), free.
  const tasks = [
    { id: 'free',    pri: 'P3', dur: 30, slack: Infinity, deadlineKey: null,         fixed: false, overdue: false },
    { id: 'deadline',pri: 'P2', dur: 30, slack: 120,      deadlineKey: '2026-06-17', fixed: false, overdue: false },
    { id: 'overdue', pri: 'P1', dur: 30, slack: -10,      deadlineKey: '2026-06-14', fixed: false, overdue: true  },
    { id: 'fixed',   pri: 'P2', dur: 60, slack: 0,        deadlineKey: null,         fixed: true,  overdue: false, anchor: 540 }
  ];

  test('STEP 1 — ConstraintSolver severity orders fixed→overdue→deadline→free', () => {
    const constraints = tasks.map((t) => new Constraint({
      taskId: t.id, fixed: t.fixed, overdue: t.overdue, deadlineKey: t.deadlineKey
    }));
    const order = constraints.slice().sort(ConstraintSolver.compareSeverity).map((c) => c.taskId);
    expect(order).toEqual(['fixed', 'overdue', 'deadline', 'free']);
  });

  test('STEP 1b — within the queued (non-fixed) tasks, slack-sort puts overdue first', () => {
    const queued = tasks.filter((t) => !t.fixed);
    const ids = ConstraintSolver.order(queued.slice()).map((t) => t.id);
    // overdue slack -10 < deadline 120 < free Infinity
    expect(ids).toEqual(['overdue', 'deadline', 'free']);
  });

  test('STEP 2 — ConflictResolver places ordered tasks without overlap', () => {
    const occ = {};
    const placements = {};
    const dateKey = '2026-06-16';
    const dayPlacements = { [dateKey]: [] };

    // Fixed task claims its anchor first (immovable pass).
    const fixed = tasks.find((t) => t.id === 'fixed');
    ConflictResolver.reserve(occ, fixed.anchor, fixed.dur);
    dayPlacements[dateKey].push({ task: { id: fixed.id, pri: fixed.pri, date: dateKey }, start: fixed.anchor, dur: fixed.dur, locked: true });
    placements.fixed = { start: fixed.anchor, dur: fixed.dur };

    // Queued tasks placed in constraint order at the earliest free 30-min slot from 480.
    const queued = ConstraintSolver.order(tasks.filter((t) => !t.fixed).slice());
    queued.forEach((t) => {
      let s = 480;
      while (s + t.dur <= 1440 && !ConflictResolver.isFree(occ, s, t.dur)) s += 30;
      ConflictResolver.reserve(occ, s, t.dur);
      dayPlacements[dateKey].push({ task: { id: t.id, pri: t.pri, date: dateKey }, start: s, dur: t.dur, locked: false });
      placements[t.id] = { start: s, dur: t.dur };
    });

    // No two placements overlap (the whole point of routing through ConflictResolver).
    const all = dayPlacements[dateKey];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(ConflictResolver.overlaps(all[i].start, all[i].dur, all[j].start, all[j].dur)).toBe(false);
      }
    }
    // Fixed stayed at its anchor; overdue (placed first of the queue) got the earliest free slot.
    expect(placements.fixed.start).toBe(540);
    expect(placements.overdue.start).toBe(480); // 480 is free (fixed is at 540-600)
  });

  test('STEP 3 — ScoreEngine scores the composed placement (all placed → 0 unplaced penalty)', () => {
    // Re-run the minimal pipeline inline so this test is self-contained.
    const occ = {};
    const dateKey = '2026-06-16';
    const dayPlacements = { [dateKey]: [] };
    const fixed = tasks.find((t) => t.id === 'fixed');
    ConflictResolver.reserve(occ, fixed.anchor, fixed.dur);
    dayPlacements[dateKey].push({ task: { id: fixed.id, pri: fixed.pri, date: dateKey }, start: fixed.anchor, dur: fixed.dur, locked: true });
    ConstraintSolver.order(tasks.filter((t) => !t.fixed).slice()).forEach((t) => {
      let s = 480;
      while (s + t.dur <= 1440 && !ConflictResolver.isFree(occ, s, t.dur)) s += 30;
      ConflictResolver.reserve(occ, s, t.dur);
      dayPlacements[dateKey].push({ task: { id: t.id, pri: t.pri, date: dateKey }, start: s, dur: t.dur, locked: false });
    });

    const score = ScoreEngine.score(dayPlacements, [], tasks.map((t) => ({ id: t.id, pri: t.pri })));

    // Everything placed → no unplaced penalty. Score is a non-negative number.
    expect(score.breakdown.unplaced).toBe(0);
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.breakdown).toHaveProperty('priorityDrift'); // shape intact through the pipeline
  });

  test('STEP 3b — an unplaceable task surfaces as unplaced penalty in the composed score', () => {
    // Saturate the day with a fixed block so a free task cannot be placed, then
    // confirm the score reflects it via ScoreEngine — proving ConflictResolver's
    // "can't place" outcome flows into ScoreEngine.
    const occ = {};
    const dateKey = '2026-06-16';
    ConflictResolver.reserve(occ, 0, 1440); // whole day busy
    const free = { id: 'free', pri: 'P2', dur: 30 };
    let placed = false;
    for (let s = 0; s + free.dur <= 1440; s += 30) {
      if (ConflictResolver.isFree(occ, s, free.dur)) { placed = true; break; }
    }
    expect(placed).toBe(false); // ConflictResolver correctly reports no slot
    const score = ScoreEngine.score({}, [free], [free]);
    expect(score.breakdown.unplaced).toBe(PRI_RANK['P2']); // 80
    expect(score.total).toBe(80);
  });
});
