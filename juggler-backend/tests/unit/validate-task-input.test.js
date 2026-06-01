'use strict';

/**
 * Unit tests for validateTaskInput + createTask 400 path
 *
 * ZOE-JUG-019: validateTaskInput({placementMode:'bogus_mode'}) returns error /is not valid/i
 * ZOE-JUG-018: POST /api/tasks with placementMode:'bogus_mode' → 400 (via createTask unit test)
 */

// ── Mock all heavy dependencies so we can load task.controller in isolation ──

jest.mock('../../src/db', () => {
  const fn = { now: () => 'MOCK_NOW' };
  const mock = () => mock;
  mock.fn = fn;
  mock.raw = jest.fn(() => Promise.resolve([]));
  return mock;
});

jest.mock('@raike/lib-logger', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const factory = jest.fn(() => logger);
  factory.createLogger = factory;
  return factory;
});

jest.mock('../../src/lib/redis', () => ({
  get: jest.fn(), set: jest.fn(), del: jest.fn(),
}));

jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
}));

jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn(), on: jest.fn(),
}));

jest.mock('../../src/lib/task-write-queue', () => ({
  isLocked: jest.fn(() => false),
  enqueueWrite: jest.fn(),
  splitFields: jest.fn(() => []),
  flushQueue: jest.fn(),
}));

jest.mock('../../src/lib/tasks-write', () => ({
  writeTask: jest.fn(), writeTasks: jest.fn(),
}));

jest.mock('../../../shared/scheduler/expandRecurring', () => ({
  isAnchorDependentRecur: jest.fn(() => false),
}));

jest.mock('../../src/lib/placementModes', () => ({
  PLACEMENT_MODES: { AUTO: 'auto', FIXED: 'fixed', FLOATING: 'floating', TIME_WINDOW: 'time_window' },
}));

jest.mock('../../src/lib/task-status', () => ({
  TERMINAL_STATUSES: ['done', 'cancelled'],
  isTerminalStatus: jest.fn((s) => ['done', 'cancelled'].includes(s)),
}));

jest.mock('../../src/lib/rolling-anchor', () => ({
  isRollingMaster: jest.fn(() => false),
  computeRollingAnchor: jest.fn(() => null),
}));

const { validateTaskInput, createTask } = require('../../src/controllers/task.controller');

// ═══════════════════════════════════════════════════════════════════════════
// ZOE-JUG-019 — validateTaskInput({placementMode:'bogus_mode'}) unit test
// ═══════════════════════════════════════════════════════════════════════════

describe('validateTaskInput — placementMode enum validation (ZOE-JUG-019)', () => {
  test('bogus_mode returns error matching /is not valid/i', () => {
    const errors = validateTaskInput({ placementMode: 'bogus_mode' });
    expect(errors.length).toBeGreaterThan(0);
    const hasInvalidMsg = errors.some((e) => /is not valid/i.test(e));
    expect(hasInvalidMsg).toBe(true);
  });

  test('valid mode "auto" returns no placementMode error', () => {
    const errors = validateTaskInput({ text: 'test', placementMode: 'auto' });
    const hasPlacementError = errors.some((e) => /placementMode/i.test(e));
    expect(hasPlacementError).toBe(false);
  });

  test('valid mode "fixed" with date returns no placementMode error', () => {
    const errors = validateTaskInput({ text: 'test', placementMode: 'fixed', date: '2026-06-01', time: '10:00 AM' });
    const hasPlacementModeErr = errors.some((e) => /is not valid/i.test(e));
    expect(hasPlacementModeErr).toBe(false);
  });

  test('undefined placementMode skips validation entirely', () => {
    const errors = validateTaskInput({ text: 'test' });
    const hasPlacementError = errors.some((e) => /placementMode/i.test(e));
    expect(hasPlacementError).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ZOE-JUG-018 — POST /api/tasks with bogus placementMode → 400
// ═══════════════════════════════════════════════════════════════════════════

describe('createTask HTTP handler — bogus placementMode returns 400 (ZOE-JUG-018)', () => {
  function makeReqRes(body) {
    const req = { body: { ...body }, user: { id: 'user-1' }, headers: {} };
    const res = {};
    const calls = [];
    res.status = (code) => {
      calls.push({ code });
      res._code = code;
      return { json: (b) => { res._body = b; } };
    };
    res.json = (b) => { res._body = b; };
    return { req, res };
  }

  test('placementMode:bogus_mode → 400 with error message', async () => {
    const { req, res } = makeReqRes({ text: 'Test task', placementMode: 'bogus_mode' });
    await createTask(req, res);
    expect(res._code).toBe(400);
    expect(res._body).toBeDefined();
    expect(res._body.error).toMatch(/is not valid/i);
  });

  test('missing text → 400 (validates _requireText path)', async () => {
    const { req, res } = makeReqRes({ dur: 30 });
    await createTask(req, res);
    expect(res._code).toBe(400);
  });
});
