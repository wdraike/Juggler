/**
 * InMemoryCalendarAdapter — a deterministic, dependency-free test double that
 * implements the full CalendarPort contract (CALENDAR_PORT_METHODS). It keeps
 * events in an in-process Map keyed by userId, so tests can drive the calendar
 * slice without a database, network, or real OAuth/CalDAV credentials.
 *
 * providerId is 'memory'. The README "Using the In-Memory Adapter for Tests"
 * section documents the supported flow:
 *   connect(userId, opts) → getValidAccessToken(user) → createEvent(...) →
 *   clearAll().
 *
 * This module exports a singleton object (matching the README usage which calls
 * methods directly on the imported adapter, e.g. `InMemoryCalendarAdapter.connect`).
 * Each method mirrors the corresponding CalendarPort signature.
 */

var CalendarEvent = require('../domain/entities/CalendarEvent');

// userId (as String) -> { connected: boolean, meta: Object, events: Map<eventId, CalendarEvent-ish> }
var store = new Map();
// Monotonic counter for deterministic generated event ids.
var idSeq = 0;

function keyFor(userId) {
  return String(userId);
}

function recordFor(userId) {
  var k = keyFor(userId);
  var rec = store.get(k);
  if (!rec) {
    rec = { connected: false, meta: {}, events: new Map() };
    store.set(k, rec);
  }
  return rec;
}

function userIdOf(user) {
  if (user == null) return null;
  if (typeof user === 'object') return user.id != null ? user.id : null;
  return user;
}

// --- Test-support helpers (not part of CalendarPort, but used by the README flow) ---

/**
 * Mark a user as connected to the in-memory provider.
 * @param {(string|number)} userId
 * @param {Object} [meta] arbitrary metadata (e.g. { username: 'test' })
 * @returns {Promise<void>}
 */
async function connect(userId, meta) {
  var rec = recordFor(userId);
  rec.connected = true;
  rec.meta = meta || {};
}

/**
 * Wipe ALL in-memory state for every user. Call in afterEach to keep tests
 * isolated.
 */
function clearAll() {
  store.clear();
  idSeq = 0;
}

// --- CalendarPort surface ---

var providerId = 'memory';

function isConnected(user) {
  var uid = userIdOf(user);
  if (uid == null) return false;
  var rec = store.get(keyFor(uid));
  return !!(rec && rec.connected);
}

async function getValidAccessToken(user) {
  var uid = userIdOf(user);
  if (uid == null || !isConnected(user)) {
    throw new Error('In-memory calendar not connected');
  }
  // The "token" carries the userId so subsequent calls can resolve the store
  // without re-passing the user object, mirroring how OAuth adapters thread a
  // bearer token through the sync engine.
  return 'memory-token:' + keyFor(uid);
}

function userIdFromToken(token, fallbackUserId) {
  if (typeof token === 'string' && token.indexOf('memory-token:') === 0) {
    return token.slice('memory-token:'.length);
  }
  return fallbackUserId != null ? keyFor(fallbackUserId) : null;
}

async function getEvents(token, startDate, endDate, userId) {
  var uid = userIdFromToken(token, userId);
  if (uid == null) return [];
  var rec = store.get(keyFor(uid));
  if (!rec) return [];

  var start = startDate != null ? new Date(startDate).getTime() : -Infinity;
  var end = endDate != null ? new Date(endDate).getTime() : Infinity;

  var out = [];
  rec.events.forEach(function (ev) {
    var t = ev.startDateTime != null ? new Date(ev.startDateTime).getTime() : NaN;
    // Events without a parseable start are always included (mirrors lenient
    // adapter behavior); otherwise filter by the [start, end] window.
    if (isNaN(t) || (t >= start && t <= end)) {
      out.push(new CalendarEvent(ev));
    }
  });
  return out;
}

async function createEvent(token, event, userId, year, tz, opts) {
  var uid = userIdFromToken(token, userId);
  if (uid == null) {
    throw new Error('In-memory calendar not connected');
  }
  var rec = recordFor(uid);
  idSeq += 1;
  var providerEventId = 'mem-evt-' + idSeq;

  var src = event || {};
  var stored = {
    id: providerEventId,
    title: src.title != null ? src.title : (src.text != null ? src.text : '(No title)'),
    description: src.description != null ? src.description : (src.notes != null ? src.notes : ''),
    startDateTime: src.startDateTime != null ? src.startDateTime : (src.date != null ? src.date : null),
    endDateTime: src.endDateTime != null ? src.endDateTime : null,
    startTimezone: tz != null ? tz : (src.startTimezone != null ? src.startTimezone : null),
    isAllDay: src.isAllDay === true,
    durationMinutes: src.durationMinutes != null ? src.durationMinutes : (src.dur != null ? src.dur : 30),
    isTransparent: src.isTransparent === true,
    calendarId: (opts && opts.calendarId != null) ? opts.calendarId : (src.calendarId != null ? src.calendarId : null),
    _raw: src
  };
  rec.events.set(providerEventId, stored);

  return { providerEventId: providerEventId, raw: stored, calendarId: stored.calendarId };
}

async function updateEvent(token, eventId, event, userId, year, tz, opts) {
  var uid = userIdFromToken(token, userId);
  if (uid == null) {
    throw new Error('In-memory calendar not connected');
  }
  var rec = recordFor(uid);
  var existing = rec.events.get(String(eventId));
  if (!existing) {
    var err = new Error('In-memory event not found: ' + eventId);
    err.code = 'NOT_FOUND';
    throw err;
  }
  var src = event || {};
  var updated = {
    id: String(eventId),
    title: src.title != null ? src.title : (src.text != null ? src.text : existing.title),
    description: src.description != null ? src.description : (src.notes != null ? src.notes : existing.description),
    startDateTime: src.startDateTime != null ? src.startDateTime : (src.date != null ? src.date : existing.startDateTime),
    endDateTime: src.endDateTime != null ? src.endDateTime : existing.endDateTime,
    startTimezone: tz != null ? tz : (src.startTimezone != null ? src.startTimezone : existing.startTimezone),
    isAllDay: src.isAllDay != null ? src.isAllDay === true : existing.isAllDay,
    durationMinutes: src.durationMinutes != null ? src.durationMinutes : (src.dur != null ? src.dur : existing.durationMinutes),
    isTransparent: src.isTransparent != null ? src.isTransparent === true : existing.isTransparent,
    calendarId: (opts && opts.calendarId != null) ? opts.calendarId : existing.calendarId,
    _raw: src
  };
  rec.events.set(String(eventId), updated);
  return { providerEventId: String(eventId), raw: updated, calendarId: updated.calendarId };
}

async function deleteEvent(token, eventId, userId) {
  var uid = userIdFromToken(token, userId);
  if (uid == null) {
    throw new Error('In-memory calendar not connected');
  }
  var rec = store.get(keyFor(uid));
  var existed = !!(rec && rec.events.delete(String(eventId)));
  return { deleted: existed };
}

async function sync(token, user) {
  // The in-memory store never changes out from under the caller, so there are
  // never remote-side changes to pull. Match the CalendarPort sync() shape.
  return { hasChanges: false };
}

function getEventIdColumn() {
  // 'memory' has no real DB column; expose a stable, namespaced name so the
  // surface is complete and never collides with a real provider column.
  return 'memory_event_id';
}

function getLastSyncedColumn() {
  return 'memory_last_synced_at';
}

module.exports = {
  providerId: providerId,
  isConnected: isConnected,
  getValidAccessToken: getValidAccessToken,
  getEvents: getEvents,
  createEvent: createEvent,
  updateEvent: updateEvent,
  deleteEvent: deleteEvent,
  sync: sync,
  getEventIdColumn: getEventIdColumn,
  getLastSyncedColumn: getLastSyncedColumn,
  // Test-support helpers (outside the CalendarPort required set):
  connect: connect,
  clearAll: clearAll
};
