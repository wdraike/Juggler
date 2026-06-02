/**
 * Unit tests for TaskWriterService
 */

const TaskWriterService = require('../../src/services/task-writer.service');

describe('TaskWriterService', () => {
  describe('canTransitionToTerminal', () => {
    test('allows non-terminal status transitions', () => {
      const result = TaskWriterService.canTransitionToTerminal(
        { id: 'task1', scheduled_at: null },
        'wip'
      );
      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
    });

    test('blocks terminal status without scheduled_at', () => {
      const result = TaskWriterService.canTransitionToTerminal(
        { id: 'task2', scheduled_at: null },
        'done'
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Cannot mark task done without a scheduled time');
      expect(result.code).toBe('SCHEDULE_REQUIRED_FOR_TERMINAL_STATUS');
    });

    test('allows terminal status with scheduled_at', () => {
      const result = TaskWriterService.canTransitionToTerminal(
        { id: 'task3', scheduled_at: '2026-06-01T10:00:00Z' },
        'done'
      );
      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
    });

    test('allows pause status without scheduled_at', () => {
      const result = TaskWriterService.canTransitionToTerminal(
        { id: 'task4', scheduled_at: null },
        'pause'
      );
      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
    });

    test('allows terminal status with allowUnscheduled override', () => {
      const result = TaskWriterService.canTransitionToTerminal(
        { id: 'task5', scheduled_at: null },
        'done',
        { allowUnscheduled: true }
      );
      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
    });

    test('blocks skip without scheduled_at', () => {
      const result = TaskWriterService.canTransitionToTerminal(
        { id: 'task6', scheduled_at: null },
        'skip'
      );
      expect(result.valid).toBe(false);
      expect(result.code).toBe('SCHEDULE_REQUIRED_FOR_TERMINAL_STATUS');
    });

    test('blocks cancel without scheduled_at', () => {
      const result = TaskWriterService.canTransitionToTerminal(
        { id: 'task7', scheduled_at: null },
        'cancel'
      );
      expect(result.valid).toBe(false);
      expect(result.code).toBe('SCHEDULE_REQUIRED_FOR_TERMINAL_STATUS');
    });
  });
});