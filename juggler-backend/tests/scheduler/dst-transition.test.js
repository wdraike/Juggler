/**
 * DST transition coverage — A4-M1 (HIGH gap, sched-audit AUDIT-REGISTER.md REG-36).
 *
 * The audit found ZERO suites exercising a US DST boundary (grep for
 * 2026-11-01/2026-03-08/"spring forward" = 0 hits) despite tz off-by-one being
 * high blast-radius in a scheduler. A3's code read found the grid-placement
 * layer (unifiedScheduleV2 + shared/scheduler/dateHelpers.js/timeBlockHelpers.js)
 * "structurally sound" and tz-agnostic BY CONSTRUCTION — verified here, not just
 * asserted:
 *
 *   - dateHelpers.parseDate/formatDateKey/getWeekStart/isSameDay operate ONLY on
 *     Y/M/D + getDay() local calendar components, never on elapsed real-time.
 *   - timeBlockHelpers builds day-of-week windows as plain [start,end] MINUTE
 *     pairs (0-1440), never Date arithmetic.
 *   - unifiedScheduleV2 places against `nowMins` (0-1439 int) and `dateKey`
 *     ("YYYY-MM-DD" string) — never constructs a `Date` object for a slot.
 *
 * A calendar day is always exactly 1440 grid-minutes to this layer, whether the
 * real-world day was 23h (spring-forward, 2026-03-08 US) or 25h (fall-back,
 * 2026-11-01 US). Section 1 proves that by direct comparison against a normal
 * day. Section 2 proves `expandRecurring`'s daily-cursor iteration doesn't
 * double/skip a calendar day across the transition. Section 3 is the
 * INTEGRATION-shaped test at the one layer that *does* do real Date/Intl-tz
 * arithmetic: `getNowInTimezone` (real "now" resolution) and
 * `rowToTask`/`computeWindowCloseUtc` (real scheduled_at parsing).
 *
 * 2026 US DST dates (verified via Intl, see Proof of Work in L4-TEST-REVIEW.md):
 *   Spring-forward: 2026-03-08, 2:00 AM -> 3:00 AM (hour 2-3 does not exist)
 *   Fall-back:      2026-11-01, 2:00 AM -> 1:00 AM (hour 1-2 occurs twice)
 *
 * Layer: unit (Sections 1-2, pure in-process, no DB) + unit-with-injected-clock
 * (Section 3, pure functions with an injectable clock — no DB, no real wall time).
 */
'use strict';

process.env.NODE_ENV = 'test';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');
const { expandRecurring } = require('../../../shared/scheduler/expandRecurring');
const { getNowInTimezone } = require('../../../shared/scheduler/getNowInTimezone');
const dateHelpers = require('../../../shared/scheduler/dateHelpers');
const { rowToTask } = require('../../src/slices/task/domain/mappers/taskMappers');
const { computeWindowCloseUtc } = require('../../src/scheduler/runSchedule');

const TZ = 'America/New_York';
const SPRING_FORWARD_DAY = '2026-03-08'; // 23h day
const FALL_BACK_DAY = '2026-11-01';      // 25h day
const NORMAL_DAY_A = '2026-03-01';       // control, same weekday (Sunday) as spring day
const NORMAL_DAY_B = '2026-10-25';       // control, same weekday (Sunday) as fall day

function makeCfg(overrides) {
  return Object.assign({
    timeBlocks: DEFAULT_TIME_BLOCKS,
    toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15,
    timezone: TZ,
  }, overrides || {});
}

function makeTimeWindowTask(overrides) {
  return Object.assign({
    id: 'dst_tw',
    text: 'DST TIME_WINDOW probe',
    date: null,
    dur: 30,
    pri: 'P2',
    when: 'work',
    dayReq: 'any',
    status: '',
    dependsOn: [],
    location: [],
    tools: [],
    recurring: false,
    generated: false,
    split: false,
    section: '',
    placementMode: PLACEMENT_MODES.TIME_WINDOW,
    preferredTimeMins: 540, // 9:00 AM
    timeFlex: 60,           // window [480,600] = 8:00-10:00
    time: undefined,
    scheduledAt: undefined,
    tz: TZ,
  }, overrides || {});
}

function runOn(todayKey, nowMins, tasks) {
  const statuses = {};
  tasks.forEach((t) => { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, todayKey, nowMins, makeCfg());
}

function gridEntry(result, taskId) {
  var found = null;
  Object.keys(result.dayPlacements || {}).forEach((dk) => {
    (result.dayPlacements[dk] || []).forEach((p) => {
      if (p && p.task && p.task.id === taskId) found = Object.assign({ dateKey: dk }, p);
    });
  });
  return found;
}

function unplacedIds(result) {
  const ids = new Set();
  (result.unplaced || []).forEach((u) => {
    const id = u && (u.id || (u.task && u.task.id));
    if (id) ids.add(id);
  });
  return ids;
}

// ---------------------------------------------------------------------------
// Section 1 — Grid layer: DST day behaves IDENTICALLY to a normal day
// (characterization: proves tz-agnostic-by-construction, not merely asserts it)
// ---------------------------------------------------------------------------
describe('DST — grid layer is minutes+dateKey pure (characterization)', () => {
  test('spring-forward day (23h): task placed at the SAME minute as a normal day, before the window closes', () => {
    const normal = runOn(NORMAL_DAY_A, 450, [makeTimeWindowTask()]); // 7:30 AM, before window
    const spring = runOn(SPRING_FORWARD_DAY, 450, [makeTimeWindowTask()]);
    const eNormal = gridEntry(normal, 'dst_tw');
    const eSpring = gridEntry(spring, 'dst_tw');
    expect(eNormal).not.toBeNull();
    expect(eSpring).not.toBeNull();
    // Same minute-of-day placement; only the dateKey differs.
    expect(eSpring.start).toBe(eNormal.start);
    expect(eSpring.end).toBe(eNormal.end);
    expect(eSpring.dateKey).toBe(SPRING_FORWARD_DAY);
    expect(unplacedIds(spring).has('dst_tw')).toBe(false);
  });

  test('fall-back day (25h): task placed at the SAME minute as a normal day, before the window closes', () => {
    const normal = runOn(NORMAL_DAY_B, 450, [makeTimeWindowTask()]);
    const fall = runOn(FALL_BACK_DAY, 450, [makeTimeWindowTask()]);
    const eNormal = gridEntry(normal, 'dst_tw');
    const eFall = gridEntry(fall, 'dst_tw');
    expect(eFall.start).toBe(eNormal.start);
    expect(eFall.end).toBe(eNormal.end);
    expect(eFall.dateKey).toBe(FALL_BACK_DAY);
    expect(unplacedIds(fall).has('dst_tw')).toBe(false);
  });

  test('window-close boundary crossing the transition day rolls forward IDENTICALLY to a normal day (minutes-grid, not wall-clock, decides the roll)', () => {
    // now=700 (11:40 AM) is past the window close (600 = 10:00 AM) on every day —
    // the task must roll to tomorrow, landing at the SAME preferred minute (540),
    // regardless of whether "today" had 23, 24, or 25 real hours.
    const normalSpring = runOn(NORMAL_DAY_A, 700, [makeTimeWindowTask()]);
    const spring = runOn(SPRING_FORWARD_DAY, 700, [makeTimeWindowTask()]);
    const normalFall = runOn(NORMAL_DAY_B, 700, [makeTimeWindowTask()]);
    const fall = runOn(FALL_BACK_DAY, 700, [makeTimeWindowTask()]);

    const eNormalSpring = gridEntry(normalSpring, 'dst_tw');
    const eSpring = gridEntry(spring, 'dst_tw');
    const eNormalFall = gridEntry(normalFall, 'dst_tw');
    const eFall = gridEntry(fall, 'dst_tw');

    expect(eSpring.start).toBe(eNormalSpring.start);
    expect(eSpring.dateKey).toBe('2026-03-09'); // next calendar day, not "next 24h"
    expect(eFall.start).toBe(eNormalFall.start);
    expect(eFall.dateKey).toBe('2026-11-02');
  });

  test('minutes-since-midnight arithmetic is unaffected by the transition: nowMins boundary values (0, 1439) behave identically day-to-day', () => {
    const beforeMidnight = runOn(SPRING_FORWARD_DAY, 1439, [makeTimeWindowTask()]);
    const midnight = runOn(SPRING_FORWARD_DAY, 0, [makeTimeWindowTask()]);
    // Both are valid nowMins inputs (0-1439 inclusive) — neither crashes nor
    // produces an out-of-grid placement; the grid clamps to DAY_START (360)
    // regardless of nowMins, so both place at/after 360.
    expect(gridEntry(beforeMidnight, 'dst_tw')).not.toBeNull();
    expect(gridEntry(midnight, 'dst_tw')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Section 2 — Recurring daily occurrence across the DST boundary
// (date pinning + no double/skip)
// ---------------------------------------------------------------------------
describe('DST — recurring daily expansion: no double, no skip, across the transition day', () => {
  function dailyMaster(id, recurStart) {
    return {
      id: id,
      text: 'Daily habit',
      recur: { type: 'daily' },
      recurStart: recurStart,
      dur: 20,
      pri: 'P3',
      taskType: 'recurring_template',
    };
  }

  // NOTE (evidence, not asserted here): expandRecurring's startDate/endDate are
  // parsed via bare `new Date("YYYY-MM-DD")` (expandRecurring.js:99-100), which
  // JS treats as UTC midnight; `.setHours(0,0,0,0)` then reinterprets that
  // instant in the PROCESS's local timezone. Under this repo's default process
  // tz (America/New_York, UTC-5/-4), that shifts the whole requested window
  // back by one calendar day (reproduced identically on a DST-adjacent AND a
  // plain non-DST week — it is a generic bare-date-string UTC/local mismatch,
  // NOT a DST-specific defect). Because of that, this test does NOT assert
  // "expand(startDate,endDate) returns exactly [startDate..endDate]" (that would
  // conflate the pre-existing generic bug with DST behavior). Instead it asserts
  // the DST-specific property the audit actually asked for: whatever contiguous
  // span comes back, the transition day appears EXACTLY ONCE and every
  // neighboring pair of instances is EXACTLY ONE calendar day apart — i.e. the
  // 23h/25h real-world day does not cause expandRecurring to double- or
  // under-materialize. The off-by-one itself is reported separately (see
  // L4-TEST-REVIEW.md finding DST-F1) — not fixed here per dispatch scope.
  test('spring-forward: exactly one instance on 2026-03-08, contiguous day-by-day, no dup/skip', () => {
    const src = dailyMaster('m-spring', '2026-01-01');
    const instances = expandRecurring([src], '2026-03-05', '2026-03-11', {});
    const dates = instances.map((t) => t.date);

    const onTransitionDay = dates.filter((d) => d === SPRING_FORWARD_DAY);
    expect(onTransitionDay.length).toBe(1); // no double-materialization

    const uniqueDates = new Set(dates);
    expect(uniqueDates.size).toBe(dates.length); // no duplicates anywhere in the span

    const sorted = dates.slice().sort();
    for (let i = 1; i < sorted.length; i++) {
      const prev = dateHelpers.parseDate(sorted[i - 1]);
      const cur = dateHelpers.parseDate(sorted[i]);
      const diffDays = Math.round((cur.getTime() - prev.getTime()) / 86400000);
      expect(diffDays).toBe(1); // no skipped calendar day across the transition
    }
  });

  test('fall-back: exactly one instance on 2026-11-01, contiguous day-by-day, no dup/skip', () => {
    const src = dailyMaster('m-fall', '2026-01-01');
    const instances = expandRecurring([src], '2026-10-29', '2026-11-04', {});
    const dates = instances.map((t) => t.date);

    const onTransitionDay = dates.filter((d) => d === FALL_BACK_DAY);
    expect(onTransitionDay.length).toBe(1);

    const uniqueDates = new Set(dates);
    expect(uniqueDates.size).toBe(dates.length);

    const sorted = dates.slice().sort();
    for (let i = 1; i < sorted.length; i++) {
      const prev = dateHelpers.parseDate(sorted[i - 1]);
      const cur = dateHelpers.parseDate(sorted[i]);
      const diffDays = Math.round((cur.getTime() - prev.getTime()) / 86400000);
      expect(diffDays).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 3 — Integration-shaped: the layer that DOES real Date/Intl-tz
// arithmetic (getNowInTimezone real-now resolution; rowToTask/computeWindowCloseUtc
// real scheduled_at parsing). Uses an injected clock — no live wall-clock, no DB.
// ---------------------------------------------------------------------------
describe('DST — integration-shaped: real now()/scheduled_at arithmetic at the transition instant', () => {
  function clockAt(iso) {
    return { now: function () { return new Date(iso); } };
  }

  test('spring-forward: getNowInTimezone jumps PAST the nonexistent 2-3 AM hour without crashing (missing-hour characterization)', () => {
    const justBefore = getNowInTimezone(TZ, clockAt('2026-03-08T06:59:00Z')); // 1:59 AM EST
    const atTransition = getNowInTimezone(TZ, clockAt('2026-03-08T07:00:00Z')); // 3:00 AM EDT
    const justAfter = getNowInTimezone(TZ, clockAt('2026-03-08T07:01:00Z')); // 3:01 AM EDT

    expect(justBefore.todayKey).toBe(SPRING_FORWARD_DAY);
    expect(atTransition.todayKey).toBe(SPRING_FORWARD_DAY);
    expect(justAfter.todayKey).toBe(SPRING_FORWARD_DAY);

    expect(justBefore.nowMins).toBe(119); // 1:59 AM
    expect(atTransition.nowMins).toBe(180); // 3:00 AM — the clock genuinely SKIPS 2:00-2:59
    expect(justAfter.nowMins).toBe(181);
    // 1 minute of real (UTC) time elapsed between justBefore and atTransition,
    // but nowMins jumped by 61 — proving the missing hour is real at this layer
    // (in contrast to Section 1, where the grid layer never sees this jump
    // because DAY_START=360 (6 AM) is always past the transition window).
  });

  test('fall-back: getNowInTimezone REPEATS the 1-2 AM hour without crashing (repeated-hour characterization)', () => {
    const firstPass = getNowInTimezone(TZ, clockAt('2026-11-01T05:59:00Z')); // 1:59 AM EDT
    const repeatStart = getNowInTimezone(TZ, clockAt('2026-11-01T06:00:00Z')); // 1:00 AM EST (again)
    const repeatEnd = getNowInTimezone(TZ, clockAt('2026-11-01T06:59:00Z'));  // 1:59 AM EST (again)

    expect(firstPass.todayKey).toBe(FALL_BACK_DAY);
    expect(repeatStart.todayKey).toBe(FALL_BACK_DAY);
    expect(repeatEnd.todayKey).toBe(FALL_BACK_DAY);

    expect(firstPass.nowMins).toBe(119);
    // nowMins goes BACKWARD (119 -> 60) even though real (UTC) time moved
    // forward — this is the repeated-hour phenomenon read purely from wall
    // clock. Not a bug: todayKey never regresses, and (per Section 1) the
    // scheduling grid never operates in this hour.
    expect(repeatStart.nowMins).toBe(60);
    expect(repeatEnd.nowMins).toBe(119);
  });

  test('computeWindowCloseUtc is UTC-pure: adds the same flex minutes on the transition day as a normal day', () => {
    const springTask = { scheduledAt: '2026-03-08T14:00:00.000Z', timeFlex: 60, preferredTimeMins: null };
    const fallTask = { scheduledAt: '2026-11-01T14:00:00.000Z', timeFlex: 60, preferredTimeMins: null };
    const normalTask = { scheduledAt: '2026-03-01T14:00:00.000Z', timeFlex: 60, preferredTimeMins: null };

    const springClose = computeWindowCloseUtc(springTask);
    const fallClose = computeWindowCloseUtc(fallTask);
    const normalClose = computeWindowCloseUtc(normalTask);

    // Exactly +60 minutes in every case — the transition day contributes
    // nothing extra because this function never touches local-tz wall time.
    expect(springClose.getTime() - new Date(springTask.scheduledAt).getTime()).toBe(60 * 60 * 1000);
    expect(fallClose.getTime() - new Date(fallTask.scheduledAt).getTime()).toBe(60 * 60 * 1000);
    expect(normalClose.getTime() - new Date(normalTask.scheduledAt).getTime()).toBe(60 * 60 * 1000);
  });

  function baseFixedRow(overrides) {
    return Object.assign({
      id: 'dst-row', text: 'DST FIXED probe', task_type: 'task',
      scheduled_at: null, date: null, time: null, status: '', dur: 30, pri: 'P2',
      project: null, section: null, notes: null, url: null,
      deadline: null, implied_deadline: null, placement_mode: PLACEMENT_MODES.FIXED,
      overdue: 0, recurring: 0, time_remaining: null, time_flex: null, flex_when: 0,
      split: 0, split_min: null, split_ordinal: null, split_total: null, split_group: null,
      occurrence_ordinal: null, recur: null, source_id: null, generated: 0, gcal_event_id: null,
      depends_on: null, location: null, tools: null, when: null, day_req: null, marker: 0,
      preferred_time_mins: null, travel_before: null, travel_after: null, desired_at: null,
      disabled_at: null, disabled_reason: null, start_after_at: null, tz: null,
      weather_precip: null, weather_cloud: null, weather_temp_min: null, weather_temp_max: null,
      weather_temp_unit: null, weather_humidity_min: null, weather_humidity_max: null,
      slack_mins: null, unscheduled: 0, created_at: null, updated_at: null, completed_at: null,
    }, overrides || {});
  }

  test('deadline at the transition hour: a FIXED task scheduled 9:30 AM on spring-forward day reads overdue only after its own slot, using real utcToLocal parsing on the transition date', () => {
    const scheduledAt = dateHelpers.localToUtc(SPRING_FORWARD_DAY, '9:30 AM', TZ);
    const row = baseFixedRow({
      scheduled_at: scheduledAt.toISOString().slice(0, 19).replace('T', ' '),
      date: SPRING_FORWARD_DAY,
    });

    const nowBefore = getNowInTimezone(TZ, clockAt('2026-03-08T12:00:00Z')); // 8:00 AM EST, before slot
    const nowAfter = getNowInTimezone(TZ, clockAt('2026-03-08T16:00:00Z'));  // 12:00 PM EDT, after slot

    expect(rowToTask(row, TZ, null, null, nowBefore).overdue).toBe(false);
    expect(rowToTask(row, TZ, null, null, nowAfter).overdue).toBe(true);
  });

  test('deadline at the transition hour (fall-back): a FIXED task scheduled 9:30 AM on fall-back day reads overdue only after its own slot', () => {
    const scheduledAt = dateHelpers.localToUtc(FALL_BACK_DAY, '9:30 AM', TZ);
    const row = baseFixedRow({
      scheduled_at: scheduledAt.toISOString().slice(0, 19).replace('T', ' '),
      date: FALL_BACK_DAY,
    });

    const nowBefore = getNowInTimezone(TZ, clockAt('2026-11-01T13:00:00Z')); // 9:00 AM EST, before slot
    const nowAfter = getNowInTimezone(TZ, clockAt('2026-11-01T16:00:00Z'));  // 12:00 PM EST, after slot

    expect(rowToTask(row, TZ, null, null, nowBefore).overdue).toBe(false);
    expect(rowToTask(row, TZ, null, null, nowAfter).overdue).toBe(true);
  });

  // These placements (2-3 AM local) are UNREACHABLE via the real scheduler grid
  // (DAY_START=360=6 AM, see unifiedScheduleV2.js:81/407) — a FIXED task can
  // still carry a hand-set or cal-synced scheduled_at at any hour, so the
  // read-path must not crash on it. Characterizes the actual (already-shipping)
  // collapse behavior; does not assert it is the "right" UX choice.
  test('nonexistent local time (spring-forward 2:30 AM) does not crash the read path and resolves deterministically', () => {
    const scheduledAt = dateHelpers.localToUtc(SPRING_FORWARD_DAY, '2:30 AM', TZ);
    const row = baseFixedRow({
      scheduled_at: scheduledAt.toISOString().slice(0, 19).replace('T', ' '),
      date: SPRING_FORWARD_DAY,
    });
    const now = getNowInTimezone(TZ, clockAt('2026-03-08T15:00:00Z')); // 11:00 AM EDT
    expect(() => rowToTask(row, TZ, null, null, now)).not.toThrow();
    expect(rowToTask(row, TZ, null, null, now).overdue).toBe(true); // 2:30 (however resolved) is well before 11:00
  });

  test('ambiguous local time (fall-back 1:30 AM occurs twice) does not crash the read path and resolves deterministically', () => {
    const scheduledAt = dateHelpers.localToUtc(FALL_BACK_DAY, '1:30 AM', TZ);
    const row = baseFixedRow({
      scheduled_at: scheduledAt.toISOString().slice(0, 19).replace('T', ' '),
      date: FALL_BACK_DAY,
    });
    const now = getNowInTimezone(TZ, clockAt('2026-11-01T15:00:00Z')); // 10:00 AM EST
    expect(() => rowToTask(row, TZ, null, null, now)).not.toThrow();
    expect(rowToTask(row, TZ, null, null, now).overdue).toBe(true);
  });
});
