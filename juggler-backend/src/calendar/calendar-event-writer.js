/**
 * Calendar Event Writer - Handles creation and updates of calendar events
 * 
 * This module provides functions for creating and updating calendar events
 * while ensuring data integrity and proper status management.
 */

const { writeCalendarEventStatus } = require('./instance-status-writer');

/**
 * Creates a new calendar event with the specified properties.
 * 
 * @param {Object} db - Database connection
 * @param {Object} eventData - Event data to create
 * @param {string} eventData.title - Event title
 * @param {string} eventData.description - Event description
 * @param {string} eventData.start_time - Event start time
 * @param {string} eventData.end_time - Event end time
 * @param {string} eventData.calendar_id - Calendar ID
 * @param {string} eventData.task_id - Associated task ID (optional)
 * @param {string} eventData.status - Initial status (default: 'pending')
 * @param {string} eventData.reason - Reason for creation (for audit trail)
 * @returns {Promise<Object>} Created calendar event
 * @throws {Error} If database operation fails
 */
async function createCalendarEvent(db, eventData) {
  const now = new Date().toISOString();

  const eventToCreate = {
    title: eventData.title,
    description: eventData.description || '',
    start_time: eventData.start_time,
    end_time: eventData.end_time,
    calendar_id: eventData.calendar_id,
    task_id: eventData.task_id || null,
    status: eventData.status || 'pending',
    status_reason: eventData.reason || 'Created via calendar event writer',
    created_at: now,
    updated_at: now
  };

  const [createdEvent] = await db('calendar_events')
    .insert(eventToCreate)
    .returning('*')
    .catch(err => {
      throw new Error(`Failed to create calendar event: ${err.message}`);
    });

  return createdEvent;
}

/**
 * Updates an existing calendar event.
 * 
 * @param {Object} db - Database connection
 * @param {string} eventId - Event ID to update
 * @param {Object} updateData - Properties to update
 * @param {string} updateData.title - New title (optional)
 * @param {string} updateData.description - New description (optional)
 * @param {string} updateData.start_time - New start time (optional)
 * @param {string} updateData.end_time - New end time (optional)
 * @param {string} updateData.status - New status (optional)
 * @param {string} updateData.reason - Reason for update (for audit trail)
 * @returns {Promise<Object>} Updated calendar event
 * @throws {Error} If database operation fails
 */
async function updateCalendarEvent(db, eventId, updateData) {
  // Handle status updates separately to use the guarded writer
  if (updateData.status !== undefined) {
    const statusResult = await writeCalendarEventStatus(
      db,
      eventId,
      updateData.status,
      updateData.reason || 'Updated via calendar event writer'
    );
    
    // Remove status from update data since we handled it separately
    delete updateData.status;
    delete updateData.reason;
  }

  // Prepare update object
  const updateObj = {
    ...updateData,
    updated_at: db.fn.now()
  };

  const [updatedEvent] = await db('calendar_events')
    .where({ id: eventId })
    .update(updateObj)
    .returning('*')
    .catch(err => {
      throw new Error(`Failed to update calendar event: ${err.message}`);
    });

  if (!updatedEvent) {
    throw new Error(`Calendar event with ID ${eventId} not found`);
  }

  return updatedEvent;
}

/**
 * Deletes a calendar event.
 * 
 * @param {Object} db - Database connection
 * @param {string} eventId - Event ID to delete
 * @returns {Promise<number>} Number of events deleted
 * @throws {Error} If database operation fails
 */
async function deleteCalendarEvent(db, eventId) {
  const result = await db('calendar_events')
    .where({ id: eventId })
    .delete()
    .catch(err => {
      throw new Error(`Failed to delete calendar event: ${err.message}`);
    });

  return result;
}

module.exports = {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  writeCalendarEventStatus
};