/**
 * Scheduler day bounds — schedFloor/schedCeiling wiring (999.1223).
 *
 * David's ruling 2026-07-06: preferences.schedFloor/schedCeiling (minutes
 * since midnight) are per-user overrides of the hardwired GRID_START=6 /
 * GRID_END=23 scheduler day bounds. Unset knob = hardwired default.
 * An inverted combo (floor >= ceiling) is rejected at the write boundary
 * (config.schema.js); if a bad combo still reaches the scheduler it is
 * ignored wholesale (both defaults), never half-applied.
 *
 * Pure scheduler tests — no DB. Placements are asserted directly from
 * result.dayPlacements (never via non-occupying "blocker" fixtures), and
 * every bounds assertion first proves at least one placement exists, so
 * these tests cannot false-green by scheduling nothing.
 */

const unifiedSchedule = require('../src/scheduler/unifiedScheduleV2');
const { dayBoundsFromCfg, clampWindowsToBounds } = unifiedSchedule._testOnly;
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');

const TODAY = '2026-04-07'; // Monday
const EARLY_NOW = 300;      // 5:00 AM — before every schedulable block

function makeCfg(preferences) {
  return {
    timeBlocks: DEFAULT_TIME_BLOCKS, toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15, locSchedules: {}, locScheduleDefaults: {},
    locScheduleOverrides: {}, hourLocationOverrides: {},
    scheduleTemplates: null, preferences: preferences || {},
  };
}

let _n = 0;
function task(overrides) {
  _n++;
  return {
    id: overrides.id || 'db_' + _n, text: overrides.text || 'Task ' + _n,
    date: TODAY, dur: 30, pri: 'P3', when: '', dayReq: 'any', status: '',
    dependsOn: [], location: [], tools: [], recurring: false,
    split: false, datePinned: false, generated: false,
    section: '', flexWhen: false, timeFlex: undefined, ...overrides,
  };
}

function schedule(tasks, cfg, nowMins) {
  var statuses = {};
  tasks.forEach(t => statuses[t.id] = t.status || '');
  return unifiedSchedule(tasks, statuses, TODAY, nowMins != null ? nowMins : EARLY_NOW, cfg);
}

function placement(result, taskId) {
  for (var dk in result.dayPlacements) {
    for (var p of result.dayPlacements[dk]) {
      if (p.task && p.task.id === taskId) return { day: dk, start: p.start, dur: p.dur, end: p.start + p.dur };
    }
  }
  return null;
}

function allPlacements(result) {
  var out = [];
  for (var dk in result.dayPlacements) {
    for (var p of result.dayPlacements[dk]) {
      out.push({ day: dk, id: p.task && p.task.id, start: p.start, end: p.start + p.dur });
    }
  }
  return out;
}

describe('dayBoundsFromCfg (unit)', () => {
  test('unset knobs → hardwired GRID_START/GRID_END defaults (360..1439)', () => {
    expect(dayBoundsFromCfg({})).toEqual({ lo: 360, hi: 1439 });
    expect(dayBoundsFromCfg(null)).toEqual({ lo: 360, hi: 1439 });
    expect(dayBoundsFromCfg(makeCfg())).toEqual({ lo: 360, hi: 1439 });
  });

  test('schedFloor/schedCeiling read from cfg.preferences (minutes, no hour conversion)', () => {
    expect(dayBoundsFromCfg(makeCfg({ schedFloor: 480, schedCeiling: 1200 })))
      .toEqual({ lo: 480, hi: 1200 });
  });

  test('top-level cfg keys (loadSchedulerConfig hoist) win over preferences', () => {
    var cfg = makeCfg({ schedFloor: 600 });
    cfg.schedFloor = 480;
    expect(dayBoundsFromCfg(cfg).lo).toBe(480);
  });

  test('ceiling 1440 ("midnight" option) clamps to the hardwired 1439 grid end', () => {
    expect(dayBoundsFromCfg(makeCfg({ schedCeiling: 1440 })).hi).toBe(1439);
  });

  test('inverted combo (floor >= ceiling) is ignored WHOLESALE — both defaults', () => {
    expect(dayBoundsFromCfg(makeCfg({ schedFloor: 600, schedCeiling: 500 })))
      .toEqual({ lo: 360, hi: 1439 });
    expect(dayBoundsFromCfg(makeCfg({ schedFloor: 600, schedCeiling: 600 })))
      .toEqual({ lo: 360, hi: 1439 });
  });

  test('non-numeric junk is treated as unset', () => {
    expect(dayBoundsFromCfg(makeCfg({ schedFloor: '480', schedCeiling: NaN })))
      .toEqual({ lo: 360, hi: 1439 });
  });
});

describe('clampWindowsToBounds (unit)', () => {
  test('default bounds are a no-op (same object — zero drift for unset knobs)', () => {
    var wins = { morning: [[360, 480]], anytime: [[360, 1380]] };
    expect(clampWindowsToBounds(wins, 360, 1439)).toBe(wins);
  });

  test('narrows overlapping windows and empties fully-excluded ones', () => {
    var wins = { morning: [[360, 480]], night: [[1260, 1380]], anytime: [[360, 1380]] };
    expect(clampWindowsToBounds(wins, 480, 1200)).toEqual({
      morning: [],            // entirely before the floor
      night: [],              // entirely after the ceiling
      anytime: [[480, 1200]],
    });
  });
});

describe('scheduler day bounds (integration — R11.17)', () => {
  test('defaults: empty day → anytime task placed at 6:00 AM (360), proving the 6-23 default floor', () => {
    var r = schedule([task({ id: 't1', dur: 60 })], makeCfg());
    var p = placement(r, 't1');
    expect(p).not.toBeNull();
    expect(p.start).toBe(360);
  });

  test('schedFloor=480/schedCeiling=1200: identical task starts at 8:00, never earlier', () => {
    var r = schedule([task({ id: 't1', dur: 60 })], makeCfg({ schedFloor: 480, schedCeiling: 1200 }));
    var p = placement(r, 't1');
    expect(p).not.toBeNull();
    expect(p.start).toBe(480);
  });

  test('8:00-20:00 user: NO placement outside [480, 1200] across a multi-day spill; defaults DO place outside', () => {
    function demand() {
      var tasks = [];
      for (var i = 0; i < 8; i++) tasks.push(task({ id: 'load' + i, dur: 120 }));
      tasks.push(task({ id: 'night1', when: 'night', dur: 30 }));
      return tasks;
    }

    var bounded = schedule(demand(), makeCfg({ schedFloor: 480, schedCeiling: 1200 }));
    var boundedPlacements = allPlacements(bounded);
    expect(boundedPlacements.length).toBeGreaterThan(0); // anti-false-green
    boundedPlacements.forEach(p => {
      expect(p.start).toBeGreaterThanOrEqual(480);
      expect(p.end).toBeLessThanOrEqual(1200);
    });

    var open = schedule(demand(), makeCfg());
    var openPlacements = allPlacements(open);
    expect(openPlacements.length).toBeGreaterThan(0);
    // Defaults still schedule outside 8-20: the 6:00 morning block gets used
    // and/or the night task lands at 21:00+.
    expect(openPlacements.some(p => p.start < 480 || p.end > 1200)).toBe(true);
  });

  test('night task: placed 21:00+ under defaults; unplaced (not force-placed inside bounds) when ceiling=1200 excludes its only block', () => {
    var open = schedule([task({ id: 'n1', when: 'night', dur: 30 })], makeCfg());
    var pOpen = placement(open, 'n1');
    expect(pOpen).not.toBeNull();
    expect(pOpen.start).toBeGreaterThanOrEqual(1260);

    var bounded = schedule([task({ id: 'n1', when: 'night', dur: 30 })],
      makeCfg({ schedFloor: 480, schedCeiling: 1200 }));
    expect(placement(bounded, 'n1')).toBeNull();
  });

  test('time_window task: flex window is clamped to the floor — search never dips below it', () => {
    function twTask() {
      return task({
        id: 'tw1', recurring: true, generated: true, placementMode: 'time_window',
        when: 'morning', time: '8:00 AM', preferredTimeMins: 480, timeFlex: 120, dur: 30,
      });
    }
    var open = schedule([twTask()], makeCfg());
    var pOpen = placement(open, 'tw1');
    expect(pOpen).not.toBeNull();
    expect(pOpen.start).toBe(480); // preferred time honored under defaults

    var floored = schedule([twTask()], makeCfg({ schedFloor: 540, schedCeiling: 1200 }));
    var pFloor = placement(floored, 'tw1');
    expect(pFloor).not.toBeNull();
    expect(pFloor.start).toBeGreaterThanOrEqual(540);
  });

  test('user-pinned FIXED task is exempt: stays at 6:30 even with floor=480 (explicit pin beats bounds)', () => {
    var r = schedule([task({ id: 'fx1', placementMode: 'fixed', time: '6:30 AM', dur: 60, datePinned: true })],
      makeCfg({ schedFloor: 480, schedCeiling: 1200 }));
    var p = placement(r, 'fx1');
    expect(p).not.toBeNull();
    expect(p.start).toBe(390);
  });

  test('inverted stored combo (floor=600 > ceiling=500) → scheduler behaves exactly like defaults', () => {
    var r = schedule([task({ id: 't1', dur: 60 })], makeCfg({ schedFloor: 600, schedCeiling: 500 }));
    var p = placement(r, 't1');
    expect(p).not.toBeNull();
    expect(p.start).toBe(360); // default floor, not 600, not 500
  });
});
