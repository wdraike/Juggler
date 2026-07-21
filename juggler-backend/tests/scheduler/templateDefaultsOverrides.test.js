/**
 * 999.2161 — canonical template_defaults/template_overrides wired into the
 * scheduler's assembled cfg + getBlocksForDate resolution.
 *
 * End-to-end proof (via unifiedScheduleV2, not just the pure helper) that a
 * day-assignment or date-override edit to the canonical trio changes actual
 * task PLACEMENT — without touching the legacy `time_blocks` row at all.
 * Mirrors TS-207 (docs/TEST-SPECS-USER-CONFIG-TEMPLATE-TASK.md).
 */

'use strict';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');

// 2026-07-20 is a Monday.
const TODAY = '2026-07-20';
const NOW_MINS = 480; // 8:00 AM

// Legacy `time_blocks` row: Monday is ALL "home"-location, all day — this
// stays untouched across every test below (proof #1: no legacy rewrite
// needed for the new resolution to take effect).
const LEGACY_HOME_ONLY_MON = [
  { id: 'home-block', tag: 'anytime', name: 'Home', start: 360, end: 1260, loc: 'home' }
];

const OFFICE_TEMPLATE_BLOCKS = [
  { id: 'office-block', tag: 'anytime', name: 'Office', start: 360, end: 1260, loc: 'work' }
];

function makeCfg(overrides) {
  return {
    timeBlocks: { Mon: LEGACY_HOME_ONLY_MON },
    toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15,
    locSchedules: {},
    locScheduleDefaults: {},
    locScheduleOverrides: {},
    hourLocationOverrides: {},
    scheduleTemplates: { office: { name: 'Office', blocks: OFFICE_TEMPLATE_BLOCKS } },
    preferences: {},
    ...overrides
  };
}

function makeTask(overrides) {
  return {
    id: 't_work_task',
    text: 'Work-only task',
    date: TODAY,
    dur: 60,
    pri: 'P2',
    when: '',
    dayReq: 'any',
    status: '',
    dependsOn: [],
    location: ['work'],
    tools: [],
    recurring: false,
    generated: false,
    split: false,
    section: '',
    placementMode: PLACEMENT_MODES.ANYTIME,
    ...overrides
  };
}

function run(tasks, cfg) {
  const statuses = {};
  tasks.forEach(function (t) { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, cfg);
}

function isPlaced(result, taskId) {
  return Object.keys(result.dayPlacements).some(function (dk) {
    return (result.dayPlacements[dk] || []).some(function (p) { return p.task && p.task.id === taskId; });
  });
}

describe('999.2161: template_defaults/template_overrides wired into scheduler placement', function () {
  test('control: with NO canonical day-assignment, a work-only task is unplaced (legacy Monday is home-only)', function () {
    var cfg = makeCfg(); // no templateDefaults/templateOverrides at all
    var result = run([makeTask()], cfg);
    expect(isPlaced(result, 't_work_task')).toBe(false);
  });

  test('cfg.templateDefaults[Mon] = "office" places the work-only task, WITHOUT any legacy time_blocks rewrite', function () {
    var cfg = makeCfg({ templateDefaults: { Mon: 'office' } });
    // Legacy row is untouched — still home-only — proving the day-assignment
    // reached placement via the canonical map, not a legacy-key rewrite.
    expect(cfg.timeBlocks.Mon).toBe(LEGACY_HOME_ONLY_MON);

    var result = run([makeTask()], cfg);
    expect(isPlaced(result, 't_work_task')).toBe(true);
  });

  test('TS-207: cfg.templateOverrides[date] wins over cfg.templateDefaults[dayName] for that date', function () {
    // templateDefaults says Monday = office (work-capable) — that applies to
    // EVERY Monday, so a deadline bounds the search to TODAY only; otherwise
    // the scheduler would happily place the task on a later Monday where the
    // (unrelated to today's override) day default still applies. The point
    // under test is narrower: for THIS date, the override wins over the
    // day-of-week default.
    var cfg = makeCfg({
      templateDefaults: { Mon: 'office' },
      templateOverrides: { '2026-07-20': 'home-only' },
      scheduleTemplates: {
        office: { name: 'Office', blocks: OFFICE_TEMPLATE_BLOCKS },
        'home-only': { name: 'Home', blocks: LEGACY_HOME_ONLY_MON }
      }
    });
    var result = run([makeTask({ deadline: '2026-07-20 23:59' })], cfg);
    // Override (home-only) wins over the day default (office) for THIS date
    // -> the work-only task cannot be placed within its deadline.
    expect(isPlaced(result, 't_work_task')).toBe(false);
    expect(result.unplaced.some(function (t) { return t.id === 't_work_task'; })).toBe(true);
  });

  test('unknown templateId in templateDefaults falls through to legacy blocksMap (SUB-207a) rather than crashing/unplacing everything', function () {
    var warnSpy = jest.spyOn(console, 'warn').mockImplementation(function () {});
    try {
      var cfg = makeCfg({ templateDefaults: { Mon: 'ghost-e2e-2161' } });
      var result = run([makeTask()], cfg);
      // Falls through to the legacy home-only Monday -> work-only task still unplaced,
      // same as the "no canonical assignment at all" control case (not a crash).
      expect(isPlaced(result, 't_work_task')).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
