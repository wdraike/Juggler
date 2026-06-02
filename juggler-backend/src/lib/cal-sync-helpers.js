/**
 * cal-sync-helpers.js — Helper functions for calendar sync terminal status handling
 *
 * Extracted from cal-sync.controller.js as part of juggler-cal-history Plan C refactoring.
 * Provides clean separation of concerns for terminal status sync logic.
 */

var { isTerminalStatus } = require('./task-status');

/**
 * Handle terminal task synchronization
 * 
 * @param {Object} task - Task object
 * @param {Object} event - Calendar event object
 * @param {Object} ledger - Sync ledger entry
 * @param {Object} adapter - Calendar adapter
 * @param {string} pToken - Provider token
 * @param {string} calCompletedBehavior - Calendar completed behavior setting
 * @param {boolean} isIngestOnly - Whether this is ingest-only sync
 * @param {string} JUGGLER_ORIGIN - Juggler origin constant
 * @param {Function} throttle - Throttle function
 * @returns {Object} - Sync updates and stats
 */
async function handleTerminalTaskSync(task, event, ledger, adapter, pToken, calCompletedBehavior, isIngestOnly, JUGGLER_ORIGIN, throttle) {
  // Only handle terminal tasks originating from Juggler
  if (!task || !event || ledger.origin !== JUGGLER_ORIGIN || isIngestOnly) {
    return { taskUpdates: [], ledgerUpdates: [], stats: {} };
  }

  var isTerminal = isTerminalStatus(task.status);
  if (!isTerminal) {
    return { taskUpdates: [], ledgerUpdates: [], stats: {} };
  }

  var taskUpdates = [];
  var ledgerUpdates = [];
  var stats = {};

  // Determine if we should delete the calendar event
  var shouldDelete = calCompletedBehavior === 'delete' || task.status !== 'done';

  if (shouldDelete) {
    try {
      await adapter.deleteEvent(pToken, event._url || ledger.provider_event_id);
      if (throttle) await throttle();
    } catch (e) {
      // Swallow 404/410 errors (event already deleted)
      if (!e.message.includes('404') && !e.message.includes('410')) {
        throw e;
      }
    }
    
    // Clear event ID from task and mark ledger as deleted
    taskUpdates.push({ 
      id: task.id, 
      fields: { [adapter.getEventIdColumn()]: null } 
    });
    ledgerUpdates.push({ 
      id: ledger.id, 
      fields: { status: 'deleted_local', provider_event_id: null } 
    });
    stats.deleted_local = 1;
  } else {
    // 'update' mode for done tasks: fall through to regular push
    // so checkmark prefix + transparency propagate to calendar
  }

  return { taskUpdates, ledgerUpdates, stats };
}

/**
 * Check if a task status is terminal for calendar sync purposes
 * 
 * @param {string} status - Task status
 * @returns {boolean} - True if status is terminal
 */
function isTerminalForSync(status) {
  return isTerminalStatus(status);
}

module.exports = {
  handleTerminalTaskSync: handleTerminalTaskSync,
  isTerminalForSync: isTerminalForSync
};