/**
 * CalendarEvent entity
 * Domain entity representing a calendar event in the unified format.
 * This is the source of truth for calendar events within the calendar slice.
 */

/**
 * @typedef {Object} CalendarEvent
 * @property {string} id - Unique event identifier (provider-specific)
 * @property {string} title - Event title/summary
 * @property {string} description - Event description/body
 * @property {string} startDateTime - Start time in ISO format
 * @property {string} endDateTime - End time in ISO format
 * @property {string|null} startTimezone - IANA timezone name (e.g., 'America/New_York')
 * @property {boolean} isAllDay - Whether this is an all-day event
 * @property {number} durationMinutes - Event duration in minutes
 * @property {string|null} lastModified - Last modified timestamp (ISO)
 * @property {boolean} isTransparent - Whether event shows as 'free' (transparent)
 * @property {string|null} eventUrl - Link to event in provider's UI
 * @property {string|null} calendarId - Calendar identifier (for multi-calendar providers)
 * @property {boolean} [isCancelled] - Whether the event is cancelled (MSFT-specific)
 * @property {string|null} [seriesMasterId] - ID of recurring series master (MSFT)
 * @property {string|null} [eventType] - Event type: 'singleInstance', 'occurrence', 'exception', 'seriesMaster'
 * @property {string|null} [_url] - Raw CalDAV URL (Apple-specific)
 * @property {string|null} [_etag] - CalDAV ETag for change tracking (Apple-specific)
 * @property {Object|null} [_raw] - Raw provider response (for debugging)
 */

/**
 * Create a new CalendarEvent with defaults
 * @param {Partial<CalendarEvent>} props
 * @returns {CalendarEvent}
 */
function createCalendarEvent(props = {}) {
  return {
    id: props.id || '',
    title: props.title || '(No title)',
    description: props.description || '',
    startDateTime: props.startDateTime || '',
    endDateTime: props.endDateTime || '',
    startTimezone: props.startTimezone || null,
    isAllDay: props.isAllDay || false,
    durationMinutes: props.durationMinutes || 30,
    lastModified: props.lastModified || null,
    isTransparent: props.isTransparent || false,
    eventUrl: props.eventUrl || null,
    calendarId: props.calendarId || null,
    isCancelled: props.isCancelled || false,
    seriesMasterId: props.seriesMasterId || null,
    eventType: props.eventType || null,
    _url: props._url || null,
    _etag: props._etag || null,
    _raw: props._raw || null
  };
}

/**
 * Validate a CalendarEvent
 * @param {CalendarEvent} event
 * @returns {boolean}
 */
function isValidCalendarEvent(event) {
  if (!event) return false;
  if (!event.id || typeof event.id !== 'string') return false;
  if (!event.title || typeof event.title !== 'string') return false;
  if (!event.startDateTime || typeof event.startDateTime !== 'string') return false;
  return true;
}

/**
 * Compute a hash for change detection
 * @param {CalendarEvent} event
 * @returns {string} - SHA256 hex string
 */
function computeEventHash(event) {
  const crypto = require('crypto');
  const str = [
    event.title || '',
    event.startDateTime || '',
    event.endDateTime || '',
    event.description || '',
    event.isTransparent ? 'transparent' : 'opaque',
    event.isAllDay ? 'allday' : 'timed'
  ].join('|');
  return crypto.createHash('sha256').update(str).digest('hex');
}

module.exports = {
  createCalendarEvent,
  isValidCalendarEvent,
  computeEventHash
};
