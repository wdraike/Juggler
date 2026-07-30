/**
 * 999.4863: the 720-min duration clamp silently drops time on the NON-SPLIT
 * placement path. 999.4850 fixed it only inside placeSplitInline; a task that
 * goes through tryPlaceQueued (split:false, window wide enough to hold the
 * clamped 720 min contiguously) was placed at 720 with zero warnings and
 * no _unplacedReason — the 60-min loss was invisible.
 *
 * After the fix: the clamp is detected at buildItems time (item._clampDropped)
 * and the non-split placement path emits a duration_clamped warning +
 * partial_split reason, matching the split path's behavior.
 */
'use strict';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');

const TODAY = '2026-06-08'; // Monday
const NOW_MINS = 0;

// A single 09:00-25:00 block (540-1500, 960 min) — wide enough to hold the
// clamped 720 min contiguously, so the task does NOT split.
function wideWindowCfg() {
  var blocks = [
    { id: 'allday', tag: 'allday', name: 'All Day', start: 540, end: 1500, color: '#F59E0B', loc: 'work' },
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
    id: 't1', text: 'big non-split test', date: TODAY, dur: 780, pri: 'P3',
    when: 'allday', dayReq: 'weekday', status: '', dependsOn: [],
    location: [], tools: [], recurring: false, generated: false,
    split: false, // NON-SPLIT path
    section: '', placementMode: PLACEMENT_MODES.ANYTIME,
    ...overrides,
  };
}

function findPlacements(result, taskId) {
  var found = [];
  Object.keys(result.dayPlacements).forEach(function (dk) {
    (result.dayPlacements[dk] || []).forEach(function (p) {
      if (p.task && p.task.id === taskId) {
        found.push({ dateKey: dk, start: p.start, dur: p.dur });
      }
    });
  });
  return found;
}

test('NON-SPLIT task with dur > 720 cap emits duration_clamped warning (999.4863)', function () {
  var cfg = wideWindowCfg();
  var task = makeTask({ dur: 780, split: false });
  var result = unifiedSchedule([task], { t1: '' }, TODAY, NOW_MINS, cfg);

  var placements = findPlacements(result, 't1');
  expect(placements.length).toBeGreaterThan(0);
  // The clamped 720 min are placed contiguously (non-split).
  expect(placements.reduce(function (a, p) { return a + p.dur; }, 0)).toBe(720);

  // A duration_clamped warning MUST surface the 60-min drop.
  var clampedWarn = result.warnings.filter(function (w) { return w.type === 'duration_clamped'; });
  expect(clampedWarn.length).toBe(1);
  expect(clampedWarn[0].dropped).toBe(60);
  expect(clampedWarn[0].originalDur).toBe(780);
  expect(clampedWarn[0].placedDur).toBe(720);

  // NEVER-MISSING visibility: the task carries a partial_split reason
  // even though it was fully placed (David ruling 2026-07-30 on 999.4850).
  expect(task._unplacedReason).toBe('partial_split');
  expect(task._unplacedDetail).toContain('60 min');
  expect(task._unplacedDetail).toContain('720 min cap');
});

test('NON-SPLIT task with dur <= 720 does NOT emit duration_clamped warning', function () {
  var cfg = wideWindowCfg();
  var task = makeTask({ dur: 600, split: false });
  var result = unifiedSchedule([task], { t1: '' }, TODAY, NOW_MINS, cfg);

  var placements = findPlacements(result, 't1');
  expect(placements.length).toBeGreaterThan(0);
  expect(placements.reduce(function (a, p) { return a + p.dur; }, 0)).toBe(600);

  var clampedWarn = result.warnings.filter(function (w) { return w.type === 'duration_clamped'; });
  expect(clampedWarn.length).toBe(0);
  expect(task._unplacedReason).toBeNull();
});