/**
 * 999.4915: a partially-split task with a strictly-past deadline gets
 * chunk 1's placement nulled in the DB while chunks 2..n stay on the grid.
 *
 * The bug is in runSchedule.js's result.unplaced.forEach (line ~2322):
 * a task that holds real placements (partial split with chunks on the
 * grid) is written back as unscheduled=1, nulling chunk 1's scheduled_at.
 * The fix adds `if (placementByTaskId[t.id]) return;` — the same guard
 * Phase 9 uses at line ~2714.
 *
 * This test verifies the SCHEDULER produces the precondition: a non-FIXED
 * split task with a past deadline that is partially placed (some chunks
 * placed, some unplaced). The guard in runSchedule.js then prevents the
 * placed chunks from being nulled.
 */
'use strict';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');

const TODAY = '2026-06-08'; // Monday
const NOW_MINS = 0;
var PAST_DATE = '2026-06-01'; // strictly past

// Single 09:00-11:00 block (540-660, 120 min) — small enough that a 300-min
// task with splitMin=120 can only place 2 of 3 chunks (120+120 placed, 60 unplaced).
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
    id: 't1', text: 'past-deadline split test', date: PAST_DATE, dur: 300, pri: 'P3',
    when: 'morning', dayReq: 'weekday', status: '', dependsOn: [],
    location: [], tools: [], recurring: false, generated: false,
    split: true, splitMin: 120,
    deadline: PAST_DATE + ' 23:59:59',
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

function isUnplaced(result, taskId) {
  return result.unplaced.some(function (u) { return (u.id || (u.task && u.task.id)) === taskId; });
}

test('partial split with past deadline: task appears in BOTH placements AND unplaced (precondition for 999.4915)', function () {
  var cfg = tightWindowCfg();
  var task = makeTask({ dur: 300, splitMin: 120, deadline: PAST_DATE + ' 23:59:59' });
  var result = unifiedSchedule([task], { t1: '' }, TODAY, NOW_MINS, cfg);

  var placements = findPlacements(result, 't1');
  // Some chunks should be placed (the scheduler places what fits).
  expect(placements.length).toBeGreaterThan(0);

  // The task should also be in unplaced (it has leftover work).
  // This is the precondition: the task is in BOTH, and runSchedule.js's
  // guard must prevent the unplaced write from nulling the placed chunks.
  expect(isUnplaced(result, 't1')).toBe(true);
});