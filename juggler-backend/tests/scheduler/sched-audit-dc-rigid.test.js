/**
 * sched-audit-dc-rigid — RED/pin tests for DAVID RULING D-C (2026-07-02):
 *
 *   "rigid/FIXED tasks are never scheduler-placed — they stay at their fixed
 *   date+time; their slot is RESERVED (no other task may be placed at the
 *   same minutes) EXCEPT reminder-type items which may coexist (brain #80498:
 *   a reminder with a set time coexists); when overdue they are marked
 *   overdue + included in the overdue list while REMAINING visible at their
 *   fixed slot."
 *
 * Traceability: .planning/kermit/juggy4/TRACEABILITY.md — D-C.
 *   REG-24 / a3-02 (.planning/kermit/sched-audit/reviews/AUDIT-REGISTER.md,
 *   a3-findings.json, A3-CODE-ADVERSARIAL.md).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DEFECT (a3-02) — unifiedScheduleV2.js, force-placement pass (~:2429-2508,
 * "rigidUnplaced.forEach" region; post-L2 line numbers may shift, locate by
 * the rigidUnplaced/force-place pass name):
 * ─────────────────────────────────────────────────────────────────────────
 * A rigid/FIXED task that fell all the way through BOTH the immovable
 * placement (tryPlaceAtTime, :774) AND the slack-sorted queue (tryPlaceQueued,
 * :1433) — i.e. it never found ANY window it could occupy (its own `when`-tag
 * never matches a configured block on any day, or its anchor day is simply
 * off-horizon) — is force-placed as a last resort: the loop pushes a
 * `forceEntry` straight into `dayPlacements[forceDate]` (line ~2506) but NEVER
 * calls `reserveWithTravel`/`reserve()` on `dayOcc[forceDate]`. Every other
 * placement path in this file (tryPlaceAtTime :797, the main queue commit
 * :2064, the retry pass :2326) DOES reserve occupancy before or as it commits
 * — this is the ONE path that doesn't.
 *
 * Consequence: the deadline-relaxed pass that runs immediately afterward
 * (`deadlineRelaxed.forEach`, ~:2516-2538) calls `findEarliestSlot` against
 * `dayOcc`, which still shows the force-placed minute as FREE — so a
 * dependency-blocked, deadline<=today flexible task can land on the EXACT
 * same (dateKey, start) as the force-placed rigid task. Two real, persisted,
 * user-visible grid entries stack on the identical minute.
 * `checkPlacementDisjointness` (runSchedule.js:2353) only WARN-logs this; it
 * never blocks the double-book.
 *
 * ── Self-verification (binding law, TEST-AUTHORING §Regression-test
 * self-verification: drive PRODUCTION, never the test's own input) ──────────
 * Fixture 1's exact RED trace was verified against the REAL, unmodified
 * `unifiedScheduleV2.js` (not hand-derived): running the fixture below
 * produces BOTH `fixed_A` (force-placed, `_conflict:true`) AND `flex_B`
 * (deadline-relaxed, `_overdue:true`) landing at `dayPlacements['2026-07-02']`
 * start=840 — a real stacked-overlap, matching a3-02's own trace exactly.
 * A scratch copy of the file was then temporarily patched (`cp` before /
 * `cp` back after, `diff` confirmed byte-identical revert, no committed
 * production change) to add
 * `reserveWithTravel(dayOcc[forceDate], forceStart, forceDur, 0, 0);`
 * immediately after the `dayPlacements[forceDate].push(forceEntry);` line —
 * the exact one-line fix a3-02 recommends. Re-running the IDENTICAL fixture
 * against the patched copy moved `flex_B` OFF today's 840 entirely (it landed
 * on 2026-07-03 instead, the next day exposing a matching 'narrow' window) —
 * confirming the RED assertion below is the TRUE post-fix behavior, not a
 * guess, and that the fixture cleanly isolates the a3-02 hole (nothing else
 * in the fixture changes between the two runs).
 *
 * Layer: unit (pure unifiedScheduleV2 in-process; no DB) for tests 1/2/4.
 * Test 3 additionally exercises the pure `rowToTask` read-layer predicate
 * (taskMappers.js) — both are documented "ZERO require('knex')" pure
 * functions per their own module headers; no DB/worktree setup needed.
 */
'use strict';

process.env.NODE_ENV = 'test';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');
const { rowToTask } = require('../../src/slices/task/domain/mappers/taskMappers');

const TODAY = '2026-07-02'; // Thursday
const YESTERDAY = '2026-07-01';
const TZ = 'America/New_York';

function weekdayName(iso) {
  const parts = iso.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
}
const TODAY_DOW = weekdayName(TODAY);

// A 'narrow' tagged block (14:00-14:30) on EVERY weekday — self-verified
// necessary: shared/scheduler/timeBlockHelpers.js `getWhenWindows`'s
// "no tagged blocks configured for that day -> fall back to the default
// anytime 360-1260 window" escape hatch (:118-123) fires per-DAY, not
// per-tag — a day with ZERO configured blocks silently grants ANY `when`
// tag (including a nonexistent one) the default 6am-9pm window. Registering
// `narrow` on every weekday makes every day "have tagged blocks", so an
// unmatched tag (e.g. `ghost_block`) genuinely never resolves to a window on
// ANY day — required for the "never finds a slot, ever" fixture below.
function makeCfg() {
  const narrowBlock = { id: 'narrow_blk', tag: 'narrow', name: 'Narrow', start: 840, end: 870, color: '#000', loc: 'home' };
  const blocks = {
    Mon: [narrowBlock], Tue: [narrowBlock], Wed: [narrowBlock], Thu: [narrowBlock],
    Fri: [narrowBlock], Sat: [narrowBlock], Sun: [narrowBlock],
  };
  return { timeBlocks: blocks, toolMatrix: {}, splitMinDefault: 15, timezone: TZ };
}

function baseTask(overrides) {
  return Object.assign({
    dur: 30,
    pri: 'P2',
    dayReq: 'any',
    status: '',
    dependsOn: [],
    location: [],
    tools: [],
    recurring: false,
    generated: false,
    split: false,
    section: '',
    tz: TZ,
  }, overrides || {});
}

function run(tasks, nowMins, cfg) {
  const statuses = {};
  tasks.forEach((t) => { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, nowMins, cfg || makeCfg());
}

function placementsAt(result, dateKey, start) {
  return (result.dayPlacements[dateKey] || []).filter((p) => p.start === start);
}
function placementFor(result, taskId) {
  let found = null;
  Object.keys(result.dayPlacements || {}).forEach((dk) => {
    (result.dayPlacements[dk] || []).forEach((p) => {
      if (p.task && p.task.id === taskId) found = Object.assign({ dateKey: dk }, p);
    });
  });
  return found;
}
function isOnGrid(result, taskId) { return !!placementFor(result, taskId); }

/** ISO date key N days from TODAY (mirrors depsGatingCharacterization.test.js's dateKey helper). */
function farDateKey(n) {
  const parts = TODAY.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + n);
  const m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

// ═══════════════════════════════════════════════════════════════════════
// TEST 1 — RED: the a3-02 occupancy hole lets a scheduler-placed flexible
// task double-book a force-placed rigid task's slot.
// ═══════════════════════════════════════════════════════════════════════
describe('D-C test 1 — force-placed FIXED slot must be RESERVED against a scheduler-placed flexible intrusion (a3-02 RED)', () => {
  // fixed_A: FIXED, `when='ghost_block'` never matches any configured tag on
  // ANY day (see makeCfg comment) -> tryPlaceAtTime fails (anchorMin never
  // derived, since a `when`-tag FIXED task doesn't fall back to t.time) ->
  // queued -> tryPlaceQueued/retry both fail (no window ever matches) ->
  // lands in `stillUnplaced` -> `rigidUnplaced` (placementMode===FIXED) ->
  // force-placed via the a3-02 hole at nowMins (840 = 14:00) with NO dayOcc
  // reservation. Matches a3-02's own repro shape ("fell through the queue —
  // when-block full").
  const fixedA = baseTask({
    id: 'fixed_A', text: 'Fixed A (forced through the a3-02 hole)', date: TODAY,
    when: 'ghost_block', placementMode: PLACEMENT_MODES.FIXED,
  });
  // dep_far: FIXED, explicit time, anchored 20 days out — a GENUINELY
  // placeable dependency (mirrors depsGatingCharacterization.test.js B7's
  // `b7_dep` shape exactly: FIXED + explicit time always places regardless of
  // `when`-tag windows). computeDepReadyAbs therefore returns a FINITE (if
  // far-future) depReadyAbs for flex_B, never Infinity — flex_B is NOT
  // permanently dep-blocked, so M-2's isPermanentlyDepBlocked gate does not
  // apply to it and the pre-existing deadlineRelaxed rescue still fires for
  // it, exactly like B7.1.
  const depFar = baseTask({
    id: 'dep_far', text: 'Dep (placeable, but far in the future)', date: farDateKey(20),
    time: '9:00 AM', placementMode: PLACEMENT_MODES.FIXED,
  });
  // flex_B: ANYTIME, `when='narrow'` -> its ONLY configured window today is
  // exactly [840,870) (14:00-14:30) — literally "the only remaining slot,
  // given constraints, is 14:00". `deadline=TODAY` + a live dep that resolves
  // LATE (dep_far, day+20 — NOT permanently blocked) routes it through the
  // main queue (blocked by the dep gate: depReadyAbs is far beyond any
  // candidate today) -> stillUnplaced -> the `deadlineRelaxed` filter
  // (deadlineDate<=today && dependsOn.length>0), which M-2's gate does NOT
  // divert (isPermanentlyDepBlocked is false — the dep WILL eventually
  // place) -> `findEarliestSlot` with relaxDeps:true, ignoreDeadline:true,
  // reading `dayOcc`. Repaired 2026-07-03 (bert REFER): the ORIGINAL fixture
  // gave flex_B a dependency that never places at all (`dep_ghost`), which is
  // the exact M-2 shape — after M-2 shipped, flex_B routed straight to
  // `unplaced` via the new dep-blocked gate, vacuously "passing" this test
  // without ever exercising the occupancy-reservation path (a3-02) it was
  // built to pin. Swapped for the B7-shaped "resolves late" dependency so the
  // deadlineRelaxed rescue still fires and the fixture again isolates the
  // a3-02 occupancy hole on its own.
  const flexB = baseTask({
    id: 'flex_B', text: 'Flex B (deadline+late-resolving dep, only slot is 14:00)', date: TODAY, pri: 'P2',
    when: 'narrow', dependsOn: ['dep_far'], deadline: TODAY,
    placementMode: PLACEMENT_MODES.ANYTIME,
  });

  test('RED: flex_B must NOT land at (TODAY, 840) — the exact minute fixed_A was force-placed at 14:00 — FAILS on current code (a3-02 hole)', () => {
    const result = run([fixedA, depFar, flexB], 840);

    const aPlacement = placementFor(result, 'fixed_A');
    expect(aPlacement).toBeTruthy();
    expect(aPlacement.dateKey).toBe(TODAY);
    expect(aPlacement.start).toBe(840);

    // THIS IS THE ASSERTION THAT FAILS TODAY. Current (buggy) output places
    // flex_B ALSO at (TODAY, 840) — verified via the experiment above and via
    // self-mutation (patched-fix re-run moves flex_B off this slot entirely).
    const bPlacement = placementFor(result, 'flex_B');
    expect(bPlacement).toBeTruthy();
    expect(!(bPlacement.dateKey === TODAY && bPlacement.start === 840)).toBe(true);
  });

  test('RED (defensive, same fixture): no two grid entries anywhere may share an identical (dateKey,start) — the exact overlap shape the hole produces — FAILS on current code', () => {
    const result = run([fixedA, depFar, flexB], 840);
    const seen = new Set();
    let duplicateFound = false;
    Object.keys(result.dayPlacements || {}).forEach((dk) => {
      (result.dayPlacements[dk] || []).forEach((p) => {
        const key = dk + '|' + p.start;
        if (seen.has(key)) duplicateFound = true;
        seen.add(key);
      });
    });
    expect(duplicateFound).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// TEST 2 — reminder-type items COEXIST with a rigid slot (brain #80498).
// ═══════════════════════════════════════════════════════════════════════
describe('D-C test 2 — REMINDER placement_mode coexists with a FIXED task at the identical minute (brain #80498)', () => {
  // Mechanism (verified by reading unifiedScheduleV2.js, not assumed):
  //   buildItems :251-254 — `isMarker = pm===REMINDER`; a marker's `dur` is
  //   forced to 0 ("Markers are calendar indicators — they coexist with
  //   other placements at the same minute, so dur=0 means they never consume
  //   occupancy").
  //   tryPlaceAtTime :797 — `reserveWithTravel(occ, start, item.dur, ...)`
  //   with dur=0 marks a ZERO-width span busy: a no-op reservation. A
  //   reminder therefore NEVER blocks, and is NEVER blocked by, anything
  //   else at the same minute — this is the coexistence mechanism, not a
  //   special-cased "allow overlap with FIXED" branch. It generalizes: a
  //   reminder coexists with ANY other placement type at its slot, matching
  //   brain #80498 ("a reminder with a set time coexists").
  const fixedD = baseTask({
    id: 'fixed_D', text: 'Fixed D (real explicit time)', date: TODAY,
    placementMode: PLACEMENT_MODES.FIXED, time: '2:00 PM',
  });
  const reminderC = baseTask({
    id: 'reminder_C', text: 'Reminder C (set time)', date: TODAY, dur: 0,
    placementMode: PLACEMENT_MODES.REMINDER, time: '2:00 PM',
  });

  test('GREEN control: both fixed_D and reminder_C are placed at (TODAY, 840) simultaneously — no displacement, no conflict flag on either', () => {
    const result = run([fixedD, reminderC], 0);
    const at840 = placementsAt(result, TODAY, 840);
    const ids = at840.map((p) => p.task.id).sort();
    expect(ids).toEqual(['fixed_D', 'reminder_C']);
    at840.forEach((p) => expect(!!p._conflict).toBe(false));
    // The reminder's zero footprint is the reason no other task is displaced.
    const reminderEntry = at840.find((p) => p.task.id === 'reminder_C');
    expect(reminderEntry.dur).toBe(0);
  });

  test('GREEN control (order-independence): coexistence holds regardless of which task is classified first — reminder before fixed', () => {
    const result = run([reminderC, fixedD], 0);
    const at840 = placementsAt(result, TODAY, 840);
    const ids = at840.map((p) => p.task.id).sort();
    expect(ids).toEqual(['fixed_D', 'reminder_C']);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// TEST 3 — overdue FIXED task stays pinned + surfaces in the overdue read.
// ═══════════════════════════════════════════════════════════════════════
describe('D-C test 3 — overdue FIXED task remains pinned at its own fixed slot AND reads overdue at the mapper layer', () => {
  // Scheduler layer: a lone FIXED task anchored YESTERDAY (no competing
  // task — the a3-02 occupancy hole cannot manifest here since nothing else
  // contends for the slot) must still be VISIBLE at its own past date/time,
  // flagged _overdue, per R50/R50.1 (already-existing pinning behavior —
  // this is a PIN, not expected to be RED).
  test('PIN: overdue fixed task force-places pinned to its OWN past date+time, flagged _overdue (not moved to today, not dropped)', () => {
    const overdueFixed = baseTask({
      id: 'fixed_overdue', text: 'Overdue Fixed', date: YESTERDAY,
      placementMode: PLACEMENT_MODES.FIXED, time: '10:00 AM',
    });
    const result = run([overdueFixed], 600);

    const placement = placementFor(result, 'fixed_overdue');
    expect(placement).toBeTruthy();
    // Pinned to its OWN past date — never rolled forward to today (R50).
    expect(placement.dateKey).toBe(YESTERDAY);
    expect(placement.start).toBe(600); // 10:00 AM, its original fixed slot
    expect(!!placement._overdue).toBe(true);
    expect(isOnGrid(result, 'fixed_overdue')).toBe(true);
  });

  // Read layer: rowToTask (taskMappers.js) is the pure predicate that feeds
  // the overdue aggregation. `conflictBuckets.js` (juggler-frontend/src/
  // scheduler/conflictBuckets.js:27-43) buckets purely on `t.overdue` —
  // `if (t.overdue) { isOverdue = true; ...; overdue.push(t); }` — so
  // asserting `rowToTask(...).overdue === true` here IS asserting the exact
  // input conflictBuckets' overdue-list feed consumes (verified by reading
  // conflictBuckets.js directly; not re-executed here — it's an ES-module
  // frontend file with no CJS interop into this backend jest project, so
  // re-driving it from this suite would need a bundler step out of scope
  // for this pure-unit file; its predicate is a one-line direct read of the
  // same field asserted below, so no meaningful gap is left uncovered).
  test('PIN: rowToTask reads overdue=true + unscheduled=false (still in the placed/pinned lane, not the unscheduled lane) for the identical fixed-past-slot row shape', () => {
    const NOW_INFO = { todayKey: TODAY, nowMins: 600 };
    const row = {
      id: 'fixed_overdue', text: 'Overdue Fixed', task_type: 'task',
      scheduled_at: YESTERDAY + ' 14:00:00', // UTC 14:00 = 10:00 AM EDT, matches the scheduler fixture's 10:00 AM anchor
      date: YESTERDAY, time: null, status: '', dur: 30, pri: 'P2', project: null,
      section: null, notes: null, url: null, deadline: null, implied_deadline: null,
      placement_mode: 'fixed', overdue: 0, recurring: 0, time_remaining: null,
      time_flex: null, flex_when: 0, split: 0, split_min: null, split_ordinal: null,
      split_total: null, split_group: null, occurrence_ordinal: null, recur: null,
      source_id: null, generated: 0, gcal_event_id: null, depends_on: null,
      location: null, tools: null, when: null, day_req: null, marker: 0,
      preferred_time_mins: null, travel_before: null, travel_after: null,
      desired_at: null, disabled_at: null, disabled_reason: null, start_after_at: null,
      tz: null, weather_precip: null, weather_cloud: null, weather_temp_min: null,
      weather_temp_max: null, weather_temp_unit: null, weather_humidity_min: null,
      weather_humidity_max: null, slack_mins: null, unscheduled: 0, created_at: null,
      updated_at: null, completed_at: null, master_id: null, msft_event_id: null,
      apple_event_id: null, apple_calendar_name: null, cal_sync_origin: null,
      cal_event_url: null, cal_locked: 0, end_date: null, rolling_anchor: null,
      unplaced_reason: null, unplaced_detail: null,
    };
    const task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(true);
    expect(task.unscheduled).toBe(false);
    expect(task.date).toBe(YESTERDAY);
  });

  // Control (adjacent correct behavior must stay GREEN): a FIXED task
  // scheduled LATER today (not yet passed) must NOT read overdue — isolates
  // that the PIN above is really testing "past", not some unconditional
  // FIXED-always-overdue shortcut.
  test('Control: FIXED task scheduled LATER today (not yet due) reads overdue=false', () => {
    const NOW_INFO = { todayKey: TODAY, nowMins: 600 }; // now = 10:00 AM
    const row = {
      id: 'fixed_future_today', text: 'Fixed later today', task_type: 'task',
      scheduled_at: TODAY + ' 18:00:00', // 2:00 PM EDT — later than now (10:00 AM)
      date: TODAY, time: null, status: '', dur: 30, pri: 'P2', project: null,
      section: null, notes: null, url: null, deadline: null, implied_deadline: null,
      placement_mode: 'fixed', overdue: 0, recurring: 0, time_remaining: null,
      time_flex: null, flex_when: 0, split: 0, split_min: null, split_ordinal: null,
      split_total: null, split_group: null, occurrence_ordinal: null, recur: null,
      source_id: null, generated: 0, gcal_event_id: null, depends_on: null,
      location: null, tools: null, when: null, day_req: null, marker: 0,
      preferred_time_mins: null, travel_before: null, travel_after: null,
      desired_at: null, disabled_at: null, disabled_reason: null, start_after_at: null,
      tz: null, weather_precip: null, weather_cloud: null, weather_temp_min: null,
      weather_temp_max: null, weather_temp_unit: null, weather_humidity_min: null,
      weather_humidity_max: null, slack_mins: null, unscheduled: 0, created_at: null,
      updated_at: null, completed_at: null, master_id: null, msft_event_id: null,
      apple_event_id: null, apple_calendar_name: null, cal_sync_origin: null,
      cal_event_url: null, cal_locked: 0, end_date: null, rolling_anchor: null,
      unplaced_reason: null, unplaced_detail: null,
    };
    const task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// TEST 4 — control: user-explicit double-booked FIXED+FIXED both stay.
// ═══════════════════════════════════════════════════════════════════════
describe('D-C test 4 — control: two FIXED tasks the user explicitly double-booked at the same time BOTH remain (D-C reserves only against SCHEDULER-placed intrusion)', () => {
  test('GREEN control: fixed_E1 and fixed_E2, both anchored at 14:00 by explicit user time, both land at (TODAY, 840) — neither displaced', () => {
    const fixedE1 = baseTask({
      id: 'fixed_E1', text: 'Fixed E1 (user double-book)', date: TODAY,
      placementMode: PLACEMENT_MODES.FIXED, time: '2:00 PM',
    });
    const fixedE2 = baseTask({
      id: 'fixed_E2', text: 'Fixed E2 (user double-book)', date: TODAY, dur: 45,
      placementMode: PLACEMENT_MODES.FIXED, time: '2:00 PM',
    });
    const result = run([fixedE1, fixedE2], 0);

    const at840 = placementsAt(result, TODAY, 840);
    const ids = at840.map((p) => p.task.id).sort();
    expect(ids).toEqual(['fixed_E1', 'fixed_E2']);
    // Both are genuinely placed (not one silently dropped/unplaced).
    expect(isOnGrid(result, 'fixed_E1')).toBe(true);
    expect(isOnGrid(result, 'fixed_E2')).toBe(true);
    expect((result.unplaced || []).length).toBe(0);
  });
});
