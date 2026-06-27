/**
 * Debug test to understand spacing algorithm behavior.
 */
'use strict';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');

const TODAY = '2026-06-17';
const NOW_MINS = 540;

const BASIC_BLOCKS = {
  Mon: [{ id: 'all', tag: 'all', name: 'All Day', start: 360, end: 1380, color: '#666', loc: 'home' }],
  Tue: [{ id: 'all', tag: 'all', name: 'All Day', start: 360, end: 1380, color: '#666', loc: 'home' }],
  Wed: [{ id: 'all', tag: 'all', name: 'All Day', start: 360, end: 1380, color: '#666', loc: 'home' }],
  Thu: [{ id: 'all', tag: 'all', name: 'All Day', start: 360, end: 1380, color: '#666', loc: 'home' }],
  Fri: [{ id: 'all', tag: 'all', name: 'All Day', start: 360, end: 1380, color: '#666', loc: 'home' }],
  Sat: [{ id: 'all', tag: 'all', name: 'All Day', start: 420, end: 1380, color: '#666', loc: 'home' }],
  Sun: [{ id: 'all', tag: 'all', name: 'All Day', start: 420, end: 1380, color: '#666', loc: 'home' }],
};

function makeCfg(overrides) {
  return Object.assign({
    timeBlocks: BASIC_BLOCKS,
    toolMatrix: {},
    locSchedules: {},
    locScheduleDefaults: {},
    locScheduleOverrides: {},
    hourLocationOverrides: {},
    scheduleTemplates: null,
    splitMinDefault: 15,
    preferences: {},
    timezone: 'America/New_York',
  }, overrides || {});
}

function makeTpcInstance(overrides) {
  return Object.assign({
    id: 'debug-' + Math.random().toString(36).slice(2, 8),
    text: 'Debug test',
    date: TODAY,
    dur: 60,
    pri: 'P2',
    when: '',
    dayReq: 'any',
    status: '',
    deadline: null,
    earliestStart: null,
    recurring: true,
    generated: true,
    split: false,
    splitMin: null,
    location: [],
    tools: [],
    dependsOn: [],
    flexWhen: false,
    placementMode: PLACEMENT_MODES.ANYTIME,
    travelBefore: 0,
    travelAfter: 0,
    sourceId: 'master-debug',
    taskType: 'recurring_instance',
    recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 3 },
    _targetDate: null,
    _deadlineDate: null,
  }, overrides);
}

function findPlacement(result, taskId) {
  var found = null;
  Object.keys(result.dayPlacements || {}).forEach(function (dk) {
    (result.dayPlacements[dk] || []).forEach(function (p) {
      if (p.task && p.task.id === taskId) found = { dateKey: dk, start: p.start, dur: p.dur, entry: p };
    });
  });
  return found;
}

describe('Debug spacing algorithm', function () {
  test('check _targetDate behavior with future target', function () {
    // Test: _targetDate = 2026-06-19 (Friday), anchor = 2026-06-17 (Wednesday)
    var task = makeTpcInstance({
      id: 'debug-future',
      date: '2026-06-17',
      dur: 60,
      _targetDate: '2026-06-19',
      _deadlineDate: '2026-06-22',
    });

    var result = run([task]);
    var p = findPlacement(result, 'debug-future');
    console.log('DEBUG: placement =', JSON.stringify(p));
    console.log('DEBUG: unplaced =', JSON.stringify(result.unplaced.map(function(t) { return { id: t.id, reason: t._unplacedReason }; })));
    console.log('DEBUG: dayPlacements keys =', Object.keys(result.dayPlacements));
    Object.keys(result.dayPlacements).forEach(function(dk) {
      console.log('DEBUG: dayPlacements[' + dk + '] =', result.dayPlacements[dk].map(function(p) { return { id: p.task && p.task.id, start: p.start, dur: p.dur }; }));
    });
    expect(p).not.toBeNull();
  });

  test('check _targetDate behavior with same-day target', function () {
    var task = makeTpcInstance({
      id: 'debug-today',
      date: '2026-06-17',
      dur: 60,
      _targetDate: '2026-06-17',
      _deadlineDate: '2026-06-20',
    });

    var result = run([task]);
    var p = findPlacement(result, 'debug-today');
    console.log('DEBUG: placement =', JSON.stringify(p));
    expect(p).not.toBeNull();
  });

  test('check _targetDate behavior with no _targetDate', function () {
    var task = makeTpcInstance({
      id: 'debug-notarget',
      date: '2026-06-17',
      dur: 60,
      _targetDate: null,
      _deadlineDate: null,
    });

    var result = run([task]);
    var p = findPlacement(result, 'debug-notarget');
    console.log('DEBUG: placement =', JSON.stringify(p));
    expect(p).not.toBeNull();
  });
});

function run(tasks, cfgOverride) {
  const cfg = cfgOverride || makeCfg();
  const statuses = {};
  tasks.forEach(function (t) { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, cfg);
}
