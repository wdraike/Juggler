/**
 * Calendar Slice
 *
 * Domain-driven slice for calendar functionality.
 * Implements CalendarPort interface for all calendar providers.
 *
 * Directory Structure:
 *   domain/
 *     entities/CalendarEvent.js  - Core domain entity
 *     ports/CalendarPort.js      - Interface contract (JSDoc)
 *   adapters/
 *     GoogleCalendarAdapter.js   - Google Calendar implementation
 *     MicrosoftCalendarAdapter.js - Microsoft Calendar implementation
 *     AppleCalendarAdapter.js    - Apple Calendar (CalDAV) implementation
 *     InMemoryCalendarAdapter.js - Test implementation
 *   facade.js                    - Main API entry point
 *
 * All adapters implement the CalendarPort interface with these required methods:
 *   - providerId
 *   - isConnected(user)
 *   - getValidAccessToken(user)
 *   - getEvents(token, startDate, endDate, userId)
 *   - createEvent(token, event, userId, year, tz, opts)
 *   - updateEvent(token, eventId, event, userId, year, tz, opts)
 *   - deleteEvent(token, eventId, userId)
 *   - sync(token, user)
 *   - getEventIdColumn()
 *   - getLastSyncedColumn()
 */

const facade = require('./facade');
const { createCalendarEvent, isValidCalendarEvent } = require('./domain/entities/CalendarEvent');
const { validateCalendarPort } = require('./domain/ports/CalendarPort');

// Adapters
const GoogleCalendarAdapter = require('./adapters/GoogleCalendarAdapter');
const MicrosoftCalendarAdapter = require('./adapters/MicrosoftCalendarAdapter');
const AppleCalendarAdapter = require('./adapters/AppleCalendarAdapter');
const InMemoryCalendarAdapter = require('./adapters/InMemoryCalendarAdapter');

module.exports = {
  // Facade (main entry point)
  calendar: facade,

  // Domain entities
  createCalendarEvent,
  isValidCalendarEvent,

  // Port validator
  validateCalendarPort,

  // Adapters (for direct access if needed)
  GoogleCalendarAdapter,
  MicrosoftCalendarAdapter,
  AppleCalendarAdapter,
  InMemoryCalendarAdapter
};
