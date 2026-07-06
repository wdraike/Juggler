/**
 * 999.844/999.1294 — 'missed' is a system-applied (not user-selectable) status
 * that must be treated as terminal, so calendar-sync cleans up its events. The
 * frontend's hand-copied task-status.js fork never learned this (canonical
 * shared/task-status.js added it via 999.1162); the fork is now a re-export
 * shim, so this locks the terminal classification in one place.
 */
import { isTerminalStatus, isValidTaskStatus, isActiveStatus, TERMINAL_STATUSES, TASK_STATUSES } from '../task-status';

describe("'missed' status", () => {
  test('is terminal', () => {
    expect(isTerminalStatus('missed')).toBe(true);
    expect(TERMINAL_STATUSES).toContain('missed');
  });
  test('is not a user-selectable/valid task status (system-only)', () => {
    expect(isValidTaskStatus('missed')).toBe(false);
    expect(TASK_STATUSES).not.toContain('missed');
  });
  test('is not active', () => {
    expect(isActiveStatus('missed')).toBe(false);
  });
});
