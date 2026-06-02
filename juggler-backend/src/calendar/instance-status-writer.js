/**
 * Instance Status Writer - Guards against invalid terminal status transitions for calendar events
 * 
 * This module provides functions for safely updating calendar event statuses while
 * preventing transitions from terminal states.
 */

const { canTransition } = require('../lib/task-status');

/**
 * Writes a new status for a calendar event, guarding against invalid transitions.
 * 
 * @param {Object} db - Database connection
 * @param {string} eventId - The ID of the calendar event to update
 * @param {string} newStatus - The new status to set
 * @param {string} reason - Reason for the status change (for audit trail)
 * @returns {Promise<Object>} Result of the status update operation
 * @throws {Error} If the transition is invalid or database operation fails
 */
async function writeCalendarEventStatus(db, eventId, newStatus, reason) {
  // First, get the current status of the calendar event
  const currentEvent = await db('calendar_events')
    .where({ id: eventId })
    .first('status')
    .catch(err => {
      throw new Error(`Failed to fetch current calendar event status: ${err.message}`);
    });

  if (!currentEvent) {
    throw new Error(`Calendar event with ID ${eventId} not found`);
  }

  const currentStatus = currentEvent.status;

  // Check if the transition is valid
  if (!canTransition(currentStatus, newStatus)) {
    throw new Error(
      `Invalid status transition: ${currentStatus} -> ${newStatus}. ` +
      `Calendar event is in terminal state or transition is not allowed.`
    );
  }

  // Perform the status update
  const result = await db('calendar_events')
    .where({ id: eventId })
    .update({
      status: newStatus,
      status_reason: reason,
      updated_at: db.fn.now()
    })
    .catch(err => {
      throw new Error(`Failed to update calendar event status: ${err.message}`);
    });

  if (result === 0) {
    throw new Error(`No calendar event updated - event ID ${eventId} may not exist`);
  }

  return {
    success: true,
    eventId,
    oldStatus: currentStatus,
    newStatus,
    reason
  };
}

/**
 * Writes a new status for a calendar event instance, guarding against invalid transitions.
 * 
 * @param {Object} db - Database connection
 * @param {string} instanceId - The ID of the calendar event instance to update
 * @param {string} newStatus - The new status to set
 * @param {string} reason - Reason for the status change (for audit trail)
 * @returns {Promise<Object>} Result of the status update operation
 * @throws {Error} If the transition is invalid or database operation fails
 */
async function writeCalendarEventInstanceStatus(db, instanceId, newStatus, reason) {
  // First, get the current status of the calendar event instance
  const currentInstance = await db('calendar_event_instances')
    .where({ id: instanceId })
    .first('status')
    .catch(err => {
      throw new Error(`Failed to fetch current calendar event instance status: ${err.message}`);
    });

  if (!currentInstance) {
    throw new Error(`Calendar event instance with ID ${instanceId} not found`);
  }

  const currentStatus = currentInstance.status;

  // Check if the transition is valid
  if (!canTransition(currentStatus, newStatus)) {
    throw new Error(
      `Invalid status transition: ${currentStatus} -> ${newStatus}. ` +
      `Calendar event instance is in terminal state or transition is not allowed.`
    );
  }

  // Perform the status update
  const result = await db('calendar_event_instances')
    .where({ id: instanceId })
    .update({
      status: newStatus,
      status_reason: reason,
      updated_at: db.fn.now()
    })
    .catch(err => {
      throw new Error(`Failed to update calendar event instance status: ${err.message}`);
    });

  if (result === 0) {
    throw new Error(`No calendar event instance updated - instance ID ${instanceId} may not exist`);
  }

  return {
    success: true,
    instanceId,
    oldStatus: currentStatus,
    newStatus,
    reason
  };
}

module.exports = {
  writeCalendarEventStatus,
  writeCalendarEventInstanceStatus,
  canTransition
};