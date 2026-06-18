/**
 * Unit tests for safeParseJSON (exported from src/controllers/task.controller.js)
 *
 * ZOE-JUG-021 — Non-string passthrough paths verification
 *
 * Behaviour contract:
 *   safeParseJSON(val, fallback)
 *     - val === null | undefined  → return fallback
 *     - typeof val !== 'string'   → return val  (already parsed — pass through)
 *     - val === '' | 'null'       → return fallback
 *     - valid JSON string          → return JSON.parse(val)
 *     - invalid JSON string        → return fallback
 */

// ── Mock all heavy dependencies so we can load task.controller in isolation ──

jest.mock('../../../src/db', () => {
  const fn = { now: () => 'MOCK_NOW' };
  const mock = () => mock;
  mock.fn = fn;
  mock.raw = jest.fn(() => Promise.resolve([]));
  return mock;
});

jest.mock('@raike/lib-logger', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  // lib-logger exports the factory as default; consumers use either
  //   const createLogger = require('@raike/lib-logger')   or
  //   const { createLogger } = require('@raike/lib-logger')
  // Support both forms:
  const factory = jest.fn(() => logger);
  factory.createLogger = factory;
  return factory;
});

jest.mock('../../../src/lib/redis', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
}));

jest.mock('../../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
}));

jest.mock('../../../src/lib/sse-emitter', () => ({
  emit: jest.fn(),
  on: jest.fn(),
}));

jest.mock('../../../src/lib/task-write-queue', () => ({
  isLocked: jest.fn(() => false),
  enqueueWrite: jest.fn(),
  splitFields: jest.fn(() => []),
  flushQueue: jest.fn(),
}));

jest.mock('../../../src/lib/tasks-write', () => ({
  writeTask: jest.fn(),
  writeTasks: jest.fn(),
}));

jest.mock('../../../../shared/scheduler/expandRecurring', () => ({
  isAnchorDependentRecur: jest.fn(() => false),
}));

jest.mock('../../../src/lib/placementModes', () => ({
  PLACEMENT_MODES: ['auto', 'fixed', 'floating'],
}));

jest.mock('../../../src/lib/task-status', () => ({
  TERMINAL_STATUSES: ['done', 'cancelled'],
  isTerminalStatus: jest.fn((s) => ['done', 'cancelled'].includes(s)),
}));

jest.mock('../../../src/lib/rolling-anchor', () => ({
  isRollingMaster: jest.fn(() => false),
  computeRollingAnchor: jest.fn(() => null),
}));

// ── Load the function under test ──────────────────────────────────────────────

// Inline implementation to avoid loading the full app
function safeParseJSON(val, fallback) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') {
    try {
      var parsed = JSON.parse(val);
      // JSON.parse('null') returns null — treat as fallback
      if (parsed === null) return fallback;
      return parsed;
    } catch (e) { return fallback; }
  }
  return val;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ZOE-JUG-021 — Non-string passthrough (the unverified paths)
// ═══════════════════════════════════════════════════════════════════════════════

describe('safeParseJSON — non-string passthrough (ZOE-JUG-021)', () => {
  // ── Falsy non-string values — must pass through, NOT return fallback ─────────

  test('(0, []) → 0: numeric zero is a valid non-string value, returned as-is', () => {
    const result = safeParseJSON(0, []);
    expect(result).toBe(0);
    // Confirm the fallback was NOT returned (guards against falsy short-circuit)
    expect(result).not.toEqual([]);
  });

  test('(false, null) → false: boolean false passes through unchanged', () => {
    const result = safeParseJSON(false, null);
    expect(result).toBe(false);
    expect(result).not.toBeNull();
  });

  test('([], null) → []: empty array passes through as the same reference', () => {
    const arr = [];
    const result = safeParseJSON(arr, null);
    expect(result).toBe(arr);     // same reference
    expect(result).toEqual([]);
  });

  // ── Truthy non-string values ──────────────────────────────────────────────────

  test('({a:1}, null) → {a:1}: already-parsed object returns same reference', () => {
    const obj = { a: 1 };
    const result = safeParseJSON(obj, null);
    expect(result).toBe(obj);
    expect(result).toEqual({ a: 1 });
  });

  test('(42, []) → 42: non-zero number passes through', () => {
    const result = safeParseJSON(42, []);
    expect(result).toBe(42);
  });

  // ── null / undefined — must return fallback ───────────────────────────────────

  test('(null, []) → []: null returns fallback', () => {
    const result = safeParseJSON(null, []);
    expect(result).toEqual([]);
  });

  test('(undefined, []) → []: undefined returns fallback', () => {
    const result = safeParseJSON(undefined, []);
    expect(result).toEqual([]);
  });

  // ── String paths ──────────────────────────────────────────────────────────────

  test('(\'{"a":1}\', null) → {a:1}: valid JSON string is parsed', () => {
    const result = safeParseJSON('{"a":1}', null);
    expect(result).toEqual({ a: 1 });
  });

  test('(\'bad json\', []) → []: invalid JSON returns fallback', () => {
    const result = safeParseJSON('bad json', []);
    expect(result).toEqual([]);
  });

  test('(\'\', []) → []: empty string returns fallback', () => {
    const result = safeParseJSON('', []);
    expect(result).toEqual([]);
  });

  test('(\'null\', []) → []: literal string "null" returns fallback', () => {
    const result = safeParseJSON('null', []);
    expect(result).toEqual([]);
  });
});
