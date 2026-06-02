const { TERMINAL_STATUSES, isTerminalStatus, STATUS_OPTIONS, canTransition, isActiveStatus, ACTIVE_STATUSES } = require('../../src/lib/task-status');

describe('Task Status Library Tests', () => {
  test('TERMINAL_STATUSES contains missed', () => {
    expect(TERMINAL_STATUSES).toContain('missed');
  });

  test('isTerminalStatus returns true for missed', () => {
    expect(isTerminalStatus('missed')).toBe(true);
  });

  test('isTerminalStatus returns false for wip', () => {
    expect(isTerminalStatus('wip')).toBe(false);
  });

  test('isTerminalStatus returns true for other terminal statuses', () => {
    expect(isTerminalStatus('done')).toBe(true);
    expect(isTerminalStatus('cancel')).toBe(true);
    expect(isTerminalStatus('skip')).toBe(true);
    expect(isTerminalStatus('pause')).toBe(true);
  });

  describe('STATUS_OPTIONS', () => {
    test('STATUS_OPTIONS contains all valid statuses', () => {
      expect(STATUS_OPTIONS).toEqual([
        '', 'wip', 'done', 'cancel', 'skip', 'pause', 'missed', 'archived', 'restored'
      ]);
    });

    test('STATUS_OPTIONS has correct length', () => {
      expect(STATUS_OPTIONS.length).toBe(9);
    });
  });

  describe('ACTIVE_STATUSES', () => {
    test('ACTIVE_STATUSES contains correct active statuses', () => {
      expect(ACTIVE_STATUSES).toEqual(['', 'wip']);
    });

    test('ACTIVE_STATUSES has correct length', () => {
      expect(ACTIVE_STATUSES.length).toBe(2);
    });
  });

  describe('isActiveStatus', () => {
    test('isActiveStatus returns true for active statuses', () => {
      expect(isActiveStatus('')).toBe(true);
      expect(isActiveStatus('wip')).toBe(true);
    });

    test('isActiveStatus returns false for terminal statuses', () => {
      expect(isActiveStatus('done')).toBe(false);
      expect(isActiveStatus('cancel')).toBe(false);
      expect(isActiveStatus('skip')).toBe(false);
      expect(isActiveStatus('pause')).toBe(false);
      expect(isActiveStatus('missed')).toBe(false);
    });

    test('isActiveStatus returns false for other non-active statuses', () => {
      expect(isActiveStatus('archived')).toBe(false);
      expect(isActiveStatus('restored')).toBe(false);
    });

    test('isActiveStatus returns false for null and undefined', () => {
      expect(isActiveStatus(null)).toBe(false);
      expect(isActiveStatus(undefined)).toBe(false);
    });

    test('isActiveStatus returns false for invalid status values', () => {
      expect(isActiveStatus('invalid')).toBe(false);
      expect(isActiveStatus('')).toBe(true); // empty string is valid active status
    });
  });

  describe('canTransition', () => {
    test('canTransition returns true for valid transitions from EMPTY', () => {
      ['done', 'wip', 'skip', 'cancel', 'pause'].forEach(newStatus => {
        expect(canTransition('', newStatus)).toBe(true);
      });
    });

    test('canTransition returns false for invalid transitions from EMPTY', () => {
      ['missed', 'archived', 'restored', 'invalid'].forEach(newStatus => {
        expect(canTransition('', newStatus)).toBe(false);
      });
    });

    test('canTransition returns true for valid transitions from WIP', () => {
      ['done', '', 'skip', 'cancel'].forEach(newStatus => {
        expect(canTransition('wip', newStatus)).toBe(true);
      });
    });

    test('canTransition returns false for invalid transitions from WIP', () => {
      ['pause', 'missed', 'archived', 'restored', 'invalid'].forEach(newStatus => {
        expect(canTransition('wip', newStatus)).toBe(false);
      });
    });

    test('canTransition returns false for transitions from terminal statuses', () => {
      ['done', 'cancel', 'skip', 'pause', 'missed'].forEach(currentStatus => {
        ['', 'wip', 'done', 'cancel'].forEach(newStatus => {
          expect(canTransition(currentStatus, newStatus)).toBe(false);
        });
      });
    });

    test('canTransition returns false for invalid status values', () => {
      expect(canTransition('invalid', 'done')).toBe(false);
      expect(canTransition('', 'invalid')).toBe(false);
      expect(canTransition(null, 'done')).toBe(false);
      expect(canTransition('wip', null)).toBe(false);
      expect(canTransition(undefined, 'done')).toBe(false);
      expect(canTransition('wip', undefined)).toBe(false);
    });

    test('canTransition handles edge cases correctly', () => {
      // Same status transitions should be false (except for special cases)
      expect(canTransition('', '')).toBe(false);
      expect(canTransition('wip', 'wip')).toBe(false);
      expect(canTransition('done', 'done')).toBe(false);

      // EMPTY to WIP and back should work
      expect(canTransition('', 'wip')).toBe(true);
      expect(canTransition('wip', '')).toBe(true);
    });
  });
});