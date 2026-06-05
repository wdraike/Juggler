/**
 * Preferred-time placement tests for findEarliestSlot (via unifiedScheduleV2).
 *
 * Verifies the fix that places TIME_WINDOW tasks at their preferredTimeMins
 * instead of the window start (winStart). Before the fix, DAY_START clamping
 * could force the window's lower bound to 6:00 AM even when preferredTimeMins
 * was later (e.g. 7:00 AM), so both loops started from winStart=360 and the
 * task landed 60 minutes earlier than intended.
 *
 * After the fix:
 *   prefStart = max(winStart, preferredTimeMins)  [for isWindowMode items]
 *   Loop 1: s in [prefStart, winEnd)  — preferred time and after
 *   Loop 2: sf in [winStart, prefStart)  — earlier fallback only when 1 exhausted
 */

'use strict';

process.env.NODE_ENV = 'test';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');

// 2026-06-10 is a Wednesday; no special significance — just a stable future date.
const TODAY = '2026-06-10';
const NOW_MINS = 0; // No time blocked at day start — all slots from 6 AM onward are free.

function makeCfg(overrides) {
  return {
    timeBlocks: DEFAULT_TIME_BLOCKS,
    toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15,
    locSchedules: {},
    locScheduleDefaults: {},
    locScheduleOverrides: {},
    hourLocationOverrides: {},
    scheduleTemplates: null,
    preferences: {},
    ...overrides
  };
}

const cfg = makeCfg();

function makeTask(overrides) {
  return {
    id: 't_' + Math.random().toString(36).slice(2, 8),
    text: 'Test task',
    date: TODAY,
    dur: 15,
    pri: 'P3',
    when: '',
    dayReq: 'any',
    status: '',
    dependsOn: [],
    location: [],
    tools: [],
    recurring: true,
    generated: true,
    split: false,
    section: '',
    ...overrides
  };
}

function run(tasks) {
  const statuses = {};
  tasks.forEach(function (t) { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, cfg);
}

function findPlacement(result, taskId) {
  var found = null;
  Object.keys(result.dayPlacements).forEach(function (dk) {
    (result.dayPlacements[dk] || []).forEach(function (p) {
      if (p.task && p.task.id === taskId) found = { dateKey: dk, start: p.start, dur: p.dur };
    });
  });
  return found;
}

// ── Constants ──────────────────────────────────────────────────
// DAY_START = GRID_START * 60 = 6 * 60 = 360 (6:00 AM in minutes).
// preferredTimeMins=420 is 7:00 AM; timeFlex=60 gives window [360, 480] (6:00–8:00 AM).
//   windowLo = max(360, 420-60) = max(360, 360) = 360  (clamped to DAY_START)
//   windowHi = min(1259, 420+60) = 480
// This is the scenario from the original bug: the clamped window starts at 6:00 AM
// but the preferred time is 7:00 AM. Old code placed tasks at 6:00; fix places at 7:00.
const PREF_MINS = 420;  // 7:00 AM
const TIME_FLEX = 60;
const WIN_START = 360;  // DAY_START — window is clamped here (6:00 AM)
const WIN_END   = 480;  // PREF_MINS + TIME_FLEX (8:00 AM)
const TASK_DUR  = 15;

describe('preferred-time placement — findEarliestSlot fix', () => {
  // ── Test A ─────────────────────────────────────────────────────
  // When all slots are free, a TIME_WINDOW task should land at preferredTimeMins
  // (420 / 7:00 AM), not at the window start (360 / 6:00 AM).
  test('A: places at preferredTimeMins (420) not winStart (360) when all slots free', () => {
    const task = makeTask({
      id: 'pref_a',
      text: 'Medications',
      placementMode: 'time_window',
      preferredTimeMins: PREF_MINS,
      timeFlex: TIME_FLEX,
      dur: TASK_DUR
    });

    const result = run([task]);
    const p = findPlacement(result, 'pref_a');

    expect(p).not.toBeNull();
    expect(p.start).toBe(PREF_MINS);  // must land at 7:00 AM (420), not 6:00 AM (360)
    expect(p.start).not.toBe(WIN_START);
  });

  // ── Test B ─────────────────────────────────────────────────────
  // When all slots from preferredTimeMins to winEnd are occupied (by a blocker
  // task), the fallback loop should find the earliest free slot at winStart.
  test('B: falls back to winStart (360) when preferred+ slots are all blocked', () => {
    // Blocker task fills the entire [420, 480) range (60 min at preferredTimeMins).
    // We use a fixed/pinned task (anchorMin supplied) so it reserves exactly those
    // minutes before the queue task searches. Slot 360 (win start) remains free.
    const blocker = makeTask({
      id: 'blocker_b',
      text: 'Blocker',
      placementMode: 'fixed',
      date: TODAY,
      time: '7:00 AM',   // anchorMin = 420 = PREF_MINS
      recurring: false,
      generated: false,
      dur: WIN_END - PREF_MINS  // 60 min — fills 420..480 (entire preferred+ range)
    });

    const task = makeTask({
      id: 'pref_b',
      text: 'Medications',
      placementMode: 'time_window',
      preferredTimeMins: PREF_MINS,
      timeFlex: TIME_FLEX,
      dur: TASK_DUR
    });

    const result = run([blocker, task]);
    const blocker_p = findPlacement(result, 'blocker_b');
    const p = findPlacement(result, 'pref_b');

    // Verify blocker actually anchored at 7:00 AM — if it didn't, this test would
    // produce a false pass (pref_b lands at 420 because the slot is free, not because
    // the fallback fired).
    expect(blocker_p).not.toBeNull();
    expect(blocker_p.start).toBe(PREF_MINS);

    expect(p).not.toBeNull();
    // Preferred range is fully blocked; fallback loop must use winStart.
    expect(p.start).toBe(WIN_START);  // 6:00 AM fallback
  });

  // ── Test C ─────────────────────────────────────────────────────
  // A task that is NOT in TIME_WINDOW mode (placementMode: 'anytime') should
  // not be affected by the preferredTimeMins fix. The prefStart short-circuit
  // only fires when item.isWindowMode is true — so the loop must still start
  // from winStart (360) for ANYTIME tasks.
  test('C: non-window ANYTIME task still placed from winStart, unaffected by fix', () => {
    const task = makeTask({
      id: 'pref_c',
      text: 'Regular task',
      placementMode: 'anytime',
      preferredTimeMins: PREF_MINS,  // present but must NOT shift the search start
      timeFlex: TIME_FLEX,
      dur: TASK_DUR,
      // ANYTIME + nowMins=0 + preferredTimeMins=420 would set preferLatestSlot
      // only if anchorMin < nowMins, but nowMins=0 and anchorMin=420 → not triggered.
      // The task should be placed at the first available slot (DAY_START=360).
    });

    const result = run([task]);
    const p = findPlacement(result, 'pref_c');

    expect(p).not.toBeNull();
    // ANYTIME tasks start from winStart, so slot 360 (6:00 AM) is the first candidate.
    expect(p.start).toBe(WIN_START);
  });
});
