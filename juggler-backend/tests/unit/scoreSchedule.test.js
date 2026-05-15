/**
 * Unit tests for scoreSchedule — per-dimension isolation tests.
 *
 * Source: src/scheduler/scoreSchedule.js
 *
 * These tests focus on dimension ISOLATION — each test compares two schedules
 * that differ in exactly ONE dimension and verifies the penalty direction is
 * correct. This is additive to tests/scoreSchedule.test.js (which covers the
 * basic happy paths and overall scoring).
 *
 * Penalty constants (from the source):
 *   DEADLINE_MISS_PENALTY = 500
 *   PRIORITY_DRIFT_BASE   = 20
 *   FRAGMENTATION_PENALTY = 15  (per extra split beyond the first)
 *
 * PRI_RANK: P1=100, P2=80, P3=50, P4=20  (higher rank = higher priority)
 */

const scoreSchedule = require('../../src/scheduler/scoreSchedule');

// ── Minimal factory helpers ───────────────────────────────────────────────────

function makeTask(overrides) {
  return Object.assign({
    id: 't_' + Math.random().toString(36).slice(2, 8),
    text: 'Test task',
    date: '2026-05-15',
    dur: 30,
    pri: 'P3',
    deadline: null,
  }, overrides);
}

// Build a placement slot for dayPlacements[dateKey].
function slot(task, start, overrides) {
  return Object.assign({ task: task, start: start, dur: task.dur }, overrides);
}

// ─────────────────────────────────────────────────────────────────────────────
// Dimension 1: Deadline miss
// ─────────────────────────────────────────────────────────────────────────────

describe('scoreSchedule — deadline miss dimension', () => {
  test('schedule with zero missed deadlines scores lower than one with a missed deadline', () => {
    const task = makeTask({ id: 'dl-task', deadline: '2026-05-15' });

    // Good: placed on the deadline date (not after)
    const good = scoreSchedule(
      { '2026-05-15': [slot(task, 480)] },
      [],
      [task]
    );

    // Bad: placed a day after the deadline
    const bad = scoreSchedule(
      { '2026-05-16': [slot(task, 480)] },
      [],
      [task]
    );

    expect(bad.breakdown.deadlineMiss).toBeGreaterThan(0);
    expect(good.breakdown.deadlineMiss).toBe(0);
    expect(bad.total).toBeGreaterThan(good.total);
  });

  test('deadline miss penalty is exactly DEADLINE_MISS_PENALTY (500) per missed task', () => {
    const task = makeTask({ id: 'dl-task-2', deadline: '2026-05-10' });
    // Placed on 2026-05-20, well past deadline
    const result = scoreSchedule(
      { '2026-05-20': [slot(task, 540)] },
      [],
      [task]
    );
    expect(result.breakdown.deadlineMiss).toBe(500);
  });

  test('two tasks both missing their deadlines double the penalty', () => {
    const t1 = makeTask({ id: 'dl-1', deadline: '2026-05-10' });
    const t2 = makeTask({ id: 'dl-2', deadline: '2026-05-11' });
    const result = scoreSchedule(
      { '2026-05-20': [slot(t1, 480), slot(t2, 510)] },
      [],
      [t1, t2]
    );
    expect(result.breakdown.deadlineMiss).toBe(1000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dimension 2: Priority waste (same-day priority drift)
// ─────────────────────────────────────────────────────────────────────────────

describe('scoreSchedule — priority drift dimension', () => {
  test('low-priority task on earlier slot than high-priority task incurs drift penalty', () => {
    const p1Task = makeTask({ id: 'high-pri', pri: 'P1' });
    const p4Task = makeTask({ id: 'low-pri',  pri: 'P4' });

    // Correct order: P1 first, P4 later → no drift
    const correct = scoreSchedule(
      { '2026-05-15': [slot(p1Task, 480), slot(p4Task, 510)] },
      [],
      [p1Task, p4Task]
    );

    // Wrong order: P4 first (lower priority hogs prime time), P1 later → drift
    const wrong = scoreSchedule(
      { '2026-05-15': [slot(p4Task, 480), slot(p1Task, 510)] },
      [],
      [p1Task, p4Task]
    );

    expect(correct.breakdown.priorityDrift).toBe(0);
    expect(wrong.breakdown.priorityDrift).toBeGreaterThan(0);
    expect(wrong.total).toBeGreaterThan(correct.total);
  });

  test('same-priority tasks placed in any order produce zero drift', () => {
    const t1 = makeTask({ id: 'p3-a', pri: 'P3' });
    const t2 = makeTask({ id: 'p3-b', pri: 'P3' });
    const result = scoreSchedule(
      { '2026-05-15': [slot(t1, 480), slot(t2, 510)] },
      [],
      [t1, t2]
    );
    expect(result.breakdown.priorityDrift).toBe(0);
  });

  test('drift penalty scales with priority gap (P1 vs P4 > P2 vs P3)', () => {
    // P4 before P1: gap = 80 (100 - 20), penalty = 20 + 80 = 100
    const high1 = makeTask({ id: 'p1', pri: 'P1' });
    const low1  = makeTask({ id: 'p4', pri: 'P4' });
    const bigGap = scoreSchedule(
      { '2026-05-15': [slot(low1, 480), slot(high1, 510)] },
      [],
      [high1, low1]
    );

    // P3 before P2: gap = 30 (80 - 50), penalty = 20 + 30 = 50
    const high2 = makeTask({ id: 'p2', pri: 'P2' });
    const low2  = makeTask({ id: 'p3', pri: 'P3' });
    const smallGap = scoreSchedule(
      { '2026-05-15': [slot(low2, 480), slot(high2, 510)] },
      [],
      [high2, low2]
    );

    expect(bigGap.breakdown.priorityDrift).toBeGreaterThan(smallGap.breakdown.priorityDrift);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dimension 3: Fragmentation (split tasks)
// ─────────────────────────────────────────────────────────────────────────────

describe('scoreSchedule — fragmentation dimension', () => {
  test('contiguous single-slot task scores better than the same task split into parts', () => {
    const task = makeTask({ id: 'frag-task', dur: 120 });

    // Contiguous: one slot, no splitPart metadata
    const contiguous = scoreSchedule(
      { '2026-05-15': [slot(task, 480, { dur: 120 })] },
      [],
      [task]
    );

    // Fragmented: four 30-min chunks (splitPart = 1…4)
    const fragmented = scoreSchedule(
      { '2026-05-15': [
        slot(task, 480, { dur: 30, splitPart: 1, splitTotal: 4 }),
        slot(task, 600, { dur: 30, splitPart: 2, splitTotal: 4 }),
        slot(task, 720, { dur: 30, splitPart: 3, splitTotal: 4 }),
        slot(task, 840, { dur: 30, splitPart: 4, splitTotal: 4 }),
      ]},
      [],
      [task]
    );

    expect(contiguous.breakdown.fragmentation).toBe(0);
    expect(fragmented.breakdown.fragmentation).toBeGreaterThan(0);
    expect(fragmented.total).toBeGreaterThan(contiguous.total);
  });

  test('fragmentation penalty is (numParts - 1) * 15', () => {
    const task = makeTask({ id: 'frag-exact', dur: 90 });
    // Split into 3 parts → penalty = (3-1) * 15 = 30
    const result = scoreSchedule(
      { '2026-05-15': [
        slot(task, 480, { dur: 30, splitPart: 1, splitTotal: 3 }),
        slot(task, 600, { dur: 30, splitPart: 2, splitTotal: 3 }),
        slot(task, 720, { dur: 30, splitPart: 3, splitTotal: 3 }),
      ]},
      [],
      [task]
    );
    expect(result.breakdown.fragmentation).toBe(30);
  });

  test('task without splitPart metadata does not incur fragmentation penalty', () => {
    const task = makeTask({ id: 'no-frag', dur: 60 });
    const result = scoreSchedule(
      { '2026-05-15': [slot(task, 480), slot(task, 540)] },
      [],
      [task]
    );
    // Same task placed twice without splitPart: fragmentation dimension = 0
    // (the fragmentation check uses `slot.splitPart == null` as guard)
    expect(result.breakdown.fragmentation).toBe(0);
  });
});
