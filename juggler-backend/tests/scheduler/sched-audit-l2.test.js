/**
 * sched-audit-l2 — RED repro tests for the two UNBLOCKED L2 code defects
 * (umbrella: sched-audit; leg L2 "Code defects").
 *
 * Traceability: .planning/kermit/sched-audit/reviews/AUDIT-REGISTER.md
 *   - REG-23 / a3-01 (A3-CODE-ADVERSARIAL.md, a3-findings.json id "a3-01")
 *   - REG-25 / F5    (A2-SCENARIO-COVERAGE.md F5)
 *
 * Explicitly OUT OF SCOPE for this file (David-blocked, do not touch):
 *   - REG-26 (a3 min/max effective-deadline contradiction — Q6)
 *   - REG-24 / a3-02 (force-place occupancy hole — Q9)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * BUG 1 — a3-01: slack-drift omits travel buffers (unifiedScheduleV2.js:2106)
 * ─────────────────────────────────────────────────────────────────────────
 * After each commit, the incremental capacity-subtraction loop does:
 *   var ov = overlapWithEligibleWindows(other, slot.dateKey, slot.start, item.dur, ...);
 *   other.capacity -= ov; other.slack = other.capacity - other.dur;
 * `item.dur` is the just-committed task's CORE duration only — it excludes
 * `item.travelBefore`/`item.travelAfter`, which `reserveWithTravel` (the same
 * commit, two lines above at :2064) DID reserve on the real occupancy grid.
 * So every other still-queued item's recomputed capacity is under-debited by
 * exactly the travel-buffer minutes the committing task actually consumed —
 * diverging from the initial `computeSlack` pass, which correctly counts the
 * full reserved footprint (rebuildPrefix sums real reserveWithTravel minutes).
 * (Same defect at the split-chunk recompute, unifiedScheduleV2.js:2045-2046 —
 * out of scope here; a3-01's own text flags it as "same defect in the split
 * path".)
 *
 * Consequence (a3-findings.json a3-01): a tight-slack item sitting in a
 * window that overlaps the travel-heavy committer's REAL footprint gets an
 * inflated (too-generous) slack value, and can therefore sort AFTER a
 * competing lower-priority item whose own number is untouched by the drift
 * (its window never touches the committer's real-or-fake footprint at all)
 * — losing the one contiguous slot it actually needed. Placement legality
 * (NEVER-MISSING) still holds (every candidate slot is re-checked against
 * real occupancy before committing), but the QUEUE ORDER — and therefore
 * WHICH task wins a contested slot — is wrong.
 *
 * ── Fixture design (every number below was VERIFIED empirically, not just
 * hand-derived — see "Self-verification" below) ──────────────────────────
 * Single day (today), one custom time-block config, ANYTIME-mode tasks
 * (eligibleWindows keys off `when` regardless of ANYTIME vs TIME_BLOCKS —
 * unifiedScheduleV2.js:615-635; only isFixedWhen/isAllDay/isWindowMode
 * special-case the lookup). Each of the 3 tasks gets its OWN single-entry
 * window tag (findEarliestSlot requires a placement to fit within ONE
 * window entry, unifiedScheduleV2.js:1252-1274 — two adjacent-but-separate
 * tags would NOT admit a placement spanning their boundary):
 *
 *     tag 'awin'  480–570 (90 min)  — task `a`'s own window only
 *     tag 'union' 420–780 (360 min) — task `b`'s window (a SUPERSET that
 *                                     fully contains `a`'s real travel
 *                                     footprint with no clipping, so the
 *                                     omitted-travel error is the FULL
 *                                     travelBefore+travelAfter, not a
 *                                     partially-clipped fraction of it)
 *     tag 'late'  630–780 (150 min) — task `c`'s window (a SUFFIX of
 *                                     'union' — `b` and `c` truly compete
 *                                     for the same real minutes in
 *                                     [630,780) — but far enough right that
 *                                     `a`'s footprint [450,570) never
 *                                     reaches it, so `c`'s own slack is
 *                                     ALWAYS accurate regardless of the bug;
 *                                     only `b`'s number is corrupted)
 *
 *   a: dur=60, travelBefore=30, travelAfter=30 (a3-findings' own numbers),
 *      window 'awin' (90 min) -> initial slack = 90-60 = 30 (lowest of the
 *      three -> `a` commits FIRST, which is required for the drift to have
 *      anything to corrupt: the bug only affects items recomputed AFTER a
 *      travel-heavy commit).
 *   b ("tight_b"): dur=150, window 'union' (360 min) -> initial slack =
 *      360-150 = 210.
 *   c ("lax_c"): dur=50, window 'late' (150 min) -> initial slack =
 *      150-50 = 100.
 *   Initial order: a(30) < c(100) < b(210) -> a commits first, as designed.
 *
 *   `a` places at the earliest slot in 'awin': start=480 (8:00). Real
 *   reserveWithTravel footprint = [480-30, 480+60+30) = [450, 570) (120 min,
 *   fully inside 'union' [420,780) — no clipping). Core (dur-only) span
 *   used by the BUGGY subtraction = [480, 540) (60 min).
 *
 *   Recompute for `b` (window 'union' 420-780):
 *     TRUE overlap  = footprint[450,570) ∩ [420,780) = 120 min (full).
 *     FAKE overlap  = core[480,540)      ∩ [420,780) =  60 min.
 *     TRUE  capacity_b = 360-120 = 240 -> TRUE  slack_b = 240-150 =  90.
 *     FAKE  capacity_b = 360- 60 = 300 -> FAKE  slack_b = 300-150 = 150.
 *   Recompute for `c` (window 'late' 630-780):
 *     overlap (TRUE or FAKE, same either way) = footprint/core ∩ [630,780)
 *       = 0 (570 < 630 — `a` never reaches 'late') -> slack_c stays 100,
 *       UNCHANGED by the bug (this is what makes `c` a clean, unaffected
 *       reference point — only `b`'s number is ever wrong).
 *
 *   TRUE resort:  b(90)  < c(100) -> `b` SHOULD be tried next.
 *   BUGGY resort: c(100) < b(150) -> `c` IS tried next instead (the drift
 *     flips the order: b's true 90 becomes a fake 150, vaulting it above c).
 *
 *   BUGGY run: `c` commits at [630,680) (fits cleanly — nothing else in
 *     'late' yet). `b` is tried last: real occupancy now has `a`'s
 *     [450,570) and `c`'s [630,680); the only free gaps in 'union' are
 *     [420,450)=30, [570,630)=60, [680,780)=100 — none reach `b`'s 150-min
 *     need -> `b` ends UNPLACED (final recomputed slack for `b` stays a
 *     non-negative 100, so no `ignoreDeadline` ladder rescue fires — this
 *     is a clean, deterministic same-day failure, not a day-rollover).
 *   CORRECT (fixed) run: `b` is tried next instead, places at the earliest
 *     open contiguous run avoiding `a`'s [450,570) -> [570,720) (150 min,
 *     exactly fits). `c` is tried last: 'late' [630,780) is now blocked by
 *     `b`'s [570,720) for all but [720,780) — 60 min, which DOES fit `c`'s
 *     50-min need -> `c` places at [720,770) instead of [630,680).
 *
 *   So the desired/correct end-state is: `a`@480(60), `b`@570(150, THE
 *   task that currently goes unplaced), `c`@720(50, not 630) — nothing
 *   left unplaced. The RED test asserts exactly this end-state.
 *
 * ── Self-verification (binding law, TEST-AUTHORING §Regression-test
 * self-verification: drive PRODUCTION, never the test's own input) ────────
 * The exact "CORRECT (fixed) run" trace above was not just hand-derived —
 * it was produced by TEMPORARILY patching the line-2106 subtraction (in a
 * scratch copy, `cp` before / `cp` back after, verified byte-identical via
 * `diff` post-revert — no committed production change) to
 * `overlapWithEligibleWindows(other, slot.dateKey, slot.start - tb, item.dur
 * + tb + ta, ...)` and re-running this exact fixture. The patched run
 * produced precisely a@480/b@570(150)/c@720(50), unplaced=[] — confirming
 * the RED assertions below are the TRUE post-fix behavior, not a guess.
 * The unpatched (current) run produces a@480/c@630(50)/unplaced=[b] on
 * BOTH this fixture AND the no-travel control below (see next block) —
 * i.e. today's code and the "control" a's no-travel variant already agree,
 * and only the real (patched) fix changes the travel-bearing case.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * BUG 2 — F5: overdue reads one calendar day late for a never-placed
 * recurring occurrence whose recurrence PERIOD ends today
 * (taskMappers.js rowToTask overdue predicate, the `dueKey < _now.todayKey`
 * strict-less-than at line ~461).
 * ─────────────────────────────────────────────────────────────────────────
 * R50.0 (REQUIREMENTS.md :552; SCHEDULER-SPEC.md :647): "First day PAST the
 * period (EXCLUSIVE): live through periodEnd-1, missed ON periodEnd." — i.e.
 * the occurrence must read overdue starting ON the periodEnd day itself, not
 * the day after.
 *
 * For a never-placed instance (scheduled_at=NULL, no FIXED/placed anchor),
 * rowToTask derives `dueKey` from `implied_deadline` (the materialized
 * period-end artifact) when no explicit deadline/scheduled_at exists. The
 * overdue predicate then does:
 *   if (dueKey < _now.todayKey) return true;
 *   if (dueKey === _now.todayKey && scheduledMins !== null) { ... }
 *   return false;
 * `scheduledMins` is null for a never-placed row (no scheduled_at, not
 * FIXED), so when `dueKey === todayKey` (periodEnd IS today) the second
 * branch never fires and the function falls through to `return false` —
 * one calendar day too late, exactly matching A2's F5 / REG-25 trace
 * ("Monday daily missed -> Tuesday not-overdue -> Wednesday finally
 * overdue").
 *
 * Layer: unit — rowToTask is a PURE function (no DB, no knex) per its own
 * module header ("ZERO require('knex')... Data enters via arguments only").
 * A hand-built row object exercises the exact same code path the DB-backed
 * overdue-split-persistence-e3.test.js exercises via `rowToTask(r, TZ, null,
 * null, NOW_INFO)` — same call convention, no isolated-DB provisioning
 * needed since the defect lives entirely in the pure predicate.
 *
 * Fixture (RED config fidelity): task_type='recurring_instance', a DAILY
 * recurrence (`recur: {type:'daily'}`), placement_mode='anytime' (never
 * FIXED), scheduled_at=null (never placed), status='' (non-terminal),
 * date=<anchor day>, implied_deadline=<periodEnd> — the same recurring/
 * never-placed row shape overdue-split-persistence-e3.test.js seeds at the
 * DB layer, minus the DB round-trip (rowToTask needs only the row object).
 * `todayKey`/`nowMins` injected explicitly via the `nowInfo` 5th arg — no
 * naked `new Date()` on DB-shaped strings anywhere in this file.
 */
'use strict';

process.env.NODE_ENV = 'test';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');
const { rowToTask } = require('../../src/slices/task/domain/mappers/taskMappers');

const TZ = 'America/New_York';

// ═══════════════════════════════════════════════════════════════════════
// Shared date helpers (explicit todayKey injection — no naked `new Date()`
// on DB-shaped strings; mirrors overdue-split-persistence-e3.test.js).
// ═══════════════════════════════════════════════════════════════════════
function dateKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function daysFromToday(n) {
  var d = new Date();
  d.setDate(d.getDate() + n);
  return dateKey(d);
}
var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function weekdayNameFor(isoDateKey) {
  // Parse the Y-M-D key as a LOCAL date (no UTC/tz drift) purely to pick the
  // matching timeBlocks weekday bucket for the fixture's custom config.
  var parts = isoDateKey.split('-').map(Number);
  var d = new Date(parts[0], parts[1] - 1, parts[2]);
  return DAY_NAMES[d.getDay()];
}

var TODAY = daysFromToday(0);
var TODAY_DOW = weekdayNameFor(TODAY);

// ═══════════════════════════════════════════════════════════════════════
// BUG 1 — a3-01 slack-drift fixture
// ═══════════════════════════════════════════════════════════════════════
describe('a3-01 — incremental slack subtraction omits travel buffers (unifiedScheduleV2.js:2106)', () => {
  // Custom single-day config: three window tags sized exactly per the
  // traced arithmetic in the file header. Only TODAY's weekday is
  // populated (dayReq='any' + deadline/earliestStart pin every task to
  // TODAY only, so no other day's blocks are ever consulted) — every OTHER
  // weekday key is present but empty so getBlocksForDate never silently
  // falls back to a wrong day's shape.
  function slackDriftCfg() {
    var blocksForToday = [
      { id: 'awin_blk', tag: 'awin', name: 'A-window', start: 480, end: 570, color: '#000', loc: 'home' },
      { id: 'union_blk', tag: 'union', name: 'Union-window', start: 420, end: 780, color: '#000', loc: 'home' },
      { id: 'late_blk', tag: 'late', name: 'Late-window', start: 630, end: 780, color: '#000', loc: 'home' },
    ];
    var timeBlocks = { Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: [] };
    timeBlocks[TODAY_DOW] = blocksForToday;
    return {
      timeBlocks: timeBlocks,
      toolMatrix: {},
      splitMinDefault: 15,
      timezone: TZ,
    };
  }

  function makeItemTask(overrides) {
    return Object.assign({
      text: 'slack-drift fixture task',
      date: TODAY,
      deadline: TODAY,
      earliestStart: TODAY,
      pri: 'P3',
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
      travelBefore: 0,
      travelAfter: 0,
    }, overrides || {});
  }

  function run(tasks, cfg) {
    const statuses = {};
    tasks.forEach((t) => { statuses[t.id] = t.status || ''; });
    return unifiedSchedule(tasks, statuses, TODAY, 0, cfg);
  }

  function placementFor(result, taskId) {
    var found = null;
    Object.keys(result.dayPlacements || {}).forEach((dk) => {
      (result.dayPlacements[dk] || []).forEach((p) => {
        if (p.task && p.task.id === taskId) found = Object.assign({ dateKey: dk }, p);
      });
    });
    return found;
  }
  function isOnGrid(result, taskId) { return !!placementFor(result, taskId); }
  function isUnplaced(result, taskId) {
    return (result.unplaced || []).some((u) => (u.id || (u.task && u.task.id)) === taskId);
  }

  test('RED: travel-adjacent tight-slack task ("tight_b") must win its only contiguous slot over the lower-priority competitor ("lax_c") once travel-consumed capacity is correctly debited — FAILS on current code (drift lets lax_c win instead, tight_b ends unplaced)', () => {
    const taskA = makeItemTask({ id: 'travel_a', dur: 60, travelBefore: 30, travelAfter: 30, when: 'awin', pri: 'P1' });
    const taskB = makeItemTask({ id: 'tight_b', dur: 150, when: 'union', pri: 'P1' });
    const taskC = makeItemTask({ id: 'lax_c', dur: 50, when: 'late', pri: 'P4' });

    const result = run([taskA, taskB, taskC], slackDriftCfg());

    // Sanity: `a` always places first (lowest initial slack, unaffected by
    // the bug — this is the pre-condition the drift needs to manifest at
    // all).
    const aPlacement = placementFor(result, 'travel_a');
    expect(aPlacement).toBeTruthy();
    expect(aPlacement.dateKey).toBe(TODAY);
    expect(aPlacement.start).toBe(480);
    expect(aPlacement.dur).toBe(60);

    // DESIRED / CORRECT: once `a`'s true travel-inclusive footprint
    // ([450,570)) is debited from tight_b's capacity, tight_b's real slack
    // is 90 (see header trace: (360-120)-150=90), strictly LESS than
    // lax_c's stable 100 -> tight_b must be tried (and win) before lax_c.
    // Its only viable contiguous slot is [570,720) inside the 'union'
    // window. THIS IS THE ASSERTION THAT FAILS TODAY — current code leaves
    // tight_b in `unplaced` entirely (verified: current output is
    // a@480/lax_c@630/unplaced=[tight_b]).
    const bPlacement = placementFor(result, 'tight_b');
    expect(bPlacement).toBeTruthy();
    expect(bPlacement.dateKey).toBe(TODAY);
    expect(bPlacement.start).toBe(570);
    expect(bPlacement.dur).toBe(150);
    expect(isUnplaced(result, 'tight_b')).toBe(false);

    // Correct knock-on: lax_c, now correctly recognized as the LESS urgent
    // task, is displaced from its (buggy) [630,680) slot to [720,770) — the
    // only remaining room in 'late' once tight_b correctly occupies
    // [570,720). Nothing is left unplaced in the correct end-state.
    const cPlacement = placementFor(result, 'lax_c');
    expect(cPlacement).toBeTruthy();
    expect(cPlacement.dateKey).toBe(TODAY);
    expect(cPlacement.start).toBe(720);
    expect(cPlacement.dur).toBe(50);

    expect((result.unplaced || []).length).toBe(0);
  });

  test('Control: with NO travel buffer on the committing task, slack accounting is already correct today — lax_c legitimately wins its earlier slot and tight_b legitimately goes unplaced; this must stay GREEN before and after the eventual a3-01 fix', () => {
    // Identical fixture, EXCEPT task `a` carries no travel at all. With no
    // travel to omit, the buggy subtraction (item.dur only) and the correct
    // one (item.dur + travelBefore + travelAfter) are IDENTICAL (both 60) —
    // there is no drift to manifest, so today's behavior already matches
    // the true-slack-ordering behavior and is NOT expected to change once
    // a3-01 is fixed (self-verified: the patched-fix scratch run reproduced
    // byte-identical output for this exact no-travel fixture — see file
    // header). This isolates travel as the specific root cause: remove it,
    // and the "wrong" outcome disappears even though every other duration/
    // window/priority is unchanged.
    const taskA = makeItemTask({ id: 'notravel_a', dur: 60, travelBefore: 0, travelAfter: 0, when: 'awin', pri: 'P1' });
    const taskB = makeItemTask({ id: 'tight_b_ctrl', dur: 150, when: 'union', pri: 'P1' });
    const taskC = makeItemTask({ id: 'lax_c_ctrl', dur: 50, when: 'late', pri: 'P4' });

    const result = run([taskA, taskB, taskC], slackDriftCfg());

    const aPlacement = placementFor(result, 'notravel_a');
    expect(aPlacement).toBeTruthy();
    expect(aPlacement.dateKey).toBe(TODAY);
    expect(aPlacement.start).toBe(480);

    // True slack_b here = (360-60)-150 = 150; true slack_c = 100
    // (unaffected, as always, since 'late' never overlaps `a`'s footprint
    // either way). 100 < 150 -> `c` correctly sorts and places first, at
    // [630,680) — this is CORRECT behavior (c really is tighter here), not
    // a bug, and is unchanged by fixing a3-01 (no travel = no drift
    // possible on this fixture).
    const cPlacement = placementFor(result, 'lax_c_ctrl');
    expect(cPlacement).toBeTruthy();
    expect(cPlacement.dateKey).toBe(TODAY);
    expect(cPlacement.start).toBe(630);
    expect(cPlacement.dur).toBe(50);

    // tight_b_ctrl correctly loses the contest in this no-travel control
    // (its true slack really is higher than c's) — both before AND after
    // the a3-01 fix, since there's no travel-buffer omission possible here.
    expect(isOnGrid(result, 'tight_b_ctrl')).toBe(false);
    expect(isUnplaced(result, 'tight_b_ctrl')).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────
  // sched-audit L23 zoe WARN z-1 follow-up (L23-ZOE-REVIEW.md finding #1):
  // the RED test above pins the slack ORDER-FLIP via final placement
  // (tight_b wins its slot), but zoe mutation-verified a 2x-travel
  // OVER-count mutation of the fix (subtracting item.dur + 2*travelBefore +
  // 2*travelAfter instead of the correct item.dur + travelBefore +
  // travelAfter) still PASSES that test — on THIS fixture, over-debiting
  // pushes tight_b's fake slack even FURTHER below lax_c's untouched 100,
  // so the queue order (and therefore the final placement) happens to come
  // out identical to the correct fix, even though the underlying footprint
  // arithmetic is wrong in the opposite direction. This test closes that
  // gap by pinning the EXACT recomputed slack VALUE (not just which task
  // wins), using the scheduler's own `cfg._stepRecorder` diagnostic hook
  // (unifiedScheduleV2.js:723-771, `orderingSlack` = Math.round(item.slack)
  // at the moment the item is placed) — the same fixture, same numbers,
  // same header trace as the RED test above:
  //   TRUE:  capacity_b = 360 - overlap(120) = 240 -> slack_b = 240-150 = 90
  //   UNDER (bug, dur-only):    overlap=60  -> capacity=300 -> slack=150 (too HIGH)
  //   OVER (2x-travel mutant):  overlap=180 -> capacity=180 -> slack=30  (too LOW)
  // Only the value 90 is correct; both 150 and 30 are wrong in opposite
  // directions, so asserting the exact value kills both mutation
  // directions, not just the one that happens to flip this fixture's final
  // ordering.
  test('PIN (sched-audit z-1): tight_b\'s post-commit recomputed slack must equal the EXACT travel-inclusive footprint value (90) — kills an over-count mutation (e.g. 2x-travel) that the order-flip-only assertions above do not catch', () => {
    const stepRecorder = [];
    const cfg = Object.assign(slackDriftCfg(), { _stepRecorder: stepRecorder });

    const taskA = makeItemTask({ id: 'travel_a2', dur: 60, travelBefore: 30, travelAfter: 30, when: 'awin', pri: 'P1' });
    const taskB = makeItemTask({ id: 'tight_b2', dur: 150, when: 'union', pri: 'P1' });
    const taskC = makeItemTask({ id: 'lax_c2', dur: 50, when: 'late', pri: 'P4' });

    run([taskA, taskB, taskC], cfg);

    const bStep = stepRecorder.find((s) => s.taskId === 'tight_b2');
    expect(bStep).toBeTruthy();
    // The exact travel-inclusive footprint value (see header trace above).
    // An UNDER-count mutation records 150 here; a 2x-travel OVER-count
    // mutation records 30 — both fail this single assertion, unlike the
    // placement-based test above which a 2x-travel mutation still passes.
    expect(bStep.orderingSlack).toBe(90);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// BUG 2 — F5 overdue-day-late fixture
// ═══════════════════════════════════════════════════════════════════════
describe('F5 — overdue reads one day late for a never-placed recurring occurrence whose period ends today (taskMappers.js rowToTask, strict `<` vs R50.0 "missed ON periodEnd")', () => {
  // Minimal never-placed daily-recurring-instance row shape (mirrors
  // overdue-split-persistence-e3.test.js's seeded task_instances row,
  // without the DB round-trip — rowToTask is pure, per its module header).
  function makeNeverPlacedDailyRow(overrides) {
    return Object.assign({
      id: 'f5-occ-1',
      task_type: 'recurring_instance',
      text: 'F5 never-placed daily occurrence',
      dur: 30,
      pri: 'P2',
      status: '',
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU', every: 1 }),
      placement_mode: 'anytime',
      scheduled_at: null,
      overdue: 0,
      unscheduled: 1,
      time_flex: null,
      preferred_time_mins: null,
      deadline: null,
    }, overrides || {});
  }

  test('RED: periodEnd === today (occurrence anchored yesterday, daily cycle -> implied_deadline = today) must read overdue=true TODAY per R50.0 "missed ON periodEnd" — FAILS on current strict `<`', () => {
    const YESTERDAY = daysFromToday(-1);
    const row = makeNeverPlacedDailyRow({
      date: YESTERDAY,               // anchor day (row.date pins the never-placed occurrence)
      implied_deadline: TODAY,       // periodEnd = anchor + 1 day (daily cycle) = TODAY
    });
    const NOW_INFO = { todayKey: TODAY, nowMins: 720 };

    const task = rowToTask(row, TZ, null, null, NOW_INFO);

    // DESIRED (R50.0): the day the occurrence's period ends IS the day it
    // reads overdue — not the day after. This currently fails: current code
    // requires dueKey < todayKey (strict), and dueKey === todayKey here with
    // scheduledMins===null (never placed, not FIXED) falls through to false.
    expect(task.overdue).toBe(true);
    expect(task.unscheduled).toBe(true);
    expect(task.scheduledAt).toBeNull();
  });

  test('Control A (adjacent correct behavior, must stay GREEN): periodEnd is TOMORROW (today = periodEnd-1, still "live through periodEnd-1") -> NOT yet overdue', () => {
    const TODAY_ANCHOR = TODAY; // occurrence anchored today; daily cycle -> periodEnd = tomorrow
    const TOMORROW = daysFromToday(1);
    const row = makeNeverPlacedDailyRow({
      date: TODAY_ANCHOR,
      implied_deadline: TOMORROW,
    });
    const NOW_INFO = { todayKey: TODAY, nowMins: 720 };

    const task = rowToTask(row, TZ, null, null, NOW_INFO);

    // R50.0: "live through periodEnd-1" — today is still within the live
    // period (periodEnd is tomorrow), so this must NOT be overdue yet. This
    // already passes today (dueKey=TOMORROW > todayKey=TODAY, falls to
    // false) — proves the fix must only move the periodEnd-day boundary,
    // not the entire predicate.
    expect(task.overdue).toBe(false);
  });

  test('Control B (adjacent correct behavior, must stay GREEN): periodEnd was YESTERDAY (today is a full day past periodEnd) -> already reads overdue today, unaffected by the periodEnd-day fix', () => {
    const TWO_DAYS_AGO = daysFromToday(-2);
    const YESTERDAY = daysFromToday(-1);
    const row = makeNeverPlacedDailyRow({
      date: TWO_DAYS_AGO,
      implied_deadline: YESTERDAY, // periodEnd = anchor+1 = yesterday; today is one full day past it
    });
    const NOW_INFO = { todayKey: TODAY, nowMins: 720 };

    const task = rowToTask(row, TZ, null, null, NOW_INFO);

    // dueKey(YESTERDAY) < todayKey(TODAY) -> already true under the existing
    // strict `<` — this is the "day after" case the current code already
    // gets right; the periodEnd-day fix must not disturb it.
    expect(task.overdue).toBe(true);
  });
});
