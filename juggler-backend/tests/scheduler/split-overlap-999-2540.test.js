/**
 * Split task overlap verification (999.2540).
 *
 * Verifies that split chunks placed by placeSplitInline never overlap with
 * other tasks' placements on the same day. The scheduler's dayOcc grid is
 * shared, so chunks should see previously-placed tasks as occupied and
 * vice versa.
 *
 * Pure unit tests calling unifiedScheduleV2 directly — no DB required.
 */

'use strict';

var unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
var { PLACEMENT_MODES } = require('../../src/lib/placementModes');

var TODAY = '2026-06-10'; // Wednesday
var NOW_MINS = 0;

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
    preferences: {},
  }, overrides || {});
}

var cfg = makeCfg();

function makeTask(overrides) {
  return Object.assign({
    id: 't_' + Math.random().toString(36).slice(2, 8),
    text: 'Test task',
    date: TODAY,
    dur: 60,
    pri: 'P3',
    when: '',
    dayReq: 'any',
    status: '',
    dependsOn: [],
    location: [],
    tools: [],
    recurring: false,
    generated: false,
    split: false,
    section: '',
    placementMode: PLACEMENT_MODES.ANYTIME,
  }, overrides || {});
}

function run(tasks, overrideCfg) {
  var statuses = {};
  tasks.forEach(function (t) { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, overrideCfg || cfg);
}

function findAllPlacements(result) {
  var all = [];
  Object.keys(result.dayPlacements).forEach(function (dk) {
    (result.dayPlacements[dk] || []).forEach(function (p) {
      all.push({
        taskId: p.task ? p.task.id : p.id,
        dateKey: dk,
        start: p.start,
        dur: p.dur,
        end: p.start + p.dur,
        travelBefore: p.travelBefore || 0,
        travelAfter: p.travelAfter || 0,
      });
    });
  });
  return all;
}

/**
 * Check for overlaps between ALL placements (including travel buffers).
 * Two placements overlap if their [start - travelBefore, end + travelAfter)
 * ranges intersect on the same dateKey.
 */
function findOverlaps(placements) {
  var byDate = {};
  placements.forEach(function (p) {
    var key = p.dateKey;
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(p);
  });

  var overlaps = [];
  Object.keys(byDate).forEach(function (dk) {
    var dayPlacements = byDate[dk];
    for (var i = 0; i < dayPlacements.length; i++) {
      for (var j = i + 1; j < dayPlacements.length; j++) {
        var a = dayPlacements[i];
        var b = dayPlacements[j];
        if (a.taskId === b.taskId) continue; // same task (split chunks) — checked separately
        var aStart = a.start - a.travelBefore;
        var aEnd = a.end + a.travelAfter;
        var bStart = b.start - b.travelBefore;
        var bEnd = b.end + b.travelAfter;
        if (aStart < bEnd && bStart < aEnd) {
          overlaps.push({ a: a, b: b, dateKey: dk });
        }
      }
    }
  });
  return overlaps;
}

/**
 * Check for overlaps between split chunks of the SAME task.
 */
function findSameTaskOverlaps(placements) {
  var byDate = {};
  placements.forEach(function (p) {
    var key = p.dateKey;
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(p);
  });

  var overlaps = [];
  Object.keys(byDate).forEach(function (dk) {
    var dayPlacements = byDate[dk];
    for (var i = 0; i < dayPlacements.length; i++) {
      for (var j = i + 1; j < dayPlacements.length; j++) {
        var a = dayPlacements[i];
        var b = dayPlacements[j];
        if (a.taskId !== b.taskId) continue;
        if (a.start < b.end && b.start < a.end) {
          overlaps.push({ a: a, b: b, dateKey: dk });
        }
      }
    }
  });
  return overlaps;
}

describe('999.2540: Split task overlap verification', function () {
  test('split chunks do not overlap with other tasks on the same day', function () {
    var splitTask = makeTask({
      id: 'sprinkler',
      text: 'Repair Dead Sprinkler Zone',
      dur: 240,
      split: true,
      splitMin: 60,
      placementMode: PLACEMENT_MODES.ANYTIME,
      pri: 'P3',
    });
    var otherTask = makeTask({
      id: 'other_task',
      text: 'Other Task',
      dur: 120,
      split: false,
      placementMode: PLACEMENT_MODES.ANYTIME,
      pri: 'P2',
    });

    var result = run([splitTask, otherTask]);
    var allPlacements = findAllPlacements(result);
    var overlaps = findOverlaps(allPlacements);

    expect(overlaps).toEqual([]);
  });

  test('split chunks of the same task do not overlap each other', function () {
    var splitTask = makeTask({
      id: 'sprinkler2',
      text: 'Repair Dead Sprinkler Zone 2',
      dur: 300,
      split: true,
      splitMin: 60,
      placementMode: PLACEMENT_MODES.ANYTIME,
      pri: 'P3',
    });

    var result = run([splitTask]);
    var allPlacements = findAllPlacements(result);
    var sameTaskOverlaps = findSameTaskOverlaps(allPlacements);

    expect(sameTaskOverlaps).toEqual([]);
  });

  test('split task with tight capacity — chunks and other tasks still no overlap', function () {
    // Tight config: only morning block (6:00-12:00 = 360min), forcing split
    var tightCfg = makeCfg({
      timeBlocks: {
        monday:    [{ start: 360, end: 720 }],
        tuesday:   [{ start: 360, end: 720 }],
        wednesday: [{ start: 360, end: 720 }],
        thursday:  [{ start: 360, end: 720 }],
        friday:    [{ start: 360, end: 720 }],
        saturday:  [{ start: 360, end: 720 }],
        sunday:    [{ start: 360, end: 720 }],
      },
    });

    var splitTask = makeTask({
      id: 'sprinkler3',
      text: 'Repair Dead Sprinkler Zone 3',
      dur: 300,
      split: true,
      splitMin: 60,
      placementMode: PLACEMENT_MODES.ANYTIME,
      pri: 'P3',
    });
    var otherTask = makeTask({
      id: 'other3',
      text: 'Other Task 3',
      dur: 120,
      split: false,
      placementMode: PLACEMENT_MODES.ANYTIME,
      pri: 'P1',
    });

    var result = run([splitTask, otherTask], tightCfg);
    var allPlacements = findAllPlacements(result);
    var overlaps = findOverlaps(allPlacements);
    var sameTaskOverlaps = findSameTaskOverlaps(allPlacements);

    expect(overlaps).toEqual([]);
    expect(sameTaskOverlaps).toEqual([]);
  });

  test('split task with multiple other tasks — no cross-task overlaps', function () {
    var splitTask = makeTask({
      id: 'sprinkler4',
      text: 'Repair Dead Sprinkler Zone 4',
      dur: 360,
      split: true,
      splitMin: 60,
      placementMode: PLACEMENT_MODES.ANYTIME,
      pri: 'P3',
    });
    var task2 = makeTask({
      id: 'task2',
      dur: 120,
      pri: 'P2',
    });
    var task3 = makeTask({
      id: 'task3',
      dur: 90,
      pri: 'P1',
    });
    var task4 = makeTask({
      id: 'task4',
      dur: 60,
      pri: 'P2',
    });

    var result = run([splitTask, task2, task3, task4]);
    var allPlacements = findAllPlacements(result);
    var overlaps = findOverlaps(allPlacements);

    expect(overlaps).toEqual([]);
  });
});