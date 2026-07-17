/**
 * Unit tests for cal-sync-helpers.js
 *
 * NOTE (999.1025 inc. 4): the terminal-status DECISION was lifted out of the old
 * impure `handleTerminalTaskSync` into the pure use-case
 * src/slices/calendar/domain/terminal-task-decision.js — see its decision-table
 * unit test at tests/cal-sync/terminal-task-decision.unit.test.js. The
 * deleteEvent effect now lives at the controller call site (covered DB-backed by
 * W4 axes D/D2/T). This file now covers only the pure `isTerminalForSync`
 * classifier that remains here.
 */

var { isTerminalForSync } = require('../../../src/lib/cal-sync-helpers');

describe('cal-sync-helpers', () => {
  describe('isTerminalForSync', () => {
    test('returns true for terminal statuses', () => {
      expect(isTerminalForSync('done')).toBe(true);
      expect(isTerminalForSync('cancel')).toBe(true);
      expect(isTerminalForSync('skip')).toBe(true);
      expect(isTerminalForSync('missed')).toBe(true);
    });

    test('returns false for non-terminal statuses', () => {
      expect(isTerminalForSync('')).toBe(false);
      expect(isTerminalForSync('wip')).toBe(false);
      expect(isTerminalForSync('pending')).toBe(false);
    });
  });
});