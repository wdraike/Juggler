/**
 * MsftCalApiPort — driven-port contract for the low-level Microsoft Graph
 * calendar REST API client (999.944 H7 — lib/msft-cal-api.js).
 *
 * Mirrors the LockPort/RedisPort/JwtSecretPort idiom: a JSDoc `@typedef`, a
 * throw-not-implemented prototype base, and a frozen METHODS array.
 *
 * Wraps `src/lib/msft-cal-api.js` — the PKCE OAuth2 + Graph REST wrapper
 * consumed by the calendar hex slice's `MicrosoftCalendarAdapter` — so it
 * exposes EXACTLY that surface: `generatePkce` / `getAuthUrl` /
 * `getTokensFromCode` / `refreshAccessToken` / `getUserInfo` / `listEvents`
 * / `checkForChanges` / `insertEvent` / `patchEvent` / `deleteEvent` /
 * `batchRequest`.
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT MC-1 (PKCE required): getAuthUrl MUST include a S256
 *   code_challenge (Azure AD /common endpoint rejects apps without PKCE);
 *   getTokensFromCode MUST supply the matching code_verifier.
 *
 * INVARIANT MC-2 (retry-then-throw on rate limit): a 429/503 response is
 *   retried up to 3 times with exponential/Retry-After backoff; after the
 *   final attempt the port MUST throw rather than return a partial/garbage
 *   result.
 *
 * INVARIANT MC-3 (delta-link expiry signal): checkForChanges MUST return
 *   `{ hasChanges: true, tokenInvalid: true }` on an expired/invalid delta
 *   link (410 / syncStateNotFound) instead of throwing — callers use this to
 *   fall back to a full resync.
 *
 * INVARIANT MC-4 (identity scope): getUserInfo MUST return the connected
 *   Microsoft account's own email/UPN (via User.Read), never the local
 *   Raike account email.
 *
 * @typedef {Object} MsftCalApiPort
 *
 * @property {() => {codeVerifier: string, codeChallenge: string}} generatePkce
 *   Generate a PKCE code_verifier/code_challenge (S256) pair (INVARIANT MC-1).
 *
 * @property {(state: string, codeChallenge: string) => string} getAuthUrl
 *   Build the Microsoft consent-screen URL, PKCE-bound (INVARIANT MC-1).
 *
 * @property {(code: string, codeVerifier: string) => Promise<{accessToken: string, refreshToken: (string|null), expiresIn: number, expiresOn: Date}>} getTokensFromCode
 *   Exchange an authorization code + verifier for tokens (INVARIANT MC-1).
 *
 * @property {(refreshToken: string) => Promise<{accessToken: string, refreshToken: string, expiresOn: Date}>} refreshAccessToken
 *   Exchange a refresh token for fresh credentials.
 *
 * @property {(accessToken: string) => Promise<{email: (string|null)}>} getUserInfo
 *   Fetch the signed-in account's identity (INVARIANT MC-4).
 *
 * @property {(accessToken: string, startDateTime: string, endDateTime: string) => Promise<{items: Array<Object>}>} listEvents
 *   List events in a time range, following @odata.nextLink pagination.
 *
 * @property {(accessToken: string, deltaLink: string) => Promise<{hasChanges: boolean, changedCount?: number, deltaLink?: string, tokenInvalid?: boolean}>} checkForChanges
 *   Lightweight delta-query change check (INVARIANT MC-3).
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
 *   Send up to 20 sub-requests as one Graph $batch call.
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function MsftCalApiPort() {}

MsftCalApiPort.prototype.generatePkce = function generatePkce() {
  throw new Error('MsftCalApiPort.generatePkce not implemented');
};

MsftCalApiPort.prototype.getAuthUrl = function getAuthUrl(_state, _codeChallenge) {
  throw new Error('MsftCalApiPort.getAuthUrl not implemented');
};

MsftCalApiPort.prototype.getTokensFromCode = function getTokensFromCode(_code, _codeVerifier) {
  throw new Error('MsftCalApiPort.getTokensFromCode not implemented');
};

MsftCalApiPort.prototype.refreshAccessToken = function refreshAccessToken(_refreshToken) {
  throw new Error('MsftCalApiPort.refreshAccessToken not implemented');
};

MsftCalApiPort.prototype.getUserInfo = function getUserInfo(_accessToken) {
  throw new Error('MsftCalApiPort.getUserInfo not implemented');
};

MsftCalApiPort.prototype.listEvents = function listEvents(_accessToken, _startDateTime, _endDateTime) {
  throw new Error('MsftCalApiPort.listEvents not implemented');
};

MsftCalApiPort.prototype.checkForChanges = function checkForChanges(_accessToken, _deltaLink) {
  throw new Error('MsftCalApiPort.checkForChanges not implemented');
};

MsftCalApiPort.prototype.insertEvent = function insertEvent(_accessToken, _event) {
  throw new Error('MsftCalApiPort.insertEvent not implemented');
};

MsftCalApiPort.prototype.patchEvent = function patchEvent(_accessToken, _eventId, _patch) {
  throw new Error('MsftCalApiPort.patchEvent not implemented');
};

MsftCalApiPort.prototype.deleteEvent = function deleteEvent(_accessToken, _eventId) {
  throw new Error('MsftCalApiPort.deleteEvent not implemented');
};

MsftCalApiPort.prototype.batchRequest = function batchRequest(_accessToken, _requests) {
  throw new Error('MsftCalApiPort.batchRequest not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy MsftCalApiPort.
 * @type {ReadonlyArray<string>}
 */
var MSFT_CAL_API_PORT_METHODS = Object.freeze([
  'generatePkce',
  'getAuthUrl',
  'getTokensFromCode',
  'refreshAccessToken',
  'getUserInfo',
  'listEvents',
  'checkForChanges',
  'insertEvent',
  'patchEvent',
  'deleteEvent',
  'batchRequest'
]);

module.exports = MsftCalApiPort;
module.exports.MsftCalApiPort = MsftCalApiPort;
module.exports.MSFT_CAL_API_PORT_METHODS = MSFT_CAL_API_PORT_METHODS;
