/**
 * 999.1208 — schedulerSession lifecycle wiring (mocked DB, no test-bed).
 *
 * Source: src/scheduler/schedulerSession.js
 *
 * Complements tests/unit/schedulerSession.test.js (which covers the pure
 * _computeStep/_computeSummary helpers and getSession's shape contract).
 * This suite pins the previously-untested BACKGROUND-INFRA wiring:
 *   - getSession extends the 1h TTL on every access (sliding expiry);
 *   - getSession does NOT touch expires_at when the session is missing/expired;
 *   - getStep/getSummary route through getSession (null passthrough, enrichment);
 *   - stopSession deletes the addressed row;
 *   - JSON columns already parsed by the driver (non-string) pass through.
 */

'use strict';

process.env.NODE_ENV = 'test';

// ── DB mock at require-time ─────────────────────────────────────────────────
// schedulerSession.js requires '../db' at module level (the 5m sweep timer is
// created on load — unref'd, so it never blocks jest teardown).
let mockFirstResult;
jest.mock('../../src/db', () => {
  const chain = {
    where: jest.fn(function () { return chain; }),
    first: jest.fn(() => Promise.resolve(mockFirstResult)),
    update: jest.fn(() => Promise.resolve(1)),
    delete: jest.fn(() => Promise.resolve(1)),
    insert: jest.fn(() => Promise.resolve([1]))
  };
  const db = jest.fn(() => chain);
  db.__chain = chain;
  return db;
});

const db = require('../../src/db');
const chain = db.__chain;
const schedulerSession = require('../../src/scheduler/schedulerSession');

const SESSION_TTL_MS = 60 * 60 * 1000;

function makeSteps() {
  return [
    { stepIndex: 0, phase: 'V2: Immovable', taskId: 't1', taskText: 'Alpha', project: 'P', pri: 1,
      orderingSlack: 0, placement: { dateKey: '2026-07-09', start: 540, dur: 60, extra: 'stripped' } },
    { stepIndex: 1, phase: 'V2: Constrained', taskId: 't2', taskText: 'Beta', project: 'P', pri: 2,
      orderingSlack: 120, placement: null }
  ];
}

function makeRow(overrides) {
  return Object.assign({
    session_id: 'sess-1',
    user_id: 7,
    today_key: '2026-07-09',
    now_mins: 600,
    timezone: 'America/New_York',
    snapshots: JSON.stringify(makeSteps()),
    tasks_by_id: JSON.stringify({
      t1: { id: 't1', text: 'Alpha', project: 'P', pri: 1, dur: 60, when: 'anytime',
        deadline: null, earliestStart: null, recurring: false, split: false,
        splitMin: null, location: null, tools: [] }
    }),
    unplaced: '[]',
    score: JSON.stringify({ total: 5 }),
    warnings: '[]',
    slack_by_task_id: JSON.stringify({ t1: 42 })
  }, overrides);
}

beforeEach(() => {
  mockFirstResult = undefined;
  jest.clearAllMocks();
});

describe('getSession — sliding 1h TTL', () => {
  test('extends expires_at by ~1h on access', async () => {
    mockFirstResult = makeRow();
    const before = Date.now();
    await schedulerSession.getSession('sess-1');
    const after = Date.now();

    expect(chain.update).toHaveBeenCalledTimes(1);
    const arg = chain.update.mock.calls[0][0];
    expect(arg.expires_at).toBeInstanceOf(Date);
    expect(arg.expires_at.getTime()).toBeGreaterThanOrEqual(before + SESSION_TTL_MS);
    expect(arg.expires_at.getTime()).toBeLessThanOrEqual(after + SESSION_TTL_MS);
  });

  test('does NOT touch expires_at when the session is missing/expired', async () => {
    mockFirstResult = undefined;
    const s = await schedulerSession.getSession('gone');
    expect(s).toBeNull();
    expect(chain.update).not.toHaveBeenCalled();
  });

  test('filters expired rows in the query (expires_at > now)', async () => {
    mockFirstResult = makeRow();
    await schedulerSession.getSession('sess-1');
    const expiryFilter = chain.where.mock.calls.find((c) => c[0] === 'expires_at');
    expect(expiryFilter).toBeDefined();
    expect(expiryFilter[1]).toBe('>');
    expect(expiryFilter[2]).toBeInstanceOf(Date);
  });

  test('passes through JSON columns the driver already parsed (non-string)', async () => {
    mockFirstResult = makeRow({
      snapshots: makeSteps(),           // objects, not JSON strings
      tasks_by_id: { t1: { id: 't1' } },
      unplaced: [],
      score: { total: 5 },
      warnings: [],
      slack_by_task_id: { t1: 42 }
    });
    const s = await schedulerSession.getSession('sess-1');
    expect(s.snapshots).toHaveLength(2);
    expect(s.tasksById.t1.id).toBe('t1');
    expect(s.score).toEqual({ total: 5 });
    expect(s.slackByTaskId).toEqual({ t1: 42 });
  });
});

describe('getStep — DB-backed step enrichment', () => {
  test('returns the enriched step: phase, task detail, slackMins, upcoming preview', async () => {
    mockFirstResult = makeRow();
    const step = await schedulerSession.getStep('sess-1', 0);

    expect(step.phase).toBe('V2: Immovable');
    expect(step.totalSteps).toBe(2);
    expect(step.task).toMatchObject({ id: 't1', text: 'Alpha', slackMins: 42 });
    expect(step.upcoming).toHaveLength(1);
    expect(step.upcoming[0]).toEqual({
      stepIndex: 1, phase: 'V2: Constrained', taskId: 't2', taskText: 'Beta', orderingSlack: 120
    });
  });

  test('task is null (not a crash) when the step references an unknown taskId', async () => {
    mockFirstResult = makeRow();
    const step = await schedulerSession.getStep('sess-1', 1); // t2 not in tasks_by_id
    expect(step.phase).toBe('V2: Constrained');
    expect(step.task).toBeNull();
  });

  test('returns null when the session is missing', async () => {
    mockFirstResult = undefined;
    await expect(schedulerSession.getStep('gone', 0)).resolves.toBeNull();
  });

  test('returns null for an out-of-range step index', async () => {
    mockFirstResult = makeRow();
    await expect(schedulerSession.getStep('sess-1', 99)).resolves.toBeNull();
  });
});

describe('getSummary — DB-backed summary projection', () => {
  test('builds the lightweight queue: one entry per step, placement stripped to {dateKey,start,dur}', async () => {
    mockFirstResult = makeRow();
    const summary = await schedulerSession.getSummary('sess-1');

    expect(summary.sessionId).toBe('sess-1');
    expect(summary.totalSteps).toBe(2);
    expect(summary.queue).toHaveLength(2);
    // Heavy per-step snapshot fields stripped; placement projected to 3 fields.
    expect(summary.queue[0].placement).toEqual({ dateKey: '2026-07-09', start: 540, dur: 60 });
    expect(summary.queue[1].placement).toBeNull();
    expect(summary.score).toEqual({ total: 5 });
  });

  test('returns null when the session is missing', async () => {
    mockFirstResult = undefined;
    await expect(schedulerSession.getSummary('gone')).resolves.toBeNull();
  });
});

describe('stopSession', () => {
  test('deletes the addressed session row', async () => {
    await schedulerSession.stopSession('sess-1');
    expect(db).toHaveBeenCalledWith('scheduler_sessions');
    expect(chain.where).toHaveBeenCalledWith('session_id', 'sess-1');
    expect(chain.delete).toHaveBeenCalledTimes(1);
  });
});
