/**
 * AppleCalApiPort — driven-port contract for the low-level Apple Calendar
 * (iCloud) CalDAV client (999.944 H7 — lib/apple-cal-api.js).
 *
 * Mirrors the LockPort/RedisPort/JwtSecretPort idiom: a JSDoc `@typedef`, a
 * throw-not-implemented prototype base, and a frozen METHODS array.
 *
 * Wraps `src/lib/apple-cal-api.js` — the tsdav/ical.js CalDAV wrapper
 * consumed by the calendar hex slice's `AppleCalendarAdapter` — so it
 * exposes EXACTLY that surface: `createClient` / `discoverCalendars` /
 * `listEvents` / `parseVEvents` / `buildVEvent` / `createEvent` /
 * `updateEvent` / `deleteEvent` / `checkForChanges`, plus the
 * `DEFAULT_SERVER_URL` constant.
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT AC-1 (UTC time normalization): all datetime values produced by
 *   parseVEvents/buildVEvent MUST be normalized to UTC (Z-suffixed) — Apple
 *   Calendar silently discards events with a floating/local DTSTAMP, and a
 *   TZID-annotated DTSTART/DTEND read on a UTC server must not be
 *   misinterpreted as local time.
 *
 * INVARIANT AC-2 (conditional-write conflict handling): createEvent MUST
 *   handle HTTP 412 (stale ledger — event already exists at the target URL)
 *   by re-fetching the current ETag and retrying as an update; updateEvent
 *   MUST handle a stale ETag the same way. Both MUST tolerate 404/410 on the
 *   retry (already-gone) without throwing.
 *
 * INVARIANT AC-3 (VEVENT-only calendar discovery): discoverCalendars MUST
 *   filter to calendars whose `components` include VEVENT (excluding
 *   VTODO/Reminders lists), defaulting to inclusion when component info is
 *   absent.
 *
 * INVARIANT AC-4 (no sync token = full sync): checkForChanges MUST return
 *   `{ hasChanges: true }` when no prior sync token/ctag is supplied.
 *
 * @typedef {Object} AppleCalApiPort
 *
 * @property {string} DEFAULT_SERVER_URL
 *   The default iCloud CalDAV server URL (`https://caldav.icloud.com`).
 *   A constant, not a method — not part of AppleCalApiPort.METHODS.
 *
 * @property {(serverUrl: string, username: string, password: string) => Promise<Object>} createClient
 *   Create a tsdav DAV client with HTTP Basic auth (app-specific password).
 *
 * @property {(client: Object) => Promise<Array<{url: string, displayName: string, ctag: (string|null), description: string, syncToken: (string|null)}>>} discoverCalendars
 *   Discover event-capable calendars for the authenticated account (INVARIANT AC-3).
 *
 * @property {(client: Object, calendarUrl: string, timeMin: string, timeMax: string) => Promise<Array<Object>>} listEvents
 *   Fetch + parse calendar events in a date range.
 *
 * @property {(icsData: string, url: string, etag: string) => Array<Object>} parseVEvents
 *   Parse an ICS string (possibly multiple VEVENTs) into normalized event
 *   objects (INVARIANT AC-1). Synchronous.
 *
 * @property {(task: Object, year: number, tz: *) => string} buildVEvent
 *   Build an ICS string from a task (INVARIANT AC-1). Synchronous.
 *
 * @property {(client: Object, calendarUrl: string, task: Object, year: number, tz: *) => Promise<{providerEventId: string, etag: (string|null), url: string}>} createEvent
 *   Create a calendar event, tolerating a stale-ledger 412 (INVARIANT AC-2).
 *
 * @property {(client: Object, eventUrl: string, task: Object, year: number, tz: *, etag: string) => Promise<void>} updateEvent
 *   Update an existing event, tolerating a stale ETag 412 (INVARIANT AC-2).
 *
 * @property {(client: Object, eventUrl: string, etag: string) => Promise<void>} deleteEvent
 *   Delete a calendar event, tolerating an already-gone 404/410.
 *
 * @property {(client: Object, calendarUrl: string, storedSyncToken: (string|null)) => Promise<{hasChanges: boolean, syncToken?: string}>} checkForChanges
 *   Check for changes via sync-token/ctag comparison (INVARIANT AC-4).
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function AppleCalApiPort() {}

AppleCalApiPort.prototype.createClient = function createClient(_serverUrl, _username, _password) {
  throw new Error('AppleCalApiPort.createClient not implemented');
};

AppleCalApiPort.prototype.discoverCalendars = function discoverCalendars(_client) {
  throw new Error('AppleCalApiPort.discoverCalendars not implemented');
};

AppleCalApiPort.prototype.listEvents = function listEvents(_client, _calendarUrl, _timeMin, _timeMax) {
  throw new Error('AppleCalApiPort.listEvents not implemented');
};

AppleCalApiPort.prototype.parseVEvents = function parseVEvents(_icsData, _url, _etag) {
  throw new Error('AppleCalApiPort.parseVEvents not implemented');
};

AppleCalApiPort.prototype.buildVEvent = function buildVEvent(_task, _year, _tz) {
  throw new Error('AppleCalApiPort.buildVEvent not implemented');
};

AppleCalApiPort.prototype.createEvent = function createEvent(_client, _calendarUrl, _task, _year, _tz) {
  throw new Error('AppleCalApiPort.createEvent not implemented');
};

AppleCalApiPort.prototype.updateEvent = function updateEvent(_client, _eventUrl, _task, _year, _tz, _etag) {
  throw new Error('AppleCalApiPort.updateEvent not implemented');
};

AppleCalApiPort.prototype.deleteEvent = function deleteEvent(_client, _eventUrl, _etag) {
  throw new Error('AppleCalApiPort.deleteEvent not implemented');
};

AppleCalApiPort.prototype.checkForChanges = function checkForChanges(_client, _calendarUrl, _storedSyncToken) {
  throw new Error('AppleCalApiPort.checkForChanges not implemented');
};

/**
 * The exact set of METHODS (functions only — DEFAULT_SERVER_URL is a
 * constant property, not a method) an adapter MUST expose to satisfy
 * AppleCalApiPort.
 * @type {ReadonlyArray<string>}
 */
var APPLE_CAL_API_PORT_METHODS = Object.freeze([
  'createClient',
  'discoverCalendars',
  'listEvents',
  'parseVEvents',
  'buildVEvent',
  'createEvent',
  'updateEvent',
  'deleteEvent',
  'checkForChanges'
]);

module.exports = AppleCalApiPort;
module.exports.AppleCalApiPort = AppleCalApiPort;
module.exports.APPLE_CAL_API_PORT_METHODS = APPLE_CAL_API_PORT_METHODS;
