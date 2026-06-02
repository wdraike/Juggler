/**
 * Unit tests for cal-sync-helpers.js
 */

var { handleTerminalTaskSync, isTerminalForSync } = require('../../../src/lib/cal-sync-helpers');
var { isTerminalStatus } = require('../../../src/lib/task-status');

// Mock adapter
var mockAdapter = {
  deleteEvent: jest.fn().mockResolvedValue(true),
  getEventIdColumn: jest.fn().mockReturnValue('provider_event_id')
};

// Mock throttle
var mockThrottle = jest.fn().mockResolvedValue(true);

// Test data
var JUGGLER_ORIGIN = 'juggler';
var task = { id: 'task-1', status: 'done' };
var event = { _url: 'https://calendar.example.com/event/123' };
var ledger = { id: 'ledger-1', origin: JUGGLER_ORIGIN, provider_event_id: 'prov-123' };

describe('cal-sync-helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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

  describe('handleTerminalTaskSync', () => {
    test('returns empty updates for non-terminal tasks', async () => {
      var nonTerminalTask = { id: 'task-2', status: '' };
      var result = await handleTerminalTaskSync(
        nonTerminalTask, event, ledger, mockAdapter, 'token', 'delete', false, JUGGLER_ORIGIN, mockThrottle
      );
      
      expect(result.taskUpdates).toEqual([]);
      expect(result.ledgerUpdates).toEqual([]);
      expect(result.stats).toEqual({});
    });

    test('returns empty updates for non-Juggler origin tasks', async () => {
      var externalLedger = { id: 'ledger-2', origin: 'gcal', provider_event_id: 'prov-456' };
      var result = await handleTerminalTaskSync(
        task, event, externalLedger, mockAdapter, 'token', 'delete', false, JUGGLER_ORIGIN, mockThrottle
      );
      
      expect(result.taskUpdates).toEqual([]);
      expect(result.ledgerUpdates).toEqual([]);
      expect(result.stats).toEqual({});
    });

    test('handles delete behavior for terminal tasks', async () => {
      var result = await handleTerminalTaskSync(
        task, event, ledger, mockAdapter, 'token', 'delete', false, JUGGLER_ORIGIN, mockThrottle
      );
      
      expect(mockAdapter.deleteEvent).toHaveBeenCalledWith('token', 'https://calendar.example.com/event/123');
      expect(mockThrottle).toHaveBeenCalled();
      expect(result.taskUpdates).toEqual([
        { id: 'task-1', fields: { provider_event_id: null } }
      ]);
      expect(result.ledgerUpdates).toEqual([
        { id: 'ledger-1', fields: { status: 'deleted_local', provider_event_id: null } }
      ]);
      expect(result.stats.deleted_local).toBe(1);
    });

    test('handles update behavior for done tasks', async () => {
      var result = await handleTerminalTaskSync(
        task, event, ledger, mockAdapter, 'token', 'update', false, JUGGLER_ORIGIN, mockThrottle
      );
      
      // Should not delete for done tasks with update behavior
      expect(mockAdapter.deleteEvent).not.toHaveBeenCalled();
      expect(result.taskUpdates).toEqual([]);
      expect(result.ledgerUpdates).toEqual([]);
      expect(result.stats).toEqual({});
    });

    test('handles delete behavior for non-done terminal tasks', async () => {
      var cancelTask = { id: 'task-3', status: 'cancel' };
      var result = await handleTerminalTaskSync(
        cancelTask, event, ledger, mockAdapter, 'token', 'update', false, JUGGLER_ORIGIN, mockThrottle
      );
      
      // Should delete for non-done terminal tasks even with update behavior
      expect(mockAdapter.deleteEvent).toHaveBeenCalled();
      expect(result.taskUpdates.length).toBeGreaterThan(0);
      expect(result.stats.deleted_local).toBe(1);
    });

    test('swallows 404/410 errors from deleteEvent', async () => {
      var errorMock = jest.fn().mockRejectedValue(new Error('404 Not Found'));
      var errorAdapter = { ...mockAdapter, deleteEvent: errorMock };
      
      var result = await handleTerminalTaskSync(
        task, event, ledger, errorAdapter, 'token', 'delete', false, JUGGLER_ORIGIN, mockThrottle
      );
      
      expect(errorMock).toHaveBeenCalled();
      expect(result.taskUpdates.length).toBeGreaterThan(0);
      expect(result.stats.deleted_local).toBe(1);
    });

    test('throws non-404/410 errors from deleteEvent', async () => {
      var errorMock = jest.fn().mockRejectedValue(new Error('500 Internal Error'));
      var errorAdapter = { ...mockAdapter, deleteEvent: errorMock };
      
      await expect(handleTerminalTaskSync(
        task, event, ledger, errorAdapter, 'token', 'delete', false, JUGGLER_ORIGIN, mockThrottle
      )).rejects.toThrow('500 Internal Error');
    });
  });
});