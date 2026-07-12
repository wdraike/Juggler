/**
 * RED (step 0) — leg juggler-overdue-flex-reschedule.
 *
 * Traceability: .planning/kermit/juggler-overdue-flex-reschedule/TRACEABILITY.md
 *   BUG-1 (unifiedScheduleV2.js:605-618, 1412-1420, 1585-1608)
 *   BUG-2 (unifiedScheduleV2.js:2172-2245)
 * WBS: .planning/kermit/juggler-overdue-flex-reschedule/WBS-juggler-overdue-flex-reschedule.md
 *   W1, W2.
 *
 * David's ruling (2026-07-12): an instance whose placement options are
 * exhausted within its flex window MUST be written `unscheduled=1` /
 * `scheduled_at=NULL` with `unplaced_reason` set — never force-crammed into
 * a leftover slot "to stay visible". Current code violates this via the
 * undocumented `preferLatestSlot` lane (buildItems :605-618) which routes an
 * overdue-today ANYTIME recurring instance through `findLatestSlot`
 * (backward-scan-from-end-of-day) TWICE:
 *   (a) at rung 1 itself (tryPlaceQueued :1536 `findSlot = item.preferLatestSlot
 *       ? findLatestSlot : findEarliestSlot` — even the FIRST/"normal" attempt
 *       uses the backward scan, not just a last-resort fallback), and
 *   (b) at the explicit fallback rung (:1600-1604) which additionally sets
 *       `relaxWhen: true` — ignoring the task's OWN declared `when` tag
 *       entirely — once the item's genuine (unrelaxed) search has failed.
 *
 * THE BUG (BUG-1), verified empirically (probe script, not just static
 * reading): an ANYTIME daily-recurring instance whose own `when`-tag window
 * (e.g. 'morning', 360-480) has ALREADY fully elapsed for today (the "past"
 * marker in dayOcc, unifiedScheduleV2.js:1811-1814, covers the whole window)
 * — so its GENUINE (unrelaxed) search is truly exhausted for the day — still
 * gets FORCE-PLACED by the :1600-1604 fallback via `relaxWhen: true` +
 * backward scan, landing on the literal LAST free slot of the day (23:30),
 * even though that slot is entirely outside the task's own declared
 * when-window. This is exactly the "force-crammed into a leftover slot"
 * behavior the ruling outlaws — confirmed below at start=1350 (23:30).
 *
 * `isMissedPreferredTime` (unifiedScheduleV2.js:442-448) is a DIFFERENT,
 * earlier-firing check (nowMins >= preferredTimeMins + timeFlex, default
 * flex=60) that ALREADY diverts a day-locked recurring instance straight to
 * `missedPreferredTimeItems` (:2055-2058) WITHOUT ever reaching
 * `tryPlaceQueued`/`preferLatestSlot` at all — so to actually exercise the
 * `preferLatestSlot` bug (not a different, already-correct code path), nowMins
 * must stay inside the narrow band `preferredTimeMins < nowMins <
 * preferredTimeMins + timeFlex` (here: preferredTimeMins=470, nowMins=490,
 * both < 470+60=530).
 *
 * THE BUG (BUG-2), verified empirically (probe script): sibling split chunks
 * placed together in ONE batched `unifiedScheduleV2` call correctly avoid
 * collision (dayOcc reservation is sequential within one call — confirmed:
 * 4 chunks land at 1350/1320/1290/1260, no overlap). The DB-observed
 * collision (3 of 4 sibling chunks landing on the byte-identical
 * `scheduled_at`) reproduces instead when each sibling chunk is (re)scheduled
 * via an INDEPENDENT invocation that only sees ITS OWN task (mirroring a
 * "reschedule this one overdue chunk" request racing against its siblings'
 * own independent requests, per count's Intake Brief hypothesis) — each
 * independent call sees an empty/open day and the `preferLatestSlot` fallback
 * DETERMINISTICALLY computes the SAME literal last-free-slot-of-the-day
 * result (2026-06-22, start=1350) for every sibling, since none of them can
 * see any other sibling's about-to-be-computed placement. This is REPRODUCED
 * below (4/4 collide; the reported 3/4 is consistent with a race where one
 * request happened to run after another had already persisted). This
 * confirms the WBS's "may resolve by construction" note: `preferLatestSlot`
 * is a pure function of (day, item) with NO sibling-awareness across
 * invocations — removing it (W1) removes the shared deterministic target
 * these independent calls otherwise converge on.
 *
 * Layer: unit (pure unifiedScheduleV2 in-process; no DB) — mirrors the style
 * of overdue-unscheduled-pinning.test.js / roamable-recurring-forward-roll.test.js
 * (both pure-function scheduler tests), per telly's directive to prefer this
 * over a DB-backed test-bed harness when available.
 */
'use strict';

process.env.NODE_ENV = 'test';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');

const TODAY = '2026-06-22'; // Monday
const TZ = 'America/New_York';

function makeCfg(overrides) {
  return Object.assign({
    timeBlocks: DEFAULT_TIME_BLOCKS,
    toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15,
    timezone: TZ,
  }, overrides || {});
}

// DEFAULT_WEEKDAY_BLOCKS (constants.js): morning 360-480, biz 480-720,
// lunch 720-780, biz2 780-1020, evening 1020-1260, night 1260-1380.
// An ANYTIME daily-recurring instance whose `when` tag is restricted to
// 'morning' and whose preferredTimeMins (-> anchorMin, buildItems:346-347)
// sits near the end of that block. nowMins=490 is chosen to satisfy BOTH:
//   - preferLatestSlot's own condition (anchorMin(470) < nowMins(490)), AND
//   - staying UNDER the isMissedPreferredTime threshold (preferredTimeMins +
//     timeFlex = 470+60 = 530 > 490) so the item is NOT diverted to
//     missedPreferredTimeItems before ever reaching tryPlaceQueued.
// At nowMins=490, nowSlot=ceil(490/15)*15=495, so dayOcc marks [0,494] as
// "past" — which fully covers the 'morning' window (360-480): the item's
// OWN genuine (unrelaxed) search is truly exhausted. The rest of the day
// (>=495) is left GENUINELY OPEN (no other task/blocker occupies it).
function makeAnytimeMorningTask(overrides) {
  return Object.assign({
    id: 'ov_any_1',
    text: 'ANYTIME daily-recurring, morning window exhausted, rest of day open',
    date: TODAY,
    dur: 30,
    pri: 'P2',
    when: 'morning',
    dayReq: 'any',
    status: '',
    dependsOn: [],
    location: [],
    tools: [],
    recurring: true,
    recur: { type: 'daily' }, // non-flexible-TPC -> day-locked (single-day flex window)
    generated: false,
    split: false,
    section: '',
    placementMode: PLACEMENT_MODES.ANYTIME,
    preferredTimeMins: 470,
    timeFlex: 60,
    time: undefined,
    scheduledAt: undefined,
    tz: TZ,
  }, overrides || {});
}

function makeAnytimeSplitChunk(overrides) {
  return Object.assign({
    id: 'chunk',
    text: 'ANYTIME daily-recurring split chunk, morning window exhausted',
    date: TODAY,
    dur: 30,
    pri: 'P2',
    when: 'morning',
    dayReq: 'any',
    status: '',
    dependsOn: [],
    location: [],
    tools: [],
    recurring: true,
    recur: { type: 'daily' },
    generated: false,
    split: true,
    section: '',
    placementMode: PLACEMENT_MODES.ANYTIME,
    preferredTimeMins: 470,
    timeFlex: 60,
    time: undefined,
    scheduledAt: undefined,
    tz: TZ,
  }, overrides || {});
}

function run(tasks, nowMins) {
  const statuses = {};
  tasks.forEach((t) => { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, nowMins, makeCfg());
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
function gridEntryFor(result, taskId) {
  var found = null;
  Object.keys(result.dayPlacements || {}).forEach((dk) => {
    (result.dayPlacements[dk] || []).forEach((p) => {
      if (p && p.task && p.task.id === taskId) found = Object.assign({ dateKey: dk }, p);
    });
  });
  return found;
}
function unplacedEntryFor(result, taskId) {
  return (result.unplaced || []).find((u) => (u.id || (u.task && u.task.id)) === taskId);
}

describe('BUG-1 (W1): preferLatestSlot force-place-at-last-slot must NOT survive once genuine (own when-window) search is exhausted', () => {
  test('ANYTIME daily-recurring instance, own when-window (morning) exhausted for today, rest of day genuinely open: DESIRED = unscheduled=1/scheduled_at=NULL/unplaced_reason set — CURRENTLY FAILS: force-placed at day-end (23:30) via findLatestSlot/relaxWhen fallback', () => {
    const t = makeAnytimeMorningTask({ id: 'ov_any_1' });
    const result = run([t], 490);

    // NEVER-MISSING: placed XOR unplaced (sanity — both invariants hold
    // regardless of which side of the fix we're on).
    const onGrid = idsOnGrid(result);
    const unplaced = idsUnplaced(result);
    expect(onGrid.has('ov_any_1') && unplaced.has('ov_any_1')).toBe(false);
    expect(onGrid.has('ov_any_1') || unplaced.has('ov_any_1')).toBe(true);

    // DESIRED (David's ruling): once the instance's own genuine placement
    // search is exhausted within its flex window, it must be unscheduled —
    // never force-placed at a leftover slot found only by ignoring the
    // task's own when-constraint (relaxWhen:true) and scanning backward from
    // day-end. RED on current code: the CURRENT buggy behavior places it at
    // dateKey=TODAY, start=1350 (23:30) via the flexWhenRelaxed fallback —
    // see the probe evidence quoted in TEST-REVIEW.md / telly-REVIEW.json.
    expect(onGrid.has('ov_any_1')).toBe(false);
    expect(unplaced.has('ov_any_1')).toBe(true);

    const unplacedEntry = unplacedEntryFor(result, 'ov_any_1');
    expect(unplacedEntry).toBeTruthy();
    const unplacedTask = unplacedEntry && (unplacedEntry.task || unplacedEntry);
    // scheduled_at=NULL equivalent at this pure-function layer: no grid entry
    // exists to derive a scheduled_at from (runSchedule.js's persist step
    // only writes scheduled_at for rows present in dayPlacements).
    expect(gridEntryFor(result, 'ov_any_1')).toBeNull();
    // unplaced_reason populated (non-tautological: this is exactly the field
    // runSchedule.js's unscheduled-lane write-back persists as
    // `unplaced_reason` — not asserting a specific code, since the exact
    // REASON_CODES value is bert's implementation choice, but it must be SET,
    // not left undefined/blank).
    expect(unplacedTask._unplacedReason).toBeTruthy();
  });

  // zoe-jofr-w1 (WARN, resolved): the WBS intent names "daily, weekly, etc."
  // recurrence for the preferLatestSlot fix; the daily-only test above
  // exercises just one recur type. zoe confirmed `preferLatestSlot`/the W1
  // fix is recur-type-agnostic by construction (buildItems/tryPlaceQueued
  // never branch on `recur.type` — the fallback ladder only reads `when`/
  // `preferredTimeMins`/`timeFlex`), but flagged that this zero-tolerance
  // core-scheduler surface had no test PINNING that weekly recurrence
  // behaves identically. This variant is IDENTICAL to the BUG-1 fixture
  // above except `recur: { type: 'weekly', days: 'MTWRFSU' }` (no
  // `timesPerCycle` → day-locked/single-day flex window, same as the daily
  // case — the sibling weekly-day-locked shape used throughout
  // roamable-recurring-forward-roll.test.js, e.g. line 250/632/770; `days`
  // includes every day so today, 2026-06-22 Monday, is always a recur day —
  // isolating the recur-TYPE variable without changing anything else).
  test('WEEKLY-recurring instance (recur-type-agnostic pin, zoe-jofr-w1), own when-window (morning) exhausted for today, rest of day genuinely open: same DESIRED outcome as daily — NOT force-placed, unscheduled with unplaced_reason set', () => {
    const t = makeAnytimeMorningTask({
      id: 'ov_weekly_1',
      recur: { type: 'weekly', days: 'MTWRFSU' }, // day-locked, same as daily's { type: 'daily' }
    });
    const result = run([t], 490);

    const onGrid = idsOnGrid(result);
    const unplaced = idsUnplaced(result);
    expect(onGrid.has('ov_weekly_1') && unplaced.has('ov_weekly_1')).toBe(false);
    expect(onGrid.has('ov_weekly_1') || unplaced.has('ov_weekly_1')).toBe(true);

    // Same DESIRED outcome as the daily BUG-1 case: NOT force-placed at
    // day-end via relaxWhen/findLatestSlot; routed to unscheduled instead.
    expect(onGrid.has('ov_weekly_1')).toBe(false);
    expect(unplaced.has('ov_weekly_1')).toBe(true);

    const unplacedEntry = unplacedEntryFor(result, 'ov_weekly_1');
    expect(unplacedEntry).toBeTruthy();
    const unplacedTask = unplacedEntry && (unplacedEntry.task || unplacedEntry);
    expect(gridEntryFor(result, 'ov_weekly_1')).toBeNull();
    expect(unplacedTask._unplacedReason).toBeTruthy();
  });
});

describe('Control (W1 regression guard) — genuine-reschedule-succeeds case must keep placing normally (must PASS now and after the fix)', () => {
  test('ANYTIME daily-recurring instance with NO restrictive when-tag (whole day is its own genuine window) and rest of day open: still PLACED (not unscheduled) — same today, before and after the fix removes the last-slot bias', () => {
    // when='' -> getWhenWindows falls back to the 'anytime' union (the WHOLE
    // day is this item's own genuine window, no relaxation needed) — this is
    // the WBS's "existing genuine-reschedule-succeeds case (an open ...
    // slot within the window) still places normally" carve-out. Only WHERE
    // in the day it lands may change post-fix (earliest-first instead of
    // last-slot); whether it lands at all must NOT change.
    const t = makeAnytimeMorningTask({ id: 'ctrl_open', when: '' });
    const result = run([t], 490);
    const onGrid = idsOnGrid(result);
    const unplaced = idsUnplaced(result);
    expect(onGrid.has('ctrl_open')).toBe(true);
    expect(unplaced.has('ctrl_open')).toBe(false);
  });
});

describe('BUG-2 (W2): independent per-chunk reschedule invocations must NOT let sibling split chunks converge on the identical {date, scheduled_at}', () => {
  // REVISED 2026-07-12 (telly re-review, post-bert-W1-fix): the ORIGINAL assertion here
  // (`expect(p.entry).toBeTruthy()`, requiring successful placement for all 4 chunks) was
  // stricter than the WBS's own written W2 acceptance criteria (WBS-...md line 19): "no two
  // sibling chunks ... share the same {date, scheduled_at} -- each occupies a distinct
  // non-overlapping slot, OR the ones that can't fit are unscheduled per W1's rule." bert
  // disputed the assertion (bert-REVIEW.json finding bert-jofr-f2 / REFER->telly) and telly's
  // re-review CONCURS: on THIS fixture (own when-window genuinely exhausted, mirroring BUG-1's
  // fixture exactly), the only way any chunk could place is via a when-relaxing fallback --
  // which is precisely the force-place-outside-declared-window behavior W1's ruling just
  // outlawed. Since all 4 chunks are structurally identical (same when/preferredTimeMins/dur/
  // nowMins; id/sourceId/splitOrdinal are not read by any placement-search decision in
  // buildItems) and each `run([c], 490)` call is a deterministic pure function with ZERO shared
  // state across the 4 independent invocations, requiring "each occupies a distinct slot" for
  // ALL 4 is mathematically unsatisfiable without either (a) reintroducing W1's removed
  // force-place fallback, or (b) inventing an unapproved cross-invocation staggering design
  // (out of scope: a placement-mode-semantics change, not a mechanical bugfix). The test below
  // now asserts the ACTUAL W2 acceptance criterion: non-collision among whichever chunks DO
  // place, with the "OR unscheduled" branch explicitly permitted -- and non-vacuously confirms
  // every unscheduled chunk went through W1's real unplaced-reason path (not silently dropped
  // via some other code path), so the test still fails loud if the fix regresses.
  test('4 sibling ANYTIME daily-recurring split chunks (same split_group/sourceId), each rescheduled via its OWN independent scheduler invocation (mirrors a race between separate per-chunk reschedule requests): DESIRED (WBS W2) = no two siblings share {dateKey, start} — EITHER each places at a distinct slot, OR (as here, own when-window exhausted per BUG-1s fixture) they correctly go unscheduled per W1s rule, non-colliding by construction', () => {
    const masterId = 'split_master_race';
    const chunks = [1, 2, 3, 4].map((ord) => makeAnytimeSplitChunk({
      id: 'chunk_' + ord, sourceId: masterId, splitTotal: 4, splitOrdinal: ord, dur: 30,
    }));

    // Each chunk is scheduled via its OWN independent unifiedScheduleV2 call
    // (NOT one batched call for all 4) — this is the shape count's Intake
    // Brief hypothesis names ("race between independent per-chunk reschedule
    // invocations"): a real endpoint that reschedules ONE overdue chunk at a
    // time cannot see its siblings' about-to-be-computed placements. A
    // batched single call (all 4 tasks in one unifiedScheduleV2 invocation)
    // does NOT reproduce the collision — dayOcc reservation is correctly
    // sequential within one call (verified separately: 4 chunks land at
    // distinct 1350/1320/1290/1260 in that shape). The DB-observed incident
    // (3 of 4 identical scheduled_at) is consistent with this independent-
    // invocation race, not a single-call defect.
    const placements = chunks.map((c) => {
      const r = run([c], 490);
      return { id: c.id, entry: gridEntryFor(r, c.id), unplaced: unplacedEntryFor(r, c.id) };
    });

    // NEVER-MISSING invariant per chunk: placed XOR unplaced (holds regardless
    // of which side of the "distinct slot OR unscheduled" branch a chunk lands on).
    placements.forEach((p) => {
      expect(!!p.entry && !!p.unplaced).toBe(false);
      expect(!!p.entry || !!p.unplaced).toBe(true);
    });

    // Non-vacuous check on the "OR unscheduled" branch: a chunk that did NOT
    // place must have gone through W1's real unplaced-reason path (populated
    // _unplacedReason) — proves this is the correct unscheduled route, not a
    // silent drop via some other code path that would also (trivially, and
    // wrongly) satisfy "non-colliding".
    placements.forEach((p) => {
      if (p.entry) return;
      const unplacedTask = p.unplaced && (p.unplaced.task || p.unplaced);
      expect(unplacedTask && unplacedTask._unplacedReason).toBeTruthy();
    });

    // W2 acceptance criterion (WBS, verbatim): no two sibling chunks share the
    // same {date, scheduled_at} — each occupies a distinct slot, OR the ones
    // that can't fit are unscheduled per W1's rule. Collision-check is scoped
    // to whichever chunks DID place (an unscheduled chunk has no {date,start}
    // to collide on — non-colliding by construction, exactly as W1's fix
    // produces on this fixture).
    const placed = placements.filter((p) => p.entry);
    const seen = new Set();
    const collisions = [];
    placed.forEach((p) => {
      const key = p.entry.dateKey + '|' + p.entry.start;
      if (seen.has(key)) collisions.push({ id: p.id, key: key });
      seen.add(key);
    });
    expect(collisions).toEqual([]);
    // Non-tautological cross-check: every chunk that DID place landed on its
    // own distinct {date,start} (redundant restatement of collisions===[],
    // kept for parity with the BUG-1/Control tests' style — not asserting
    // placed.length itself, since 0 placed (all-unscheduled) legitimately
    // satisfies the WBS's "OR unscheduled" branch on this exhausted-window fixture).
    expect(seen.size).toBe(placed.length);
  });
});
