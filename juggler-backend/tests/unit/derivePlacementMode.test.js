/**
 * Unit tests for derivePlacementMode — the internal helper in task.controller.js.
 *
 * derivePlacementMode is NOT exported from task.controller; it is exercised via
 * taskToRow (which IS exported). We drive it by passing task fields that trigger
 * the placement-mode re-derivation path in taskToRow (any field in
 * PLACEMENT_TRIGGER_FIELDS: marker, rigid, when, recurring, preferredTimeMins,
 * placementMode).
 *
 * Source: src/controllers/task.controller.js lines 103–112 (derivePlacementMode)
 * and lines 547–561 (taskToRow integration).
 *
 * IMPORTANT: PINNED_DATE is present in PLACEMENT_MODES but derivePlacementMode
 * never returns it — datePinned is handled by the caller (taskToRow / the route
 * handlers) through a separate code path. These tests cover the 6 modes that
 * derivePlacementMode actually returns plus two FIXED paths (when-string and
 * rigid+!recurring).
 */

// Mock db at require-time so that task.controller.js can be required in a
// unit-test context without a real database connection.
jest.mock('../../src/db', () => {
  const fn = { now: () => 'MOCK_NOW' };
  const mock = jest.fn(() => mock);
  mock.fn = fn;
  // Provide enough of the chain interface that any incidental DB calls don't
  // explode (they should not be reached for taskToRow, but safety-net here).
  mock.where = jest.fn(() => mock);
  mock.whereIn = jest.fn(() => mock);
  mock.select = jest.fn().mockResolvedValue([]);
  return mock;
});

// Also stub out side-effect modules that task.controller requires at the
// module level so the require() doesn't crash.
jest.mock('../../src/lib/redis', () => ({
  invalidateTasks: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
}));
jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn(),
}));
jest.mock('../../src/lib/task-write-queue', () => ({
  isLocked: jest.fn().mockReturnValue(false),
  enqueueWrite: jest.fn(),
  splitFields: jest.fn(() => ({ schedulingFields: {}, nonSchedulingFields: {} })),
  flushQueue: jest.fn(),
}));
jest.mock('../../src/lib/tasks-write', () => ({
  updateTaskById: jest.fn().mockResolvedValue(undefined),
}));

const { taskToRow } = require('../../src/controllers/task.controller');

// Helper: call taskToRow with a minimal task that only contains the
// placement-triggering fields of interest. The second argument (userId) is
// required but its value doesn't affect placement_mode derivation.
function placementFor(fields) {
  const row = taskToRow(fields, 'u-test', null, null);
  return row.placement_mode;
}

describe('derivePlacementMode (exercised via taskToRow)', () => {
  // ── Mode: MARKER ─────────────────────────────────────────────────────────
  test('returns MARKER when marker=true', () => {
    expect(placementFor({ marker: true })).toBe('marker');
  });

  // ── Mode: FIXED (via when string) ─────────────────────────────────────────
  test('returns FIXED when when includes "fixed"', () => {
    expect(placementFor({ when: 'fixed-08:00' })).toBe('fixed');
  });

  // ── Mode: FIXED (via rigid + !recurring) ─────────────────────────────────
  // The second code path: isRigid && !recurring → FIXED
  test('returns FIXED when rigid=true and recurring=false', () => {
    expect(placementFor({ rigid: true, recurring: false })).toBe('fixed');
  });

  // ── Mode: RECURRING_RIGID ─────────────────────────────────────────────────
  // recurring + rigid + preferredTimeMins set → RECURRING_RIGID
  test('returns RECURRING_RIGID when recurring=true, rigid=true, preferredTimeMins set', () => {
    expect(placementFor({ recurring: true, rigid: true, preferredTimeMins: 480 })).toBe('recurring_rigid');
  });

  // ── Mode: RECURRING_WINDOW ────────────────────────────────────────────────
  // recurring + preferredTimeMins set (without rigid) → RECURRING_WINDOW
  test('returns RECURRING_WINDOW when recurring=true and preferredTimeMins is a number', () => {
    expect(placementFor({ recurring: true, preferredTimeMins: 600 })).toBe('recurring_window');
  });

  // ── Mode: RECURRING_FLEXIBLE ─────────────────────────────────────────────
  // recurring, no rigid, no preferredTimeMins → RECURRING_FLEXIBLE
  test('returns RECURRING_FLEXIBLE when recurring=true, rigid=false, preferredTimeMins=null', () => {
    expect(placementFor({ recurring: true, rigid: false, preferredTimeMins: null })).toBe('recurring_flexible');
  });

  // ── Mode: FLEXIBLE ────────────────────────────────────────────────────────
  // All placement-trigger fields absent / falsy → FLEXIBLE
  test('returns FLEXIBLE as fallback when no placement constraints set', () => {
    expect(placementFor({ marker: false, when: '', recurring: false })).toBe('flexible');
  });

  // ── Precedence: MARKER beats FIXED ───────────────────────────────────────
  // marker=true is checked first; even if when includes 'fixed' the result
  // must be MARKER (first branch in derivePlacementMode).
  test('MARKER takes precedence over FIXED (marker=true + when includes fixed)', () => {
    expect(placementFor({ marker: true, when: 'fixed-08:00' })).toBe('marker');
  });

  // ── Precedence: FIXED (when) beats RECURRING_RIGID ───────────────────────
  // when string check comes before the recurring block.
  test('FIXED (via when) takes precedence over RECURRING_RIGID', () => {
    // recurring+rigid+ptm would normally yield RECURRING_RIGID but when wins.
    expect(placementFor({ when: 'fixed-09:00', recurring: true, rigid: true, preferredTimeMins: 480 })).toBe('fixed');
  });
});
