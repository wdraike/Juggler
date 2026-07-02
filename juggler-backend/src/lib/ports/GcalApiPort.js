/**
 * GcalApiPort — driven-port contract for the low-level Google Calendar REST
 * API client (999.944 H7 — lib/gcal-api.js).
 *
 * Mirrors the LockPort/RedisPort/JwtSecretPort idiom: a JSDoc `@typedef`, a
 * throw-not-implemented prototype base, and a frozen METHODS array.
 *
 * Wraps `src/lib/gcal-api.js` — the OAuth2 + REST wrapper around Calendar
 * API v3 consumed by the calendar hex slice's `GoogleCalendarAdapter` — so
 * it exposes EXACTLY that surface: `createOAuth2Client` / `getAuthUrl` /
 * `getTokensFromCode` / `refreshAccessToken` / `listEvents` /
 * `checkForChanges` / `insertEvent` / `patchEvent` / `deleteEvent` /
 * `batchRequest`.
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT GC-1 (retry-then-throw on rate limit): a 429/503 response is
 *   retried up to 3 times with exponential/Retry-After backoff; after the
 *   final attempt the port MUST throw rather than return a partial/garbage
 *   result.
 *
 * INVARIANT GC-2 (sync-token expiry signal): checkForChanges MUST return
 *   `{ hasChanges: true, tokenInvalid: true }` on a 410 Gone (expired sync
 *   token) instead of throwing — callers use this to fall back to a full
 *   resync.
 *
 * INVARIANT GC-3 (pagination cap): listEvents MUST cap pagination at 20
 *   pages to prevent runaway loops against a misbehaving/huge calendar.
 *
 * @typedef {Object} GcalApiPort
 *
 * @property {() => OAuth2Client} createOAuth2Client
 *   Construct an OAuth2Client configured from GOOGLE_CLIENT_ID/SECRET and the
 *   redirect URI.
 *
 * @property {(oauth2Client: OAuth2Client, state: string) => string} getAuthUrl
 *   Build the Google consent-screen URL for the given OAuth2Client + state.
 *
 * @property {(oauth2Client: OAuth2Client, code: string) => Promise<Object>} getTokensFromCode
 *   Exchange an authorization code for tokens.
 *
 * @property {(oauth2Client: OAuth2Client, refreshToken: string) => Promise<Object>} refreshAccessToken
 *   Exchange a refresh token for fresh credentials.
 *
 * @property {(accessToken: string, timeMin: string, timeMax: string) => Promise<{items: Array<Object>, nextSyncToken: (string|null)}>} listEvents
 *   List events in a time range, paginating up to the cap (INVARIANT GC-3).
 *
 * @property {(accessToken: string, syncToken: string) => Promise<{hasChanges: boolean, changedCount?: number, nextSyncToken?: string, tokenInvalid?: boolean}>} checkForChanges
 *   Lightweight sync-token change check (INVARIANT GC-2).
 *
 * @property {(accessToken: string, event: Object) => Promise<Object>} insertEvent
 *   Create a calendar event.
 *
 * @property {(accessToken: string, eventId: string, patch: Object) => Promise<Object>} patchEvent
 *   Partially update an existing event.
 *
 * @property {(accessToken: string, eventId: string) => Promise<null>} deleteEvent
 *   Delete an event.
 *
 * @property {(accessToken: string, requests: Array<Object>) => Promise<Array<{id: string, status: number, body: (Object|null)}>>} batchRequest
 *   Send up to 50 sub-requests as one multipart/mixed batch call.
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function GcalApiPort() {}

GcalApiPort.prototype.createOAuth2Client = function createOAuth2Client() {
  throw new Error('GcalApiPort.createOAuth2Client not implemented');
};

GcalApiPort.prototype.getAuthUrl = function getAuthUrl(_oauth2Client, _state) {
  throw new Error('GcalApiPort.getAuthUrl not implemented');
};

GcalApiPort.prototype.getTokensFromCode = function getTokensFromCode(_oauth2Client, _code) {
  throw new Error('GcalApiPort.getTokensFromCode not implemented');
};

GcalApiPort.prototype.refreshAccessToken = function refreshAccessToken(_oauth2Client, _refreshToken) {
  throw new Error('GcalApiPort.refreshAccessToken not implemented');
};

GcalApiPort.prototype.listEvents = function listEvents(_accessToken, _timeMin, _timeMax) {
  throw new Error('GcalApiPort.listEvents not implemented');
};

GcalApiPort.prototype.checkForChanges = function checkForChanges(_accessToken, _syncToken) {
  throw new Error('GcalApiPort.checkForChanges not implemented');
};

GcalApiPort.prototype.insertEvent = function insertEvent(_accessToken, _event) {
  throw new Error('GcalApiPort.insertEvent not implemented');
};

GcalApiPort.prototype.patchEvent = function patchEvent(_accessToken, _eventId, _patch) {
  throw new Error('GcalApiPort.patchEvent not implemented');
};

GcalApiPort.prototype.deleteEvent = function deleteEvent(_accessToken, _eventId) {
  throw new Error('GcalApiPort.deleteEvent not implemented');
};

GcalApiPort.prototype.batchRequest = function batchRequest(_accessToken, _requests) {
  throw new Error('GcalApiPort.batchRequest not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy GcalApiPort.
 * @type {ReadonlyArray<string>}
 */
var GCAL_API_PORT_METHODS = Object.freeze([
  'createOAuth2Client',
  'getAuthUrl',
  'getTokensFromCode',
  'refreshAccessToken',
  'listEvents',
  'checkForChanges',
  'insertEvent',
  'patchEvent',
  'deleteEvent',
  'batchRequest'
]);

module.exports = GcalApiPort;
module.exports.GcalApiPort = GcalApiPort;
module.exports.GCAL_API_PORT_METHODS = GCAL_API_PORT_METHODS;
