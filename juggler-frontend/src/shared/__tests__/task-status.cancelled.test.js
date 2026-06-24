/**
 * 'cancelled' is a real backend status (tasks-write.js cancel path; the scheduler
 * already treats it terminal). The frontend status library was missing it entirely,
 * so cancelled tasks were treated as ACTIVE and leaked into the Issues page as
 * overdue/past-due/unplaced. Lock it as a valid, terminal status.
 */
import { isTerminalStatus, isValidTaskStatus, isActiveStatus, TERMINAL_STATUSES } from '../task-status';

describe("'cancelled' status", () => {
  test('is terminal', () => {
    expect(isTerminalStatus('cancelled')).toBe(true);
    expect(TERMINAL_STATUSES).toContain('cancelled');
  });
  test('is a valid status', () => {
    expect(isValidTaskStatus('cancelled')).toBe(true);
  });
  test('is not active', () => {
    expect(isActiveStatus('cancelled')).toBe(false);
  });
  test("distinct from 'cancel' but both terminal", () => {
    expect(isTerminalStatus('cancel')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
  });
});
