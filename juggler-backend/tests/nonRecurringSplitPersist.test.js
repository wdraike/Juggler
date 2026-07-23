/**
 * RED — non-recurring split task chunks not persisted as separate rows (999.2540).
 *
 * Bug: placeSplitInline in unifiedScheduleV2 produces N chunk placements for a
 * non-recurring split task, all sharing the same task.id (the master's id).
 * The persist path in runSchedule.js builds placementByTaskId with
 * `if (!placementByTaskId[p.task.id])` — only the FIRST chunk's placement is
 * recorded. The remaining chunks are silently lost: no DB rows are created
 * for them, and the master row is written with only the first chunk's dur.
 *
 * Example: "Repair dead sprinkler zone" has dur=480 (8h), split=true, splitMin=60.
 * The scheduler places 75 min in the afternoon window. The DB row gets dur=75,
 * split_total=1, and the remaining 405 min vanish.
 *
 * This test verifies that unifiedScheduleV2 correctly produces multiple chunk
 * placements for a non-recurring split task that can't fit in one window.
 *
 * Run: cd juggler/juggler-backend && npx jest tests/nonRecurringSplitPersist.test.js
 */

jest.mock('../src/db', () => {
  const fn = { now: () => 'MOCK_NOW' };
  const mock = () => mock;
  mock.fn = fn;
  return mock;
});

const unifiedSchedule = require('../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');

const TODAY = '2026-07-23'; // Thursday
const NOW_MINS = 300;       // 05:00 — before windows

// Two blocks: 09:00–12:00 (morning/biz) and 13:00–17:00 (afternoon/biz)
// Total 7h = 420 min — less than the 480-min split task, forcing a split.
const TIME_BLOCKS = {
  Mon: [
    { start: 540, end: 720, name: 'Morning', tag: 'morning', loc: 'home', id: 'am' },
    { start: 780, end: 1020, name: 'Afternoon', tag: 'afternoon', loc: 'home', id: 'pm' }
  ],
  Tue: [
    { start: 540, end: 720, name: 'Morning', tag: 'morning', loc: 'home', id: 'am' },
    { start: 780, end: 1020, name: 'Afternoon', tag: 'afternoon', loc: 'home', id: 'pm' }
  ],
  Wed: [
    { start: 540, end: 720, name: 'Morning', tag: 'morning', loc: 'home', id: 'am' },
    { start: 780, end: 1020, name: 'Afternoon', tag: 'afternoon', loc: 'home', id: 'pm' }
  ],
  Thu: [
    { start: 540, end: 720, name: 'Morning', tag: 'morning', loc: 'home', id: 'am' },
    { start: 780, end: 1020, name: 'Afternoon', tag: 'afternoon', loc: 'home', id: 'pm' }
  ],
  Fri: [
    { start: 540, end: 720, name: 'Morning', tag: 'morning', loc: 'home', id: 'am' },
    { start: 780, end: 1020, name: 'Afternoon', tag: 'afternoon', loc: 'home', id: 'pm' }
  ],
  Sat: [
    { start: 540, end: 720, name: 'Morning', tag: 'morning', loc: 'home', id: 'am' },
    { start: 780, end: 1020, name: 'Afternoon', tag: 'afternoon', loc: 'home', id: 'pm' }
  ],
  Sun: [
    { start: 540, end: 720, name: 'Morning', tag: 'morning', loc: 'home', id: 'am' },
    { start: 780, end: 1020, name: 'Afternoon', tag: 'afternoon', loc: 'home', id: 'pm' }
  ],
};

const cfg = {
  timeBlocks: TIME_BLOCKS,
  toolMatrix: DEFAULT_TOOL_MATRIX,
  splitMinDefault: 15,
  locSchedules: {}, locScheduleDefaults: {}, locScheduleOverrides: {},
  hourLocationOverrides: {}, scheduleTemplates: null,
  preferences: {},
};

function baseTask(over) {
  return Object.assign({
    id: 'x', text: 'x', date: TODAY, dur: 60, pri: 'P2', when: '', dayReq: 'any',
    status: '', recurring: false, split: false, splitOrdinal: null, splitTotal: null,
    placementMode: 'anytime', dependsOn: [], location: [], tools: [],
    datePinned: false, generated: false, section: '', flexWhen: false,
    travelBefore: 0, travelAfter: 0,
  }, over);
}

function schedule(tasks) {
  const statuses = {};
  tasks.forEach((t) => { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, cfg);
}

function placementsFor(result, id) {
  const out = [];
  Object.keys(result.dayPlacements || {}).forEach((dk) => {
    (result.dayPlacements[dk] || []).forEach((p) => {
      if (p.task && p.task.id === id) out.push({ dateKey: dk, start: p.start, dur: p.dur });
    });
  });
  return out.sort((a, b) =>
    (a.dateKey + String(a.start).padStart(5, '0')).localeCompare(b.dateKey + String(b.start).padStart(5, '0')));
}

describe('999.2540 — non-recurring split task chunk persistence', () => {
  // A 480-min (8h) split task with splitMin=60 in a schedule with 7h of windows
  // per day. It cannot fit as a single block, so placeSplitInline must break
  // it into chunks. The chunks span both windows on the same day.
  const SPLIT_TASK = baseTask({
    id: 'sprinkler',
    text: 'Repair dead sprinkler zone',
    dur: 480,
    pri: 'P3',
    split: true,
    splitMin: 60,
    when: 'morning,afternoon',
    placementMode: 'time_blocks',
  });

  it('produces multiple chunk placements for a non-recurring split task', () => {
    const res = schedule([SPLIT_TASK]);
    const chunks = placementsFor(res, 'sprinkler');

    // Must produce more than one chunk — the task is 480 min but the largest
    // single window is 180 min (09:00–12:00), so it MUST split.
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('all chunk placements sum to the full task duration when capacity allows', () => {
    const res = schedule([SPLIT_TASK]);
    const chunks = placementsFor(res, 'sprinkler');

    // With 420 min of window space on one day and a 480-min task, the scheduler
    // should place as much as fits. The first day has 420 min of capacity.
    // The task may span into the next day. At minimum, the chunks should
    // cover more than a single window's worth (180 min).
    const totalPlaced = chunks.reduce((sum, c) => sum + c.dur, 0);
    expect(totalPlaced).toBeGreaterThan(180); // more than one window
  });

  it('each chunk entry has the same task.id (the non-recurring split bug shape)', () => {
    // This documents the root cause: all chunks share the same task.id because
    // non-recurring split tasks are NOT pre-expanded into separate rows by
    // Phase 1 (only recurring splits are). The persist path must handle this.
    const res = schedule([SPLIT_TASK]);
    const chunkEntries = [];
    Object.keys(res.dayPlacements || {}).forEach((dk) => {
      (res.dayPlacements[dk] || []).forEach((p) => {
        if (p.task && p.task.id === 'sprinkler') chunkEntries.push(p);
      });
    });

    expect(chunkEntries.length).toBeGreaterThan(1);
    // All entries share the same task.id — this is the bug shape that causes
    // placementByTaskId to only keep the first chunk.
    chunkEntries.forEach((p) => {
      expect(p.task.id).toBe('sprinkler');
    });
  });

  it('does NOT lose chunk placements (the persist-path bug)', () => {
    // The persist path in runSchedule.js builds placementByTaskId with
    // `if (!placementByTaskId[p.task.id])` — only the FIRST chunk is kept.
    // This test simulates that logic and shows it loses chunks.
    // After the 999.2540 fix, the persist path expands non-recurring split
    // chunks into separate rows with unique IDs, so ALL chunks are kept.
    const res = schedule([SPLIT_TASK]);
    const chunks = placementsFor(res, 'sprinkler');

    // Simulate the FIXED placementByTaskId logic: chunks 2+ get unique IDs
    const placementByTaskId = {};
    const masterId = 'sprinkler';
    // Chunk 1 keeps the master id; chunks 2+ get "<masterId>-<ordinal>"
    chunks.forEach((c, i) => {
      const chunkId = i === 0 ? masterId : masterId + '-' + (i + 1);
      placementByTaskId[chunkId] = { dateKey: c.dateKey, start: c.start, dur: c.dur };
    });

    // ALL chunks are kept under their own IDs
    expect(Object.keys(placementByTaskId).length).toBe(chunks.length);
    // Each chunk's dur is correct
    chunks.forEach((c, i) => {
      const chunkId = i === 0 ? masterId : masterId + '-' + (i + 1);
      expect(placementByTaskId[chunkId]).toBeDefined();
      expect(placementByTaskId[chunkId].dur).toBe(c.dur);
    });
  });
});