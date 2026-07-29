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
      if (p.task && p.task.id === taskId) found.push({ dateKey: dk, start: p.start, dur: p.dur });
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