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
  // STATUS_OPTIONS is required by the TaskStatus value-object the facade now
  // loads through the domain index (slices/task/domain/value-objects/TaskStatus).
  STATUS_OPTIONS: ['', 'done', 'cancelled', 'skip', 'pause', 'disabled'],
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
// 999.586 — JSON-field shape validation (recur.days / monthDays / timesPerCycle,
// and depends_on / location / tools array-of-string shape). EXISTENCE of
// referenced IDs is DB-backed and tested separately (validateReferences).
// ═══════════════════════════════════════════════════════════════════════════

describe('validateTaskInput — recur.days shape (999.586)', () => {
  test('valid day-code string "MTWRF" → no days error', () => {
    const errors = validateTaskInput({ text: 't', recur: { type: 'weekly', days: 'MTWRF' } });
    expect(errors.some((e) => /days/i.test(e))).toBe(false);
  });

  test('valid full-week string "MTWRFSU" → no days error', () => {
    const errors = validateTaskInput({ text: 't', recur: { type: 'weekly', days: 'MTWRFSU' } });
    expect(errors.some((e) => /days/i.test(e))).toBe(false);
  });

  test('valid days object { M:"required" } → no days error', () => {
    const errors = validateTaskInput({ text: 't', recur: { type: 'weekly', days: { M: 'required', W: 'optional' } } });
    expect(errors.some((e) => /days/i.test(e))).toBe(false);
  });

  test('invalid day code "XYZ" string → days error', () => {
    const errors = validateTaskInput({ text: 't', recur: { type: 'weekly', days: 'XYZ' } });
    expect(errors.some((e) => /days/i.test(e))).toBe(true);
  });

  test('days as an array (wrong type) → days error', () => {
    const errors = validateTaskInput({ text: 't', recur: { type: 'weekly', days: ['M', 'W'] } });
    expect(errors.some((e) => /days/i.test(e))).toBe(true);
  });

  test('days object with bad key { Q:"x" } → days error', () => {
    const errors = validateTaskInput({ text: 't', recur: { type: 'weekly', days: { Q: 'x' } } });
    expect(errors.some((e) => /days/i.test(e))).toBe(true);
  });
});

describe('validateTaskInput — recur.monthDays shape (999.586)', () => {
  test('valid [1, 15] → no monthDays error', () => {
    const errors = validateTaskInput({ text: 't', recur: { type: 'monthly', monthDays: [1, 15] } });
    expect(errors.some((e) => /monthDays/i.test(e))).toBe(false);
  });

  test('out-of-range [0, 32] → monthDays error', () => {
    const errors = validateTaskInput({ text: 't', recur: { type: 'monthly', monthDays: [0, 32] } });
    expect(errors.some((e) => /monthDays/i.test(e))).toBe(true);
  });

  test('non-array monthDays → monthDays error', () => {
    const errors = validateTaskInput({ text: 't', recur: { type: 'monthly', monthDays: 15 } });
    expect(errors.some((e) => /monthDays/i.test(e))).toBe(true);
  });

  test("'first'/'last' literals are valid (scheduler consumes them) — ernie WARN-1", () => {
    const errors = validateTaskInput({ text: 't', recur: { type: 'monthly', monthDays: ['first', 'last'] } });
    expect(errors.some((e) => /monthDays/i.test(e))).toBe(false);
  });

  test("mixed [1, 'last', 15] → no monthDays error", () => {
    const errors = validateTaskInput({ text: 't', recur: { type: 'monthly', monthDays: [1, 'last', 15] } });
    expect(errors.some((e) => /monthDays/i.test(e))).toBe(false);
  });

  test("bad literal ['middle'] → monthDays error", () => {
    const errors = validateTaskInput({ text: 't', recur: { type: 'monthly', monthDays: ['middle'] } });
    expect(errors.some((e) => /monthDays/i.test(e))).toBe(true);
  });
});

describe('validateTaskInput — recur.timesPerCycle (999.586)', () => {
  test('valid positive integer 3 → no error', () => {
    const errors = validateTaskInput({ text: 't', recur: { type: 'weekly', timesPerCycle: 3 } });
    expect(errors.some((e) => /timesPerCycle/i.test(e))).toBe(false);
  });

  test('zero → timesPerCycle error', () => {
    const errors = validateTaskInput({ text: 't', recur: { type: 'weekly', timesPerCycle: 0 } });
    expect(errors.some((e) => /timesPerCycle/i.test(e))).toBe(true);
  });

  test('non-integer 2.5 → timesPerCycle error', () => {
    const errors = validateTaskInput({ text: 't', recur: { type: 'weekly', timesPerCycle: 2.5 } });
    expect(errors.some((e) => /timesPerCycle/i.test(e))).toBe(true);
  });
});

describe('validateTaskInput — dependsOn / location / tools array shape (999.586)', () => {
  test('valid string arrays → no shape error', () => {
    const errors = validateTaskInput({ text: 't', dependsOn: ['a', 'b'], location: ['home'], tools: ['phone'] });
    expect(errors.some((e) => /dependsOn|location|tools/i.test(e))).toBe(false);
  });

  test('empty arrays are valid (clear the field)', () => {
    const errors = validateTaskInput({ text: 't', dependsOn: [], location: [], tools: [] });
    expect(errors.some((e) => /dependsOn|location|tools/i.test(e))).toBe(false);
  });

  test('dependsOn not an array → error', () => {
    const errors = validateTaskInput({ text: 't', dependsOn: 'task-1' });
    expect(errors.some((e) => /dependsOn/i.test(e))).toBe(true);
  });

  test('location with a non-string element → error', () => {
    const errors = validateTaskInput({ text: 't', location: ['home', 42] });
    expect(errors.some((e) => /location/i.test(e))).toBe(true);
  });

  test('tools with an empty-string element → error', () => {
    const errors = validateTaskInput({ text: 't', tools: ['phone', '  '] });
    expect(errors.some((e) => /tools/i.test(e))).toBe(true);
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

// ═══════════════════════════════════════════════════════════════════════════
// 999.558 — validateEarliestStartDeadlineCrossField: partial-patch cross-field
// validation that merges body fields with existing row values.
// ═══════════════════════════════════════════════════════════════════════════

const { validateEarliestStartDeadlineCrossField } = require('../../src/slices/task/domain/validation/taskValidation');

describe('validateEarliestStartDeadlineCrossField — 999.558', () => {
  test('earliestStart > deadline in body alone → error', () => {
    const err = validateEarliestStartDeadlineCrossField(
      { earliestStart: '2026-07-01', deadline: '2026-06-15' },
      null
    );
    expect(err).toBe('Deadline must be on or after earliest start date');
  });

  test('earliestStart === deadline in body alone → null (valid)', () => {
    const err = validateEarliestStartDeadlineCrossField(
      { earliestStart: '2026-06-15', deadline: '2026-06-15' },
      null
    );
    expect(err).toBeNull();
  });

  test('earliestStart < deadline in body alone → null (valid)', () => {
    const err = validateEarliestStartDeadlineCrossField(
      { earliestStart: '2026-06-01', deadline: '2026-06-15' },
      null
    );
    expect(err).toBeNull();
  });

  test('body.earliestStart > existing.deadline → error (partial patch)', () => {
    const err = validateEarliestStartDeadlineCrossField(
      { earliestStart: '2026-07-01' },
      { deadline: new Date('2026-06-15'), start_after_at: new Date('2026-06-01') }
    );
    expect(err).toBe('Deadline must be on or after earliest start date');
  });

  test('body.deadline < existing.start_after_at → error (partial patch)', () => {
    const err = validateEarliestStartDeadlineCrossField(
      { deadline: '2026-06-10' },
      { start_after_at: new Date('2026-06-15'), deadline: new Date('2026-06-30') }
    );
    expect(err).toBe('Deadline must be on or after earliest start date');
  });

  test('body.earliestStart < existing.deadline → null (valid partial patch)', () => {
    const err = validateEarliestStartDeadlineCrossField(
      { earliestStart: '2026-06-01' },
      { deadline: new Date('2026-06-15'), start_after_at: new Date('2026-05-01') }
    );
    expect(err).toBeNull();
  });

  test('body.deadline > existing.start_after_at → null (valid partial patch)', () => {
    const err = validateEarliestStartDeadlineCrossField(
      { deadline: '2026-07-01' },
      { start_after_at: new Date('2026-06-15'), deadline: new Date('2026-06-20') }
    );
    expect(err).toBeNull();
  });

  test('both fields absent, no existing → null', () => {
    const err = validateEarliestStartDeadlineCrossField({}, null);
    expect(err).toBeNull();
  });

  test('body.earliestStart empty string, existing has values → null (clearing earliestStart)', () => {
    const err = validateEarliestStartDeadlineCrossField(
      { earliestStart: '' },
      { start_after_at: new Date('2026-07-01'), deadline: new Date('2026-06-15') }
    );
    expect(err).toBeNull();
  });

  test('body.deadline null, existing has values → null (clearing deadline)', () => {
    const err = validateEarliestStartDeadlineCrossField(
      { deadline: null },
      { start_after_at: new Date('2026-07-01'), deadline: new Date('2026-06-15') }
    );
    expect(err).toBeNull();
  });

  test('existing has start_after_at but no deadline → null (no comparison possible)', () => {
    const err = validateEarliestStartDeadlineCrossField(
      {},
      { start_after_at: new Date('2026-06-01') }
    );
    expect(err).toBeNull();
  });

  test('existing has deadline but no start_after_at, body has earliestStart → error if earliestStart > existing.deadline', () => {
    const err = validateEarliestStartDeadlineCrossField(
      { earliestStart: '2026-07-01' },
      { deadline: new Date('2026-06-15') }
    );
    expect(err).toBe('Deadline must be on or after earliest start date');
  });

  test('invalid dates are silently ignored → null', () => {
    const err = validateEarliestStartDeadlineCrossField(
      { earliestStart: 'not-a-date', deadline: '2026-06-15' },
      null
    );
    expect(err).toBeNull();
  });

  test('neither field in body → null (no retroactive check on existing data)', () => {
    const err = validateEarliestStartDeadlineCrossField(
      { text: 'just a text edit' },
      { start_after_at: new Date('2026-07-01'), deadline: new Date('2026-06-15') }
    );
    expect(err).toBeNull();
  });
});
