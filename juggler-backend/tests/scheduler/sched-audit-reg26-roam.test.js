/**
 * sched-audit-reg26-roam — RED repro tests for REG-26 (chain step 0: RED only,
 * NO production changes in this file/pass).
 *
 * Umbrella: sched-audit. Register: REG-26 (AUDIT-REGISTER.md:54), evidence A2
 * F9 (A2-SCENARIO-COVERAGE.md:113/157/164).
 *
 * LOCKED RULING (David, 2026-06-23, INBOX juggler-overdue-reschedule — verbatim,
 * re-affirmed WBS-sched-audit.md:30 2026-07-02 as UNBLOCKING REG-26/F9):
 *   A recurring instance's EFFECTIVE deadline = min(recurrence-period boundary,
 *   latest in-window placement time for the occurrence). The instance ROAMS
 *   within its window/period and the scheduler MUST re-place it forward to the
 *   next valid slot (daily -> later same day within its when-window; weekly/
 *   flexible-TPC -> later slot within the cycle). OVERDUE only when NO valid
 *   slot remains before that effective deadline. Day-locked daily cannot roll
 *   to ANOTHER day (R32.7) -- roams only within its own day's window.
 *
 * Also SCHEDULER-SPEC.md:700 ("Effective deadline = min(recurrence-period
 * boundary, window-close)") and OVD-2 (:800, "a roamable instance ... whose
 * slot is past but effective deadline NOT passed is CLEARED and re-presented
 * to the placement queue").
 *
 * ─────────────────────────────────────────────────────────────────────────
 * STUDIED FIRST (per dispatch) -- roamable-recurring-forward-roll.test.js.
 * That suite is GREEN and already covers the ANCHOR-DATE-IN-THE-PAST forward-
 * roll gate (unifiedScheduleV2.js:1867 `item.anchorDate < todayIsoKey` branch,
 * OVD-2's code citation :~1664-1712): AC1a/AC1b/AC1c/AC1d (daily intra-day
 * roam + weekly roll-forward when `date` is a PRIOR day), AC6a/AC6b/AC6c
 * (R32.7 day-lock control + flexible-TPC contrast), AC3-cap/AC3-cap-regression
 * (period-end bleed guard), PART2-A/C/D (windowed daily same-day roam via the
 * `isMissedWindow`/TIME_WINDOW path). None of those exercise a task whose
 * `date` IS TODAY and is placementMode='time_blocks' (not TIME_WINDOW) with a
 * `preferredTimeMins` set -- that is the `isMissedPreferredTime` gate
 * (unifiedScheduleV2.js:429-436), a SEPARATE code path from the anchorDate<
 * today forward-roll gate the roamable suite pins. THIS is the REG-26/F9 hole:
 * `isMissedPreferredTime` unconditionally dead-ends ANY recurring task (it
 * does not check `isFlexibleTpc`, which isn't even computed yet at that point
 * in the function -- `isFlexibleTpc` is defined at :510, AFTER the :429-436
 * check) into `missedPreferredTimeItems` (unifiedScheduleV2.js:1925) the
 * moment TODAY's preferred-time+flex window closes, with NO attempt to
 * re-present the item to the placement queue for a LATER DAY within the same
 * cycle -- even when the task is flexible-TPC (roams across days) and later
 * days in the cycle are free. No pruning was needed: this is genuinely new,
 * unpinned ground.
 *
 * DETERMINISM: all tests pass explicit todayKey/nowMins; no Date.now(), no
 * Math.random(), no I/O. Wall-clock is never accessed. (matches roamable
 * suite's own contract, same file family)
 *
 * --- dateStrings trap ---
 * Not applicable here -- these tests build task fixtures directly (in-memory),
 * never read DB rows / DATETIME strings. See project memory:
 * juggler-datestrings-newdate-misparse-trap for why this matters elsewhere.
 *
 * --- RED config fidelity (TEST-AUTHORING.md) ---
 * `preferredTimeMins` + `timeFlex` on a `placement_mode='time_blocks'` recurring
 * task is a REAL, documented combination (TASK-PROPERTIES.md:116 -- "Preferred
 * Time ... Anchor time for time-window AND time-blocks recurring modes"), not a
 * fabricated shape. `recur: { type:'weekly', days:'MTWRFSU', timesPerCycle:3 }`
 * is the exact "3x/week" flexible-TPC shape F9 describes (isFlexibleTpc:
 * timesPerCycle(3) < selectedDays(7)).
 *
 * All RED assertions below were confirmed against the CURRENT (pre-fix)
 * working tree by direct probe before being pinned (see TEST-REVIEW.md
 * "Run RED" section for verbatim console output, run 2x).
 */

'use strict';

process.env.NODE_ENV = 'test';

var unifiedScheduleV2 = require('../../src/scheduler/unifiedScheduleV2');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
var { computeEffectiveDeadline } = require('../../src/scheduler/runSchedule');
var { REASON_CODES } = require('../../../shared/scheduler/reasonCodes');

// ── Frozen time context ─────────────────────────────────────────────────────
// TODAY = 2026-06-24 (Wednesday), nowMins = 600 (10:00 AM local, America/New_York).
var TODAY_KEY = '2026-06-24';
var TOMORROW_KEY = '2026-06-25';
var NOW_MINS = 600; // 10:00 AM

function makeCfg(overrides) {
  return Object.assign({
    timeBlocks: DEFAULT_TIME_BLOCKS,
    toolMatrix: DEFAULT_TOOL_MATRIX,
    timezone: 'America/New_York'
  }, overrides || {});
}

var _taskCounter = 0;
function makeTask(overrides) {
  _taskCounter++;
  return Object.assign({
    id: 'reg26-task-' + _taskCounter,
    taskType: 'recurring_instance',
    text: 'REG-26 Task ' + _taskCounter,
    date: null,
    day: null,
    time: null,
    dur: 30,
    pri: 'P3',
    status: '',
    section: null,
    notes: '',
    deadline: null,
    impliedDeadline: null,
    earliestStart: null,
    location: [],
    tools: [],
    when: '',
    dayReq: 'any',
    recurring: true,
    generated: true,
    placementMode: 'time_blocks',
    timeFlex: null,
    split: false,
    recur: null,
    recurStart: null,
    dependsOn: [],
    flexWhen: false,
    overdue: null,
    preferredTimeMins: null
  }, overrides);
}

function runScheduler(tasks, todayKey, nowMins, cfg) {
  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = t.status || ''; });
  return unifiedScheduleV2(tasks, statuses, todayKey || TODAY_KEY, nowMins != null ? nowMins : NOW_MINS, cfg || makeCfg());
}

function allPlacements(result, taskId) {
  var found = [];
  if (!result || !result.dayPlacements) return found;
  Object.keys(result.dayPlacements).forEach(function(dk) {
    result.dayPlacements[dk].forEach(function(p) {
      if (p.task && p.task.id === taskId) found.push(Object.assign({ dateKey: dk }, p));
    });
  });
  return found;
}

function unplacedEntryFor(result, taskId) {
  if (!result || !result.unplaced) return undefined;
  return result.unplaced.find(function(t) { return t && t.id === taskId; });
}

// ── Shared saturated-cycle fixture (REG26-2a + REG26-4b) ────────────────────
// revised leg sched-audit 2026-07-02: the original single-blocker-per-day
// fixture (dur:1020, one FIXED task/day) did NOT genuinely saturate the day —
// ConstraintSolver.effectiveDuration (src/slices/scheduler/domain/logic/
// ConstraintSolver.js:47-52) clamps ANY single task's working duration to a
// pre-existing, documented 720-minute upper bound, so a dur:1020 blocker is
// silently truncated to 720 and leaves the tail of the schedulable day open
// (confirmed via git-stash A/B probe: identical 360+720 placement pre- and
// post-REG26-1-fix). Mirrors sched-audit-da-oneoff.test.js's "D-A 6"
// two-chunk full-day-blocker pattern (360-1080 + 1080-1380): TWO blockers per
// day, back-to-back, cover the FULL schedulable window with no gap.
//
// Grid bounds (src/scheduler/constants.js DEFAULT_WEEKDAY_BLOCKS /
// DEFAULT_WEEKEND_BLOCKS): weekday grid = 360 (06:00) .. 1380 (23:00), 1020
// min; weekend grid = 420 (07:00) .. 1380 (23:00), 960 min. IN_CYCLE_DAYS
// spans Wed 2026-06-24 .. Tue 2026-06-30 (anchor + 7-day cycle, inclusive
// last valid day 2026-06-30) — Sat 06-27/Sun 06-28 use the weekend grid, the
// other 5 days use the weekday grid.
var CAP_LAST_DAY = '2026-06-30'; // anchor(Jun-24) + cycleLen(7) - 1, inclusive last valid day
var IN_CYCLE_DAYS = ['2026-06-24', '2026-06-25', '2026-06-26', '2026-06-27', '2026-06-28', '2026-06-29', '2026-06-30'];
var WEEKEND_DAYS = { '2026-06-27': true, '2026-06-28': true }; // Sat, Sun

// Two back-to-back FIXED blockers for one calendar day: chunk A occupies
// [gridStart, gridStart+720) (the effectiveDuration cap), chunk B occupies
// the remainder [gridStart+720, gridEnd) — together they cover the entire
// schedulable window for that day with NO gap, weekday or weekend.
function makeFullDayBlockersForDay(dateKey, idx) {
  var weekend = !!WEEKEND_DAYS[dateKey];
  var gridStart = weekend ? 420 : 360;
  var gridEnd = 1380;
  var chunkA = 720; // ConstraintSolver.effectiveDuration cap
  var chunkB = gridEnd - (gridStart + chunkA); // remainder to gridEnd, no gap
  function blocker(suffix, start, dur) {
    return {
      id: 'reg26-blocker-' + idx + suffix, taskType: 'task', text: 'Blocker ' + dateKey + ' ' + suffix,
      date: dateKey, dur: dur, pri: 'P0', status: '', overdue: null,
      recurring: false, placementMode: 'fixed', preferredTimeMins: start,
      when: '', dayReq: 'any', flexWhen: false,
      location: [], tools: [], split: false, dependsOn: []
    };
  }
  return [blocker('a', gridStart, chunkA), blocker('b', gridStart + chunkA, chunkB)];
}

// Builds the flexible-TPC roamable task + the full set of genuinely-saturating
// blockers across every IN_CYCLE_DAYS day. Shared by REG26-2a (scheduler-only
// characterization) and REG26-4b (scheduler+sweep consistency, post REG26-1 fix).
function makeSaturatedFixture(taskId) {
  var roamable = makeTask({
    id: taskId,
    text: 'Gym 3x/week Saturated',
    date: TODAY_KEY,
    day: 'Wed',
    dur: 30,
    recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 3 },
    recurStart: TODAY_KEY,
    preferredTimeMins: 480,
    timeFlex: 60
  });
  var blockers = [];
  IN_CYCLE_DAYS.forEach(function(dk, i) {
    blockers = blockers.concat(makeFullDayBlockersForDay(dk, i));
  });
  return { roamable: roamable, blockers: blockers };
}

// ═══════════════════════════════════════════════════════════════════════════
// REG26-1 — flexible-TPC, TODAY's window closes unfilled, LATER-IN-CYCLE slots
// are FREE → must be re-placed later in cycle, NOT dead-ended as missed.
//
// Fixture: weekly, days='MTWRFSU' (7 selectable), timesPerCycle=3 → 3 < 7 →
// isFlexibleTpc=true. date=TODAY_KEY (anchorDate === todayIsoKey -- this is
// NOT the anchorDate<today forward-roll gate the roamable suite covers).
// preferredTimeMins=480 (8am), timeFlex=60 -> window closes 540 (9am).
// nowMins=600 (10am) -> window has closed. Tomorrow (and every day through
// the cycle cap) has NO other task -- wide open.
//
// CURRENT (confirmed by direct probe, run 2x): isMissedPreferredTime fires
// unconditionally (unifiedScheduleV2.js:429-436 does not check isFlexibleTpc)
// -> item pushed to missedPreferredTimeItems (:1925) -> stillUnplaced with
// _unplacedReason=REASON_CODES.MISSED, date pinned to TODAY. Zero placements
// on any day, including the wide-open tomorrow.
// EXPECTED (post-fix, per OVD-2/LOCKED ruling): re-presented to the queue,
// placed on a later day within the cycle (>= tomorrow, <= cap).
// ═══════════════════════════════════════════════════════════════════════════

describe('REG26-1 — flexible-TPC same-day window-close must retry later in cycle (RED)', function() {

  test('REG26-1a (RED): 3x/week flexible-TPC, today-window closed, tomorrow free → placed on a later cycle day, NOT dead-ended as unplaced/missed', function() {
    var task = makeTask({
      id: 'reg26-flex-tpc',
      text: 'Gym 3x/week',
      date: TODAY_KEY,
      day: 'Wed',
      dur: 30,
      recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 3 },
      recurStart: TODAY_KEY,
      preferredTimeMins: 480, // 8:00 AM
      timeFlex: 60            // window closes 9:00 AM (540 min); nowMins=600 -> closed
    });

    var result = runScheduler([task], TODAY_KEY, NOW_MINS, makeCfg());
    var placements = allPlacements(result, 'reg26-flex-tpc');
    var forwardPlacements = placements.filter(function(p) { return p.dateKey >= TOMORROW_KEY; });

    // EXPECTED (post-fix): at least one placement on a later cycle day.
    // RED (current): forwardPlacements.length === 0 -- the item never re-enters
    // the placement queue; it is dead-ended into result.unplaced instead.
    expect(forwardPlacements.length).toBeGreaterThan(0);
  });

  test('REG26-1b (RED): same fixture — must NOT be marked unplaced/MISSED when a later-cycle slot is available', function() {
    var task = makeTask({
      id: 'reg26-flex-tpc-2',
      text: 'Gym 3x/week',
      date: TODAY_KEY,
      day: 'Wed',
      dur: 30,
      recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 3 },
      recurStart: TODAY_KEY,
      preferredTimeMins: 480,
      timeFlex: 60
    });

    var result = runScheduler([task], TODAY_KEY, NOW_MINS, makeCfg());
    var unplacedEntry = unplacedEntryFor(result, 'reg26-flex-tpc-2');

    // EXPECTED (post-fix): NOT in unplaced at all (it was placed forward instead).
    // RED (current): unplacedEntry exists, _unplacedReason === REASON_CODES.MISSED,
    // _unplacedDetail === 'Preferred-time window has passed' (unifiedScheduleV2.js:2396),
    // even though tomorrow (and every other cycle day) is completely free.
    expect(unplacedEntry).toBeUndefined();
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// REG26-2 — same fixture, but EVERY day in the cycle is saturated (no valid
// slot anywhere) → the terminal outcome (unplaced) is the CORRECT end-state
// per OVD-4 ("a run that finds no valid slot before the effective deadline ->
// overdue"/unscheduled).
//
// revised leg sched-audit 2026-07-02: the ORIGINAL single dur:1020-blocker/day
// fixture landed on unplaced/REASON_CODES.MISSED, but ONLY because
// isMissedPreferredTime dead-ended the item before ever attempting the cycle
// search (a false-comfort/coincidental pass — REG26-1 proved the search was
// never even attempted) AND because ConstraintSolver.effectiveDuration's
// 720-min cap silently left the fixture's own claimed saturation unreal. Now
// widened to the genuinely-saturating two-chunk fixture (makeSaturatedFixture,
// shared with REG26-4b): post REG26-1 fix, the item IS re-presented to the
// normal placement queue and genuinely searches every in-cycle day, finding
// nothing. That is a DIFFERENT code path than the isMissedPreferredTime
// dead-end, so it surfaces through the queue's own unplaced classification —
// REASON_CODES.NO_SLOT, not REASON_CODES.MISSED (MISSED is specific to the
// dead-end gate that no longer fires for a flexible-TPC item once a genuine
// cycle-wide search has run). Both are terminal/unplaced outcomes; the reason
// CODE legitimately differs because the code PATH differs.
// ═══════════════════════════════════════════════════════════════════════════

describe('REG26-2 — flexible-TPC, cycle fully saturated → genuinely unplaced/NO_SLOT (characterization; terminal outcome survives the REG26-1 fix, reason code updated to match the real post-fix code path)', function() {

  test('REG26-2a (characterization, GREEN): 3x/week flexible-TPC, all in-cycle days GENUINELY saturated (two-chunk full-day blockers, D-A 6 pattern) → unplaced with REASON_CODES.NO_SLOT, pinned to anchor date', function() {
    // revised leg sched-audit 2026-07-02: replaced the invalidated single
    // dur:1020 blocker/day (silently clamped to 720 by ConstraintSolver.
    // effectiveDuration, leaving a real ~300-360 min/day gap) with the shared
    // two-chunk makeSaturatedFixture — now every in-cycle day is genuinely
    // fully occupied, so the roam search (running for real post REG26-1 fix)
    // finds NO slot anywhere, and this terminal outcome is a real result of
    // the search, not a coincidental pass via the pre-fix dead-end.
    var fixture = makeSaturatedFixture('reg26-saturated');

    var result = runScheduler(fixture.blockers.concat([fixture.roamable]), TODAY_KEY, NOW_MINS, makeCfg());
    var placements = allPlacements(result, 'reg26-saturated');
    var badPlacements = placements.filter(function(p) { return p.dateKey > CAP_LAST_DAY; });

    // Must never bleed into the next cycle regardless of how the fix reaches
    // "no slot" (mirrors AC3-cap's cap-bleed guard in the roamable suite).
    expect(badPlacements).toEqual([]);

    // Stronger than the cap-bleed check alone: with the day genuinely full,
    // there must be NO placement anywhere in the cycle, not merely none past
    // the cap — this is what makes the saturation real instead of assumed.
    expect(placements.length).toBe(0);

    var unplacedEntry = unplacedEntryFor(result, 'reg26-saturated');
    expect(unplacedEntry).toBeTruthy();
    // revised leg sched-audit 2026-07-02: post REG26-1 fix, this item is
    // re-presented to the normal placement queue (not the isMissedPreferredTime
    // dead-end), so a genuine cycle-wide "nothing free" verdict surfaces as
    // REASON_CODES.NO_SLOT (the queue's own reason), not REASON_CODES.MISSED
    // (which is specific to the dead-end gate this fixture no longer hits).
    expect(unplacedEntry._unplacedReason).toBe(REASON_CODES.NO_SLOT);
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// REG26-3 — day-locked daily (R32.7 control): the SAME isMissedPreferredTime
// gate (unifiedScheduleV2.js:429-436), but with a NON-TPC daily recur
// (isFlexibleTpc=false, isDayLocked=true). This is a DIFFERENT code path from
// the roamable suite's AC6a/AC6b (which pin the anchorDate<today forward-roll
// gate, not this same-day preferred-time gate) -- not a duplicate.
//
// Direct probe confirms this is ALREADY correct (GREEN): a day-locked
// instance genuinely has no other valid day (R32.7), so dead-ending it the
// moment its own window closes IS its effective deadline. This is the
// control proving the coming REG26-1 fix must be scoped to isFlexibleTpc
// only -- day-locked must keep this exact terminal behavior.
// ═══════════════════════════════════════════════════════════════════════════

describe('REG26-3 — day-locked daily same-day window-close does NOT roll to another day (R32.7 control, GREEN)', function() {

  test('REG26-3a (GREEN, must stay GREEN through the fix): day-locked daily, today-window closed → NOT placed on tomorrow; unplaced/MISSED pinned to today', function() {
    var task = makeTask({
      id: 'reg26-daylocked',
      text: 'Morning Habit',
      date: TODAY_KEY,
      day: 'Wed',
      dur: 30,
      recur: { type: 'daily', days: 'MTWRFSU' }, // no timesPerCycle -> day-locked
      recurStart: TODAY_KEY,
      preferredTimeMins: 480,
      timeFlex: 60
    });

    var result = runScheduler([task], TODAY_KEY, NOW_MINS, makeCfg());
    var tomorrowPlacements = (result.dayPlacements[TOMORROW_KEY] || []).filter(function(p) {
      return p.task && p.task.id === 'reg26-daylocked';
    });
    expect(tomorrowPlacements.length).toBe(0); // R32.7: never rolls to another day

    var unplacedEntry = unplacedEntryFor(result, 'reg26-daylocked');
    expect(unplacedEntry).toBeTruthy();
    expect(unplacedEntry._unplacedReason).toBe(REASON_CODES.MISSED);
    expect(unplacedEntry.date).toBe(TODAY_KEY); // pinned to its own day, not rolled
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// REG26-4 — persist-sweep vs scheduler disagreement (the "dead zone").
//
// SCHEDULER-SPEC.md:700 (LOCKED, David 2026-06-23): "Effective deadline =
// min(recurrence-period boundary, window-close)". runSchedule.js's exported
// `computeEffectiveDeadline` (the persist-sweep helper AUDIT-REGISTER.md:54
// cites at runSchedule.js:2244-2256/current :2235-2241) computes the MAX
// instead ("De Morgan of original OR guards" per its own header comment,
// runSchedule.js:220-234) -- the exact contradiction F9 names.
//
// revised leg sched-audit 2026-07-02: bert landed the min() fix
// (runSchedule.js:235-241) and the reconciliation of the previously-pinned
// max() suites (tests/unit/scheduler/effective-deadline.test.js,
// tests/scheduler/instance-date-rules.test.js:169-172) is now done in the
// same pass -- both suites assert min() semantics and are GREEN. REG26-4a/4b
// below are GREEN characterization tests confirming the fix, not RED repros.
// ═══════════════════════════════════════════════════════════════════════════

describe('REG26-4 — persist-sweep effectiveDeadline is min() not max() (GREEN, fix landed; effective-deadline.test.js + instance-date-rules.test.js reconciled to min() in the same pass)', function() {

  test('REG26-4a (GREEN, fix confirmed): computeEffectiveDeadline({periodBoundary: future, windowClose: already-past}) returns windowClose (min), not periodBoundary (max)', function() {
    // periodBoundary = period end, 7 days out (2026-07-01 midnight EDT = 04:00 UTC).
    // windowClose = today's window close, 9:00 AM EDT (13:00 UTC) -- already past
    // relative to "now" = 10:00 AM EDT (14:00 UTC), matching REG26-1's fixture.
    var periodBoundary = new Date('2026-07-01T04:00:00.000Z');
    var windowClose = new Date('2026-06-24T13:00:00.000Z');
    var now = new Date('2026-06-24T14:00:00.000Z');

    var effectiveDeadline = computeEffectiveDeadline({ periodBoundary: periodBoundary, windowClose: windowClose });

    // LOCKED ruling: effective deadline = min(...) = windowClose (the earlier one, already past).
    // RED on current code: computeEffectiveDeadline returns periodBoundary (the later one, still future).
    expect(effectiveDeadline.getTime()).toBe(windowClose.getTime());

    // Direct consequence: per the ruling, "now" must already be past the effective
    // deadline (the window closed an hour ago) -- the sweep should act NOW, not wait
    // for the period boundary a week away.
    expect(now.getTime() >= effectiveDeadline.getTime()).toBe(true);
  });

  test('REG26-4b (GREEN, post-fix consistency): dead-zone consistency — the scheduler\'s GENUINELY-unplaced verdict (saturated-cycle fixture, REG26-2a) must agree with the persist-sweep\'s min()-based effectiveDeadline that this occurrence is already past its deadline', function() {
    // revised leg sched-audit 2026-07-02: REG26-1's free-roam fixture (no
    // blockers) is no longer unplaced after the REG26-1 fix -- it is now
    // correctly forward-rolled, so it can no longer supply a genuine
    // unplaced scheduler-side verdict for this consistency check. Reuse the
    // REG26-2a saturated-cycle fixture instead: every in-cycle day is
    // GENUINELY full (two-chunk blockers, no gap), so the scheduler's
    // unplaced verdict here is real, not a byproduct of the fixed bug. Reason
    // code is REASON_CODES.NO_SLOT (queue-path, see REG26-2a), not MISSED
    // (dead-end-path) -- both are terminal/unplaced, which is what this
    // sweep-vs-scheduler consistency check actually cares about.
    var fixture = makeSaturatedFixture('reg26-deadzone');
    var result = runScheduler(fixture.blockers.concat([fixture.roamable]), TODAY_KEY, NOW_MINS, makeCfg());
    var schedulerUnplaced = unplacedEntryFor(result, 'reg26-deadzone');
    expect(schedulerUnplaced).toBeTruthy();
    expect(schedulerUnplaced._unplacedReason).toBe(REASON_CODES.NO_SLOT);

    // Persist-sweep-side verdict for the SAME occurrence's own boundaries
    // (independent of the blockers -- derived from the task's own recur +
    // preferredTimeMins/timeFlex, identical to REG26-1/REG26-4a's fixture):
    // window closed at 9am today, period boundary a week out, "now" = 10am.
    var periodBoundary = new Date('2026-07-01T04:00:00.000Z');
    var windowClose = new Date('2026-06-24T13:00:00.000Z');
    var now = new Date('2026-06-24T14:00:00.000Z');
    var effectiveDeadline = computeEffectiveDeadline({ periodBoundary: periodBoundary, windowClose: windowClose });
    var sweepStillLive = now.getTime() < effectiveDeadline.getTime();

    // revised leg sched-audit 2026-07-02: max() superseded by locked min()
    // effective-deadline ruling. min() -> effectiveDeadline === windowClose
    // (the earlier boundary, already passed) -> sweepStillLive === false --
    // the sweep now AGREES with the scheduler that this occurrence is past
    // its effective deadline, consistent state at this phase boundary. Under
    // the old max() contract this would have been sweepStillLive === true
    // (still live for another week) while the scheduler had ALREADY marked
    // it MISSED this same run -- exactly the dead zone F9 describes.
    expect(effectiveDeadline.getTime()).toBe(windowClose.getTime());
    expect(sweepStillLive).toBe(false);
  });

});
