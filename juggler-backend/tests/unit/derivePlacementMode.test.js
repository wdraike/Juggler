/**
 * Unit tests for taskToRow placement_mode behaviour after the Phase 09 enum redesign.
 *
 * derivePlacementMode() was removed in plan 09-03. placement_mode is now written
 * ONLY when the client explicitly supplies task.placementMode — the server never
 * derives it from when-content or legacy flags (marker/rigid/recurring).
 *
 * Source: src/controllers/task.controller.js — taskToRow (placement block)
 *
 * ── Phase 09-03 ──────────────────────────────────────────────────────────────
 * This file replaces the old derivePlacementMode.test.js (skipped tests from
 * 09-02). All tests now verify the direct-write path introduced in plan 09-03.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Mock db at require-time so task.controller.js can load without a real DB.
jest.mock('../../src/db', () => {
  const fn = { now: () => 'MOCK_NOW' };
  const mock = jest.fn(() => mock);
  mock.fn = fn;
  mock.where = jest.fn(() => mock);
  mock.whereIn = jest.fn(() => mock);
  mock.select = jest.fn().mockResolvedValue([]);
  return mock;
});

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

const { taskToRow, rowToTask } = require('../../src/controllers/task.controller');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');

// Helper: call taskToRow and return only placement_mode from the resulting row.
function placementFor(fields, currentTask) {
  const row = taskToRow(fields, 'u-test', null, currentTask || null);
  return row.placement_mode;
}

describe('taskToRow — direct-write placement_mode (post-09-03)', () => {
  // ── Direct write: client supplies placementMode ───────────────────────────

  test('writes placement_mode when client supplies placementMode=fixed', () => {
    expect(placementFor({ placementMode: 'fixed' })).toBe('fixed');
  });

  test('writes placement_mode when client supplies placementMode=anytime', () => {
    expect(placementFor({ placementMode: 'anytime' })).toBe('anytime');
  });

  test('writes placement_mode when client supplies placementMode=time_window', () => {
    expect(placementFor({ placementMode: 'time_window' })).toBe('time_window');
  });

  test('writes placement_mode when client supplies placementMode=time_blocks', () => {
    expect(placementFor({ placementMode: 'time_blocks' })).toBe('time_blocks');
  });

  test('writes placement_mode when client supplies placementMode=reminder', () => {
    expect(placementFor({ placementMode: 'reminder' })).toBe('reminder');
  });

  test('writes placement_mode when client supplies placementMode=all_day', () => {
    expect(placementFor({ placementMode: 'all_day' })).toBe('all_day');
  });

  // ── No derivation: without explicit placementMode, row has none ───────────

  test('does NOT set placement_mode when placementMode is absent (no derivation)', () => {
    expect(placementFor({ when: 'morning', recurring: true })).toBeUndefined();
  });

  test('does NOT derive from rigid flag — placementMode must be explicit', () => {
    expect(placementFor({ rigid: true, recurring: false })).toBeUndefined();
  });

  test('does NOT derive from when containing old fixed-like strings', () => {
    // After migration, 'fixed' never appears in `when`; and even if it did, the
    // server no longer inspects when-content to derive placement_mode.
    expect(placementFor({ when: 'fixed-08:00' })).toBeUndefined();
  });

  test('does NOT derive from marker flag', () => {
    expect(placementFor({ marker: true })).toBeUndefined();
  });

  test('does NOT derive from recurring+preferredTimeMins without explicit placementMode', () => {
    expect(placementFor({ recurring: true, preferredTimeMins: 480 })).toBeUndefined();
  });

  // ── placementMode takes priority over all other fields ────────────────────

  test('explicit placementMode wins even when other legacy flags are present', () => {
    // Passes both old-style flags and an explicit placementMode — only
    // placementMode should land in the row.
    expect(placementFor({
      placementMode: 'time_window',
      rigid: true,
      recurring: true,
      preferredTimeMins: 480,
      when: 'morning'
    })).toBe('time_window');
  });
});

describe('rowToTask — placement_mode passthrough (post-C1-fix)', () => {
  // placement_mode is NOT NULL in the DB; rowToTask passes it through as-is.
  // A missing/null value indicates a data integrity problem — rowToTask does
  // not paper over it with a fallback.
  test('passes through absent placement_mode key from DB row as-is (placementMode is undefined)', () => {
    const task = rowToTask({ text: 'Test' }, null);
    expect(task.placementMode).toBeUndefined();
  });

  test('passes through null placement_mode from DB row as-is (placementMode is null)', () => {
    const task = rowToTask({ text: 'Test', placement_mode: null }, null);
    expect(task.placementMode).toBeNull();
  });

  test('passes through empty string placement_mode from DB row as-is', () => {
    const task = rowToTask({ placement_mode: '' }, null);
    expect(task.placementMode).toBe('');
  });

  test('preserves explicit placement_mode from DB row', () => {
    const task = rowToTask({ placement_mode: 'fixed' }, null);
    expect(task.placementMode).toBe('fixed');
  });
});
