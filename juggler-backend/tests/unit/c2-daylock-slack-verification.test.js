/**
 * 999.1091 (C2) — day-lock slack model verification.
 *
 * David's ruling (2026-07-03, verbatim): "it can only be scheduled on the days
 * allowed by the user. If the users only want 3 occurrences in a week, but allow
 * more than 3 days, it can move to a different day if the pacing needs to be
 * violated [i.e. if the target day is unavailable]." Net effect (confirmed by code
 * trace — see .planning/kermit/sched-anchor-window/INTAKE-BRIEF.json): this is
 * EXACTLY the existing isFlexibleTpc / DAY-LOCK.2 mechanism, already shipped —
 *   - SLACK (allowed-days-count > timesPerCycle): roam is allowed, constrained to
 *     the user's own allowed days (never outside them) — already correct today.
 *   - NO SLACK (allowed-days-count === timesPerCycle, e.g. Mon/Wed/Fri selected
 *     AND exactly 3x/week): every allowed day is required every cycle — day-lock
 *     is CORRECT and must NOT be loosened. This is unifiedScheduleV2.js's own
 *     documented rationale for isDayLocked ("otherwise the Mon instance could
 *     roam onto Wed and collide with the Wed instance").
 *
 * This file exists because NO test in the existing suite pins the no-slack
 * multi-day case specifically (tpc.test.js covers the slack/roam case
 * extensively — TS-85 etc. — but not the exact-match boundary). Pure unit style,
 * no DB — mirrors tests/unit/tpc-spacing-algorithm.test.js's harness.
 */

'use strict';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');

const TODAY = '2026-06-17'; // Wednesday
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

function makeWeeklyInstance(overrides) {
  return Object.assign({
    id: 'c2-' + Math.random().toString(36).slice(2, 8),
    text: 'C2 slack-model test',
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
    taskType: 'recurring_instance',
  }, overrides);
}

function run(tasks, cfgOverride, dayOccOverride) {
  const cfg = cfgOverride || makeCfg();
  const statuses = {};
  tasks.forEach(function (t) { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, cfg);
}

function findPlacement(result, taskId) {
  var found = null;
  Object.keys(result.dayPlacements || {}).forEach(function (dk) {
    (result.dayPlacements[dk] || []).forEach(function (p) {
      if (p.task && p.task.id === taskId) found = { dateKey: dk, start: p.start, dur: p.dur };
    });
  });
  return found;
}

describe('999.1091 C2 — day-lock slack model (David ruling 2026-07-03)', function () {
  test('NO SLACK: Mon/Wed/Fri selected + timesPerCycle=3 (exact match) — each instance stays on its OWN picked day even when other allowed days are free', function () {
    // 2026-06-17 is a Wednesday (TODAY). Build 3 separate instances of the SAME
    // master, one per allowed day, exactly as expandRecurring would generate for
    // a non-reduced (tpc === selectedDayCount) weekly Mon/Wed/Fri master — no TPC
    // filtering happens in expandRecurring for this case (tpc >= selectedDayCount),
    // so each is a full-fledged separate instance already anchored to its own day.
    // Use next week's Mon/Wed/Fri (all future relative to TODAY=2026-06-17) —
    // a past-dated day-locked instance is dropped entirely (DAY-LOCK.3), which
    // would confound this test with a different mechanism.
    const mon = makeWeeklyInstance({
      id: 'c2-mon', date: '2026-06-22', sourceId: 'master-noslack',
      recur: { type: 'weekly', days: 'MWF', timesPerCycle: 3 },
    });
    const wed = makeWeeklyInstance({
      id: 'c2-wed', date: '2026-06-24', sourceId: 'master-noslack',
      recur: { type: 'weekly', days: 'MWF', timesPerCycle: 3 },
    });
    const fri = makeWeeklyInstance({
      id: 'c2-fri', date: '2026-06-26', sourceId: 'master-noslack',
      recur: { type: 'weekly', days: 'MWF', timesPerCycle: 3 },
    });

    const result = run([mon, wed, fri]);

    const monP = findPlacement(result, 'c2-mon');
    const wedP = findPlacement(result, 'c2-wed');
    const friP = findPlacement(result, 'c2-fri');

    expect(monP).not.toBeNull();
    expect(wedP).not.toBeNull();
    expect(friP).not.toBeNull();

    // Day-lock: no slack (allowed-days-count === timesPerCycle) means each
    // instance is confined to its OWN anchor day — never another allowed day.
    expect(monP.dateKey).toBe('2026-06-22');
    expect(wedP.dateKey).toBe('2026-06-24');
    expect(friP.dateKey).toBe('2026-06-26');
  });

  test('SLACK: Mon/Wed/Fri allowed + timesPerCycle=2 (fewer occurrences than allowed days) — roam is confined to the allowed-day set, never outside it', function () {
    // isFlexibleTpc = timesPerCycle(2) < selectedDayCount(3) -> true -> NOT day-locked,
    // roams within the cycle window. Two instances, both flexible.
    const a = makeWeeklyInstance({
      id: 'c2-slack-a', date: '2026-06-22', sourceId: 'master-slack', // Monday anchor
      recur: { type: 'weekly', days: 'MWF', timesPerCycle: 2 },
    });
    const b = makeWeeklyInstance({
      id: 'c2-slack-b', date: '2026-06-24', sourceId: 'master-slack', // Wednesday anchor
      recur: { type: 'weekly', days: 'MWF', timesPerCycle: 2 },
    });

    const result = run([a, b]);
    const aP = findPlacement(result, 'c2-slack-a');
    const bP = findPlacement(result, 'c2-slack-b');

    expect(aP).not.toBeNull();
    expect(bP).not.toBeNull();

    // Both placements MUST land on an allowed day (Mon/Wed/Fri) — never Tue/Thu/
    // Sat/Sun — this is David's "never outside the user's allowed days" invariant.
    var allowedDows = [1, 3, 5]; // Mon, Wed, Fri
    [aP, bP].forEach(function (p) {
      var dow = new Date(p.dateKey + 'T00:00:00').getDay();
      expect(allowedDows).toContain(dow);
    });
  });

  test('BIWEEKLY SLACK: roam is allowed across the FULL 14-day cycle, not just the originally-picked 7-day half (David ruling, follow-up)', function () {
    // Mon/Wed selected, biweekly, timesPerCycle=1 -> isFlexibleTpc = 1 < 2 = true.
    // Anchor = 2026-06-22 (Monday, week 0 of this cycle). cycleDays=14 for biweekly
    // -> roam window = [2026-06-22 .. 2026-07-05] (14 days), spanning BOTH weeks of
    // the pair. Occupy Mon+Wed of week 0 entirely (all-day fixed blockers) so the
    // ONLY way this instance can place at all is by rolling into week 1 (Mon/Wed of
    // 2026-06-29 or 2026-07-01) -- proving the roam genuinely crosses the parity
    // boundary rather than being confined to the originally-picked half.
    // effectiveDuration clamps any single task to 720 min max (ConstraintSolver.js),
    // so fully occupying a 1020-minute day (06:00-23:00) needs TWO blockers.
    function blockersFor(id, date) {
      return [
        makeWeeklyInstance({
          id: id + '-a', date: date, dur: 720, pri: 'P1',
          placementMode: PLACEMENT_MODES.ANYTIME, recurring: false, taskType: 'task',
          earliestStart: date, deadline: date,
        }),
        makeWeeklyInstance({
          id: id + '-b', date: date, dur: 300, pri: 'P1',
          placementMode: PLACEMENT_MODES.ANYTIME, recurring: false, taskType: 'task',
          earliestStart: date, deadline: date,
        }),
      ];
    }
    var blockersMon = blockersFor('blocker-mon', '2026-06-22');
    var blockersWed = blockersFor('blocker-wed', '2026-06-24');
    var flexible = makeWeeklyInstance({
      id: 'c2-biweekly-slack', date: '2026-06-22', sourceId: 'master-biweekly-slack',
      deadline: '2026-07-05', // extend the search window to the full 14-day cycle
      recur: { type: 'biweekly', days: 'MW', timesPerCycle: 1 },
    });

    var result = run(blockersMon.concat(blockersWed, [flexible]));
    var p = findPlacement(result, 'c2-biweekly-slack');

    expect(p).not.toBeNull();
    // Must have rolled PAST week 0 (both its days occupied) into week 1 of the
    // SAME 14-day cycle -- 2026-06-29 (Mon) or 2026-07-01 (Wed).
    expect(['2026-06-29', '2026-07-01']).toContain(p.dateKey);
  });
});
