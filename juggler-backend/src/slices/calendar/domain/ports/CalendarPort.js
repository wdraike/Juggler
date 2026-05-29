/**
 * CalendarPort interface (JSDoc typedef)
 *
 * Defines the contract that all calendar adapters must implement.
 * This is the "port" in hexagonal architecture terms.
 *
 * Implementation notes:
 * - Google Calendar: token is OAuth2 access token (string)
 * - Microsoft Calendar: token is OAuth2 access token (string)
 * - Apple Calendar: token is DAV client instance (object)
 */

/**
 * @typedef {Object} CalendarPort
 *
 * @property {string} providerId - Unique identifier for this provider ('gcal', 'msft', 'apple')
 *
 * @property {function(Object): boolean} isConnected
 *   Check if a user has this calendar provider connected.
 *   @param {Object} user - User record from database
 *   @returns {boolean}
 *
 * @property {function(Object): Promise<string|Object>} getValidAccessToken
 *   Get a valid access token (or client instance for CalDAV).
 *   Handles token refresh automatically.
 *   @param {Object} user - User record from database
 *   @returns {Promise<string|Object>} - Access token string or DAV client
 *
 * @property {function(string|Object, string, string, number): Promise<CalendarEvent[]>} getEvents
 *   Fetch events from the calendar within a date range.
 *   @param {string|Object} token - Access token or client instance
 *   @param {string} startDate - Start date/time in ISO format
 *   @param {string} endDate - End date/time in ISO format
 *   @param {number} userId - User ID for storing sync tokens
 *   @returns {Promise<CalendarEvent[]>} - Array of normalized events
 *
 * @property {function(string|Object, Object, number, string, Object?): Promise<{providerEventId: string, raw: Object}>} createEvent
 *   Create a new calendar event from a task.
 *   @param {string|Object} token - Access token or client instance
 *   @param {Object} task - Task record
 *   @param {number} year - Current year context
 *   @param {string} tz - User's timezone (IANA)
 *   @param {Object} [opts] - Optional flags
 *   @returns {Promise<{providerEventId: string, raw: Object}>}
 *
 * @property {function(string|Object, string, Object, number, string, Object?): Promise<void>} updateEvent
 *   Update an existing calendar event.
 *   @param {string|Object} token - Access token or client instance
 *   @param {string} eventId - Provider's event ID
 *   @param {Object} task - Updated task record
 *   @param {number} year - Current year context
 *   @param {string} tz - User's timezone (IANA)
 *   @param {Object} [opts] - Optional flags
 *   @returns {Promise<void>}
 *
 * @property {function(string|Object, string): Promise<void>} deleteEvent
 *   Delete a calendar event.
 *   @param {string|Object} token - Access token or client instance
 *   @param {string} eventId - Provider's event ID
 *   @returns {Promise<void>}
 *
 * @property {function(string|Object, Object): Promise<{hasChanges: boolean, nextSyncToken?: string, deltaLink?: string, tokenInvalid?: boolean}>} sync
 *   Lightweight sync check using sync tokens/delta links.
 *   @param {string|Object} token - Access token or client instance
 *   @param {Object} user - User record with stored sync state
 *   @returns {Promise<{hasChanges: boolean, nextSyncToken?: string, deltaLink?: string, tokenInvalid?: boolean}>}
 *
 * @property {function(string|Object, Array<Object>, number, string): Promise<Array<{taskId: number, providerEventId: string|null, raw: Object|null, error: string|null}>>} [batchCreateEvents]
 *   Batch create multiple events (optional, for providers that support it).
 *   @param {string|Object} token - Access token or client instance
 *   @param {Array<Object>} taskEventPairs - Array of {task, eventId?} pairs
 *   @param {number} year - Current year context
 *   @param {string} tz - User's timezone (IANA)
 *   @returns {Promise<Array<{taskId: number, providerEventId: string|null, raw: Object|null, error: string|null}>>}
 *
 * @property {function(string|Object, Array<string>): Promise<Array<{eventId: string, error: string|null}>>} [batchDeleteEvents]
 *   Batch delete multiple events (optional, for providers that support it).
 *   @param {string|Object} token - Access token or client instance
 *   @param {Array<string>} eventIds - Array of event IDs to delete
 *   @returns {Promise<Array<{eventId: string, error: string|null}>>}
 *
 * @property {function(): string} getEventIdColumn
 *   Get the database column name for this provider's event ID.
 *   @returns {string} - Column name (e.g., 'gcal_event_id', 'msft_event_id')
 *
 * @property {function(): string} getLastSyncedColumn
 *   Get the database column name for this provider's last sync timestamp.
 *   @returns {string} - Column name (e.g., 'gcal_last_synced_at', 'msft_cal_last_synced_at')
 *
 * @property {function(CalendarEvent, string, Object?): Object} [applyEventToTaskFields]
 *   Convert a calendar event to database field updates for a task.
 *   @param {CalendarEvent} event - Normalized event
 *   @param {string} tz - User's timezone (IANA)
 *   @param {Object} [currentTask] - Existing task record (for comparison)
 *   @returns {Object} - Database field updates
 *
 * @property {function(CalendarEvent): string} [eventHash]
 *   Compute a hash for change detection.
 *   @param {CalendarEvent} event - Normalized event
 *   @returns {string} - SHA256 hex string
 *
 * @property {function(Object): CalendarEvent} [normalizeEvent]
 *   Normalize a raw provider event to CalendarEvent shape.
 *   @param {Object} rawEvent - Raw event from provider API
 *   @returns {CalendarEvent}
 *
 * @property {async function(number): Promise<Array<{calendar_id: string, display_name: string, enabled: boolean}>>} [getEnabledCalendars]
 *   Get list of enabled calendars for multi-calendar providers (Apple).
 *   @param {number} userId - User ID
 *   @returns {Promise<Array>} - List of calendar objects
 *
 * @property {async function(number): Promise<Object|null>} [getWriteCalendar]
 *   Get the calendar to write events to (for multi-calendar providers).
 *   @param {number} userId - User ID
 *   @returns {Promise<Object|null>} - Calendar object or null
 */

/**
 * Validates that an adapter implements the required CalendarPort methods
 * @param {Object} adapter
 * @returns {Array<string>} - Array of missing method names (empty if valid)
 */
function validateCalendarPort(adapter) {
  const required = [
    'providerId',
    'isConnected',
    'getValidAccessToken',
    'getEvents',
    'createEvent',
    'updateEvent',
    'deleteEvent',
    'sync',
    'getEventIdColumn',
    'getLastSyncedColumn'
  ];

  const missing = [];
  for (const method of required) {
    if (method === 'providerId') {
      if (!adapter.providerId) missing.push(method);
    } else {
      if (typeof adapter[method] !== 'function') missing.push(method);
    }
  }
  return missing;
}

module.exports = {
  validateCalendarPort
};
