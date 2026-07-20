/**
 * RED — split-chunk travel buffers (999.1079, ruling R7 2026-07-19).
 *
 * placeSplitInline reserves split chunks with `reserve()` (core minutes only,
 * no travel), while every whole-task placement uses reserveWithTravel. So a
 * split chunk can be placed crowding an adjacent occupant's commute buffer.
 * R7: split chunks must reserve travel like whole tasks (each chunk is a session
 * needing transition time). This RED demonstrates the missing buffer FIRST.
 *
 * Scenario: one 240-min window [09:00,13:00). A FIXED task (dur 120,
 * travelAfter 30) takes [09:00,11:00) and reserves [09:00,11:30) with its
 * after-buffer. A SPLIT task (dur 300 > window, splitMin 60, travel 30/30) then
 * splits; its first chunk must sit travelAfter(FIXED)+travelBefore(SPLIT)=60 min
 * clear of FIXED's core end. Pre-fix it lands at 11:30 (only FIXED's own buffer,
 * none of its own); post-fix at 12:00.
 *
 * Run: cd juggler/juggler-backend && npx jest tests/splitTravelBuffer.test.js
 */

jest.mock('../src/db', () => {
  const fn = { now: () => 'MOCK_NOW' };
  const mock = () => mock;
  mock.fn = fn;
  return mock;
});

const unifiedSchedule = require('../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');

const TODAY = '2026-06-22'; // Monday
const NOW_MINS = 300;       // 05:00 — before the window

// Single 09:00–13:00 work block every weekday, so the window is a deterministic
// [540,780) with no lunch split.
const ONE_BLOCK = { start: 540, end: 780, name: 'Work', tag: 'biz', loc: 'home', id: 'work' };
const TIME_BLOCKS = {
  Mon: [ONE_BLOCK], Tue: [ONE_BLOCK], Wed: [ONE_BLOCK], Thu: [ONE_BLOCK],
  Fri: [ONE_BLOCK], Sat: [ONE_BLOCK], Sun: [ONE_BLOCK],
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
  return out.sort((a, b) => (a.dateKey + a.start).localeCompare(b.dateKey + b.start) || a.start - b.start);
}

describe('999.1079 — split chunks reserve travel buffers (R7)', () => {
  // FIXED occupies the window head; SPLIT must not crowd its after-buffer.
  const FIXED = baseTask({ id: 'fixed', text: 'Fixed', dur: 120, pri: 'P1', travelAfter: 30,
    deadlineDate: TODAY });
  const SPLIT = baseTask({ id: 'split', text: 'Split', dur: 300, pri: 'P3', split: true,
    splitMin: 60, travelBefore: 30, travelAfter: 30 });

  it('places the first split chunk clear of the fixed task travel buffers', () => {
    const res = schedule([FIXED, SPLIT]);
    const fixed = placementsFor(res, 'fixed');
    const split = placementsFor(res, 'split');

    // Precondition: FIXED took the window head [540,660).
    expect(fixed).toHaveLength(1);
    expect(fixed[0].start).toBe(540);
    expect(fixed[0].dur).toBe(120);

    // At least one split chunk placed.
    expect(split.length).toBeGreaterThan(0);
    const firstChunk = split[0];

    // R7: the chunk must sit travelAfter(FIXED)=30 + travelBefore(SPLIT)=30 = 60
    // minutes clear of FIXED's core end (660). Pre-fix it lands at 690.
    const fixedCoreEnd = fixed[0].start + fixed[0].dur; // 660
    expect(firstChunk.start - fixedCoreEnd).toBeGreaterThanOrEqual(60);
  });

  it('records the reserved travel on each split-chunk placement entry', () => {
    // harrison BLOCK fix — the entry must carry the same travel it reserved on
    // the grid, or the recurring-split-overflow release (which clears
    // [start-tb, end+ta) from entry.travelBefore/After) under-clears and the
    // buffer minutes leak. Whole-task entries already carry real travel; split
    // chunks now have parity.
    const res = schedule([FIXED, SPLIT]);
    const chunkEntries = [];
    Object.keys(res.dayPlacements || {}).forEach((dk) => {
      (res.dayPlacements[dk] || []).forEach((p) => {
        if (p.task && p.task.id === 'split') chunkEntries.push(p);
      });
    });
    expect(chunkEntries.length).toBeGreaterThan(0);
    chunkEntries.forEach((p) => {
      expect(p.travelBefore).toBe(30);
      expect(p.travelAfter).toBe(30);
    });
  });
});
