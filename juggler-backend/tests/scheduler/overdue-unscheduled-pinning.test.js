/**
 * Overdue rescue passes must NEVER grid-place — B1/B2 (leg juggy4).
 *
 * Traceability: .planning/kermit/juggy4/TRACEABILITY.md B1, B2.
 * Intake: .planning/kermit/juggy4/INTAKE-BRIEF.json (root_cause, repro).
 *
 * THE BUG (B1): Phase 4 `missedWindowItems` (unifiedScheduleV2.js:2355-2380, the
 * when-block branch at :2364-2376) and Phase 5 `pastAnchoredRecurrings`
 * (:2394-2410) push placements straight into `dayPlacements` with NO occupancy
 * check (`reserveWithTravel`/`dayOcc` are never consulted — every OTHER
 * placement path in this file calls `reserveWithTravel` before pushing; these
 * two don't). Two unrelated overdue recurring TIME_WINDOW tasks can land at the
 * identical start/day with no lane/offset -> overlapping grid entries.
 *
 * DESIRED (David's product ruling, superseding part of commit 9bb62bb's
 * when-block-anchor-pins-grid-only branch): once a recurring task's flex
 * window or anchor date has passed, it is NEVER grid-placed. It goes
 * unscheduled-overdue (matches the existing Phase 3 `missedPreferredTimeItems`
 * precedent at :2334-2342, and the existing runSchedule.js:1907-1987
 * "unscheduled lane" write-back for the persisted end-state:
 * overdue=1, unscheduled=1, scheduled_at=null).
 *
 * THE BUG (B2): pre-split ordinal DB rows / inline split chunks of an overdue
 * recurring task have NO masterId/sourceId grouping in these two rescue passes
 * (unlike the split-overflow pass at :2125-2294, which explicitly groups
 * `splitChunksByMaster` by `task.sourceId || task.master_id`) -- each chunk
 * independently flows through pastAnchoredPreQueue (:1821-1873) into
 * `pastAnchoredRecurrings`, producing N separate overdue entries for one task.
 *
 * DESIRED (re-pinned leg juggy4 2026-07-02 iter1: scheduler-level collapse
 * removed (ernie E1); display merge = DailyView grouping): B2's ORIGINAL fix
 * (`collapseOverdueSplitChunksByMaster`, a scheduler-level group-to-one-
 * representative pass) was found by ernie (finding ernie-juggy4-E1, BLOCK) to
 * silently DROP sibling chunk rows (splitOrdinal>=2) from `result.unplaced`
 * entirely -- runSchedule.js §8 only persists rows present in `result.unplaced`,
 * so dropped siblings ended scheduled_at=NULL/unscheduled=NULL/status='' — a
 * NEVER-MISSING violation (persistence limbo, not just a display artifact).
 * bert removed the collapse (Oscar/Kermit design-correction ruling): EVERY
 * incomplete overdue split chunk now routes INDIVIDUALLY into `stillUnplaced`
 * and is persisted individually (its own row, its own `unscheduled=1`/
 * `overdue=1`, its own pinned `date`). The AMENDED contract is:
 *   - ALL incomplete overdue chunks of the split master appear in
 *     `result.unplaced`, each individually (no scheduler-level combining/
 *     summing of duration -- each chunk keeps its own `dur`).
 *   - Each is flagged unscheduled-overdue-shaped (`_unplacedReason ===
 *     REASON_CODES.MISSED`) with its OWN date pinned to its anchor (R50:
 *     never rolled forward).
 *   - NONE of the incomplete chunks is ever grid-placed.
 *   - The completed chunk is excluded entirely (never enters `buildItems`,
 *     per the status filter at unifiedScheduleV2.js:248) -- it must not be
 *     resurrected into either the grid or `result.unplaced`.
 *   - No duplicate emission: each chunk id appears exactly once, total,
 *     across grid + unplaced (placed-XOR-unplaced per chunk row).
 * Single-entry ON-SCREEN display for the group is a presentation-layer
 * concern, NOT a scheduler-output concern: DailyView.jsx:995-1007 groups
 * these individually-unplaced sibling rows by splitGroup/sourceId+date and
 * renders one entry + a `_unplacedChunkCount` badge (per ruling 999.841 --
 * DB rows/scheduler output stay separate; only the UI merges).
 *
 * These tests intentionally assert the OBSERVABLE INVARIANT (never-grid-
 * placed; every incomplete chunk present exactly once in `result.unplaced`;
 * completed chunk never resurrected) at the SCHEDULER-OUTPUT layer -- the
 * DailyView display-merge is a separate, UI-layer concern verified (if at
 * all) by its own component tests, not here.
 *
 * Layer: unit (pure unifiedScheduleV2 in-process; no DB). Fixture style mirrors
 * w2-partition.test.js (known fixture trap: blockers must actually occupy the
 * grid — these fixtures reuse the proven makeMissedWindowTask shape).
 */
'use strict';

process.env.NODE_ENV = 'test';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');
// REASON_CODES.MISSED is the marker unifiedScheduleV2 sets on an unscheduled-overdue task
// (same import path used by roamable-recurring-forward-roll.test.js).
const { REASON_CODES } = require('../../../shared/scheduler/reasonCodes');

const TODAY = '2026-06-22'; // Monday
const YESTERDAY = '2026-06-21'; // Sunday — a past anchor date for Phase 5 fixtures
const TZ = 'America/New_York';

function makeCfg(overrides) {
  return Object.assign({
    timeBlocks: DEFAULT_TIME_BLOCKS,
    toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15,
    timezone: TZ,
  }, overrides || {});
}

// Same shape as w2-partition.test.js's makeMissedWindowTask — a TIME_WINDOW
// task whose window [pref-flex, pref+flex] is entirely BEFORE nowMins today.
// pref=8:00 (480), flex=60 -> window [420,540]; nowMins=600 (10:00) ->
// windowHi(540) <= now(600) => isMissedWindow=true on current code.
function makeMissedWindowTask(overrides) {
  return Object.assign({
    id: 'mw_task',
    text: 'Missed-window TIME_WINDOW task',
    date: TODAY,
    dur: 30,
    pri: 'P2',
    when: 'work', // any non-empty when-block anchor (line 2364 only checks non-empty)
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

// A recurring TIME_WINDOW task anchored on a PAST date (not today) -> routes
// through pastAnchoredPreQueue (:1821-1873) into the Phase 5 rescue pass
// (`pastAnchoredRecurrings`), since it is not a flexible-TPC recurrence (no
// `recur.timesPerCycle`) so it takes the unconditional pin branch (:1870-1873).
function makePastAnchoredTask(overrides) {
  return Object.assign({
    id: 'pa_task',
    text: 'Past-anchored recurring task',
    date: YESTERDAY,
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
function gridEntriesForId(result, taskId) {
  const found = [];
  Object.keys(result.dayPlacements || {}).forEach((dk) => {
    (result.dayPlacements[dk] || []).forEach((p) => {
      if (p && p.task && p.task.id === taskId) found.push(Object.assign({ dateKey: dk }, p));
    });
  });
  return found;
}
function allGridEntries(result) {
  const found = [];
  Object.keys(result.dayPlacements || {}).forEach((dk) => {
    (result.dayPlacements[dk] || []).forEach((p) => found.push(Object.assign({ dateKey: dk }, p)));
  });
  return found;
}
// Collect every "representation" (grid entry OR unplaced task) belonging to a
// given split master (sourceId), across BOTH possible post-fix shapes — the
// fix's exact internal representation is an open design call (intake-brief
// ambiguity #2); this helper is representation-agnostic.
function representationsForMaster(result, masterId) {
  const gridReps = allGridEntries(result)
    .filter((p) => p.task && (p.task.sourceId === masterId || p.task.master_id === masterId))
    .map((p) => ({ where: 'grid', dur: p.dur, taskId: p.task.id }));
  const unplacedReps = (result.unplaced || [])
    .filter((t) => t && (t.sourceId === masterId || t.master_id === masterId))
    .map((t) => ({ where: 'unplaced', dur: t.dur, taskId: t.id }));
  return gridReps.concat(unplacedReps);
}

describe('B1 — overdue rescue passes must not grid-place (unscheduled-overdue only)', () => {
  test('single overdue missed-window recurring task (Phase 4, when-block anchor): NOT on grid, present exactly once as unplaced', () => {
    const t = makeMissedWindowTask({ id: 'ov_recur_1', recurring: true });
    const result = run([t], 600); // now = 10:00, window [420,540] entirely past
    const onGrid = idsOnGrid(result);
    const unplaced = idsUnplaced(result);

    // NEVER-MISSING: placed XOR unplaced (never both, never neither).
    expect(onGrid.has('ov_recur_1') && unplaced.has('ov_recur_1')).toBe(false);
    expect(onGrid.has('ov_recur_1') || unplaced.has('ov_recur_1')).toBe(true);

    // DESIRED: no grid time-slot at all for an overdue missed-window task.
    expect(onGrid.has('ov_recur_1')).toBe(false);
    expect(unplaced.has('ov_recur_1')).toBe(true);

    // Exactly one representation total (no dual-place, no duplication).
    const gridCount = gridEntriesForId(result, 'ov_recur_1').length;
    const unplacedCount = (result.unplaced || []).filter((u) => (u.id || (u.task && u.task.id)) === 'ov_recur_1').length;
    expect(gridCount + unplacedCount).toBe(1);

    // Pinned to its deadline/anchor date, never dropped or moved — the task's
    // OWN date field (its deadline day) must be unchanged by the rescue pass.
    const unplacedEntry = (result.unplaced || []).find((u) => (u.id || (u.task && u.task.id)) === 'ov_recur_1');
    const unplacedTask = unplacedEntry && (unplacedEntry.task || unplacedEntry);
    expect(unplacedTask.date).toBe(TODAY);
  });

  test('two independent overdue missed-window recurring tasks: neither is grid-placed, no shared-start collision', () => {
    const t1 = makeMissedWindowTask({ id: 'ov_recur_a', recurring: true });
    const t2 = makeMissedWindowTask({ id: 'ov_recur_b', recurring: true });
    const result = run([t1, t2], 600);
    const onGrid = idsOnGrid(result);
    const unplaced = idsUnplaced(result);

    // DESIRED: neither overdue task ever reaches the grid.
    expect(onGrid.has('ov_recur_a')).toBe(false);
    expect(onGrid.has('ov_recur_b')).toBe(false);
    expect(unplaced.has('ov_recur_a')).toBe(true);
    expect(unplaced.has('ov_recur_b')).toBe(true);

    // Defensive grid-integrity check: no two grid entries anywhere share an
    // identical (dateKey, start) — the exact overlap the bug produces.
    const seen = new Set();
    allGridEntries(result).forEach((p) => {
      const key = p.dateKey + '|' + p.start;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    });
  });

  test('overdue past-anchored recurring task (Phase 5): NOT on grid, present exactly once as unplaced, date pinned to anchor (never rolled forward, R50)', () => {
    const t = makePastAnchoredTask({ id: 'pa_recur_1' });
    const result = run([t], 0); // nowMins irrelevant to the past-anchor check
    const onGrid = idsOnGrid(result);
    const unplaced = idsUnplaced(result);

    expect(onGrid.has('pa_recur_1') && unplaced.has('pa_recur_1')).toBe(false);
    expect(onGrid.has('pa_recur_1')).toBe(false);
    expect(unplaced.has('pa_recur_1')).toBe(true);

    const gridCount = gridEntriesForId(result, 'pa_recur_1').length;
    const unplacedCount = (result.unplaced || []).filter((u) => (u.id || (u.task && u.task.id)) === 'pa_recur_1').length;
    expect(gridCount + unplacedCount).toBe(1);

    // R50: past+incomplete stays pinned to its OWN past anchor date — never
    // rolled forward to today or any later date.
    const unplacedEntry = (result.unplaced || []).find((u) => (u.id || (u.task && u.task.id)) === 'pa_recur_1');
    const unplacedTask = unplacedEntry && (unplacedEntry.task || unplacedEntry);
    expect(unplacedTask.date).toBe(YESTERDAY);
  });
});

describe('B2 — overdue split task: EVERY incomplete chunk pinned individually to unplaced (no scheduler-level collapse)', () => {
  // re-pinned leg juggy4 2026-07-02 iter1: scheduler-level collapse removed
  // (ernie E1); display merge = DailyView grouping.
  test('2 incomplete chunks + 1 completed chunk of an overdue split recurring task: BOTH incomplete chunks present individually in unplaced (never grid-placed, never merged/summed); completed chunk not resurrected; no chunk emitted twice', () => {
    const masterId = 'split_master_1';
    const chunk1 = makePastAnchoredTask({
      id: 'chunk_1', sourceId: masterId, splitTotal: 3, splitOrdinal: 1, split: true, dur: 30, status: '',
    });
    const chunk2 = makePastAnchoredTask({
      id: 'chunk_2', sourceId: masterId, splitTotal: 3, splitOrdinal: 2, split: true, dur: 45, status: '',
    });
    // Completed chunk: filtered out of buildItems entirely by the status guard
    // (unifiedScheduleV2.js:248) — must NOT be resurrected into either lane.
    const chunk3Done = makePastAnchoredTask({
      id: 'chunk_3', sourceId: masterId, splitTotal: 3, splitOrdinal: 3, split: true, dur: 20, status: 'done',
    });

    const result = run([chunk1, chunk2, chunk3Done], 0);

    const reps = representationsForMaster(result, masterId);
    // AMENDED contract (re-pinned): EVERY incomplete chunk of the split
    // master is present in result.unplaced INDIVIDUALLY — no scheduler-level
    // collapse to a single per-master representative (that collapse was the
    // ernie E1 NEVER-MISSING violation: it silently dropped sibling chunks
    // from result.unplaced). Two incomplete chunks -> two representations.
    // NON-TAUTOLOGICAL: this assertion is the exact one that would have
    // caught ernie's E1 bug (the removed collapse produced reps.length===1
    // here) — see the self-mutation proof in TEST-REVIEW.md, which
    // temporarily reinstates the collapse and confirms this line flips RED
    // (Expected: 2, Received: 1).
    expect(reps.length).toBe(2);
    // Each incomplete chunk keeps its OWN duration — no scheduler-level
    // summing/combining of duration across chunks (999.841: DB rows /
    // scheduler-output rows for split chunks are never merged; only the
    // DailyView UI groups them for display).
    const repDurs = reps.map((r) => r.dur).sort((a, b) => a - b);
    expect(repDurs).toEqual([30, 45]);
    // Both representations are in the unplaced lane, never on the grid.
    reps.forEach((r) => { expect(r.where).toBe('unplaced'); });

    // Neither incomplete chunk id independently appears on the grid.
    expect(idsOnGrid(result).has('chunk_1')).toBe(false);
    expect(idsOnGrid(result).has('chunk_2')).toBe(false);

    // Each incomplete chunk is present in result.unplaced individually and
    // flagged unscheduled-overdue-shaped, with its OWN date pinned to its
    // anchor (R50: never rolled forward to today or any later date).
    ['chunk_1', 'chunk_2'].forEach((id) => {
      const entry = (result.unplaced || []).find((u) => (u.id || (u.task && u.task.id)) === id);
      expect(entry).toBeTruthy();
      const task = entry.task || entry;
      expect(task._unplacedReason).toBe(REASON_CODES.MISSED);
      expect(task.date).toBe(YESTERDAY);
    });

    // NEVER-MISSING / no-duplicate-emission: each chunk id (including the
    // completed one) appears AT MOST once total across grid + unplaced, and
    // each INCOMPLETE chunk appears EXACTLY once (placed-XOR-unplaced per
    // chunk row — never both, never neither for an incomplete chunk).
    ['chunk_1', 'chunk_2'].forEach((id) => {
      const gridCount = gridEntriesForId(result, id).length;
      const unplacedCount = (result.unplaced || []).filter((u) => (u.id || (u.task && u.task.id)) === id).length;
      expect(gridCount + unplacedCount).toBe(1);
    });

    // The completed chunk (chunk_3, status='done') must NOT be resurrected
    // into either lane — filtered out upstream of these rescue passes.
    expect(idsOnGrid(result).has('chunk_3')).toBe(false);
    expect(idsUnplaced(result).has('chunk_3')).toBe(false);
  });
});

describe('Control — NON-overdue recurring + NON-overdue split place exactly as today (must PASS now and after the fix)', () => {
  test('non-overdue TIME_WINDOW recurring task (window still open): placed on grid as usual, not unplaced', () => {
    const t = makeMissedWindowTask({ id: 'ctrl_recur_1', recurring: true, preferredTimeMins: 480, timeFlex: 60 });
    // nowMins=300 (5:00am) -> window [420,540] is still entirely in the future -> not missed.
    const result = run([t], 300);
    const onGrid = idsOnGrid(result);
    const unplaced = idsUnplaced(result);
    expect(onGrid.has('ctrl_recur_1')).toBe(true);
    expect(unplaced.has('ctrl_recur_1')).toBe(false);
  });

  test('non-overdue split task chunks (today, not anchored to a past date): each chunk still places as its OWN separate grid entry (no overdue-only collapse)', () => {
    const masterId = 'split_ctrl_master';
    const chunk1 = Object.assign(makeMissedWindowTask({
      id: 'ctrl_chunk_1', sourceId: masterId, splitTotal: 2, splitOrdinal: 1, split: true, dur: 30,
      recurring: false, preferredTimeMins: 480, timeFlex: 60,
    }));
    const chunk2 = Object.assign(makeMissedWindowTask({
      id: 'ctrl_chunk_2', sourceId: masterId, splitTotal: 2, splitOrdinal: 2, split: true, dur: 30,
      recurring: false, preferredTimeMins: 600, timeFlex: 60,
    }));
    // nowMins=0 -> neither window (480±60, 600±60) has passed -> both place normally.
    const result = run([chunk1, chunk2], 0);
    const onGrid = idsOnGrid(result);
    expect(onGrid.has('ctrl_chunk_1')).toBe(true);
    expect(onGrid.has('ctrl_chunk_2')).toBe(true);
    // Two distinct grid entries — NOT collapsed into one (collapse is an
    // overdue-only behavior per B2).
    const reps = representationsForMaster(result, masterId);
    expect(reps.length).toBe(2);
  });
});

/**
 * BUG2 (W2) — RED repro, leg sched-anchor-split-bugs.
 *
 * Traceability: .planning/kermit/sched-anchor-split-bugs/TRACEABILITY.md BUG2.
 *
 * Kermit's hypothesis: "recurring split chunks land on identical scheduled_at for
 * placement_mode:'anytime' overdue occurrences" — i.e. a duplicate-placement bug in
 * tryPlaceQueued/placeSplitInline (~unifiedScheduleV2.js:1665 / :2153-2170), not
 * covered by the juggy4 B1/B2 fix (which only routes TIME_WINDOW / when-block-anchored
 * overdue recurring items into `result.unplaced`).
 *
 * OBSERVED (telly, running the fixture below): that is not quite the mechanism.
 * `buildItems` (unifiedScheduleV2.js:266-310) has an EARLIER, unconditional early-drop
 * branch for ANYTIME-mode recurring items:
 *
 *   if (t.recurring && pm === PLACEMENT_MODES.ANYTIME && t.date && toKey(t.date) < todayIsoKey) {
 *     ... isFlexTpcCheck ...
 *     } else {
 *       return; // Day-locked — drop as before
 *     }
 *   }
 *
 * For a plain daily recurrence (`recur: {type:'daily'}`, no `timesPerCycle` -> not
 * flexible-TPC) whose anchor date is in the past, this `return` removes the item from
 * `items` BEFORE it ever reaches the queue, tryPlaceQueued, placeSplitInline, or the
 * pastAnchoredPreQueue/stillUnplaced rescue passes B1/B2 added — regardless of
 * `t.split`/`t.sourceId`. Confirmed empirically (probe script, 2 incomplete split
 * chunks + 1 completed chunk, all ANYTIME/daily/past-anchored): BOTH incomplete
 * chunks are ABSENT from `result.dayPlacements` AND `result.unplaced` — not a grid
 * collision, but total omission from the scheduler's output (a NEVER-MISSING
 * violation, arguably a step worse than a duplicate scheduled_at). Control probes
 * confirm this is not split-specific — a single non-split ANYTIME overdue recurring
 * instance is dropped identically, while the equivalent TIME_WINDOW fixture (this
 * file's existing B1/B2 tests) correctly lands in `result.unplaced` with
 * `_unplacedReason: 'missed'`.
 *
 * This REFINES Kermit's root-cause file:line: the defect is buildItems' ANYTIME
 * early-drop branch (:266-310), not the placement passes at :1665/:2153-2170 — those
 * are never reached because the item is already gone by the time they'd run. The
 * reported production symptom ("identical scheduled_at") is the DOWNSTREAM
 * consequence: because these dropped rows never appear in the scheduler's output,
 * runSchedule.js's persist step (driven off result.unplaced/dayPlacements) never
 * touches them once they go overdue, so whatever (possibly identical/placeholder)
 * scheduled_at they carried from their last real placement is frozen forever —
 * never individually re-pinned the way the TIME_WINDOW fix does.
 *
 * This test asserts the SAME invariant the TIME_WINDOW B2 test above established
 * (every incomplete split chunk present exactly once in result.unplaced, never
 * grid-placed) against an ANYTIME/daily equivalent fixture. Does NOT modify any
 * existing TIME_WINDOW test in this file.
 */
describe('BUG2 (W2): ANYTIME-mode overdue recurring split chunks — repro (RED)', () => {
  // Mirrors makePastAnchoredTask above, but ANYTIME placement + explicit daily
  // recur (non-flexible-TPC: no timesPerCycle) instead of TIME_WINDOW.
  function makePastAnchoredAnytimeTask(overrides) {
    return Object.assign({
      id: 'pa_any_task',
      text: 'Past-anchored recurring task (anytime)',
      date: YESTERDAY,
      dur: 30,
      pri: 'P2',
      when: '',
      dayReq: 'any',
      status: '',
      dependsOn: [],
      location: [],
      tools: [],
      recurring: true,
      recur: { type: 'daily' }, // non-flexible-TPC -> takes the day-locked drop branch
      generated: false,
      split: false,
      section: '',
      placementMode: PLACEMENT_MODES.ANYTIME,
      time: undefined,
      scheduledAt: undefined,
      tz: TZ,
    }, overrides || {});
  }

  test('2 incomplete ANYTIME split chunks + 1 completed chunk of an overdue daily-recurring split task: EACH incomplete chunk should be present individually in result.unplaced (mirrors the TIME_WINDOW B2 invariant) — CURRENTLY FAILS: both silently vanish (never grid-placed AND never unplaced)', () => {
    const masterId = 'split_master_anytime_1';
    const chunk1 = makePastAnchoredAnytimeTask({
      id: 'a_chunk_1', sourceId: masterId, splitTotal: 3, splitOrdinal: 1, split: true, dur: 30, status: '',
    });
    const chunk2 = makePastAnchoredAnytimeTask({
      id: 'a_chunk_2', sourceId: masterId, splitTotal: 3, splitOrdinal: 2, split: true, dur: 45, status: '',
    });
    const chunk3Done = makePastAnchoredAnytimeTask({
      id: 'a_chunk_3', sourceId: masterId, splitTotal: 3, splitOrdinal: 3, split: true, dur: 20, status: 'done',
    });

    const result = run([chunk1, chunk2, chunk3Done], 0);

    // This part already holds today (never grid-placed) — consistent with "no
    // duplicate scheduled_at IN THIS PURE FUNCTION" (the collision, if any, is a
    // downstream persistence-layer artifact, not something visible here).
    expect(idsOnGrid(result).has('a_chunk_1')).toBe(false);
    expect(idsOnGrid(result).has('a_chunk_2')).toBe(false);

    // DESIRED (mirrors the TIME_WINDOW B2 invariant above): every incomplete chunk
    // of the split master is present INDIVIDUALLY in result.unplaced.
    // RED: reps.length is 0 (both chunks silently dropped at buildItems:266-310),
    // not 2 — see the refined root-cause note above.
    const reps = representationsForMaster(result, masterId);
    expect(reps.length).toBe(2);

    ['a_chunk_1', 'a_chunk_2'].forEach((id) => {
      const entry = (result.unplaced || []).find((u) => (u.id || (u.task && u.task.id)) === id);
      expect(entry).toBeTruthy();
      const task = entry.task || entry;
      expect(task._unplacedReason).toBe(REASON_CODES.MISSED);
      expect(task.date).toBe(YESTERDAY);
    });
  });
});
