/**
 * Unit tests for schedulerSession.js — the admin stepper session store.
 *
 * Source: src/scheduler/schedulerSession.js
 *
 * Architecture notes (from reading the source):
 *   - startSession / getSession / stopSession / getStep / getSummary are DB-backed.
 *   - _computeStep(sessionObj, stepIndex) and _computeSummary(sessionObj) are
 *     SYNCHRONOUS pure helpers that receive an already-fetched session object.
 *   - We test _computeStep + _computeSummary directly (pure functions, no DB).
 *   - For getSession (DB-backed), we mock the db module and verify the returned
 *     null-when-not-found contract.
 */

// ── DB mock at require-time ───────────────────────────────────────────────────
// schedulerSession.js requires '../db' at module level (for the sweep timer).
// We intercept it here before the module is loaded.

let mockDbChain;

// Reset the chain mock between tests so each test controls its own results.
function makeMockChain(overrides) {
  const base = {
    where:    jest.fn().mockReturnThis(),
    update:   jest.fn().mockResolvedValue(1),
    first:    jest.fn().mockResolvedValue(null),
    insert:   jest.fn().mockResolvedValue([1]),
    delete:   jest.fn().mockResolvedValue(1),
    select:   jest.fn().mockResolvedValue([]),
  };
  return Object.assign(base, overrides);
}

// The db module is called as db(table) → chain. We track the current chain via
// a module-level variable so individual tests can replace it.
const mockDb = jest.fn((table) => {  // eslint-disable-line no-unused-vars
  return mockDbChain || makeMockChain();
});
mockDb.fn = { now: () => 'MOCK_NOW' };

jest.mock('../../src/db', () => mockDb);

// schedulerSession also requires unifiedScheduleV2 lazily inside startSession,
// so that require() doesn't hit us at module load — no mock needed for it here.

const {
  _computeStep,
  _computeSummary,
  getSession,
  stopSession,
} = require('../../src/scheduler/schedulerSession');

// ── Shared fixture builder ────────────────────────────────────────────────────

function makeSnapshot(stepIndex, overrides) {
  return Object.assign({
    stepIndex: stepIndex,
    phase: 'V2: Unconstrained',
    taskId: 'task-' + stepIndex,
    taskText: 'Task ' + stepIndex,
    project: 'proj',
    pri: 'P3',
    orderingSlack: 120,
    placement: {
      dateKey: '2026-05-15',
      start: 480 + stepIndex * 30,
      dur: 30,
    },
  }, overrides);
}

function makeSessionObj(snapshotCount, overrides) {
  const snapshots = [];
  for (let i = 0; i < snapshotCount; i++) {
    snapshots.push(makeSnapshot(i));
  }
  const tasksById = {};
  snapshots.forEach(function(s) {
    tasksById[s.taskId] = {
      id: s.taskId,
      text: s.taskText,
      project: s.project,
      pri: s.pri,
      dur: 30,
      when: '',
      deadline: null,
      earliestStart: null,
      recurring: false,
      split: false,
      splitMin: null,
      location: [],
      tools: [],
    };
  });
  return Object.assign({
    sessionId: 'sess-abc',
    userId: 'u-test',
    todayKey: '2026-05-15',
    nowMins: 480,
    timezone: 'America/New_York',
    snapshots: snapshots,
    tasksById: tasksById,
    unplaced: [],
    score: { total: 5 },
    warnings: [],
    slackByTaskId: {},
  }, overrides);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('_computeStep (pure sync helper)', () => {
  test('returns null for out-of-range step index (too high)', () => {
    const s = makeSessionObj(2);
    expect(_computeStep(s, 99)).toBeNull();
  });

  test('returns null for negative step index', () => {
    const s = makeSessionObj(2);
    expect(_computeStep(s, -1)).toBeNull();
  });

  test('returns step record for index 0 — includes totalSteps and task fields', () => {
    const s = makeSessionObj(3);
    const step = _computeStep(s, 0);
    expect(step).not.toBeNull();
    expect(step.totalSteps).toBe(3);
    expect(step.stepIndex).toBe(0);
    expect(step.task).not.toBeNull();
    expect(step.task.id).toBe('task-0');
  });

  test('returns step record for last valid index', () => {
    const s = makeSessionObj(3);
    const step = _computeStep(s, 2);
    expect(step).not.toBeNull();
    expect(step.stepIndex).toBe(2);
    expect(step.task.id).toBe('task-2');
  });

  test('step record includes upcoming[] preview of following steps', () => {
    const s = makeSessionObj(5);
    const step = _computeStep(s, 0);
    // upcoming should contain indices 1..4 (up to 5 lookahead)
    expect(Array.isArray(step.upcoming)).toBe(true);
    expect(step.upcoming.length).toBeGreaterThan(0);
    expect(step.upcoming[0].stepIndex).toBe(1);
  });

  test('task field is null when taskId is not found in tasksById', () => {
    const s = makeSessionObj(1);
    // Sabotage: remove the task from tasksById
    s.tasksById = {};
    const step = _computeStep(s, 0);
    expect(step).not.toBeNull();
    expect(step.task).toBeNull();
  });
});

describe('_computeSummary (pure sync helper)', () => {
  test('returns aggregate with totalSteps', () => {
    const s = makeSessionObj(4);
    const summary = _computeSummary(s);
    expect(summary.totalSteps).toBe(4);
  });

  test('returns queue array with one entry per step', () => {
    const s = makeSessionObj(3);
    const summary = _computeSummary(s);
    expect(Array.isArray(summary.queue)).toBe(true);
    expect(summary.queue.length).toBe(3);
  });

  test('each queue entry has stepIndex, phase, taskId, taskText', () => {
    const s = makeSessionObj(2);
    const summary = _computeSummary(s);
    const entry = summary.queue[0];
    expect(typeof entry.stepIndex).toBe('number');
    expect(typeof entry.phase).toBe('string');
    expect(typeof entry.taskId).toBe('string');
    expect(typeof entry.taskText).toBe('string');
  });

  test('returns sessionId, todayKey, score, unplaced, warnings', () => {
    const s = makeSessionObj(1);
    const summary = _computeSummary(s);
    expect(summary.sessionId).toBe('sess-abc');
    expect(summary.todayKey).toBe('2026-05-15');
    expect(summary.score).toEqual({ total: 5 });
    expect(Array.isArray(summary.unplaced)).toBe(true);
    expect(Array.isArray(summary.warnings)).toBe(true);
  });

  test('_computeSummary on empty snapshot list returns zero-step summary', () => {
    const s = makeSessionObj(0);
    const summary = _computeSummary(s);
    expect(summary.totalSteps).toBe(0);
    expect(summary.queue).toEqual([]);
  });
});

describe('getSession (DB-backed — mock DB)', () => {
  beforeEach(() => {
    mockDb.mockClear();
  });

  test('returns null when session not found (DB returns null)', async () => {
    // db('scheduler_sessions').where(...).where(...).first() → null
    mockDbChain = makeMockChain({ first: jest.fn().mockResolvedValue(null) });
    const result = await getSession('nonexistent-session-id');
    expect(result).toBeNull();
  });

  test('returns camelCase session object when row found', async () => {
    const fakeRow = {
      session_id: 'sess-123',
      user_id: 'u1',
      today_key: '2026-05-15',
      now_mins: 480,
      timezone: 'America/New_York',
      snapshots: JSON.stringify([]),
      tasks_by_id: JSON.stringify({}),
      unplaced: JSON.stringify([]),
      score: JSON.stringify({ total: 0 }),
      warnings: JSON.stringify([]),
      slack_by_task_id: JSON.stringify({}),
    };
    // first() returns the row; update() for TTL extension resolves fine.
    mockDbChain = makeMockChain({
      first: jest.fn().mockResolvedValue(fakeRow),
      update: jest.fn().mockResolvedValue(1),
    });
    const result = await getSession('sess-123');
    expect(result).not.toBeNull();
    expect(result.sessionId).toBe('sess-123');
    expect(result.todayKey).toBe('2026-05-15');
    expect(Array.isArray(result.snapshots)).toBe(true);
  });
});

describe('stopSession (DB-backed — mock DB)', () => {
  beforeEach(() => {
    mockDb.mockClear();
  });

  test('resolves without throwing', async () => {
    mockDbChain = makeMockChain({ delete: jest.fn().mockResolvedValue(1) });
    await expect(stopSession('sess-xyz')).resolves.not.toThrow();
  });
});
