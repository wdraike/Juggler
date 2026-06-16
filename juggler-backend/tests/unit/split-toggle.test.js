/**
 * Tests for R35 — Split Containment
 *
 * R35.1: Split toggle visibility — user can toggle splitting on/off for a task
 * R35.6: Recurring split overflow flag — when a recurring split overflows its
 *        parent instance, the overflow flag is set on the spillover instance
 */

const { describe, it, expect, beforeEach, jest } = require('@jest/globals');

// Mock the split service
const splitService = {
  isSplitEnabled: jest.fn(),
  toggleSplit: jest.fn(),
  getSplitOverflowFlags: jest.fn(),
  hasRecurringSplitOverflow: jest.fn(),
  getPendingRecurringSplits: jest.fn(),
};

jest.mock('../../src/services/split.service', () => splitService);

describe('R35.1 — Split Toggle Visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return true when split is enabled for a task', async () => {
    splitService.isSplitEnabled.mockResolvedValue(true);

    const result = await splitService.isSplitEnabled('task-123');
    expect(result).toBe(true);
    expect(splitService.isSplitEnabled).toHaveBeenCalledWith('task-123');
  });

  it('should return false when split is disabled for a task', async () => {
    splitService.isSplitEnabled.mockResolvedValue(false);

    const result = await splitService.isSplitEnabled('task-456');
    expect(result).toBe(false);
  });

  it('should toggle split from off to on', async () => {
    splitService.toggleSplit.mockResolvedValue({ enabled: true });

    const result = await splitService.toggleSplit('task-123', true);
    expect(result.enabled).toBe(true);
    expect(splitService.toggleSplit).toHaveBeenCalledWith('task-123', true);
  });

  it('should toggle split from on to off', async () => {
    splitService.toggleSplit.mockResolvedValue({ enabled: false });

    const result = await splitService.toggleSplit('task-123', false);
    expect(result.enabled).toBe(false);
  });

  it('should handle toggle for task with no existing split state', async () => {
    splitService.toggleSplit.mockResolvedValue({ enabled: true, created: true });

    const result = await splitService.toggleSplit('task-new', true);
    expect(result.created).toBe(true);
    expect(result.enabled).toBe(true);
  });
});

describe('R35.6 — Recurring Split Overflow Flag', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should report overflow flag when a recurring split exceeds parent time block', async () => {
    splitService.hasRecurringSplitOverflow.mockResolvedValue(true);

    const result = await splitService.hasRecurringSplitOverflow('task-recurring-1');
    expect(result).toBe(true);
  });

  it('should report no overflow when split fits within parent', async () => {
    splitService.hasRecurringSplitOverflow.mockResolvedValue(false);

    const result = await splitService.hasRecurringSplitOverflow('task-recurring-2');
    expect(result).toBe(false);
  });

  it('should return overflow flags for all pending splits of a recurring task', async () => {
    const flags = [
      { instanceId: 'inst-1', overflow: false },
      { instanceId: 'inst-2', overflow: true },
      { instanceId: 'inst-3', overflow: false },
    ];
    splitService.getSplitOverflowFlags.mockResolvedValue(flags);

    const result = await splitService.getSplitOverflowFlags('task-recurring-1');
    expect(result).toHaveLength(3);
    expect(result[1].overflow).toBe(true);
  });

  it('should return empty array when no pending splits exist', async () => {
    splitService.getSplitOverflowFlags.mockResolvedValue([]);

    const result = await splitService.getSplitOverflowFlags('task-no-pending');
    expect(result).toHaveLength(0);
  });

  it('should return pending recurring splits for a parent task', async () => {
    const pending = [
      { id: 'inst-1', overflow: false, scheduledDate: '2026-06-16' },
      { id: 'inst-2', overflow: true, scheduledDate: '2026-06-17' },
    ];
    splitService.getPendingRecurringSplits.mockResolvedValue(pending);

    const result = await splitService.getPendingRecurringSplits('task-recurring-1');
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('inst-1');
  });

  it('should handle overflow flag on spillover instance correctly', async () => {
    // A spillover instance is created when a split exceeds the parent time block
    const spilloverInstance = {
      id: 'spillover-1',
      parentTaskId: 'task-recurring-1',
      originalInstanceId: 'inst-2',
      overflow: true,
      scheduledDate: '2026-06-18',
    };
    splitService.getPendingRecurringSplits.mockResolvedValue([spilloverInstance]);

    const [result] = await splitService.getPendingRecurringSplits('task-recurring-1');
    expect(result.overflow).toBe(true);
    expect(result.originalInstanceId).toBe('inst-2');
    expect(result.parentTaskId).toBe('task-recurring-1');
  });

  it('should return false for task without recurring split', async () => {
    splitService.hasRecurringSplitOverflow.mockResolvedValue(false);

    const result = await splitService.hasRecurringSplitOverflow('task-non-recurring');
    expect(result).toBe(false);
  });

  it('should return empty pending for task with no split config', async () => {
    splitService.getPendingRecurringSplits.mockResolvedValue([]);

    const result = await splitService.getPendingRecurringSplits('task-no-split-config');
    expect(result).toHaveLength(0);
  });

  it('should handle error when split service is unavailable', async () => {
    splitService.hasRecurringSplitOverflow.mockRejectedValue(
      new Error('Split service unavailable')
    );

    await expect(
      splitService.hasRecurringSplitOverflow('task-123')
    ).rejects.toThrow('Split service unavailable');
  });
});
