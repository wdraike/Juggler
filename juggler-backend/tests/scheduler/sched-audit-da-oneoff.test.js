/**
 * D-A — one-off overdue unification (leg sched-audit, step 0: RED tests).
 *
 * David ruling D-A (2026-07-02): a ONE-OFF task (non-recurring, non-split)
 * past its deadline or missed time window follows the SAME rule as
 * recurring/split (juggy4, 2026-07-02): NOT grid-placed on future days;
 * routed to unplaced -> persisted unscheduled=1 (scheduled_at=NULL rows),
 * pinned to its DEADLINE DATE, overdue on read. Never rolled forward. This
 * aligns code with R50.1's literal text (no carve-out) and closes A1 finding
 * G1 (BLOCK) + A4 Q1 (David scope question), both in
 * .planning/kermit/sched-audit/reviews/.
 *
 * THE BUG (evidence cited in the WBS, verified against unifiedScheduleV2.js /
 * runSchedule.js in this leg's tree):
 *   (a) A one-off TIME_WINDOW task whose flex window has closed TODAY still
 *       gets grid-placed on a LATER day. Root cause: `isMissedWindow`
 *       (unifiedScheduleV2.js:403-421) is a same-day-only flag consulted
 *       ONLY as a `stillUnplaced` filter (:2371) AFTER all placement rungs
 *       have already run — it never gates `tryPlaceQueued`'s rung 1 (normal)
 *       search, which has no same-day-only cap for a one-off. When the task
 *       carries a genuine `deadline` equal to today, slack goes negative
 *       (window is gone) and `overdueApplicable` (:1446) becomes true, so
 *       rung 2 (`ignoreDeadline`, :1462-1466) extends the search to the full
 *       horizon and force-places it on a future day WITH an `_overdue`
 *       marker (evidence bullet (c) — "the ladder's ignoreDeadline rung").
 *   (b) A one-off with a PAST deadline (`t.deadline` earlier than the
 *       `dates` search horizon's first entry, i.e. before today) that never
 *       finds a slot goes to `runSchedule.js` Case C (:2107-2116,
 *       "never placed -> move to unscheduled lane"), which writes
 *       `unscheduled=1` unconditionally but never pins `date` to the
 *       deadline — the persisted/in-memory `date` stays whatever the row's
 *       stale `date` field already was (frequently "today"), not the
 *       deadline day A1's G1 finding flags this exact gap.
 *   (c) See (a) — `ignoreDeadline` bypasses a passed deadline instead of
 *       routing the task to unscheduled-overdue.
 *   Root-cause note for the fix step (not fixed here): `indexOfDate(dates,
 *   deadlineDate)` (:670-675) returns -1 for ANY deadline before `dates[0]`
 *   (today) since the search-date list only starts at today — both
 *   `computeSlack` (:686-687) and `findEarliestSlot`'s deadline cap
 *   (:1062-1065) then silently fall back to "no cap" (treat the item as if
 *   unconstrained) instead of recognizing "deadline is in the past ->
 *   overdue". This is the mechanism behind bug (b)'s rolling.
 *
 * Traceability: .planning/kermit/sched-audit/TRACEABILITY.md (D-A chain).
 * Evidence: A1-REQUIREMENTS-MECE.md G1 (BLOCK), A4-TEST-AUDIT.md Q1 probe,
 * AUDIT-REGISTER.md REG rows (D-A chain).
 *
 * Layer: unit (pure unifiedScheduleV2 in-process; no DB) for scenarios 1-4.
 * Scenario 5 is a read-only audit of the EXISTING w2-partition.test.js file
 * (no DB, no new fixture) — reports which assertions the fix step must
 * revise; does not change that file.
 *
 * Fixture style mirrors overdue-unscheduled-pinning.test.js / w2-partition.test.js
 * (known fixture trap: blockers must actually occupy the grid).
 */
'use strict';

process.env.NODE_ENV = 'test';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');
const { REASON_CODES } = require('../../../shared/scheduler/reasonCodes');

const TODAY = '2026-06-22'; // Monday
const YESTERDAY = '2026-06-21'; // Sunday
const TOMORROW = '2026-06-23'; // Tuesday
const FUTURE_DEADLINE = '2026-06-25'; // Thursday — 3 days out
const TZ = 'America/New_York';

function makeCfg(overrides) {
  return Object.assign({
    timeBlocks: DEFAULT_TIME_BLOCKS,
    toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15,
    timezone: TZ,
  }, overrides || {});
}

function run(tasks, nowMins, cfgOverrides) {
  const statuses = {};
  tasks.forEach((t) => { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, nowMins, makeCfg(cfgOverrides));
}

function idsOnGrid(result) {
  const ids = new Set();
  Object.keys(result.dayPlacements || {}).forEach((dk) => {
    (result.dayPlacements[dk] || []).forEach((p) => {
      if (p && p.task && p.task.id) ids.add(p.task.id);
    });
  });
  return ids;
}
function idsUnplaced(result) {
  const ids = new Set();
  (result.unplaced || []).forEach((u) => {
    const id = u && (u.id || (u.task && u.task.id));
    if (id) ids.add(id);
  });
  return ids;
}
function gridEntriesForId(result, taskId) {
  const found = [];
  Object.keys(result.dayPlacements || {}).forEach((dk) => {
    (result.dayPlacements[dk] || []).forEach((p) => {
      if (p && p.task && p.task.id === taskId) found.push(Object.assign({ dateKey: dk }, p));
    });
  });
  return found;
}
function unplacedEntryFor(result, taskId) {
  return (result.unplaced || []).find((u) => (u.id || (u.task && u.task.id)) === taskId);
}

// A one-off (non-recurring, non-split) TIME_WINDOW task whose flex window
// [pref-flex, pref+flex] is entirely BEFORE nowMins TODAY, carrying an
// explicit user `deadline` (RED config fidelity: the live bug reports cite a
// genuine user-deadline one-off, not a bare no-deadline floater — see A1 G1
// and the WBS "deadline today" / "deadline yesterday" scenarios).
// pref=8:00 (480), flex=60 -> window [420,540]; nowMins=600 (10:00) ->
// windowHi(540) <= now(600) => isMissedWindow=true on current code.
function makeOneOffWindowTask(overrides) {
  return Object.assign({
    id: 'oo_task',
    text: 'One-off TIME_WINDOW task with a user deadline',
    date: TODAY,
    deadline: TODAY,
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
    preferredTimeMins: 480,
    timeFlex: 60,
    time: undefined,
    scheduledAt: undefined,
    tz: TZ,
  }, overrides || {});
}

// A one-off (non-recurring, non-split) ANYTIME task with a PAST deadline that
// has genuinely NEVER been placed (structurally unplaceable on ANY day —
// `location` never resolves at any time-of-day per DEFAULT_TIME_BLOCKS'
// `loc: 'home'|'work'`, so `whyCannotRun` returns `location_mismatch` on
// every candidate slot, every day — a day-INDEPENDENT block, unlike a
// capacity-only "calendar is full today" case). This makes "never placed"
// deterministic within the scheduler's bounded planning horizon instead of
// requiring every day in a 14+-day fixture to be individually saturated.
function makeOneOffNeverPlaceable(overrides) {
  return Object.assign({
    id: 'oo_never_task',
    text: 'One-off ANYTIME task, past deadline, structurally unplaceable',
    date: TODAY, // stale "last known" date field — NOT the deadline
    deadline: YESTERDAY,
    dur: 30,
    pri: 'P2',
    when: '',
    dayReq: 'any',
    status: '',
    dependsOn: [],
    location: ['nowhere_special'], // never matches DEFAULT_TIME_BLOCKS' loc: home|work
    tools: [],
    recurring: false,
    generated: false,
    split: false,
    section: '',
    placementMode: PLACEMENT_MODES.ANYTIME,
    time: undefined,
    scheduledAt: undefined,
    tz: TZ,
  }, overrides || {});
}

describe('D-A 1 — missed-window one-off (window closed today, deadline today): NEVER-MISSING, pinned to deadline, not grid-placed', () => {
  test('one-off TIME_WINDOW task, window closed today, deadline=today: NOT on grid, exactly once in unplaced, date pinned to deadline', () => {
    const t = makeOneOffWindowTask({ id: 'oo_missed_1' });
    const result = run([t], 600); // now = 10:00, window [420,540] entirely past

    const onGrid = idsOnGrid(result);
    const unplaced = idsUnplaced(result);

    // DESIRED (D-A): never grid-placed once its own window/deadline has passed —
    // currently the ignoreDeadline rung (unifiedScheduleV2.js:1462-1466) force-places
    // it on a future day with an `_overdue` marker instead. RED on current code.
    expect(onGrid.has('oo_missed_1')).toBe(false);
    expect(unplaced.has('oo_missed_1')).toBe(true);

    // NEVER-MISSING: exactly one representation total (no dual-place, no drop).
    const gridCount = gridEntriesForId(result, 'oo_missed_1').length;
    const unplacedCount = (result.unplaced || []).filter((u) => (u.id || (u.task && u.task.id)) === 'oo_missed_1').length;
    expect(gridCount + unplacedCount).toBe(1);

    // Pinned to its deadline date (here == today, since the fixture's deadline
    // is today) — never rolled to a later day.
    const unplacedEntry = unplacedEntryFor(result, 'oo_missed_1');
    const unplacedTask = unplacedEntry && (unplacedEntry.task || unplacedEntry);
    expect(unplacedTask.date).toBe(TODAY);
    expect(unplacedTask._unplacedReason).toBe(REASON_CODES.MISSED);
  });
});

describe('D-A 2 — one-off with a past deadline, never placed: unscheduled-overdue, date pinned to the DEADLINE date (not today, not rolled)', () => {
  test('one-off ANYTIME task, deadline=yesterday, structurally unplaceable: unplaced exactly once, date === deadline (yesterday), never rolled to today', () => {
    const t = makeOneOffNeverPlaceable({ id: 'oo_never_1' });
    const result = run([t], 480); // nowMins irrelevant to the location-mismatch block

    const onGrid = idsOnGrid(result);
    const unplaced = idsUnplaced(result);

    // DESIRED (D-A): a one-off past its deadline and never placed must be
    // unscheduled-overdue, exactly once — never grid-placed by accident.
    expect(onGrid.has('oo_never_1')).toBe(false);
    expect(unplaced.has('oo_never_1')).toBe(true);
    const gridCount = gridEntriesForId(result, 'oo_never_1').length;
    const unplacedCount = (result.unplaced || []).filter((u) => (u.id || (u.task && u.task.id)) === 'oo_never_1').length;
    expect(gridCount + unplacedCount).toBe(1);

    // THE CORE D-A ASSERTION (bug (b)): pinned to the task's own DEADLINE date
    // (YESTERDAY) — never today, never rolled forward. Current code's
    // `runSchedule.js` Case C (:2107-2116) writes `unscheduled=1` but never
    // reassigns `date`, so the in-memory/persisted date stays at whatever the
    // task's stale `date` field already was (TODAY in this fixture) — RED.
    const unplacedEntry = unplacedEntryFor(result, 'oo_never_1');
    const unplacedTask = unplacedEntry && (unplacedEntry.task || unplacedEntry);
    expect(unplacedTask.date).toBe(YESTERDAY);
    expect(unplacedTask.date).not.toBe(TODAY);
  });
});

describe('D-A 3 — CONTROL: future deadline, no slot today but a slot tomorrow — forward placement BEFORE the deadline stays legal (D0 unchanged)', () => {
  test('one-off TIME_WINDOW task, window closed today but deadline 3 days out: STILL placed normally tomorrow, no overdue marker', () => {
    // Window closed today (same shape as D-A 1) but the deadline is well in
    // the future — D-A only kills POST-deadline rolling; PRE-deadline forward
    // placement (the task's own multi-day search window, still capped by its
    // deadline) remains legal and must NOT regress when D-A ships.
    const t = makeOneOffWindowTask({ id: 'oo_ctrl_1', deadline: FUTURE_DEADLINE });
    const result = run([t], 600); // now = 10:00, today's window already past

    const onGrid = idsOnGrid(result);
    const unplaced = idsUnplaced(result);

    expect(onGrid.has('oo_ctrl_1')).toBe(true);
    expect(unplaced.has('oo_ctrl_1')).toBe(false);

    // Lands on a future day (today's window already closed) but with NO
    // overdue marker — this is legal pre-deadline forward placement, not the
    // post-deadline rolling D-A forbids.
    const entries = gridEntriesForId(result, 'oo_ctrl_1');
    expect(entries.length).toBe(1);
    expect(entries[0].dateKey).toBe(TOMORROW);
    expect(entries[0]._overdue).toBeFalsy();
  });
});

// D-A 4 — CONTROLS: recurring + split overdue behavior unchanged.
//
// REMOVED (zoe DADC-ZOE-REVIEW.md z-5, leg sched-audit): this describe block
// previously contained a single vacuous test whose sole assertion was
// `expect(true).toBe(true)` — a green "control" that pins nothing
// (coverage-theater / tautological-test finding). Deleted rather than
// papered over with a placebo assertion, per zoe's own recommended fix
// ("replace with a require/run reference or delete the vacuous block; rely
// on the adjacent-suite gate for the recurring/split controls rather than a
// green-but-empty in-file marker").
//
// The "recurring + split overdue behavior unchanged" requirement this block
// documented IS covered — by real, already-passing fixtures — in:
//   - overdue-unscheduled-pinning.test.js  (recurring/split overdue pinning)
//   - w2-partition.test.js                 (AC-W2.3 recurring dual-place XOR)
// Both are run as part of this file's adjacent-suite gate (see
// DA-TEST-REVIEW.md proof-of-work: "5 suites, 40 passed, 0 failed" /
// DA-DC-BERT-LOG.md's post-fix "9/9 GREEN" re-run) — that IS the control;
// no in-file no-op marker is needed to make it visible.

// ---------------------------------------------------------------------------
// Iteration 2 (leg sched-audit, 2026-07-02): extending RED coverage for ernie's
// DADC-CODE-REVIEW.md findings #1 (W1) and #2 (W2) — both WARN, both centered
// on David's D-A ruling (unscheduled-overdue pinned to deadline, never rolled
// forward) — plus two probes (i4/i5) on findings #6 and #7 (INFO, guard-scope
// discrepancies flagged but not fixed). NO production code touched this pass.
// ---------------------------------------------------------------------------

// A one-off (non-recurring, non-split) ANYTIME task whose deadline is a PAST
// day genuinely BEFORE the scheduler's search horizon (`dates[0]` == today),
// but which is otherwise freely placeable today (no location/tool/window
// constraints) — the archetypal W1 fixture from ernie finding #1: unlike D-A 2
// (structurally unplaceable via location_mismatch), this task WOULD find a
// slot today if the deadline cap were ever applied to it, which is exactly
// the bug — no cap is applied when the deadline predates the horizon
// (indexOfDate returns -1 -> computeSlack :686-687 clamps deadlineIdx to
// dates.length-1 -> positive slack -> overdueApplicable false -> rung-1
// :1062-1064 never activates the D-A cap since `di<0`).
function makeOneOffPastDeadlinePlaceableToday(overrides) {
  return Object.assign({
    id: 'w1_task',
    text: 'One-off ANYTIME task, deadline strictly before today, freely placeable today',
    date: TODAY, // stale prior-run date — NOT the deadline
    deadline: YESTERDAY,
    dur: 30,
    pri: 'P2',
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
    time: undefined,
    scheduledAt: undefined,
    tz: TZ,
  }, overrides || {});
}

describe('D-A 5 (ernie W1, DADC-CODE-REVIEW.md finding #1) — one-off deadline STRICTLY BEFORE today, freely placeable today: must NOT grid-place; unplaced, pinned to the (past) deadline day', () => {
  test('one-off ANYTIME task, deadline=yesterday, open slot exists today: NOT on grid, exactly once in unplaced, date pinned to yesterday (deadline) — RED on current code (indexOfDate -1 escapes the D-A cap)', () => {
    const t = makeOneOffPastDeadlinePlaceableToday();
    const result = run([t], 480);

    const onGrid = idsOnGrid(result);
    const unplaced = idsUnplaced(result);

    // DESIRED (D-A contract): a one-off whose deadline has already passed —
    // even a day fully BEFORE the search horizon — is never grid-placed.
    // CURRENT CODE: computeSlack (:686-687) clamps the unresolvable
    // deadlineIdx to the END of the horizon, producing POSITIVE slack, so
    // `overdueApplicable` (:1461, slack<0) is false and the capAtOwnDeadline
    // rung (:1477-1481) is never reached — rung 1 (:1062-1064) also never
    // caps because `di<0` skips the `if (di>=0) latestIdx = di;` branch, so
    // the task is placed on today's first free slot instead. RED.
    expect(onGrid.has('w1_task')).toBe(false);
    expect(unplaced.has('w1_task')).toBe(true);

    // NEVER-MISSING: exactly one representation total.
    const gridCount = gridEntriesForId(result, 'w1_task').length;
    const unplacedCount = (result.unplaced || []).filter((u) => (u.id || (u.task && u.task.id)) === 'w1_task').length;
    expect(gridCount + unplacedCount).toBe(1);

    // Pinned to its own DEADLINE date (yesterday) — never today, never rolled forward.
    const unplacedEntry = unplacedEntryFor(result, 'w1_task');
    const unplacedTask = unplacedEntry && (unplacedEntry.task || unplacedEntry);
    expect(unplacedTask.date).toBe(YESTERDAY);
    expect(unplacedTask.date).not.toBe(TODAY);
  });
});

// A FIXED (immovable) full-day blocker, split across two chunks because
// effectiveDuration (ConstraintSolver.js:47-52) clamps any single task's
// working duration to 720 minutes — a single dur:1020 blocker gets silently
// truncated to 720, leaving the tail of the day open (probed and confirmed
// via a throwaway node script before authoring this fixture). Two blockers
// back-to-back (360-1080, 1080-1380) cover the FULL scheduling day
// [GRID_START=360, GRID_END=1380) with no gap.
function makeFullDayBlocker(idSuffix, preferredTimeMins, dur) {
  return {
    id: 'w2_blocker_' + idSuffix,
    text: 'Full-day blocker chunk ' + idSuffix,
    date: TODAY,
    dur: dur,
    pri: 'P1',
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
    placementMode: PLACEMENT_MODES.FIXED,
    preferredTimeMins: preferredTimeMins,
    time: undefined,
    scheduledAt: undefined,
    tz: TZ,
  };
}

// A one-off (non-recurring, non-split) TIME_WINDOW task with flexWhen enabled,
// deadline TODAY, whose preferred-time window has already closed today (same
// shape as makeOneOffWindowTask) — the ernie W2 fixture (finding #2): when
// TODAY is entirely booked (via the two full-day blockers above), rung-2
// (ignoreDeadline+capAtOwnDeadline, capped to today) fails, rung-3
// (relaxWhen, deadline-respecting, still capped to today) fails, and rung-4
// (:1489, `overdueApplicable && flexApplicable` -> ignoreDeadline+relaxWhen,
// NO capAtOwnDeadline) searches the FULL horizon and lands on a future day —
// past the deadline, exactly the D-A1 behavior the fix outlaws, reached via
// the flex path instead of the plain ignoreDeadline path.
function makeFlexWhenOverdueOneOff(overrides) {
  return Object.assign({
    id: 'w2_task',
    text: 'One-off TIME_WINDOW task, flexWhen enabled, deadline today, window closed, today fully booked',
    date: TODAY,
    deadline: TODAY,
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
    flexWhen: true,
    section: '',
    placementMode: PLACEMENT_MODES.TIME_WINDOW,
    preferredTimeMins: 480,
    timeFlex: 60,
    time: undefined,
    scheduledAt: undefined,
    tz: TZ,
  }, overrides || {});
}

describe('D-A 6 (ernie W2, DADC-CODE-REVIEW.md finding #2) — flex_when overdue one-off, deadline today, window elapsed, today fully booked: rung-4 must NOT roll it past its own deadline', () => {
  test('one-off TIME_WINDOW task, flexWhen=true, deadline=today, today saturated: NOT on grid at all (never mind tomorrow), exactly once in unplaced, date pinned to today (deadline) — RED on current code (rung-4 has no capAtOwnDeadline)', () => {
    const blockerA = makeFullDayBlocker('A', 360, 720); // 360..1080
    const blockerB = makeFullDayBlocker('B', 1080, 300); // 1080..1380 (covers to GRID_END)
    const t = makeFlexWhenOverdueOneOff();
    const result = run([blockerA, blockerB, t], 600); // now=10:00, window [420,540] already past

    const onGrid = idsOnGrid(result);
    const unplaced = idsUnplaced(result);

    // DESIRED (D-A contract): overdue + flex_when is STILL a one-off — must
    // never be rolled onto a POST-deadline day. CURRENT CODE: rung-4
    // (unifiedScheduleV2.js:1489-1493) passes only
    // `{ ignoreDeadline: true, relaxWhen: true }` — no `capAtOwnDeadline` — so
    // with today saturated it searches the full horizon and force-places the
    // task TOMORROW with `_overdue` + `_flexWhenRelaxed` markers. RED.
    expect(onGrid.has('w2_task')).toBe(false);
    expect(unplaced.has('w2_task')).toBe(true);

    const gridCount = gridEntriesForId(result, 'w2_task').length;
    const unplacedCount = (result.unplaced || []).filter((u) => (u.id || (u.task && u.task.id)) === 'w2_task').length;
    expect(gridCount + unplacedCount).toBe(1);

    const unplacedEntry = unplacedEntryFor(result, 'w2_task');
    const unplacedTask = unplacedEntry && (unplacedEntry.task || unplacedEntry);
    expect(unplacedTask.date).toBe(TODAY);
    expect(unplacedTask.date).not.toBe(TOMORROW);
  });
});

// i5 probe (ernie finding #7, DADC-CODE-REVIEW.md): the D-A pin guard
// (unifiedScheduleV2.js:2601) excludes split chunks via `task.split`
// (boolean), but the rest of the scheduler identifies a split chunk via
// `Number(task.splitTotal) > 1` (:2157-2158, :2316-2317, and buildItems'
// own `splitTot` derivation :393-394). Two shapes probed (both never-placed
// via a structural location_mismatch block, both carrying a deadline
// strictly before today so a wrongly-applied pin is visibly distinguishable
// from the task's own stale `date`):
//   (a) task.split === true            -> excluded by the current guard (as written)
//   (b) task.split falsy, splitTotal>1  -> NOT excluded by the current guard (the gap)
function makeSplitChunkNeverPlaceable(idSuffix, splitFlag, splitTotal) {
  return {
    id: 'split_' + idSuffix,
    text: 'Split chunk (task.split=' + splitFlag + ', splitTotal=' + splitTotal + '), structurally unplaceable, past deadline',
    date: TODAY, // stale prior-run date — distinguishable from the deadline
    deadline: YESTERDAY,
    dur: 30,
    pri: 'P2',
    when: '',
    dayReq: 'any',
    status: '',
    dependsOn: [],
    location: ['nowhere_special'], // never matches DEFAULT_TIME_BLOCKS' loc: home|work — structurally never-placed
    tools: [],
    recurring: false,
    generated: false,
    split: splitFlag,
    splitOrdinal: 2,
    splitTotal: splitTotal,
    section: '',
    placementMode: PLACEMENT_MODES.ANYTIME,
    time: undefined,
    scheduledAt: undefined,
    tz: TZ,
  };
}

describe('D-A 7 probe (ernie i5/finding #7) — split-chunk exclusion from the one-off date-pin: guard tests `task.split`, scheduler elsewhere keys `splitTotal>1`', () => {
  test('(a) task.split===true, splitTotal=3: correctly EXCLUDED from the pin — date stays the stale prior value, NOT overwritten to the deadline — GREEN (guard as literally written handles this shape)', () => {
    const t = makeSplitChunkNeverPlaceable('a', true, 3);
    const result = run([t], 480);

    const unplaced = idsUnplaced(result);
    expect(unplaced.has('split_a')).toBe(true);

    const unplacedEntry = unplacedEntryFor(result, 'split_a');
    const unplacedTask = unplacedEntry && (unplacedEntry.task || unplacedEntry);
    // Guard excludes task.split truthy -> date pin never runs -> the stale
    // prior `date` (TODAY) survives untouched, NOT clobbered to the deadline.
    expect(unplacedTask.date).toBe(TODAY);
    expect(unplacedTask.date).not.toBe(YESTERDAY);
  });

  test('(b) task.split falsy, splitTotal=3 (the scheduler-wide canonical split-chunk shape per :2157-2158/:2316-2317): the pin guard does NOT recognize this as a split chunk — date gets WRONGLY overwritten to the deadline, same as a plain one-off — RED (guard/scheduler split-identity mismatch, finding #7)', () => {
    const t = makeSplitChunkNeverPlaceable('b', false, 3);
    const result = run([t], 480);

    const unplaced = idsUnplaced(result);
    expect(unplaced.has('split_b')).toBe(true);

    const unplacedEntry = unplacedEntryFor(result, 'split_b');
    const unplacedTask = unplacedEntry && (unplacedEntry.task || unplacedEntry);
    // DESIRED (split chunks must never receive the one-off date-pin, mirroring
    // shape (a)): date should stay TODAY (the stale prior value), untouched.
    // CURRENT CODE (:2601 `if (u.isRecurring || task.recurring || task.split) return;`)
    // only tests the boolean `task.split` field — a chunk carrying
    // `splitTotal:3` but `split:false` is NOT excluded, so it falls through
    // to `task.date = u.deadlineDate;` and gets pinned to YESTERDAY exactly
    // like a plain one-off. This assertion encodes the DESIRED (split-safe)
    // contract and is RED against current code — reported, not silently
    // left as an unexplained discrepancy.
    expect(unplacedTask.date).toBe(TODAY);
    expect(unplacedTask.date).not.toBe(YESTERDAY);
  });
});

// i4 probe (ernie finding #6, DADC-CODE-REVIEW.md): runSchedule.js's Case C
// persist guard (`original.deadline && original.date`, :2122) is broader than
// the in-memory pin (which excludes recurring/split, :2601) — Case C itself
// has no recurring/split exclusion. This file cannot exercise runSchedule.js's
// DB-backed Case C directly (it is embedded inside the async
// `runScheduleAndPersist`, no seam to unit-test without a DB — see
// runScheduleIntegration.test.js for that layer), but the ENTIRE risk Case C
// introduces is that it echoes whatever `task.date` unifiedScheduleV2 already
// left on the object. This probe pins the upstream half of that contract at
// the layer this file owns: for a never-placed RECURRING instance carrying a
// deadline that DIFFERS from its own anchor date, `task.date` must remain the
// anchor date (unmodified) — never clobbered to the deadline — so that
// whatever Case C subsequently persists (reading `original.date`) is
// necessarily the CORRECT pre-existing value, not a wrongly-pinned one.
function makePastAnchoredRecurringWithDeadline(overrides) {
  return Object.assign({
    id: 'pa_deadline_task',
    text: 'Past-anchored recurring instance carrying a deadline that differs from its anchor date',
    date: YESTERDAY, // the anchor — buildItems: anchorDate = toKey(t.date)
    deadline: FUTURE_DEADLINE, // deliberately DIFFERENT from anchorDate, so a wrongful clobber is visible
    dur: 30,
    pri: 'P2',
    when: '',
    dayReq: 'any',
    status: '',
    dependsOn: [],
    location: [],
    tools: [],
    recurring: true,
    generated: false,
    split: false,
    section: '',
    placementMode: PLACEMENT_MODES.TIME_WINDOW,
    preferredTimeMins: 480,
    timeFlex: 60,
    time: undefined,
    scheduledAt: undefined,
    tz: TZ,
  }, overrides || {});
}

describe('D-A 8 probe (ernie i4/finding #6) — never-placed recurring instance: task.date must NOT be clobbered to the deadline (upstream half of the Case C broader-guard risk)', () => {
  test('recurring instance, anchorDate=yesterday, deadline=3-days-out (differs from anchor): unplaced, date stays the anchor date (yesterday) — NOT the deadline — GREEN (pin correctly excludes recurring; whatever Case C persists downstream is therefore the correct pre-existing value)', () => {
    const t = makePastAnchoredRecurringWithDeadline();
    const result = run([t], 480);

    const onGrid = idsOnGrid(result);
    const unplaced = idsUnplaced(result);

    expect(onGrid.has('pa_deadline_task')).toBe(false);
    expect(unplaced.has('pa_deadline_task')).toBe(true);

    const unplacedEntry = unplacedEntryFor(result, 'pa_deadline_task');
    const unplacedTask = unplacedEntry && (unplacedEntry.task || unplacedEntry);
    // The D-A pin (:2601 `if (u.isRecurring || ...) return;`) never touches
    // task.date for a recurring item — it stays the anchor date the recurring
    // machinery already set, never rolled to the (different) deadline.
    expect(unplacedTask.date).toBe(YESTERDAY);
    expect(unplacedTask.date).not.toBe(FUTURE_DEADLINE);
  });
});
