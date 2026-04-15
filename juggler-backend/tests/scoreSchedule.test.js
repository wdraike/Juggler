/**
 * Score Schedule Tests
 *
 * scoreSchedule(dayPlacements, unplaced, allTasks) → { total, breakdown, details }
 * Lower score = better. 0 = perfect.
 */

const scoreSchedule = require('../src/scheduler/scoreSchedule');

function makeTask(overrides) {
  return {
    id: 't_' + Math.random().toString(36).slice(2, 8),
    text: 'Test', date: '3/22', dur: 30, pri: 'P3',
    ...overrides
  };
}

function makePlacement(task, start, dur, overrides) {
  return { task, start, dur: dur || task.dur, ...overrides };
}

describe('scoreSchedule', () => {
  test('empty schedule scores 0', () => {
    const result = scoreSchedule({}, [], []);
    expect(result.total).toBe(0);
  });

  test('single placed task with no issues scores low', () => {
    const t = makeTask({ id: 't1', date: '3/22' });
    const placements = { '3/22': [makePlacement(t, 540, 30)] };
    const result = scoreSchedule(placements, [], [t]);
    // No unplaced, no deadline miss, no dep violations
    expect(result.total).toBeLessThan(100);
  });

  test('unplaced task adds penalty', () => {
    const t = makeTask({ id: 't1', pri: 'P1' });
    const result = scoreSchedule({}, [t], [t]);
    expect(result.total).toBeGreaterThan(0);
    expect(result.breakdown.unplaced).toBeGreaterThan(0);
  });

  test('higher priority unplaced = higher penalty', () => {
    const p1 = makeTask({ id: 't1', pri: 'P1' });
    const p4 = makeTask({ id: 't2', pri: 'P4' });
    const resultP1 = scoreSchedule({}, [p1], [p1]);
    const resultP4 = scoreSchedule({}, [p4], [p4]);
    expect(resultP1.breakdown.unplaced).toBeGreaterThan(resultP4.breakdown.unplaced);
  });

  test('deadline miss adds penalty', () => {
    const t = makeTask({ id: 't1', date: '3/20', deadline: '3/21' });
    // Placed on 3/25 — after deadline of 3/21
    const placements = { '3/25': [makePlacement(t, 540, 30)] };
    const result = scoreSchedule(placements, [], [t]);
    expect(result.breakdown.deadlineMiss).toBeGreaterThan(0);
  });

  test('no deadline miss when placed before due', () => {
    const t = makeTask({ id: 't1', date: '3/22', deadline: '3/25' });
    const placements = { '3/22': [makePlacement(t, 540, 30)] };
    const result = scoreSchedule(placements, [], [t]);
    expect(result.breakdown.deadlineMiss).toBe(0);
  });

  test('priority drift: lower pri before higher pri on same day', () => {
    const p1 = makeTask({ id: 'p1', date: '3/22', pri: 'P1' });
    const p4 = makeTask({ id: 'p4', date: '3/22', pri: 'P4' });
    // P4 placed BEFORE P1 — that's wrong
    const placements = { '3/22': [
      makePlacement(p4, 480, 30),
      makePlacement(p1, 540, 30)
    ]};
    const result = scoreSchedule(placements, [], [p1, p4]);
    expect(result.breakdown.priorityDrift).toBeGreaterThan(0);
  });

  test('no priority drift when correctly ordered', () => {
    const p1 = makeTask({ id: 'p1', date: '3/22', pri: 'P1' });
    const p4 = makeTask({ id: 'p4', date: '3/22', pri: 'P4' });
    // P1 before P4 — correct
    const placements = { '3/22': [
      makePlacement(p1, 480, 30),
      makePlacement(p4, 540, 30)
    ]};
    const result = scoreSchedule(placements, [], [p1, p4]);
    expect(result.breakdown.priorityDrift).toBe(0);
  });

  test('date drift: task placed on different day than original', () => {
    const t = makeTask({ id: 't1', date: '3/22' });
    // Placed on 3/25 instead of 3/22
    const placements = { '3/25': [makePlacement(t, 540, 30)] };
    const result = scoreSchedule(placements, [], [t]);
    expect(result.breakdown.dateDrift).toBeGreaterThan(0);
  });

  test('fragmentation: split task penalized per part', () => {
    const t = makeTask({ id: 't1', date: '3/22', dur: 120 });
    // Same task split into 3 parts
    const placements = { '3/22': [
      makePlacement(t, 480, 40, { splitPart: 1, splitTotal: 3 }),
      makePlacement(t, 600, 40, { splitPart: 2, splitTotal: 3 }),
      makePlacement(t, 720, 40, { splitPart: 3, splitTotal: 3 })
    ]};
    const result = scoreSchedule(placements, [], [t]);
    expect(result.breakdown.fragmentation).toBeGreaterThan(0);
  });
});
