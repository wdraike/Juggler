/**
 * 999.4794 regression: a splittable task whose splitMin exceeds every
 * eligible window width must NOT be force-placed outside template hours.
 *
 * Before the fix: placeSplitInline produced zero chunks (no window fits
 * splitMin), the task fell through to the force-placement pass (which
 * only checks rigid/FIXED), and was force-placed at block start with
 * _conflict=true — the full duration dumped outside the template window.
 *
 * After the fix: the zero-chunk split is flagged (_splitFailed), and the
 * force-placement pass excludes it. The task stays unplaced with a
 * no_slot reason, as the ticket's Expected Behavior requires.
 */
'use strict';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');

const TODAY = '2026-06-08'; // Monday
const NOW_MINS = 0;

// Single 09:00-11:00 morning block (540-660, 120 min capacity) on every weekday.
function tightWindowCfg() {
  var blocks = [
    { id: 'morning', tag: 'morning', name: 'Morning', start: 540, end: 660, color: '#F59E0B', loc: 'work' },
  ];
  return {
    timeBlocks: { Mon: blocks, Tue: blocks, Wed: blocks, Thu: blocks, Fri: blocks, Sat: [], Sun: [] },
    toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15,
    locSchedules: {}, locScheduleDefaults: {}, locScheduleOverrides: {},
    hourLocationOverrides: {}, scheduleTemplates: null, preferences: {},
  };
}

function makeTask(overrides) {
  return {
    id: 't1', text: 'big test', date: TODAY, dur: 180, pri: 'P3',
    when: 'morning', dayReq: 'weekday', status: '', dependsOn: [],
    location: [], tools: [], recurring: false, generated: false,
    split: true, splitMin: 150, // wider than the 120-min window
    section: '', placementMode: PLACEMENT_MODES.ANYTIME,
    ...overrides,
  };
}

function findPlacements(result, taskId) {
  var found = [];
  Object.keys(result.dayPlacements).forEach(function (dk) {
    (result.dayPlacements[dk] || []).forEach(function (p) {
      // 999.4850: _conflict MUST be carried through — without it, every
      // `placements.filter(p => p._conflict)` assertion below is structurally
      // empty and can never fail (harrison review 2026-07-29).
      if (p.task && p.task.id === taskId) {
        found.push({ dateKey: dk, start: p.start, dur: p.dur, _conflict: !!p._conflict });
      }
    });
  });
  return found;
}

function isUnplaced(result, taskId) {
  return result.unplaced.some(function (u) { return (u.id || (u.task && u.task.id)) === taskId; });
}

test('ANYTIME splittable task with splitMin > window width is unplaced, not force-placed', function () {
  var cfg = tightWindowCfg();
  var task = makeTask({ placementMode: PLACEMENT_MODES.ANYTIME });
  var result = unifiedSchedule([task], { t1: '' }, TODAY, NOW_MINS, cfg);

  expect(isUnplaced(result, 't1')).toBe(true);
  expect(findPlacements(result, 't1').length).toBe(0);
});

test('FIXED splittable task with splitMin > window width is unplaced, not force-placed outside template hours', function () {
  var cfg = tightWindowCfg();
  var task = makeTask({ placementMode: PLACEMENT_MODES.FIXED });
  var result = unifiedSchedule([task], { t1: '' }, TODAY, NOW_MINS, cfg);

  expect(isUnplaced(result, 't1')).toBe(true);
  expect(findPlacements(result, 't1').length).toBe(0);
});

test('FIXED splittable task with splitMin < window width IS split and placed (no regression)', function () {
  var cfg = tightWindowCfg();
  // splitMin=30 fits in the 120-min window; dur=180 exceeds it so split fires.
  var task = makeTask({ splitMin: 30, placementMode: PLACEMENT_MODES.FIXED });
  var result = unifiedSchedule([task], { t1: '' }, TODAY, NOW_MINS, cfg);

  var placements = findPlacements(result, 't1');
  // Should be placed in chunks (120 + 60 = 180 across two days, or 120+60 on same day if capacity allows)
  expect(placements.length).toBeGreaterThan(0);
  // Every scheduled minute accounted for — a partial split that silently drops
  // minutes must fail here, not vanish (harrison 2026-07-29, review of 19fd6e02)
  expect(placements.reduce(function (a, p) { return a + p.dur; }, 0)).toBe(180);
  expect(isUnplaced(result, 't1')).toBe(false);
  // No _conflict flag — placed within template windows
  placements.forEach(function (p) {
    expect(p.start).toBeGreaterThanOrEqual(540);
    expect(p.start + p.dur).toBeLessThanOrEqual(660);
  });
});

// 999.4850: a splittable task whose dur exceeds the 720-min effectiveDuration
// cap silently drops the excess — 780 becomes 720, 60 min vanish with no
// partial_split reason or warning. effectiveDuration clamps dur to 720, the
// split places exactly 720, and the task reports as fully placed.
test('FIXED splittable task with dur > 720 cap surfaces partial_split for the dropped remainder', function () {
  var cfg = tightWindowCfg();
  var task = makeTask({ dur: 780, splitMin: 30, placementMode: PLACEMENT_MODES.FIXED });
  var result = unifiedSchedule([task], { t1: '' }, TODAY, NOW_MINS, cfg);

  var placements = findPlacements(result, 't1');
  expect(placements.length).toBeGreaterThan(0);
  // The clamped 720 min are placed; the extra 60 are NOT silently dropped.
  expect(placements.reduce(function (a, p) { return a + p.dur; }, 0)).toBe(720);
  // David ruling 2026-07-30: a task whose CLAMPED minutes all landed is NOT
  // listed as unplaced — runSchedule Phase 8 would write it back as
  // unscheduled/scheduled_at=NULL and wipe the 720 real placed minutes. The
  // reason + warning below carry the NEVER-MISSING visibility instead.
  expect(isUnplaced(result, 't1')).toBe(false);
  expect(task._unplacedReason).toBe('partial_split');
  expect(task._unplacedDetail).toContain('60 min');
  // A duration_clamped warning surfaces the silent drop.
  var clampedWarn = result.warnings.filter(function (w) { return w.type === 'duration_clamped'; });
  expect(clampedWarn.length).toBe(1);
  expect(clampedWarn[0].dropped).toBe(60);
  // No duplicate force-placement entry (pre-existing sibling bug fixed).
  var conflictEntries = placements.filter(function (p) { return p._conflict; });
  expect(conflictEntries.length).toBe(0);
});

// 999.4850: effectiveDuration prefers timeRemaining over dur, so the clamp
// detection must mirror that selection — a task with dur:100, timeRemaining:780
// clamps to 720 and drops 60; reading only task.dur (100) would miss it.
test('FIXED splittable task with timeRemaining > 720 cap surfaces partial_split', function () {
  var cfg = tightWindowCfg();
  var task = makeTask({ dur: 100, timeRemaining: 780, splitMin: 30, placementMode: PLACEMENT_MODES.FIXED });
  var result = unifiedSchedule([task], { t1: '' }, TODAY, NOW_MINS, cfg);

  var placements = findPlacements(result, 't1');
  expect(placements.length).toBeGreaterThan(0);
  expect(placements.reduce(function (a, p) { return a + p.dur; }, 0)).toBe(720);
  // Fully placed once clamped → reported, but not listed unplaced (see above).
  expect(isUnplaced(result, 't1')).toBe(false);
  expect(task._unplacedReason).toBe('partial_split');
  expect(task._unplacedDetail).toContain('60 min');
  var clampedWarn = result.warnings.filter(function (w) { return w.type === 'duration_clamped'; });
  expect(clampedWarn.length).toBe(1);
  expect(clampedWarn[0].dropped).toBe(60);
  var conflictEntries = placements.filter(function (p) { return p._conflict; });
  expect(conflictEntries.length).toBe(0);
});

// Mon has two disjoint blocks; Tue+ one wide block. Used to drive the
// dep-relaxation pass, which needs a task with deps and a deadline ≤ today.
function depRelaxCfg() {
  var monBlocks = [
    { id: 'am', tag: 'morning', name: 'AM', start: 360, end: 780, color: '#F59E0B', loc: 'work' },
    { id: 'pm', tag: 'afternoon', name: 'PM', start: 800, end: 1160, color: '#3B82F6', loc: 'work' },
  ];
  var wideBlocks = [
    { id: 'all', tag: 'morning', name: 'All day', start: 360, end: 1320, color: '#F59E0B', loc: 'work' },
  ];
  return {
    timeBlocks: { Mon: monBlocks, Tue: wideBlocks, Wed: wideBlocks, Thu: wideBlocks, Fri: wideBlocks, Sat: [], Sun: [] },
    toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15,
    locSchedules: {}, locScheduleDefaults: {}, locScheduleOverrides: {},
    hourLocationOverrides: {}, scheduleTemplates: null, preferences: {},
  };
}

// 999.4850 (harrison review 2026-07-29): the dep-relaxation pass consumes the
// SAME array as the rigid-force pass (`stillUnplaced = remainingUnplaced`), so
// guarding only the latter left a second door open — an already-split task with
// deps and a deadline ≤ today had its FULL clamped dur committed again on top of
// its own chunks (1440 for a 780-min task), and because a successful relaxed
// placement never returns the item to stillUnplaced, result.unplaced came back
// EMPTY — destroying the partial_split visibility this ticket exists to add.
test('a split-placed task with deps and a past deadline is not re-placed by the dep-relaxation pass', function () {
  var cfg = depRelaxCfg();
  var task = makeTask({
    dur: 780, splitMin: 30, placementMode: PLACEMENT_MODES.ANYTIME,
    deadline: TODAY, dependsOn: ['t2'],
  });
  var dep = makeTask({ id: 't2', text: 'dep', dur: 30, split: false, splitMin: 15, dependsOn: [] });
  var result = unifiedSchedule([task, dep], { t1: '', t2: '' }, TODAY, NOW_MINS, cfg);

  var placements = findPlacements(result, 't1');
  var totalPlaced = placements.reduce(function (a, p) { return a + p.dur; }, 0);
  // THE invariant: a task can never occupy more grid minutes than the scheduler
  // asked for. effectiveDuration clamps 780 -> 720, so anything above 720 means
  // the task was committed twice. Without the dep-relaxation guard this is
  // 420 + 720 = 1140.
  expect(totalPlaced).toBeLessThanOrEqual(720);
  // Concrete behaviour for this fixture: only Monday is eligible (deadline is
  // today) and the dep chain leaves the single 360-780 block, so 420 places and
  // the rest is reported, not dumped.
  expect(totalPlaced).toBe(420);
  expect(placements.filter(function (p) { return p._conflict; }).length).toBe(0);
  // The partial-split visibility survives the pass. This case IS genuinely
  // unplaced (300 min of the clamped ask never landed), unlike the fully-placed
  // clamp cases above.
  expect(isUnplaced(result, 't1')).toBe(true);
  expect(task._unplacedReason).toBe('partial_split');
  // BOTH losses must be reported, not just one: 300 min the split could not
  // place PLUS the 60 the cap silently dropped before the split ever ran.
  // Reporting only splitResult.remaining (300) still loses 60 minutes.
  expect(task._unplacedDetail).toContain('360');
  var clamped = result.warnings.filter(function (w) {
    return w.type === 'duration_clamped' && w.taskId === 't1';
  });
  expect(clamped.length).toBe(1);
  expect(clamped[0].dropped).toBe(60);
});

// 999.4850: the identical missing guard sat on the OLDER `remaining > 0`
// partial-split branch — a FIXED task partially split by genuine window
// exhaustion (not the 720 clamp) was also force-placed a second time, stacking
// its full 300 min on top of its own 120-min chunk at the same start, with
// result.unplaced empty and a bogus recurringConflict warning. One guard closes
// both paths; this pins the second one, which shipped untested.
test('a FIXED task partially split by window exhaustion is not force-placed on top of its own chunk', function () {
  var cfg = tightWindowCfg();
  var task = makeTask({
    dur: 300, splitMin: 30, placementMode: PLACEMENT_MODES.FIXED, deadline: TODAY,
  });
  var result = unifiedSchedule([task], { t1: '' }, TODAY, NOW_MINS, cfg);

  var placements = findPlacements(result, 't1');
  expect(placements.reduce(function (a, p) { return a + p.dur; }, 0)).toBe(120);
  expect(placements.filter(function (p) { return p._conflict; }).length).toBe(0);
  expect(isUnplaced(result, 't1')).toBe(true);
  expect(task._unplacedReason).toBe('partial_split');
  expect(result.warnings.filter(function (w) {
    return w.type === 'recurringConflict' && w.taskId === 't1';
  }).length).toBe(0);
});
