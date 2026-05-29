/**
 * InMemoryCalendarAdapter.js
 * CalendarPort implementation for testing.
 *
 * Stores all events in memory with no external dependencies.
 * Useful for unit tests and development without real credentials.
 */

const crypto = require('crypto');

// In-memory storage
const storage = new Map();
const events = new Map();
let eventIdCounter = 1;

/**
 * @typedef {Object} UserStorage
 * @property {object} [auth] - Simulated auth credentials
 * @property {Map<string,CalendarEvent>} events - User's calendar events
 * @property {string|null} syncToken - Last sync token
 */

function getUserStorage(userId) {
  if (!storage.has(userId)) {
    storage.set(userId, {
      auth: null,
      events: new Map(),
      syncToken: null
    });
  }
  return storage.get(userId);
}

const providerId = 'memory';

// --- Connection & Token Management ---

function isConnected(user) {
  const userStorage = getUserStorage(user.id);
  return !!userStorage.auth;
}

async function connect(userId, credentials = {}) {
  const userStorage = getUserStorage(userId);
  userStorage.auth = { ...credentials, connectedAt: new Date().toISOString() };
}

async function disconnect(userId) {
  storage.delete(userId);
}

async function getValidAccessToken(user) {
  const userStorage = getUserStorage(user.id);
  if (!userStorage.auth) {
    throw new Error('In-memory calendar not connected');
  }
  return { userId: user.id, token: 'memory-token-' + user.id };
}

// --- Event CRUD Operations ---

async function getEvents(token, startDate, endDate, userId) {
  const userStorage = getUserStorage(userId);
  const results = [];

  for (const event of userStorage.events.values()) {
    // Filter by date range
    const eventStart = new Date(event.startDateTime);
    const rangeStart = new Date(startDate);
    const rangeEnd = new Date(endDate);

    if (eventStart >= rangeStart && eventStart <= rangeEnd) {
      results.push(event);
    }
  }

  // Sort by start time
  results.sort((a, b) => new Date(a.startDateTime) - new Date(b.startDateTime));

  return results;
}

async function createEvent(token, event, userId, year, tz, opts) {
  const userStorage = getUserStorage(userId);
  const eventId = 'mem-' + eventIdCounter++;

  const now = new Date().toISOString();
  const newEvent = {
    id: eventId,
    title: event.text || event.title || '(No title)',
    description: event.description || event.notes || '',
    startDateTime: event.startDateTime || computeStartDateTime(event, year),
    endDateTime: event.endDateTime || computeEndDateTime(event, year),
    startTimezone: tz || 'UTC',
    isAllDay: event.isAllDay || event.placementMode === 'all_day' || event.placement_mode === 'all_day',
    durationMinutes: event.dur || event.durationMinutes || 30,
    lastModified: now,
    isTransparent: event.marker || event.isTransparent || false,
    eventUrl: null,
    calendarId: null,
    _raw: null
  };

  if (!newEvent.startDateTime) {
    // Default to today if no date specified
    const today = new Date();
    newEvent.startDateTime = today.toISOString();
    const end = new Date(today.getTime() + (newEvent.durationMinutes * 60000));
    newEvent.endDateTime = end.toISOString();
  }

  userStorage.events.set(eventId, newEvent);

  return {
    providerEventId: eventId,
    raw: newEvent
  };
}

async function updateEvent(token, eventId, event, userId, year, tz, opts) {
  const userStorage = getUserStorage(userId);
  const existingEvent = userStorage.events.get(eventId);

  if (!existingEvent) {
    throw new Error('Event not found: ' + eventId);
  }

  const updatedEvent = {
    ...existingEvent,
    title: event.text || event.title || existingEvent.title,
    description: event.description || event.notes || existingEvent.description,
    startDateTime: event.startDateTime || computeStartDateTime(event, year) || existingEvent.startDateTime,
    endDateTime: event.endDateTime || computeEndDateTime(event, year) || existingEvent.endDateTime,
    isAllDay: event.isAllDay || event.placementMode === 'all_day' || event.placement_mode === 'all_day',
    durationMinutes: event.dur || event.durationMinutes || existingEvent.durationMinutes,
    isTransparent: event.marker || event.isTransparent || existingEvent.isTransparent,
    lastModified: new Date().toISOString()
  };

  userStorage.events.set(eventId, updatedEvent);
}

async function deleteEvent(token, eventId, userId) {
  const userStorage = getUserStorage(userId);
  if (!userStorage.events.has(eventId)) {
    // Treat as success if already deleted
    return;
  }
  userStorage.events.delete(eventId);
}

async function sync(token, user) {
  const userStorage = getUserStorage(user.id);
  const storedToken = userStorage.syncToken;

  // Simple sync check: compare event count
  const eventCount = userStorage.events.size;
  const currentToken = 'sync-' + eventCount + '-' + Date.now();

  if (!storedToken) {
    userStorage.syncToken = currentToken;
    return { hasChanges: true, nextSyncToken: currentToken };
  }

  const hasChanges = storedToken !== currentToken;
  if (hasChanges) {
    userStorage.syncToken = currentToken;
  }

  return {
    hasChanges,
    nextSyncToken: currentToken
  };
}

// --- Batch Operations ---

async function batchCreateEvents(token, taskEventPairs, year, tz) {
  const results = [];
  for (const pair of taskEventPairs) {
    try {
      const result = await createEvent(token, pair.task, pair.task.userId || pair.task.user_id, year, tz);
      results.push({
        taskId: pair.task.id,
        providerEventId: result.providerEventId,
        raw: result.raw,
        error: null
      });
    } catch (e) {
      results.push({
        taskId: pair.task.id,
        providerEventId: null,
        raw: null,
        error: e.message
      });
    }
  }
  return results;
}

async function batchDeleteEvents(token, eventIds, userId) {
  const results = [];
  for (const eventId of eventIds) {
    try {
      await deleteEvent(token, eventId, userId);
      results.push({ eventId, error: null });
    } catch (e) {
      results.push({ eventId, error: e.message });
    }
  }
  return results;
}

async function batchUpdateEvents(token, updatePairs, year, tz) {
  const results = [];
  for (const pair of updatePairs) {
    try {
      await updateEvent(token, pair.eventId, pair.task, pair.task.userId || pair.task.user_id, year, tz);
      results.push({ eventId: pair.eventId, error: null });
    } catch (e) {
      results.push({ eventId: pair.eventId, error: e.message });
    }
  }
  return results;
}

// --- Helper Functions ---

function normalizeEvent(event) {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startDateTime: event.startDateTime,
    endDateTime: event.endDateTime,
    startTimezone: event.startTimezone,
    isAllDay: event.isAllDay,
    durationMinutes: event.durationMinutes,
    lastModified: event.lastModified,
    isTransparent: event.isTransparent,
    eventUrl: event.eventUrl,
    calendarId: event.calendarId,
    _raw: event._raw
  };
}

function eventHash(event) {
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

function applyEventToTaskFields(event, tz, currentTask) {
  const isAllDay = event.isAllDay;
  const fields = {
    text: event.title,
    dur: event.durationMinutes,
    updated_at: new Date().toISOString()
  };

  if (event.startDateTime) {
    const date = new Date(event.startDateTime);
    if (isAllDay) {
      fields.date = date.toISOString().split('T')[0];
      fields.time = '12:00 AM';
    } else {
      fields.time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
  }

  if (isAllDay) {
    fields.placement_mode = 'all_day';
  } else if (event.isTransparent) {
    fields.placement_mode = 'reminder';
  } else {
    fields.placement_mode = 'fixed';
  }

  return fields;
}

function getEventIdColumn() {
  return 'mem_event_id';
}

function getLastSyncedColumn() {
  return 'mem_last_synced_at';
}

// --- Internal Helpers ---

function computeStartDateTime(event, year) {
  if (event.startDateTime) return event.startDateTime;
  if (event._scheduled_at || event.scheduledAt) {
    return event._scheduled_at || event.scheduledAt;
  }
  if (event.date) {
    // Parse date (handle both ISO and M/D formats)
    const isoMatch = event.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const mdMatch = event.date.match(/^(\d{1,2})\/(\d{1,2})$/);

    let y = year || new Date().getFullYear();
    let month, day;

    if (isoMatch) {
      y = isoMatch[1];
      month = parseInt(isoMatch[2]) - 1;
      day = parseInt(isoMatch[3]);
    } else if (mdMatch) {
      month = parseInt(mdMatch[1]) - 1;
      day = parseInt(mdMatch[2]);
    } else {
      return null;
    }

    // Parse time if available
    let hours = 0, mins = 0;
    if (event.time) {
      const timeMatch = event.time.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (timeMatch) {
        hours = parseInt(timeMatch[1], 10);
        const ampm = timeMatch[3].toUpperCase();
        if (ampm === 'PM' && hours !== 12) hours += 12;
        if (ampm === 'AM' && hours === 12) hours = 0;
        mins = parseInt(timeMatch[2], 10);
      }
    }

    const date = new Date(y, month, day, hours, mins);
    return date.toISOString();
  }
  return null;
}

function computeEndDateTime(event, year) {
  if (event.endDateTime) return event.endDateTime;

  const start = computeStartDateTime(event, year);
  if (!start) return null;

  const dur = event.dur || event.durationMinutes || 30;
  const startDate = new Date(start);
  const endDate = new Date(startDate.getTime() + (dur * 60000));
  return endDate.toISOString();
}

// --- Test Utilities ---

function clearAll() {
  storage.clear();
  eventIdCounter = 1;
}

function getAllEvents(userId) {
  const userStorage = getUserStorage(userId);
  return Array.from(userStorage.events.values());
}

function seedEvents(userId, eventsList) {
  const userStorage = getUserStorage(userId);
  for (const event of eventsList) {
    const eventId = event.id || ('mem-' + eventIdCounter++);
    userStorage.events.set(eventId, { ...event, id: eventId });
  }
}

// --- Module Exports ---

module.exports = {
  providerId,
  isConnected,
  getValidAccessToken,
  getEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  sync,
  batchCreateEvents,
  batchDeleteEvents,
  batchUpdateEvents,
  normalizeEvent,
  eventHash,
  applyEventToTaskFields,
  getEventIdColumn,
  getLastSyncedColumn,
  // In-memory specific utilities
  connect,
  disconnect,
  clearAll,
  getAllEvents,
  seedEvents
};
