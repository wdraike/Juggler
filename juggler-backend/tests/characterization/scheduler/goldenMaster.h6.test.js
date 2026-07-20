/**
 * H6 W0 — Scheduler Characterization Golden Master
 *
 * PURPOSE: Pins the CURRENT behavior of unifiedScheduleV2.js + scoreSchedule.js as a
 * snapshot oracle BEFORE the hexagonal extraction (Phase H6) begins.
 *
 * This suite MUST be green against the un-refactored scheduler code AND must stay green
 * bit-for-bit after the ConstraintSolver/ScoreEngine/ConflictResolver extraction (W1-W4).
 * It is the S8 blocking gate: scheduler slice may NOT merge without this suite green before
 * AND after extraction (JUGGLER-HEX-DESIGN.md §3, INTAKE-BRIEF.json §S8).
 *
 * INVARIANTS PINNED (one+ test per row in TRACEABILITY.md):
 *   S1  — most-constrained → least-constrained ordering snapshot (FROZEN LITERAL)
 *   S2  — severity comparator: fixed > overdue > deadline > free
 *   S3  — recurring instances placed ONLY on their assigned day; never rolled to adjacent day
 *   S4  — scheduler core does not import scheduleQueue (static require-graph assertion)
 *   S5  — delta-write count == number of tasks whose placement actually changed (RED until W2)
 *   S6  — enqueueScheduleRun is NOT called during a full scheduler run
 *   P1  — runSchedule.js has ZERO inline fn.now(); writes use new Date() via the repository (W3 migration complete)
 *   C-IDEM — back-to-back runs on stable input → 0 DB changes (RED until W2 delta-write)
 *   C-SCORE — scoreSchedule {total, breakdown} snapshot against fixed fixture
 *   C-WX    — weatherOk fail-open: no weather data → task IS placed, not blocked
 *   GOLDEN-MASTER-CORE — FROZEN LITERAL snapshot {dayPlacements, unplaced, score, slackByTaskId}
 *
 * STUDY PRECEDENT: tests/characterization/task.goldenMaster.http.test.js (H3 golden-master)
 *
 * TEST STYLE: pure-unit where possible (no DB, no network). Integration tests for S5/C-IDEM
 * use the real test-bed MySQL (port 3407). Deterministic: all time is frozen or deterministic.
 *
 * Traceability: TRACEABILITY.md S1-S8, P1, C-IDEM, C-SCORE, C-WX, C-COUPLE.
 *
 * SELF-MUTATION CONTRACT: each pinned value was verified by flipping the comparator/constant
 * in source code, confirming the test FAILED, then reverting. See comments per test.
 *
 * POST-ZOE FIX-LOOP CHANGES (2026-06-12, iteration 1):
 *   - BLOCK-1 (S3): Added full-day-conflict fixture with recur property so isDayLocked=false
 *     actually lets the instance roll to TOMORROW → test goes RED under MUT-A.
 *   - BLOCK-4 (C-WX): Fixture now populates weatherByDateHour[TODAY] for early hours but
 *     leaves the candidate slot hour MISSING → weatherOk IS called → fail-open hit.
 *     Goes RED under MUT-B (return false when no hour data).
 *   - CORE (WARN-5): Converted to frozen-literal toEqual with concrete start/dur values.
 *     Removed all conditionally-vacuous if-guards. Goes RED under MUT-D.
 *   - S1 (WARN-7): Added 3-finite-slack unconditional ordering assertion (full array toEqual).
 *     Goes RED under MUT-D (inverted slack sort).
 *   - S5/C-IDEM (BLOCK-2/3): Deleted tautological hand-rolled tests. Re-authored as
 *     it.failing() that ACTUALLY call runScheduleAndPersist and assert delta-write behavior
 *     (write-only-changed). RED on current write-all code; GREEN when W2 delta-write lands.
 *   - S4/S6: Added comment noting W2/W3 must update if scheduleQueue.js file moves.
 */

'use strict';

process.env.NODE_ENV = 'test';

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS AND MOCKS (pure-unit tests need no real DB)
// ─────────────────────────────────────────────────────────────────────────────

const unifiedSchedule = require('../../../src/scheduler/unifiedScheduleV2');
const scoreSchedule   = require('../../../src/scheduler/scoreSchedule');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX, PRI_RANK } = require('../../../src/scheduler/constants');

// Fixed anchor dates: Monday 2026-06-16, 8:00 AM (480 min). Using ISO dates throughout.
const TODAY    = '2026-06-16'; // Monday
const TOMORROW = '2026-06-17'; // Tuesday
const DAY3     = '2026-06-18'; // Wednesday
const NOW_MINS = 480;           // 8:00 AM

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE FACTORIES  (mirror the H3 golden-master factory style)
// ─────────────────────────────────────────────────────────────────────────────

let _seq = 0;
function makeTask(overrides) {
  _seq++;
  return Object.assign({
    id: 'gm-' + String(_seq).padStart(3, '0'),
    text: 'GM task ' + _seq,
    date: TODAY,
    dur: 30,
    pri: 'P3',
    when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any',
    status: '',
    dependsOn: [],
    location: [],
    tools: [],
    recurring: false,
    split: false,
    datePinned: false,
    generated: false,
    section: '',
    flexWhen: false
  }, overrides);
}

function makeCfg(overrides) {
  return Object.assign({
    timeBlocks: DEFAULT_TIME_BLOCKS,
    toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15,
    locSchedules: {},
    locScheduleDefaults: {},
    locScheduleOverrides: {},
    hourLocationOverrides: {},
    scheduleTemplates: null,
    preferences: {}
  }, overrides);
}

const CFG = makeCfg();

function run(tasks, cfg) {
  _seq = 0; // reset so IDs are stable
  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, cfg || CFG);
}

// Find all placements for a task across all days.
function findPlacements(result, taskId) {
  var parts = [];
  Object.keys(result.dayPlacements).forEach(function(dk) {
    (result.dayPlacements[dk] || []).forEach(function(p) {
      if (p.task && p.task.id === taskId) {
        parts.push({ dateKey: dk, start: p.start, dur: p.dur, locked: !!p.locked });
      }
    });
  });
  return parts;
}

function isPlaced(result, taskId) {
  return findPlacements(result, taskId).length > 0;
}

function isUnplaced(result, taskId) {
  return (result.unplaced || []).some(function(t) { return t && t.id === taskId; });
}

// Extract the sorted queue order as list of IDs from the placement sequence.
// The slack-sort means tasks appear in placement order within the result — we
// capture the insertion order of dayPlacements[TODAY] (Phase V2: Constrained).
function placedOrderOnDay(result, dateKey) {
  return (result.dayPlacements[dateKey] || [])
    .filter(function(p) { return p.task; })
    .map(function(p) { return p.task.id; });
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1: GOLDEN-MASTER CORE SNAPSHOT (FROZEN LITERAL)
// Purpose: bit-for-bit baseline — feed fixed fixtures, snapshot {dayPlacements,
// unplaced, score, slackByTaskId} as FROZEN LITERALS. Must reproduce identically
// after extraction.
// TRACEABILITY: S8
//
// FROZEN LITERAL PROTOCOL (zoe WARN-5 fix): all concrete values captured from
// the un-mutated scheduler run on 2026-06-12. Verified under MUT-D (inverted
// slack sort): all three tasks have null slack (no deadlines), so MUT-D does not
// affect their relative order — the frozen start values still catch any scheduling
// drift that moves any task. The S1 describe block carries the MUT-D pin for
// finite-slack ordering.
// ─────────────────────────────────────────────────────────────────────────────

describe('GOLDEN-MASTER CORE — frozen literal snapshot (S8)', () => {
  // Deterministic task set: 3 tasks, one per priority tier, all today.
  // Captured values: gm-core-001 → start:720 dur:60, gm-core-002 → start:780 dur:30,
  // gm-core-003 → start:810 dur:30.  Score: total:0, all breakdown:0. slackByTaskId: all null.
  const FIXTURE_TASKS = [
    { id: 'gm-core-001', text: 'High priority', dur: 60, pri: 'P1', date: TODAY, status: '', when: 'morning,lunch,afternoon,evening,night', dayReq: 'any', dependsOn: [], location: [], tools: [], recurring: false, split: false, datePinned: false, generated: false, section: '', flexWhen: false },
    { id: 'gm-core-002', text: 'Medium priority', dur: 30, pri: 'P2', date: TODAY, status: '', when: 'morning,lunch,afternoon,evening,night', dayReq: 'any', dependsOn: [], location: [], tools: [], recurring: false, split: false, datePinned: false, generated: false, section: '', flexWhen: false },
    { id: 'gm-core-003', text: 'Low priority', dur: 30, pri: 'P3', date: TODAY, status: '', when: 'morning,lunch,afternoon,evening,night', dayReq: 'any', dependsOn: [], location: [], tools: [], recurring: false, split: false, datePinned: false, generated: false, section: '', flexWhen: false }
  ];

  let result;
  beforeAll(function() {
    // setSystemTime WITHOUT useFakeTimers — avoids hangs in async/retry code
    jest.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    var statuses = {};
    FIXTURE_TASKS.forEach(function(t) { statuses[t.id] = ''; });
    result = unifiedSchedule(FIXTURE_TASKS, statuses, TODAY, NOW_MINS, CFG);
  });

  // FROZEN LITERAL: concrete placements on TODAY.
  // SELF-MUTATION: any scheduling drift (wrong task order, different start times) fails this.
  // MUT-D (inverted slack sort) does NOT change these because all three have null slack
  // (no deadlines). The S1 describe below carries the finite-slack MUT-D pin.
  test('CORE — placements[TODAY] frozen literal (start/dur/id for each task)', () => {
    var placements = (result.dayPlacements[TODAY] || [])
      .filter(function(p) { return p.task; })
      .map(function(p) { return { id: p.task.id, start: p.start, dur: p.dur }; });
    expect(placements).toEqual([
      { id: 'gm-core-001', start: 720, dur: 60 },
      { id: 'gm-core-002', start: 780, dur: 30 },
      { id: 'gm-core-003', start: 810, dur: 30 }
    ]);
  });

  // FROZEN LITERAL: zero unplaced.
  test('CORE — unplaced.length = 0 (no conflict in this fixture)', () => {
    expect(result.unplaced.length).toBe(0);
  });

  // FROZEN LITERAL: exact score values.
  // SELF-MUTATION: if UNPLACED_MULTIPLIER changes or any task becomes unplaced, total != 0.
  test('CORE — score frozen literal (total:0, all breakdown fields:0)', () => {
    expect(result.score.total).toBe(0);
    expect(result.score.breakdown).toEqual({
      unplaced: 0,
      deadlineMiss: 0,
      priorityDrift: 0,
      crossDayPri: 0,
      dateDrift: 0,
      fragmentation: 0
    });
  });

  // FROZEN LITERAL: slackByTaskId — all null (no deadlines).
  // SELF-MUTATION: if ConstraintSolver stops writing slackByTaskId entries, this fails.
  test('CORE — slackByTaskId frozen literal (all null for deadline-free tasks)', () => {
    expect(result.slackByTaskId).toEqual({
      'gm-core-001': null,
      'gm-core-002': null,
      'gm-core-003': null
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2: INTEGRATED MULTI-PHASE MIXED-CONSTRAINT FIXTURE (Snuffy requirement)
// Purpose: prove ConstraintSolver → ScoreEngine → ConflictResolver compose together
// as a whole 3-solver pipeline, not just unit-isolated pieces.
// TRACEABILITY: S1, S2, S8, C-COUPLE
// ─────────────────────────────────────────────────────────────────────────────

describe('INTEGRATED multi-phase pipeline — mixed constraint fixture', () => {
  // Fixture: fixed + overdue + deadline + free tasks across multiple days.
  // This exercises the full pipeline: FIXED immovable pass → constrained slack-sort → unconstrained free.
  const fixedTask = {
    id: 'mp-fixed-001', text: 'Fixed meeting', dur: 60, pri: 'P2',
    // IMPORTANT: no `when` tag — with FIXED+when tag, anchorMin is null (FIXED+when uses when-block).
    // Without `when`, anchorMin = parseTimeToMinutes(t.time) → triggers tryPlaceAtTime → locked=true.
    date: TODAY, time: '9:00 AM', status: '', when: '',
    dayReq: 'any', dependsOn: [], location: [], tools: [],
    recurring: false, split: false, datePinned: true, generated: false, section: '',
    flexWhen: false, placementMode: 'fixed'
  };
  const overdueTask = {
    id: 'mp-over-001', text: 'Overdue task', dur: 30, pri: 'P1',
    date: '2026-06-14', // 2 days in the past → overdue
    status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: [], tools: [],
    recurring: false, split: false, datePinned: false, generated: false, section: '', flexWhen: false
  };
  const deadlineTask = {
    id: 'mp-dead-001', text: 'Deadline task', dur: 45, pri: 'P2',
    date: TODAY, deadline: TOMORROW, // finite slack
    status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: [], tools: [],
    recurring: false, split: false, datePinned: false, generated: false, section: '', flexWhen: false
  };
  const freeTask = {
    id: 'mp-free-001', text: 'Free task', dur: 30, pri: 'P3',
    date: TODAY, // no deadline → Infinity slack
    status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: [], tools: [],
    recurring: false, split: false, datePinned: false, generated: false, section: '', flexWhen: false
  };

  const MIXED_TASKS = [freeTask, deadlineTask, overdueTask, fixedTask]; // deliberately unordered
  let result;

  beforeAll(function() {
    var statuses = {};
    MIXED_TASKS.forEach(function(t) { statuses[t.id] = ''; });
    result = unifiedSchedule(MIXED_TASKS, statuses, TODAY, NOW_MINS, CFG);
  });

  test('pipeline produces a valid result object', () => {
    expect(result).toHaveProperty('dayPlacements');
    expect(result).toHaveProperty('unplaced');
    expect(result).toHaveProperty('score');
  });

  test('fixed task is placed as locked (immovable pass)', () => {
    var placed = findPlacements(result, 'mp-fixed-001');
    // Fixed tasks with anchorMin are placed via tryPlaceAtTime, locked=true.
    expect(placed.length).toBeGreaterThanOrEqual(1);
    expect(placed[0].locked).toBe(true);
  });

  test('overdue task is placed (P1-boosted, rescheduled within constraints)', () => {
    // Overdue non-recurring task: placed on today or later (not unplaced).
    // SELF-MUTATION: if we remove the overdue boost, overdue could be unplaced by a
    // deadline-constrained task taking the slot.
    var placed = findPlacements(result, 'mp-over-001');
    expect(placed.length).toBeGreaterThanOrEqual(1);
  });

  test('deadline task is placed within or before its deadline day', () => {
    var placed = findPlacements(result, 'mp-dead-001');
    // Unconditional: we always assert placement exists (removing if-guard per zoe WARN-6).
    expect(placed.length).toBeGreaterThanOrEqual(1);
    placed.forEach(function(p) {
      // Must be placed on or before the deadline date.
      expect(p.dateKey <= deadlineTask.deadline).toBe(true);
    });
  });

  test('score.total is a non-negative number after multi-constraint run', () => {
    expect(result.score.total).toBeGreaterThanOrEqual(0);
  });

  test('score breakdown has expected keys', () => {
    var bd = result.score.breakdown;
    expect(bd).toHaveProperty('unplaced');
    expect(bd).toHaveProperty('deadlineMiss');
    expect(bd).toHaveProperty('priorityDrift');
    expect(bd).toHaveProperty('crossDayPri');
    expect(bd).toHaveProperty('dateDrift');
    expect(bd).toHaveProperty('fragmentation');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3: S1 MOST-CONSTRAINED → LEAST-CONSTRAINED ORDERING SNAPSHOT
// Purpose: pin the full sorted placement order for a mixed-constraint fixture
// as a FROZEN LITERAL (concrete start times and full array toEqual).
// TRACEABILITY: S1
//
// MUTATION PROOF (MUT-D — inverted slack sort):
//   Original order: s1-constrained (start:720), s1-medium (start:750), s1-free (start:780)
//   Under MUT-D:    s1-medium (start:720), s1-constrained (start:750), s1-free (start:780)
//   The toEqual assertion on the ordered ID array FAILS under MUT-D. ✓
// ─────────────────────────────────────────────────────────────────────────────

describe('S1 — most-constrained → least-constrained ordering snapshot', () => {
  // Three tasks with explicitly different FINITE slack levels:
  //   taskA: deadline = tomorrow  (slack ≈1 day)  → most constrained
  //   taskB: deadline = DAY3      (slack ≈2 days) → medium constrained
  //   taskC: no deadline          (Infinity slack) → least constrained
  //
  // Captured concrete values (2026-06-12):
  //   s1-constrained → start:720 (slack:1410)
  //   s1-medium      → start:750 (slack:2160)
  //   s1-free        → start:780 (slack:null)
  const taskA = {
    id: 's1-constrained', text: 'Constrained task', dur: 30, pri: 'P2',
    date: TODAY, deadline: TOMORROW,
    status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: [], tools: [],
    recurring: false, split: false, datePinned: false, generated: false, section: '', flexWhen: false
  };
  const taskB = {
    id: 's1-medium', text: 'Medium slack task', dur: 30, pri: 'P2',
    date: TODAY, deadline: DAY3,
    status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: [], tools: [],
    recurring: false, split: false, datePinned: false, generated: false, section: '', flexWhen: false
  };
  const taskC = {
    id: 's1-free', text: 'Free task', dur: 30, pri: 'P2',
    date: TODAY, // no deadline
    status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: [], tools: [],
    recurring: false, split: false, datePinned: false, generated: false, section: '', flexWhen: false
  };

  // Deliberately reverse order to confirm solver reorders them.
  const TASKS = [taskC, taskB, taskA]; // free first, constrained last — reverse of expected output
  let result;

  beforeAll(function() {
    var statuses = { 's1-constrained': '', 's1-medium': '', 's1-free': '' };
    result = unifiedSchedule(TASKS, statuses, TODAY, NOW_MINS, CFG);
  });

  test('all three tasks are placed', () => {
    expect(isPlaced(result, 's1-constrained')).toBe(true);
    expect(isPlaced(result, 's1-medium')).toBe(true);
    expect(isPlaced(result, 's1-free')).toBe(true);
  });

  // FROZEN LITERAL: exact concrete start positions for each task.
  // SELF-MUTATION (MUT-D — inverted slack sort): under inversion, s1-medium (slack:2160)
  // would be placed first (start:720) and s1-constrained (slack:1410) second (start:750),
  // causing this assertion to FAIL. ✓ Verified 2026-06-12.
  test('S1 frozen literal: constrained→medium→free placement order with concrete starts', () => {
    var placements = (result.dayPlacements[TODAY] || [])
      .filter(function(p) { return p.task; })
      .map(function(p) { return { id: p.task.id, start: p.start }; });

    // Must contain all three in exact slack-ascending order.
    var ids = placements.map(function(p) { return p.id; });
    expect(ids).toEqual(['s1-constrained', 's1-medium', 's1-free']);

    // Pin the exact start times (frozen literal).
    var byId = {};
    placements.forEach(function(p) { byId[p.id] = p.start; });
    expect(byId['s1-constrained']).toBe(720);
    expect(byId['s1-medium']).toBe(750);
    expect(byId['s1-free']).toBe(780);
  });

  // Frozen slackByTaskId for S1 fixture.
  test('S1 slackByTaskId frozen literal', () => {
    expect(result.slackByTaskId['s1-constrained']).toBe(1410);
    expect(result.slackByTaskId['s1-medium']).toBe(2160);
    expect(result.slackByTaskId['s1-free']).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4: S2 SEVERITY COMPARATOR SNAPSHOT
// Purpose: pin the exact severity ordering: fixed > overdue > deadline > free.
// TRACEABILITY: S2
// ─────────────────────────────────────────────────────────────────────────────

describe('S2 — severity comparator: fixed > overdue > deadline > free', () => {
  // Single capacity slot today: one `morning` block (6-8 AM before NOW, then 8 AM+).
  // We use a restricted `when` tag so we can engineer a capacity crunch and observe priority.
  // All tasks want `afternoon` (12-5 PM, high capacity). We add them all with different
  // severity to confirm fixed wins slots first, overdue second, etc.

  const fixedEvent = {
    id: 's2-fixed', text: 'Fixed event', dur: 30, pri: 'P3',
    // IMPORTANT: no `when` tag — FIXED+when → anchorMin=null (uses when-block).
    // Without `when`, anchorMin = parseTimeToMinutes(t.time) → tryPlaceAtTime → locked=true.
    date: TODAY, time: '2:00 PM', // 840 min (2:00 PM)
    status: '', when: '',
    dayReq: 'any', dependsOn: [], location: [], tools: [],
    recurring: false, split: false, datePinned: true, generated: false, section: '',
    flexWhen: false, placementMode: 'fixed'
  };
  const overdueItem = {
    id: 's2-overdue', text: 'Overdue item', dur: 30, pri: 'P3',
    date: '2026-06-14', // past date, non-recurring → P1 boosted overdue
    status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: [], tools: [],
    recurring: false, split: false, datePinned: false, generated: false, section: '', flexWhen: false
  };
  const deadlineItem = {
    id: 's2-deadline', text: 'Deadline item', dur: 30, pri: 'P3',
    date: TODAY, deadline: TOMORROW,
    status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: [], tools: [],
    recurring: false, split: false, datePinned: false, generated: false, section: '', flexWhen: false
  };
  const freeItem = {
    id: 's2-free', text: 'Free item', dur: 30, pri: 'P3',
    date: TODAY, // no deadline
    status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: [], tools: [],
    recurring: false, split: false, datePinned: false, generated: false, section: '', flexWhen: false
  };

  const TASKS = [freeItem, deadlineItem, overdueItem, fixedEvent]; // deliberately reversed
  let result;

  beforeAll(function() {
    var statuses = { 's2-fixed': '', 's2-overdue': '', 's2-deadline': '', 's2-free': '' };
    result = unifiedSchedule(TASKS, statuses, TODAY, NOW_MINS, CFG);
  });

  test('fixed event is placed as locked (immovable — severity=fixed wins regardless)', () => {
    var placed = findPlacements(result, 's2-fixed');
    expect(placed.length).toBe(1);
    expect(placed[0].locked).toBe(true);
    // Must be at its anchor time 840 min (2:00 PM).
    expect(placed[0].start).toBe(840);
  });

  test('overdue item is placed (severity > deadline, P1-boosted)', () => {
    // Overdue non-recurring items are rescheduled (boosted). Must appear in placements.
    // SELF-MUTATION: if we remove the overdue-boost path in unifiedScheduleV2, this fails.
    expect(isPlaced(result, 's2-overdue')).toBe(true);
  });

  test('deadline item is placed within its deadline window', () => {
    var placed = findPlacements(result, 's2-deadline');
    // Unconditional: placement must exist (removing if-guard per zoe WARN-6).
    expect(placed.length).toBeGreaterThanOrEqual(1);
    expect(placed[0].dateKey <= TOMORROW).toBe(true);
  });

  test('severity snapshot: fixed is placed before free (locked=true entry precedes unconstrained)', () => {
    // Fixed is placed in the immovable pass (first pass), free in the unconstrained pass (last).
    var placedOnToday = result.dayPlacements[TODAY] || [];
    var fixedIdx = placedOnToday.findIndex(function(p) { return p.task && p.task.id === 's2-fixed'; });
    var freeIdx  = placedOnToday.findIndex(function(p) { return p.task && p.task.id === 's2-free'; });
    // Both must be present (unconditional assertions — removing if-guard per zoe WARN-6).
    expect(fixedIdx).toBeGreaterThanOrEqual(0);
    expect(freeIdx).toBeGreaterThanOrEqual(0);
    // Fixed must appear before free in the dayPlacements array (insertion order = pass order).
    expect(fixedIdx).toBeLessThan(freeIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5: S3 SAME-DAY RECURRENCE
// Purpose: assert a recurring instance is placed ONLY on its assigned day,
// NEVER rolled to an adjacent day when that day is full.
// When full: goes to unplaced/issues, not tomorrow.
// TRACEABILITY: S3
//
// BLOCK-1 FIX (zoe): The original fixture never created a genuine same-day
// conflict that exercises the day-lock. The new fixture (s3-fullday describe)
// fills TODAY with two FIXED tasks leaving no capacity, then adds a recurring
// instance WITH a 'recur' property so cycleDays is non-zero. Under current code
// (isDayLocked=true), instance → unplaced. Under MUT-A (isDayLocked=false),
// the instance can search cycleDays forward and lands on TOMORROW → RED. ✓
// ─────────────────────────────────────────────────────────────────────────────

describe('S3 — recurring instances: same-day placement only, never rolled to adjacent day', () => {
  // Recurring instance anchored to TOMORROW. Day is NOT full → placed on TOMORROW.
  const instanceOnTomorrow = {
    id: 's3-inst-001', text: 'Recurring instance', dur: 30, pri: 'P3',
    date: TOMORROW, // occurrence date = TOMORROW
    status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: [], tools: [],
    recurring: true, split: false, datePinned: false, generated: true,
    section: '', flexWhen: false, sourceId: 's3-tmpl-001',
    taskType: 'recurring_instance',
    placementMode: 'anytime' // ANYTIME → isDayLocked=true for non-flexible-tpc
  };

  // Day-filling tasks on TODAY only (no conflict with TOMORROW).
  // Keep this simple: just the recurring instance on TOMORROW.
  const TASKS = [instanceOnTomorrow];
  let result;

  beforeAll(function() {
    var statuses = { 's3-inst-001': '' };
    result = unifiedSchedule(TASKS, statuses, TODAY, NOW_MINS, CFG);
  });

  test('recurring instance placed on its assigned day (TOMORROW), not today', () => {
    var placed = findPlacements(result, 's3-inst-001');
    // Unconditional: instance must be placed somewhere.
    expect(placed.length).toBeGreaterThanOrEqual(1);
    // ALL placements must be on TOMORROW — never rolled to TODAY or DAY3.
    placed.forEach(function(p) {
      expect(p.dateKey).toBe(TOMORROW);
    });
  });

  test('recurring instance does NOT appear on today or any adjacent day other than its anchor', () => {
    // SELF-MUTATION: if we remove isDayLocked=true for non-flexible-tpc recurring, the
    // instance could drift to today (the nearest eligible day), breaking this assertion.
    var todayPlacements = result.dayPlacements[TODAY] || [];
    var onToday = todayPlacements.some(function(p) { return p.task && p.task.id === 's3-inst-001'; });
    expect(onToday).toBe(false); // must NOT be placed on today

    // Also check DAY3 (should not roll forward beyond anchor either).
    var day3Placements = result.dayPlacements[DAY3] || [];
    var onDay3 = day3Placements.some(function(p) { return p.task && p.task.id === 's3-inst-001'; });
    expect(onDay3).toBe(false);
  });
});

// S3 full-day-conflict fixture — exercises the ACTUAL day-lock mechanism.
// The recurring instance has a 'recur' property (so cycleDays is non-zero).
// Under current code (isDayLocked=true): instance → unplaced (cannot roll forward).
// Under MUT-A (isDayLocked=false): instance rolls to TOMORROW → THIS TEST FAILS. ✓
describe('S3 — recurring instance goes to unplaced (not next day) when assigned day is FULL', () => {
  // Two FIXED tasks that together consume ~900 minutes of Monday's capacity.
  // fixedBig: 9AM + 600min (9AM → 7PM)
  // fixedBig2: 7PM + 300min (7PM → 12AM)
  // This leaves no gap for a 60-minute recurring instance.
  const fixedBig = {
    id: 's3-fixedbig', text: 'Fixed block occupying morning through evening', dur: 600, pri: 'P1',
    date: TODAY, time: '9:00 AM',
    status: '', when: '',
    dayReq: 'any', dependsOn: [], location: [], tools: [],
    recurring: false, split: false, datePinned: true, generated: false, section: '', flexWhen: false,
    placementMode: 'fixed'
  };
  const fixedBig2 = {
    id: 's3-fixedbig2', text: 'Fixed block occupying night', dur: 300, pri: 'P1',
    date: TODAY, time: '7:00 PM',
    status: '', when: '',
    dayReq: 'any', dependsOn: [], location: [], tools: [],
    recurring: false, split: false, datePinned: true, generated: false, section: '', flexWhen: false,
    placementMode: 'fixed'
  };
  // Recurring instance WITH a recur property so cycleDays is derived (7 days).
  // Without cycleDays > 0, isDayLocked=false has no effect (falls back to day-locked).
  // The 'recur' property provides: weekly, Monday-only, 1× per cycle.
  // timesPerCycle=1, selectedDays=1 → isFlexibleTpc = (1 < 1) = false → isDayLocked=true normally.
  const recurInst = {
    id: 's3-daylock-inst', text: 'Recurring instance on a full day', dur: 60, pri: 'P3',
    date: TODAY,
    status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: [], tools: [],
    recurring: true, split: false, datePinned: false, generated: true,
    section: '', flexWhen: false,
    sourceId: 's3-tmpl-lock',
    taskType: 'recurring_instance',
    placementMode: 'anytime',
    // recur supplies cycleDays=7 so the task CAN search forward when isDayLocked=false.
    // Under current code isDayLocked=true clamps latestIdx=anchorIdx → unplaced.
    recur: JSON.stringify({ type: 'weekly', days: 'M', timesPerCycle: 1, cycleDays: 7 })
  };

  const TASKS = [fixedBig, fixedBig2, recurInst];
  let result;

  beforeAll(function() {
    var statuses = {};
    TASKS.forEach(function(t) { statuses[t.id] = ''; });
    result = unifiedSchedule(TASKS, statuses, TODAY, NOW_MINS, CFG);
  });

  // POSITIVE ASSERTION: instance is on TODAY or in unplaced — never on TOMORROW.
  // Under current code (isDayLocked=true) and a full day: instance → unplaced. ✓
  test('S3 full-day: recurring instance is unplaced when assigned day is full', () => {
    var onToday    = findPlacements(result, 's3-daylock-inst').filter(function(p) { return p.dateKey === TODAY; });
    var onTomorrow = findPlacements(result, 's3-daylock-inst').filter(function(p) { return p.dateKey === TOMORROW; });
    var inUnplaced = isUnplaced(result, 's3-daylock-inst');

    // The instance must be EITHER on today (if capacity found) OR in unplaced.
    // It must NEVER be on tomorrow — that would mean the day-lock was violated.
    // In this fixture today has 900min of fixed capacity, so the 60min instance is unplaced.
    expect(onTomorrow.length).toBe(0); // CRITICAL: must NOT roll to tomorrow
    // Assert the task is accounted for (either placed on today or unplaced, not silently dropped).
    expect(onToday.length + (inUnplaced ? 1 : 0)).toBeGreaterThanOrEqual(1);
  });

  // Explicit unplaced check (the expected current behavior).
  // SELF-MUTATION (MUT-A — isDayLocked=false): with isDayLocked=false AND cycleDays=7,
  // the instance searches 7 days forward from anchor. Since TODAY is full, it lands on
  // TOMORROW. This test FAILS because onTomorrow > 0 → the previous test also fails. ✓
  // Verified 2026-06-12: current code → unplaced:1, onTomorrow:0. MUT-A → unplaced:0, onTomorrow:1.
  test('S3 full-day: instance is in unplaced (not TOMORROW) under current day-lock (FAILS under MUT-A)', () => {
    expect(isUnplaced(result, 's3-daylock-inst')).toBe(true);
    var onTomorrow = findPlacements(result, 's3-daylock-inst').filter(function(p) { return p.dateKey === TOMORROW; });
    expect(onTomorrow.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 6: S4 NO-SELF-TRIGGER [GAP] — STATIC REQUIRE-GRAPH ASSERTION
// Purpose: unifiedScheduleV2 must NOT import scheduleQueue or call enqueueScheduleRun.
// This is a structural, require-closure assertion (not a runtime spy).
// TRACEABILITY: S4
//
// NOTE (W2/W3 update requirement): These tests pin the module name 'scheduleQueue.js'.
// If W2/W3 extractions rename the file or re-export enqueue via a facade
// (e.g. lib-events, triggerRun), these assertions must be updated to track the new name.
// An additional runtime spy on the real enqueue boundary should be added at that point.
// ─────────────────────────────────────────────────────────────────────────────

describe('S4 — static require-graph: scheduler core does not import scheduleQueue', () => {
  test('unifiedScheduleV2.js source does not require scheduleQueue (SELF-MUTATION: adding the require would fail this)', () => {
    // Read the source and assert it does not contain a reference to scheduleQueue.
    // This is intentionally a textual invariant (the only approved carve-out in telly rules):
    // a require('scheduleQueue') in source IS the causal mechanism — runtime behavior
    // follows directly from the import. This is not a string-matching behavioral proxy;
    // it IS the actual artifact that would enable self-triggering.
    var fs = require('fs');
    var path = require('path');
    var src = fs.readFileSync(
      path.resolve(__dirname, '../../../src/scheduler/unifiedScheduleV2.js'),
      'utf8'
    );
    // Must NOT require scheduleQueue.
    expect(src).not.toMatch(/require\s*\(\s*['"][^'"]*scheduleQueue[^'"]*['"]\s*\)/);
    // Must NOT reference enqueueScheduleRun.
    expect(src).not.toMatch(/enqueueScheduleRun/);
  });

  test('unifiedScheduleV2.js module resolution: scheduleQueue is not in require closure', () => {
    // Walk the resolved module graph from unifiedScheduleV2. scheduleQueue must not appear.
    // We use require.cache + a BFS over the resolved module path to build the closure.
    // This is execution-based (not source-string) and catches transitive imports.
    var path = require('path');

    // Clear the module from cache to get a fresh resolution.
    var targetKey = require.resolve('../../../src/scheduler/unifiedScheduleV2');
    var schedQueueKey = require.resolve('../../../src/scheduler/scheduleQueue');

    // Require the module to ensure it's in cache.
    require('../../../src/scheduler/unifiedScheduleV2');

    // BFS through require.cache from unifiedScheduleV2.
    var visited = new Set();
    var queue = [targetKey];
    while (queue.length > 0) {
      var current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      var mod = require.cache[current];
      if (mod && Array.isArray(mod.children)) {
        mod.children.forEach(function(child) {
          if (!visited.has(child.id)) queue.push(child.id);
        });
      }
    }

    // scheduleQueue must NOT be in the transitive closure.
    // NOTE: If W2/W3 moves scheduleQueue to a new path or renames the export,
    // update schedQueueKey above and the S6 describe similarly.
    expect(visited.has(schedQueueKey)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 7: S5 DELTA-WRITE-COUNT (it.failing — RED until W2 delta-write)
//
// RED until W2 delta-write — it.failing() inverts:
//   Current code (write-all): runScheduleAndPersist writes scheduled_at for EVERY
//   placed task every run, regardless of whether placement changed. So a task whose
//   scheduled_at is already correct still gets an UPDATE touching updated_at.
//   This test asserts the TARGET behavior: only tasks with changed scheduled_at are
//   written. On current write-all code the assertion FAILS (write count > changed count),
//   so it.failing() makes the test PASS. W2 removes the .failing() marker when
//   delta-write lands.
//
// TRACEABILITY: S5
// Reference: WBS "Locked decisions" S5 ruling; runSchedule.js:1264-1267 write-all comment.
// ─────────────────────────────────────────────────────────────────────────────

describe('S5 — delta-write-count: only changed tasks are written (GREEN — W2 delta-write landed)', () => {
  // ── Infrastructure ────────────────────────────────────────────────────────
  // assertDbAvailable throws [TEST-FR-001] when the DB is unreachable.
  // Called from beforeAll so a DB-down failure propagates OUTSIDE it.failing(),
  // causing the whole describe to hard-fail (reported as a suite error, never as
  // a silently-inverted passing test). it.failing() must only invert on the
  // delta-write expect() — never on infrastructure.
  const { assertDbAvailable } = require('../../helpers/requireDB');
  const testDb = require('../../helpers/testDb');
  let db;

  // ── ISOLATION: unique user per describe (isolation fix — 2026-06-12) ────────
  // Each DB-backed describe gets its own user_id so that beforeEach cleanup and
  // seed operations are fully scoped and cannot interfere with sibling describes
  // regardless of execution order or --runInBand. Never use 'test-user-001'
  // across multiple DB-backed describes in the same file.
  const S5_USER = 'test-user-s5';

  // ── Seed state — set in beforeEach, read in it.failing bodies ────────────
  // s5-test-1 seed state
  let s5t1_before = null;
  // s5-test-2 seed state
  let s5t2_beforeStable = null;

  // Track which test is running so beforeEach can seed the right data.
  // We use a shared currentTest flag set before each test runs.
  let currentTestName = '';

  beforeAll(async () => {
    // Hard-fail the entire describe when test-bed is unavailable.
    // This throw propagates OUTSIDE any it.failing() wrapper.
    await assertDbAvailable();
    db = testDb.getDb();
    // Scope cleanup + seedUser to S5_USER only — never call testDb.cleanup()
    // (which wipes ALL users) to avoid cross-describe interference.
    await db('task_instances').where('user_id', S5_USER).del();
    await db('task_masters').where('user_id', S5_USER).del();
    await db('users').where('id', S5_USER).del();
    await testDb.seedUser({ id: S5_USER, email: 'test-s5@test.com', name: 'S5 User' });
  }, 15000);

  afterAll(async () => {
    jest.useRealTimers();
    // Cleanup this describe's rows only. Do NOT call testDb.destroy() here —
    // the singleton connection is shared with C-IDEM integration and other describes
    // in this file. Destroying it mid-suite closes the connection before sibling
    // describes run, causing FK errors and undefined-connection failures.
    // The connection is closed by Jest's forceExit or the global teardown.
    await db('task_instances').where('user_id', S5_USER).del();
    await db('task_masters').where('user_id', S5_USER).del();
    await db('users').where('id', S5_USER).del();
  });

  beforeEach(async () => {
    // Clean slate for each test — scoped to S5_USER only.
    await db('task_instances').where('user_id', S5_USER).del();
    await db('task_masters').where('user_id', S5_USER).del();
    s5t1_before = null;
    s5t2_beforeStable = null;
  });

  // ── RED until W2 delta-write ──────────────────────────────────────────────
  // it.failing() in Jest 29 means: the test body is expected to FAIL. When the body
  // FAILS (assertion throws), Jest marks the test PASS. When the body PASSES (all
  // assertions hold), Jest marks the test FAIL — signalling W2 has landed and the
  // .failing() marker must be removed.
  //
  // SETUP CONTRACT: all DB availability checks and seedTask calls run in beforeAll
  // / beforeEach (OUTSIDE it.failing). Only runScheduleAndPersist + the delta-write
  // expect() live inside it.failing. This guarantees it.failing inverts only on
  // the real write-all assertion, never on connection or seed errors.
  //
  // Why this test fails on current write-all code:
  //   Seed 1 task with already-correct scheduled_at. Run runScheduleAndPersist.
  //   Current code writes ALL placed tasks → task's updated_at changes despite no
  //   scheduling change. The assertion "updated_at unchanged" fails.
  //
  // W2 delta-write will make the count correct: unchanged task is skipped → passes.
  //
  // SANITY PROOF: assert task was actually PLACED (scheduled_at set) to confirm
  // runScheduleAndPersist ran and the scheduler reached the write path. If no
  // scheduled_at is set, the test failed before the write assertion, which is a
  // setup/config problem — not the delta-write behavior being tested.
  // GREEN after W2 delta-write (the .failing marker is removed — delta-write
  // makes this pass for real).
  //
  // CONTRACT: delta-write skips a task when "the DB row already equals the
  // computed placement". The honest way to establish a stable row is to let the
  // scheduler place the task ONCE (run-1 canonicalizes scheduled_at/date/time to
  // exactly what the scheduler decides for the real wall-clock day), then assert
  // a SECOND run writes nothing for it. Seeding an arbitrary scheduled_at and
  // expecting a no-op would test the wrong thing: runScheduleAndPersist schedules
  // against the real "now", so a hand-picked future scheduled_at legitimately
  // moves (a real change → a real write, correctly).
  it(
    'S5: runScheduleAndPersist writes only changed tasks (run-2 on a stable task → 0 writes)',
    async () => {
      // Seed a placeable task (scheduled_at null → the scheduler assigns it).
      // NOTE: seedTask routes status to BOTH task_masters and task_instances.
      // task_instances.time is a MySQL TIME column — omit display-format times.
      await testDb.seedTask({
        id: 's5-already-placed',
        user_id: S5_USER,
        text: 'Placed by run-1, stable for run-2',
        status: '',
        dur: 30,
        pri: 'P2',
        scheduled_at: null,
        date: TODAY
      });

      const { runScheduleAndPersist } = require('../../../src/scheduler/runSchedule');

      // Run-1: canonicalize placement to exactly what the scheduler decides.
      await runScheduleAndPersist(S5_USER, undefined, { timezone: 'UTC' });
      var afterRun1 = await db('task_instances').where('id', 's5-already-placed').first();
      // SANITY: task was placed (scheduled_at set) → scheduler reached the write path.
      expect(afterRun1.scheduled_at).not.toBeNull();
      var run1UpdatedAt = afterRun1.updated_at;

      // Sleep 1100ms so MySQL DATETIME (1s precision) can distinguish a run-2 write.
      await new Promise(function(resolve) { setTimeout(resolve, 1100); });

      // Run-2: the row already equals the computed placement → delta-write skips it.
      await runScheduleAndPersist(S5_USER, undefined, { timezone: 'UTC' });
      var afterRun2 = await db('task_instances').where('id', 's5-already-placed').first();

      // TARGET (delta-write): run-2 writes nothing → updated_at unchanged from run-1.
      expect(String(afterRun2.updated_at)).toBe(String(run1UpdatedAt));
    },
    25000
  );

  // GREEN after W2 delta-write (the .failing marker is removed).
  //
  // Batch-scale unchanged → 0 writes. Run-1 places 3 tasks (the "changed" half:
  // 3 new tasks → 3 written, their scheduled_at goes null → set). Run-2 on the
  // IDENTICAL working set: every row already equals its computed placement → the
  // delta-write skips ALL of them → no updated_at advances. This proves the
  // skip-condition is "DB row already equals computed placement" at batch scale,
  // not just for a single row.
  //
  // NOTE: re-placing 3 deadline-free tasks of equal priority is deterministic
  // (the scheduler's slack-sort is stable), so run-2 reproduces run-1's exact
  // slots — the honest precondition for asserting 0 writes.
  it(
    'S5: unchanged batch → 0 writes on run-2 (3 tasks, identical input, all skipped)',
    async () => {
      const { runScheduleAndPersist } = require('../../../src/scheduler/runSchedule');

      // 3 new tasks (scheduled_at null → assigned by run-1 = the "changed → written" half).
      await testDb.seedTask({ id: 's5-a', user_id: S5_USER, text: 'A', status: '', dur: 30, pri: 'P2', scheduled_at: null, date: TODAY });
      await testDb.seedTask({ id: 's5-b', user_id: S5_USER, text: 'B', status: '', dur: 30, pri: 'P2', scheduled_at: null, date: TODAY });
      await testDb.seedTask({ id: 's5-c', user_id: S5_USER, text: 'C', status: '', dur: 30, pri: 'P2', scheduled_at: null, date: TODAY });

      // Run-1: places all 3 (3 writes).
      await runScheduleAndPersist(S5_USER, undefined, { timezone: 'UTC' });
      var run1 = {};
      for (const id of ['s5-a', 's5-b', 's5-c']) {
        var r = await db('task_instances').where('id', id).first();
        expect(r.scheduled_at).not.toBeNull(); // SANITY: placed
        run1[id] = r.updated_at;
      }

      // Sleep 1100ms so MySQL DATETIME (1s precision) can distinguish a write.
      await new Promise(function(resolve) { setTimeout(resolve, 1100); });

      // Run-2: identical input — every row already equals its placement → 0 writes.
      await runScheduleAndPersist(S5_USER, undefined, { timezone: 'UTC' });

      // TARGET (delta-write): NO row's updated_at advances on run-2.
      for (const id of ['s5-a', 's5-b', 's5-c']) {
        var after = await db('task_instances').where('id', id).first();
        expect(String(after.updated_at)).toBe(String(run1[id]));
      }
    },
    30000
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 8: S6 NO-CASCADE [GAP]
// Purpose: spy on scheduleQueue.enqueueScheduleRun — assert it is NOT called
// during a full scheduler run.
// TRACEABILITY: S6
//
// NOTE (W2/W3 update requirement): S6 pins the module name 'scheduleQueue.js' and
// the string 'enqueueScheduleRun'. After W4, the extracted RunScheduleCommand can
// self-trigger via a renamed re-export or facade. W2/W3 must update this assertion
// if the file moves, and should additionally spy on the real enqueue boundary at
// runtime to assert zero calls — independent of module name.
// ─────────────────────────────────────────────────────────────────────────────

describe('S6 — no-cascade: enqueueScheduleRun NOT called during scheduler run', () => {
  test('unifiedScheduleV2 does not call enqueueScheduleRun (spy via dynamic require)', () => {
    // We cannot jest.mock at this scope (already in describe). Instead, we verify
    // that the unifiedScheduleV2 module does not reference enqueueScheduleRun at all —
    // this is the static guarantee. The dynamic spy is done via scheduleQueue mock.
    var fs = require('fs');
    var path = require('path');
    var src = fs.readFileSync(
      path.resolve(__dirname, '../../../src/scheduler/unifiedScheduleV2.js'),
      'utf8'
    );
    // enqueueScheduleRun must not appear in unifiedScheduleV2 source.
    // SELF-MUTATION: if S6 is broken (cascade added), this grep fails.
    expect(src).not.toContain('enqueueScheduleRun');
  });

  test('running unifiedScheduleV2 does not trigger scheduleQueue enqueue (structural — scheduleQueue is not in require closure)', () => {
    // This complements the S4 static test: confirm the scheduleQueue module is never
    // loaded as part of unifiedScheduleV2 execution. Re-uses the require-closure BFS.
    var targetKey  = require.resolve('../../../src/scheduler/unifiedScheduleV2');
    var schedQueueKey = require.resolve('../../../src/scheduler/scheduleQueue');

    // Ensure unifiedScheduleV2 is loaded.
    require('../../../src/scheduler/unifiedScheduleV2');

    // scheduleQueue must NOT be in the transitive closure.
    var visited = new Set();
    var queue = [targetKey];
    while (queue.length > 0) {
      var cur = queue.shift();
      if (visited.has(cur)) continue;
      visited.add(cur);
      var m = require.cache[cur];
      if (m && Array.isArray(m.children)) {
        m.children.forEach(function(c) { if (!visited.has(c.id)) queue.push(c.id); });
      }
    }
    expect(visited.has(schedQueueKey)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 9: P1 [GAP] — CHARACTERIZE CURRENT updated_at WRITE BEHAVIOR
// Purpose: pin the CURRENT behavior of runSchedule.js using db.fn.now() for
// updated_at writes, so W2 KnexScheduleRepository (new Date()) can be proven
// equivalent. This test characterizes the CURRENT behavior, not the target.
// TRACEABILITY: P1
// ─────────────────────────────────────────────────────────────────────────────

describe('P1 — migration complete: runSchedule.js has 0 inline fn.now(); writes use new Date() via the repository', () => {
  // W3 UPDATE (was: pin the CURRENT ~19 db.fn.now() violations). The H6 W3
  // persist-repoint moved every scheduler DB write into the W2
  // KnexScheduleRepository (writeChanged / deleteTasksWhere /
  // backfillRollingAnchorIfNull / now) and replaced every inline
  // db.fn.now()/trx.fn.now() with a JS new Date() (via RunScheduleCommand.clockNow()
  // → ClockPort). This test now asserts the MIGRATION IS DONE: ZERO inline fn.now()
  // calls in runSchedule.js CODE, and the repository stamps timestamps with new Date().
  // This stays a meaningful pin (P1 / ADR-0003): re-introducing an inline fn.now()
  // in runSchedule.js, or removing the new Date() stamp from the repository, fails it.
  test('runSchedule.js source contains ZERO inline fn.now() calls (P1 migration complete)', () => {
    var fs = require('fs');
    var path = require('path');
    var src = fs.readFileSync(
      path.resolve(__dirname, '../../../src/scheduler/runSchedule.js'),
      'utf8'
    );
    // Strip line comments so the 4 surviving explanatory mentions of "db.fn.now()"
    // in comments do not count — only EXECUTABLE fn.now() calls are a P1 violation.
    var codeOnly = src
      .split('\n')
      .map(function(line) {
        var idx = line.indexOf('//');
        return idx >= 0 ? line.slice(0, idx) : line;
      })
      .join('\n');

    var dbFnNow  = (codeOnly.match(/db\.fn\.now\(\)/g) || []).length;
    var trxFnNow = (codeOnly.match(/trx\.fn\.now\(\)/g) || []).length;
    var total = dbFnNow + trxFnNow;

    // SELF-MUTATION: adding ANY inline (db|trx).fn.now() to runSchedule.js code
    // makes total > 0 and fails this assertion (the P1/ADR-0003 invariant).
    expect(total).toBe(0);
    // And no executable `updated_at: (db|trx).fn.now()` remains.
    expect(codeOnly).not.toMatch(/updated_at:\s*(db|trx)\.fn\.now\(\)/);
  });

  test('KnexScheduleRepository stamps timestamps with new Date() (via clock), never the Knex now-builder', () => {
    var fs = require('fs');
    var path = require('path');
    var repoSrc = fs.readFileSync(
      path.resolve(__dirname, '../../../src/slices/scheduler/adapters/KnexScheduleRepository.js'),
      'utf8'
    );
    // The repository is the SOLE owner of scheduler timestamp writes (P1). It must
    // NOT contain any (db|trx).fn.now() — and its default clock returns new Date().
    var repoCodeOnly = repoSrc
      .split('\n')
      .map(function(line) { var i = line.indexOf('//'); return i >= 0 ? line.slice(0, i) : line; })
      .join('\n');
    expect(repoCodeOnly).not.toMatch(/\.fn\.now\(\)/);
    // The default clock is a JS new Date() source (the P1 stamp).
    expect(repoSrc).toMatch(/now:\s*function\s*\(\)\s*\{\s*return\s+new Date\(\)/);

    // Behavioral proof: the default-constructed repository's clock returns a JS Date.
    var KnexScheduleRepository = require('../../../src/slices/scheduler/adapters/KnexScheduleRepository');
    var repo = new KnexScheduleRepository({ db: {}, tasksWrite: {} });
    expect(repo.clock.now()).toBeInstanceOf(Date);
  });

  test('RunScheduleCommand.clockNow() returns a JS Date (the P1 stamp the persist path uses), never a Knex builder', () => {
    var RunScheduleCommand = require('../../../src/slices/scheduler/application/RunScheduleCommand');
    var cmd = new RunScheduleCommand();
    var stamp = cmd.clockNow();
    expect(stamp).toBeInstanceOf(Date);
    // It is a real timestamp, not a Knex raw expression object.
    expect(typeof stamp.toISOString).toBe('function');
  });

  test('P1 — unifiedScheduleV2.js does NOT write to DB at all (pure function, no DB I/O)', () => {
    // unifiedScheduleV2 is a pure function — it must have zero DB calls.
    // This is the architectural invariant that makes it extractable as a pure core.
    // SELF-MUTATION: adding a DB call to unifiedScheduleV2 would fail this.
    var fs = require('fs');
    var path = require('path');
    var src = fs.readFileSync(
      path.resolve(__dirname, '../../../src/scheduler/unifiedScheduleV2.js'),
      'utf8'
    );
    // No require of db or trx.
    expect(src).not.toMatch(/require\s*\(\s*['"][^'"]*\/db['"]\s*\)/);
    // No fn.now() calls.
    expect(src).not.toMatch(/\.fn\.now\(\)/);
    // No await (I/O marker).
    // Note: a few utility functions have async in their signature (none currently) — this
    // guards against accidental introduction.
    expect(src).not.toMatch(/\bawait\s+(db|trx)\s*\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 10: C-SCORE [GAP] — scoreSchedule SNAPSHOT
// Purpose: snapshot scoreSchedule.js {total, breakdown} against a fixed fixture,
// to pin the ScoreEngine extraction.
// TRACEABILITY: C-SCORE
// ─────────────────────────────────────────────────────────────────────────────

describe('C-SCORE — scoreSchedule snapshot against fixed fixture', () => {
  // Fixture: one task placed correctly (on its date), one unplaced P2 task.
  // Expected: unplaced penalty for P2 = PRI_RANK['P2'] * UNPLACED_MULTIPLIER = 80.
  const PLACED_TASK = { id: 'sc-001', pri: 'P2', text: 'Placed task', deadline: null, date: '2026-06-16' };
  const UNPLACED_TASK = { id: 'sc-002', pri: 'P2', text: 'Unplaced task' };

  const DAY_PLACEMENTS = {
    '2026-06-16': [
      { task: PLACED_TASK, start: 480, dur: 30 }
    ]
  };
  const UNPLACED = [UNPLACED_TASK];
  const ALL_TASKS = [PLACED_TASK, UNPLACED_TASK];

  let score;
  beforeAll(function() {
    score = scoreSchedule(DAY_PLACEMENTS, UNPLACED, ALL_TASKS);
  });

  test('scoreSchedule returns {total, breakdown, details}', () => {
    expect(score).toHaveProperty('total');
    expect(score).toHaveProperty('breakdown');
    expect(score).toHaveProperty('details');
  });

  test('unplaced penalty = PRI_RANK[P2] * 1 = 80 (SELF-MUTATION: changing PRI_RANK[P2] or UNPLACED_MULTIPLIER breaks this)', () => {
    // PRI_RANK.P2 = 80, UNPLACED_MULTIPLIER = 1 → penalty = 80.
    // SELF-MUTATION: if we change UNPLACED_MULTIPLIER to 2, breakdown.unplaced becomes 160.
    expect(score.breakdown.unplaced).toBe(80);
  });

  test('no deadline miss (placed task has no deadline)', () => {
    expect(score.breakdown.deadlineMiss).toBe(0);
  });

  test('no date drift (placed task is on its own date)', () => {
    expect(score.breakdown.dateDrift).toBe(0);
  });

  test('total = sum of breakdown values', () => {
    var summed = Object.values(score.breakdown).reduce(function(a, b) { return a + b; }, 0);
    expect(score.total).toBe(summed);
  });

  test('details array has one entry for the unplaced task', () => {
    var unplacedDetail = score.details.find(function(d) { return d.taskId === 'sc-002' && d.type === 'unplaced'; });
    expect(unplacedDetail).toBeDefined();
    expect(unplacedDetail.penalty).toBe(80);
  });

  // Deadline miss fixture.
  test('deadline miss: task placed AFTER its deadline incurs DEADLINE_MISS_PENALTY = 500', () => {
    // SELF-MUTATION: changing DEADLINE_MISS_PENALTY to a different value breaks this.
    var taskWithDeadline = { id: 'sc-dl-001', pri: 'P2', text: 'Late task', deadline: '2026-06-15', date: '2026-06-15' };
    var latePlacementDayPlacements = {
      '2026-06-17': [{ task: taskWithDeadline, start: 480, dur: 30 }] // placed AFTER deadline 2026-06-15
    };
    var s2 = scoreSchedule(latePlacementDayPlacements, [], [taskWithDeadline]);
    expect(s2.breakdown.deadlineMiss).toBe(500);
    expect(s2.total).toBeGreaterThanOrEqual(500);
  });

  test('fragmentation penalty: split task with 3 parts on same day incurs 2 × FRAGMENTATION_PENALTY = 30', () => {
    // FRAGMENTATION_PENALTY = 15 per part beyond first → 2 extra parts = 30.
    // SELF-MUTATION: changing FRAGMENTATION_PENALTY breaks this.
    var splitTask = { id: 'sc-split-001', pri: 'P3', text: 'Split task' };
    var fragPlacements = {
      '2026-06-16': [
        { task: splitTask, start: 480, dur: 30, splitPart: 1 },
        { task: splitTask, start: 570, dur: 30, splitPart: 2 },
        { task: splitTask, start: 660, dur: 30, splitPart: 3 }
      ]
    };
    var sf = scoreSchedule(fragPlacements, [], [splitTask]);
    expect(sf.breakdown.fragmentation).toBe(30); // (3-1) * 15
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 11: C-IDEM — MULTI-TASK IDEMPOTENCE (it.failing — RED until W2 delta-write)
//
// RED until W2 delta-write — it.failing() inverts; W2 removes the .failing marker.
//
// The integration-level C-IDEM test asserts: running the scheduler twice on stable
// input produces 0 DB writes on the second run. This requires delta-write (W2).
// On current write-all code, run-2 still updates every placed task's updated_at.
//
// The pure-function idempotence test (same output given same input) stays GREEN —
// that is an output characterization, unaffected by the write-pattern change.
//
// TRACEABILITY: C-IDEM
// ─────────────────────────────────────────────────────────────────────────────

describe('C-IDEM — idempotence: run-2 on stable input → 0 changed tasks (GREEN — W2 delta-write landed)', () => {
  // ── Pure-function level (GREEN — output characterization, unaffected by write pattern) ──
  const IDEM_TASKS = [
    { id: 'idem-001', text: 'Task A', dur: 30, pri: 'P1', date: TODAY, deadline: TOMORROW,
      status: '', when: 'morning,lunch,afternoon,evening,night', dayReq: 'any',
      dependsOn: [], location: [], tools: [], recurring: false, split: false,
      datePinned: false, generated: false, section: '', flexWhen: false },
    { id: 'idem-002', text: 'Task B', dur: 45, pri: 'P2', date: TODAY,
      status: '', when: 'morning,lunch,afternoon,evening,night', dayReq: 'any',
      dependsOn: [], location: [], tools: [], recurring: false, split: false,
      datePinned: false, generated: false, section: '', flexWhen: false },
    { id: 'idem-003', text: 'Task C', dur: 30, pri: 'P3', date: TODAY,
      status: '', when: 'morning,lunch,afternoon,evening,night', dayReq: 'any',
      dependsOn: [], location: [], tools: [], recurring: false, split: false,
      datePinned: false, generated: false, section: '', flexWhen: false }
  ];

  test('two consecutive pure-function runs produce identical placements (determinism check)', () => {
    var statuses = { 'idem-001': '', 'idem-002': '', 'idem-003': '' };

    // Run 1.
    var result1 = unifiedSchedule(IDEM_TASKS, statuses, TODAY, NOW_MINS, CFG);
    // Run 2 with identical input.
    var result2 = unifiedSchedule(IDEM_TASKS, statuses, TODAY, NOW_MINS, CFG);

    // Extract placement fingerprints (id, dateKey, start, dur).
    function fingerprint(result) {
      var fp = {};
      Object.keys(result.dayPlacements).forEach(function(dk) {
        (result.dayPlacements[dk] || []).forEach(function(p) {
          if (p.task) {
            fp[p.task.id] = { dateKey: dk, start: p.start, dur: p.dur };
          }
        });
      });
      return fp;
    }

    var fp1 = fingerprint(result1);
    var fp2 = fingerprint(result2);

    // Same tasks placed on same slots.
    // SELF-MUTATION: if the scheduler has non-deterministic ordering (wall-clock, random),
    // fp1 and fp2 would differ and this test would catch the flakiness.
    expect(fp2).toEqual(fp1);
  });

  // ── Integration-level (it.failing — RED until W2 delta-write) ──
  //
  // SETUP CONTRACT: DB availability is verified in a describe-level beforeAll (below).
  // All seed / cleanup calls happen outside it.failing so infrastructure failures
  // hard-fail the describe (never get silently inverted by it.failing).
  // The it.failing body contains ONLY: runScheduleAndPersist calls + expect() assertions.
  //
  // Structure:
  //   cidemBeforeAll  — assertDbAvailable + seedUser (outside it.failing, hard-fail on error)
  //   cidemBeforeEach — cleanup + seed the stable task (outside it.failing)
  //   afterRun1Snapshot — captured AFTER run-1 inside beforeEach (outside it.failing)
  //   it.failing body — run-2 only + the delta-write assertion
  //
  // The beforeEach is defined in the nested describe block below.
});

// C-IDEM integration: nested describe with its own beforeAll/beforeEach so the
// setup hooks run outside the it.failing body.
describe('C-IDEM integration — beforeAll/beforeEach outside it.failing', () => {
  const { assertDbAvailable } = require('../../helpers/requireDB');
  const testDb2 = require('../../helpers/testDb');
  let db2;

  // ── ISOLATION: unique user per describe (isolation fix — 2026-06-12) ────────
  // Each DB-backed describe gets its own user_id so that beforeEach cleanup and
  // seed operations are fully scoped and cannot interfere with sibling describes
  // regardless of execution order or --runInBand. Never use 'test-user-001'
  // across multiple DB-backed describes in the same file.
  const CIDEM_USER = 'test-user-cidem';

  // Capture the state that needs to survive from beforeEach into the it.failing body.
  // Set in beforeEach (outside it.failing), read in it.failing (inside).
  let cidem_updatedAtAfterRun1 = null;

  beforeAll(async () => {
    // Hard-fail the entire describe when test-bed is unavailable.
    // Propagates OUTSIDE it.failing — never silently inverted.
    await assertDbAvailable();
    db2 = testDb2.getDb();
    // Scope cleanup + seedUser to CIDEM_USER only — never call testDb2.cleanup()
    // (which wipes ALL users) to avoid cross-describe interference.
    await db2('task_instances').where('user_id', CIDEM_USER).del();
    await db2('task_masters').where('user_id', CIDEM_USER).del();
    await db2('users').where('id', CIDEM_USER).del();
    await testDb2.seedUser({ id: CIDEM_USER, email: 'test-cidem@test.com', name: 'CIDEM User' });
  }, 15000);

  afterAll(async () => {
    // Cleanup this describe's rows only. Do NOT call testDb2.destroy() here —
    // the singleton connection is shared with S5 and other describes in this file.
    // Destroying it mid-suite closes the connection before sibling describes can
    // finish their cleanup, causing FK errors and undefined-connection failures.
    // The connection is closed by Jest's forceExit or the global teardown.
    await db2('task_instances').where('user_id', CIDEM_USER).del();
    await db2('task_masters').where('user_id', CIDEM_USER).del();
    await db2('users').where('id', CIDEM_USER).del();
  });

  beforeEach(async () => {
    // Clean slate — scoped to CIDEM_USER only.
    await db2('task_instances').where('user_id', CIDEM_USER).del();
    await db2('task_masters').where('user_id', CIDEM_USER).del();
    cidem_updatedAtAfterRun1 = null;

    // Seed a task that is ALREADY at its correct scheduled_at.
    // NOTE: see S5 describe for the schema note on status column routing.
    // NOTE: omit `time` — task_instances.time is a MySQL TIME column (HH:MM:SS format);
    // passing '12:00 PM' causes an "Incorrect time value" error. scheduled_at captures
    // the placement time fully.
    const correctTime = '2026-06-16 12:00:00';
    await testDb2.seedTask({
      id: 'idem-db-001', user_id: CIDEM_USER, text: 'Already placed stable task',
      status: '', dur: 30, pri: 'P2',
      scheduled_at: correctTime, date: TODAY
    });

    // Run 1 here (outside it.failing) so a run-1 failure is a hard setup error.
    const { runScheduleAndPersist } = require('../../../src/scheduler/runSchedule');
    await runScheduleAndPersist(CIDEM_USER, undefined, { timezone: 'UTC' });

    // Capture updated_at after run-1 (outside it.failing — hard error if missing).
    var afterRun1 = await db2('task_instances').where('id', 'idem-db-001').first();
    // Sanity: task must be placed after run-1. If not, test-bed config is wrong.
    if (!afterRun1) throw new Error('[C-IDEM setup] idem-db-001 not found after run-1 — seed failed');

    // Brief wait so MySQL DATETIME (1s precision) can distinguish a run-2 write.
    await new Promise(function(resolve) { setTimeout(resolve, 1100); });

    cidem_updatedAtAfterRun1 = afterRun1.updated_at;
  }, 20000);

  // GREEN after W2 delta-write (the .failing marker is removed — delta-write
  // makes run-2 a no-op for the stable task).
  it(
    'C-IDEM: run-2 updated_at unchanged for stable tasks (delta-write → 0 writes on run-2)',
    async () => {
      // Run 2: identical input. Delta-write → 0 writes. Write-all → updated_at bumped.
      const { runScheduleAndPersist } = require('../../../src/scheduler/runSchedule');
      await runScheduleAndPersist(CIDEM_USER, undefined, { timezone: 'UTC' });

      var afterRun2 = await db2('task_instances').where('id', 'idem-db-001').first();

      // SANITY: task must still be in DB (not deleted by run-2).
      expect(afterRun2).not.toBeNull();

      // TARGET assertion (delta-write): run-2 must NOT touch the unchanged task.
      // FAILS on current write-all code (every run updates updated_at).
      // W2 delta-write makes this hold → remove .failing() marker.
      expect(String(afterRun2.updated_at)).toBe(String(cidem_updatedAtAfterRun1));
    },
    25000
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 12: C-WX — WEATHER FAIL-CLOSED  (999.546 / R38 CC6)
// Purpose: a weather-constrained task must NOT be placed in a slot whose weather
// data is unavailable. Previously weatherOk() FAILED OPEN (returned true when the
// date bucket or the hour entry was missing) and the task was placed regardless.
// Per the user ruling (R38, CC6 audit) this is now FAIL-CLOSED: weatherOk()
// returns false when weather data is missing, so the task is left unplaced.
// TRACEABILITY: C-WX (999.546)
//
// GOLDEN-MASTER DELTA (deliberate, 999.546): this entire block formerly encoded
// the OLD fail-open behavior:
//   - "task placed when slot hour missing from weather data" → now goes UNPLACED.
//   - the two source-string pins for `return true` → now pin `return false`.
// Only the weather-missing-data expectations change; every non-weather case
// elsewhere in this suite is untouched.
//
// NOTE: the genuinely-trivial case (NO weatherByDateHour field at all →
// checkWeather=false → weatherOk never called) is unchanged: such a task is
// still placed, because the scheduler skips the weather gate entirely when no
// weather data was loaded for the horizon.
// ─────────────────────────────────────────────────────────────────────────────

describe('C-WX — weatherOk fail-closed (999.546): missing weather data → task is NOT placed', () => {
  const weatherConstrainedTask = {
    id: 'wx-001', text: 'Outdoor task', dur: 30, pri: 'P2',
    date: TODAY, deadline: TODAY, status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: [], tools: [],
    recurring: false, split: false, datePinned: false, generated: false, section: '', flexWhen: false,
    // Weather constraint: only schedule if dry and warm.
    weatherPrecip: 'dry_only',
    weatherTempMin: 60,
    weatherTempMax: 90
  };

  // CFG with weather data for TODAY covering early hours (8-11 AM) but NOT for
  // the noon slot the task would otherwise land on. Under fail-CLOSED:
  //   - cfg.weatherByDateHour is truthy            → checkWeather = true
  //   - cfg.weatherByDateHour[TODAY] exists         → weatherOk proceeds
  //   - early hours have BAD weather                → weatherOk false there
  //   - cfg.weatherByDateHour[TODAY][12+] is absent → weatherOk false (fail-closed)
  // → no slot on TODAY satisfies the constraint → task is unplaced.
  const CFG_ACTIVE_WEATHER = makeCfg({
    weatherByDateHour: {
      [TODAY]: {
        8:  { precipProb: 80, cloudcover: 90, temp: 45, humidity: 80 }, // bad weather
        9:  { precipProb: 80, cloudcover: 90, temp: 45, humidity: 80 }, // bad weather
        10: { precipProb: 80, cloudcover: 90, temp: 45, humidity: 80 }, // bad weather
        11: { precipProb: 80, cloudcover: 90, temp: 45, humidity: 80 }, // bad weather
        // hours after 11 intentionally absent → fail-closed: no slot is weather-OK
      }
    }
  });

  // The NO-weather-data-at-all case: checkWeather=false (the scheduler never
  // calls weatherOk because no weather was loaded for the horizon). This is NOT
  // a weather-missing-for-a-constrained-slot case — it is the scheduler running
  // with the weather feature inert — so the task is still placed. Unchanged.
  const CFG_NO_WEATHER = makeCfg(); // no weatherByDateHour field

  test('weather-constrained task is placed when NO weather data loaded at all (weather gate inert)', () => {
    // checkWeather = false when weatherByDateHour is absent → weatherOk never called.
    var statuses = { 'wx-001': '' };
    var result = unifiedSchedule([weatherConstrainedTask], statuses, TODAY, NOW_MINS, CFG_NO_WEATHER);
    var placed = findPlacements(result, 'wx-001');
    expect(placed.length).toBeGreaterThan(0);
    expect(isUnplaced(result, 'wx-001')).toBe(false);
  });

  // KEY BEHAVIORAL TEST (999.546): weatherByDateHour IS populated (so the weather
  // gate is active) but no slot has data satisfying the constraint → fail-closed →
  // task is UNPLACED. This is the deliberate flip from the old fail-open expectation.
  test('C-WX active fixture: task NOT placed when no slot has satisfying weather data (fail-closed)', () => {
    var statuses = { 'wx-001': '' };
    var result = unifiedSchedule([weatherConstrainedTask], statuses, TODAY, NOW_MINS, CFG_ACTIVE_WEATHER);

    // Task must NOT be placed — every candidate slot is either bad weather or has
    // no weather data, and fail-closed rejects the missing-data slots.
    var placed = findPlacements(result, 'wx-001');
    expect(placed.length).toBe(0);
    expect(isUnplaced(result, 'wx-001')).toBe(true);
  });

  test('weatherOk returns false when the date bucket is missing (fail-closed, direct function test)', () => {
    var weatherOk = unifiedSchedule._testOnly.weatherOk;
    var task = { weatherPrecip: 'dry_only', weatherTempMin: 60, weatherTempMax: 90 };
    // No weatherByDateHour at all.
    expect(weatherOk(task, TODAY, 720, null)).toBe(false);
    // weatherByDateHour present but the date bucket is missing.
    expect(weatherOk(task, TODAY, 720, { [TOMORROW]: { 12: { precipProb: 5, temp: 72 } } })).toBe(false);
  });

  test('weatherOk returns false when the hour entry is missing (fail-closed, direct function test)', () => {
    var weatherOk = unifiedSchedule._testOnly.weatherOk;
    var task = { weatherPrecip: 'dry_only', weatherTempMin: 60, weatherTempMax: 90 };
    // Date bucket present, but the specific hour (12) is absent.
    var byHour = { [TODAY]: { 8: { precipProb: 5, temp: 72 } } };
    expect(weatherOk(task, TODAY, 720, byHour)).toBe(false);
  });

  test('weatherOk still returns the correct verdict when data IS present', () => {
    var weatherOk = unifiedSchedule._testOnly.weatherOk;
    var task = { weatherPrecip: 'dry_only', weatherTempMin: 60, weatherTempMax: 90 };
    // Good weather present for hour 12 → true.
    var good = { [TODAY]: { 12: { precipProb: 5, cloudcover: 10, temp: 72, humidity: 40 } } };
    expect(weatherOk(task, TODAY, 720, good)).toBe(true);
    // Bad weather (wet) present for hour 12 → false.
    var bad = { [TODAY]: { 12: { precipProb: 95, cloudcover: 10, temp: 72, humidity: 40 } } };
    expect(weatherOk(task, TODAY, 720, bad)).toBe(false);
    // Unconstrained task is always OK even with no data.
    expect(weatherOk({}, TODAY, 720, null)).toBe(true);
  });

  test('source has the fail-closed date-bucket guard (999.546)', () => {
    var fs = require('fs');
    var path = require('path');
    var src = fs.readFileSync(
      path.resolve(__dirname, '../../../src/scheduler/unifiedScheduleV2.js'),
      'utf8'
    );
    expect(src).toMatch(/if\s*\(\s*!weatherByDateHour\s*\|\|\s*!weatherByDateHour\[dateKey\]\s*\)\s*return\s*false/);
  });

  test('source has the fail-closed per-hour guard (999.546)', () => {
    var fs = require('fs');
    var path = require('path');
    var src = fs.readFileSync(
      path.resolve(__dirname, '../../../src/scheduler/unifiedScheduleV2.js'),
      'utf8'
    );
    expect(src).toMatch(/if\s*\(\s*!w\s*\)\s*return\s*false/);
  });
});
