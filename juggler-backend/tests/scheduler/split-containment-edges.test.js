/**
 * Split-containment edge cases — dedicated per-requirement coverage.
 *
 * Backlog 999.556 / 999.557: strong INDIRECT coverage already exists in
 * splitInteractions.test.js (TS-126 series) and schedulerScenarios.test.js,
 * but no file tags these requirement IDs with a case that genuinely exercises
 * the specific containment behavior. This file fills that gap.
 *
 *   R19.4 — day-lock recurring rigid splits: all chunks of a recurring rigid
 *           split land on the occurrence date only.
 *   R19.5 — non-recurring splits MAY cross day boundaries when one day lacks
 *           capacity (up to the deadline).
 *   R19.6 — travel buffers apply only to the first ordinal (travelBefore) and
 *           last ordinal (travelAfter) of a split.
 *   R19.7 — partial splits (remaining after all windows exhausted) flagged
 *           `partial_split` in the unplaced list.
 *   R35.2 — time-box recurring splits: all chunks complete before the next
 *           recurrence interval (weekly → 7-day window).
 *   R35.6 — recurring splits that overflow their time-box flagged
 *           `_unplacedReason: "recurring_split_overflow"`.
 *
 * Pure unit tests — call unifiedScheduleV2 directly, no DB.
 *
 * Behavior facts pinned from src/scheduler/unifiedScheduleV2.js:
 *  - Split expansion (placeSplitInline) only fires when a task can't fit as a
 *    single contiguous block; force it with dur > max contiguous slot.
 *  - The recurring_split_overflow time-box pass (timeBoxRecurringSplits) only
 *    groups chunks that carry `recurring:true`, `splitTotal>1` AND a master id
 *    (`sourceId` or `master_id`), and whose `recur` yields a known cycle length.
 *  - partial_split is set on item.task._unplacedReason when placeSplitInline
 *    places >=1 chunk but leaves a remainder.
 *  - travelBefore is applied only to splitOrdinal===1, travelAfter only to
 *    splitOrdinal===splitTotal (unifiedScheduleV2 lines ~318-326).
 */

'use strict';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');

// 2026-06-08 is a Monday; gives a clean week for weekly time-box tests.
const TODAY = '2026-06-08';
const NOW_MINS = 0;

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
    ...overrides,
  };
}

const cfg = makeCfg();

function makeTask(overrides) {
  return {
    id: 't_' + Math.random().toString(36).slice(2, 8),
    text: 'Test task',
    date: TODAY,
    dur: 60,
    pri: 'P3',
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
    ...overrides,
  };
}

function run(tasks, overrideCfg) {
  const statuses = {};
  tasks.forEach((t) => { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, overrideCfg || cfg);
}

function findPlacements(result, taskId) {
  const found = [];
  Object.keys(result.dayPlacements).forEach((dk) => {
    (result.dayPlacements[dk] || []).forEach((p) => {
      if (p.task && p.task.id === taskId) {
        found.push({ dateKey: dk, start: p.start, dur: p.dur, entry: p });
      }
    });
  });
  return found;
}

function totalDuration(result, taskId) {
  return findPlacements(result, taskId).reduce((s, p) => s + p.dur, 0);
}

function distinctDays(result, taskId) {
  return new Set(findPlacements(result, taskId).map((p) => p.dateKey)).size;
}

/** Find unplaced entries for a task id (entry shape varies: {id} or {task}). */
function unplacedFor(result, taskId) {
  return result.unplaced.filter((u) => (u.id || (u.task && u.task.id)) === taskId);
}

/** The _unplacedReason the scheduler stamped on the task object for taskId. */
function unplacedReason(result, taskId) {
  const u = unplacedFor(result, taskId)[0];
  if (!u) return null;
  const task = u.task || u;
  return task._unplacedReason || null;
}

/** Config restricting every weekday to a single morning block of [start,end). */
function singleBlockCfg(start, end) {
  const block = (s, e) => [{ id: 'morning', tag: 'morning', name: 'Morning', start: s, end: e, color: '#F59E0B', loc: 'work' }];
  return makeCfg({
    timeBlocks: {
      Mon: block(start, end), Tue: block(start, end), Wed: block(start, end),
      Thu: block(start, end), Fri: block(start, end),
      Sat: block(start, end), Sun: block(start, end),
    },
  });
}

// ══════════════════════════════════════════════════════════════════════════
// R19.4 — Day-lock recurring rigid splits (all chunks on the occurrence date)
// ══════════════════════════════════════════════════════════════════════════
describe('R19.4 — recurring rigid split day-lock', () => {
  test('R19.4: rigid recurring split (fixed placement) keeps all chunks on the occurrence date', () => {
    // A fixed-placement recurring split is rigid → isDayLocked path. Even with
    // a duration that needs splitting, chunks must not roam off the anchor day.
    // Use a single 09:00-12:00 morning block and a 180-min split so it must
    // chunk but can still fit within one day.
    const task = makeTask({
      id: 'r194_rigid',
      dur: 150,
      split: true,
      splitMin: 30,
      recurring: true,
      recur: { type: 'daily', every: 1 },
      sourceId: 'master_r194',
      anchorDate: TODAY,
      recurStart: TODAY,
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      when: 'morning',
    });
    const result = run([task], singleBlockCfg(540, 720)); // 09:00-12:00 = 180 min capacity
    const placements = findPlacements(result, 'r194_rigid');
    expect(placements.length).toBeGreaterThanOrEqual(1);
    // R19.4: every placed chunk is on the occurrence (anchor) date.
    placements.forEach((p) => expect(p.dateKey).toBe(TODAY));
    expect(distinctDays(result, 'r194_rigid')).toBe(1);
  });

  test('R19.4: daily recurring split does NOT spill chunks into the next occurrence day', () => {
    // Daily recurrence → cycle length 1 → cap latestIdx to the anchor day in
    // placeSplitInline. A 240-min split against a 120-min/day block can only
    // place ~120 min on the anchor day; the rest must NOT appear on day+1.
    const task = makeTask({
      id: 'r194_daily',
      dur: 240,
      split: true,
      splitMin: 30,
      recurring: true,
      recur: { type: 'daily', every: 1 },
      sourceId: 'master_r194d',
      anchorDate: TODAY,
      recurStart: TODAY,
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      when: 'morning',
    });
    const result = run([task], singleBlockCfg(540, 660)); // 09:00-11:00 = 120 min/day
    const placements = findPlacements(result, 'r194_daily');
    placements.forEach((p) => expect(p.dateKey).toBe(TODAY));
    // Capacity (120) < duration (240) → cannot all fit on the locked day.
    expect(totalDuration(result, 'r194_daily')).toBeLessThan(240);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// R19.5 — Non-recurring splits MAY cross day boundaries
// ══════════════════════════════════════════════════════════════════════════
describe('R19.5 — non-recurring split crosses day boundaries', () => {
  test('R19.5: non-recurring split spans multiple days when one day lacks capacity', () => {
    // 240-min non-recurring split, only 120 min/day of capacity → must spread
    // across >= 2 days. Non-recurring has no cycle cap, so chunks roam forward.
    const task = makeTask({
      id: 'r195_cross',
      dur: 240,
      split: true,
      splitMin: 30,
      recurring: false,
      deadline: '2026-06-12', // bounded so chunks have somewhere to land but must cross days
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      when: 'morning',
    });
    const result = run([task], singleBlockCfg(540, 660)); // 120 min/day
    expect(totalDuration(result, 'r195_cross')).toBe(240);
    expect(distinctDays(result, 'r195_cross')).toBeGreaterThanOrEqual(2);
  });

  test('R19.5: non-recurring split respects the deadline (no chunks past deadlineDate)', () => {
    // Same shape but bounded by a deadline two days out. Chunks may cross days
    // but never beyond the deadline.
    const deadline = '2026-06-10'; // TODAY + 2 days
    const task = makeTask({
      id: 'r195_dl',
      dur: 180,
      split: true,
      splitMin: 30,
      recurring: false,
      deadline: deadline,
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      when: 'morning',
    });
    const result = run([task], singleBlockCfg(540, 600)); // 60 min/day → needs 3 days
    const placements = findPlacements(result, 'r195_dl');
    placements.forEach((p) => expect(p.dateKey <= deadline).toBe(true));
    expect(distinctDays(result, 'r195_dl')).toBeGreaterThanOrEqual(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// R19.6 — Travel buffers only on first/last ordinal
// ══════════════════════════════════════════════════════════════════════════
describe('R19.6 — travel buffers on first/last ordinal only', () => {
  // These exercise the buildItems travel-assignment branch (splitOrd===1 →
  // travelBefore; splitOrd===splitTot → travelAfter) by passing pre-chunked
  // ordinals, the way reconcile-splits materializes them in production.
  function chunk(ord, tot, extra) {
    return makeTask(Object.assign({
      id: `r196_o${ord}`,
      text: `chunk ${ord}/${tot}`,
      dur: 30,
      split: false,
      splitOrdinal: ord,
      splitTotal: tot,
      travelBefore: 20,
      travelAfter: 25,
      placementMode: PLACEMENT_MODES.ANYTIME,
    }, extra || {}));
  }

  test('R19.6: first ordinal carries travelBefore, not travelAfter', () => {
    const result = run([chunk(1, 3)]);
    const p = findPlacements(result, 'r196_o1')[0];
    expect(p).toBeTruthy();
    expect(p.entry.travelBefore).toBe(20);
    expect(p.entry.travelAfter).toBe(0);
  });

  test('R19.6: last ordinal carries travelAfter, not travelBefore', () => {
    const result = run([chunk(3, 3)]);
    const p = findPlacements(result, 'r196_o3')[0];
    expect(p).toBeTruthy();
    expect(p.entry.travelBefore).toBe(0);
    expect(p.entry.travelAfter).toBe(25);
  });

  test('R19.6: middle ordinal carries neither travel buffer', () => {
    const result = run([chunk(2, 3)]);
    const p = findPlacements(result, 'r196_o2')[0];
    expect(p).toBeTruthy();
    expect(p.entry.travelBefore).toBe(0);
    expect(p.entry.travelAfter).toBe(0);
  });

  test('R19.6: single-chunk split (1/1) carries both buffers', () => {
    const result = run([chunk(1, 1)]);
    const p = findPlacements(result, 'r196_o1')[0];
    expect(p).toBeTruthy();
    expect(p.entry.travelBefore).toBe(20);
    expect(p.entry.travelAfter).toBe(25);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// R19.7 — Partial splits flagged `partial_split`
// ══════════════════════════════════════════════════════════════════════════
describe('R19.7 — partial split flagged', () => {
  test('R19.7: split with capacity for only part of its duration is flagged partial_split', () => {
    // Non-recurring split of 240 min, but only ONE day has any capacity (60
    // min on TODAY, none thereafter). placeSplitInline places one chunk, then
    // exhausts all windows → remainder flagged partial_split.
    const task = makeTask({
      id: 'r197_partial',
      dur: 240,
      split: true,
      splitMin: 30,
      recurring: false,
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      when: 'morning',
      deadline: TODAY, // confine all windows to TODAY → only 60 min available
    });
    const result = run([task], singleBlockCfg(540, 600)); // 60 min/day; deadline confines to TODAY
    // Some of it placed (the 60-min Monday block), but not all 240.
    expect(totalDuration(result, 'r197_partial')).toBe(60);
    expect(totalDuration(result, 'r197_partial')).toBeLessThan(240);
    // ...remainder flagged partial_split.
    expect(unplacedReason(result, 'r197_partial')).toBe('partial_split');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// R35.2 — Time-box recurring splits (weekly → 7-day window)
// ══════════════════════════════════════════════════════════════════════════
describe('R35.2 — recurring split time-box (weekly window)', () => {
  test('R35.2: weekly recurring split keeps all chunks inside the 7-day window', () => {
    // Weekly recurrence → cycle length 7. With a 60-min/day block, a 300-min
    // split spreads across days but all chunks must stay before anchor + 7 days.
    const task = makeTask({
      id: 'r352_weekly',
      dur: 300,
      split: true,
      splitMin: 30,
      recurring: true,
      recur: { type: 'weekly', every: 1, days: ['M'] },
      sourceId: 'master_r352',
      anchorDate: TODAY,
      recurStart: TODAY,
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      when: 'morning',
    });
    const result = run([task], singleBlockCfg(540, 600)); // 60 min/day
    const placements = findPlacements(result, 'r352_weekly');
    expect(placements.length).toBeGreaterThanOrEqual(1);
    // anchor + 7 days boundary. TODAY = 2026-06-08 → boundary 2026-06-15.
    const boundary = '2026-06-15';
    placements.forEach((p) => expect(p.dateKey < boundary).toBe(true));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// R35.6 — Recurring split overflow flagged recurring_split_overflow
// ══════════════════════════════════════════════════════════════════════════
describe('R35.6 — recurring split overflow flag', () => {
  // The recurring_split_overflow flag fires in the timeBoxRecurringSplits pass,
  // which groups PRE-MATERIALIZED chunks (splitTotal>1, recurring, with a master
  // id) — the shape reconcile-splits produces in production. The cycle boundary
  // is anchor + cycleLen days; any chunk that cannot land before the next
  // occurrence (here: the next Monday) is flagged. The chunks are pinned to
  // Mondays (dayReq:'M') so the only candidate days are 06-08 then 06-15 (the
  // boundary), and each Monday holds only one chunk.
  function weeklyChunk(ord, total, extra) {
    return makeTask(Object.assign({
      id: `r356_o${ord}`,
      text: `chunk ${ord}/${total}`,
      dur: 30,
      split: false,
      splitOrdinal: ord,
      splitTotal: total,
      recurring: true,
      recur: { type: 'weekly', every: 1, days: ['M'] },
      sourceId: 'master_r356',
      anchorDate: TODAY, // Monday 2026-06-08
      recurStart: TODAY,
      dayReq: 'M',
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      when: 'morning',
    }, extra || {}));
  }

  test('R35.6: a recurring split chunk that cannot fit before the next occurrence is flagged recurring_split_overflow', () => {
    // Monday has a single 30-min block → only one chunk fits per Monday.
    // ord1 lands on 06-08; ord2 has no room until 06-15 (= anchor + 7 = the
    // boundary) → time-box pass flags it recurring_split_overflow.
    const c1 = weeklyChunk(1, 2);
    const c2 = weeklyChunk(2, 2);
    const mondayOnly = makeCfg({
      timeBlocks: {
        Mon: [{ id: 'morning', tag: 'morning', name: 'Morning', start: 540, end: 570, color: '#F59E0B', loc: 'work' }],
        Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: [],
      },
    });
    const result = run([c1, c2], mondayOnly);
    // First chunk placed on the anchor Monday...
    const p1 = findPlacements(result, 'r356_o1');
    expect(p1.length).toBe(1);
    expect(p1[0].dateKey).toBe(TODAY);
    // ...second chunk could not fit before the next occurrence → overflow flag.
    expect(findPlacements(result, 'r356_o2').length).toBe(0);
    expect(unplacedReason(result, 'r356_o2')).toBe('recurring_split_overflow');
  });

  test('R35.6: recurring split chunks that all fit before the next occurrence are NOT flagged overflow', () => {
    // Control: Monday block large enough to hold both chunks → no overflow.
    const c1 = weeklyChunk(1, 2);
    const c2 = weeklyChunk(2, 2);
    const roomyMonday = makeCfg({
      timeBlocks: {
        Mon: [{ id: 'morning', tag: 'morning', name: 'Morning', start: 540, end: 720, color: '#F59E0B', loc: 'work' }],
        Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: [],
      },
    });
    const result = run([c1, c2], roomyMonday);
    expect(findPlacements(result, 'r356_o1').length).toBe(1);
    expect(findPlacements(result, 'r356_o2').length).toBe(1);
    expect(findPlacements(result, 'r356_o1')[0].dateKey).toBe(TODAY);
    expect(findPlacements(result, 'r356_o2')[0].dateKey).toBe(TODAY);
    expect(unplacedReason(result, 'r356_o1')).toBeNull();
    expect(unplacedReason(result, 'r356_o2')).toBeNull();
  });
});
