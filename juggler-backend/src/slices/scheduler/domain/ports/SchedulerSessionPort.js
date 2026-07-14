/**
 * SchedulerSessionPort — driven-port contract for the `scheduler_sessions`
 * CRUD behind the legacy `src/scheduler/schedulerSession.js` DB-backed
 * session store for the admin Stepper UI (JUG-SCHEDULER-LEGACY-DB-BYPASS /
 * 999.1532).
 *
 * A stepper session is a DISTINCT lifecycle from the scheduler's
 * task-placement writes (`ScheduleRepositoryPort`) and the queue's
 * claim/heartbeat lifecycle (`ScheduleQueuePort`) — hence its own port.
 * `schedulerSession.js` never runs inside a transaction, so every method
 * takes the caller's `db` handle explicitly (same convention as
 * `ScheduleQueuePort` / `TaskProviderPort`).
 *
 * Contract only — JSDoc `@typedef` + throw-not-implemented base, mirroring
 * `TaskProviderPort` / `ScheduleQueuePort`.
 *
 * @typedef {Object} SchedulerSessionPort
 *
 * @property {(db: Function, now: Date) => Promise<number>} deleteExpiredSessions
 *   Delete every session whose `expires_at` is before `now` — the background
 *   sweeper (verbatim — `schedulerSession.js` `sweep` ~43). Returns rows removed.
 *
 * @property {(db: Function, row: Object) => Promise<void>} insertSession
 *   Insert a new session row (verbatim — `startSession` ~119-133).
 *
 * @property {(db: Function, sessionId: string, now: Date) => Promise<Object|undefined>} getActiveSession
 *   Read the session row for `sessionId`, scoped to `expires_at > now`
 *   (verbatim — `getSession`'s read ~155-158).
 *
 * @property {(db: Function, sessionId: string, expiresAt: Date) => Promise<number>} touchSessionExpiry
 *   Extend a session's TTL on access (verbatim — `getSession`'s touch
 *   ~162-164). Returns rows updated.
 *
 * @property {(db: Function, sessionId: string) => Promise<number>} deleteSession
 *   Delete a session by id (verbatim — `stopSession` ~263). Returns rows removed.
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function SchedulerSessionPort() {}

SchedulerSessionPort.prototype.deleteExpiredSessions = function deleteExpiredSessions(_db, _now) {
  throw new Error('SchedulerSessionPort.deleteExpiredSessions not implemented');
};

SchedulerSessionPort.prototype.insertSession = function insertSession(_db, _row) {
  throw new Error('SchedulerSessionPort.insertSession not implemented');
};

SchedulerSessionPort.prototype.getActiveSession = function getActiveSession(_db, _sessionId, _now) {
  throw new Error('SchedulerSessionPort.getActiveSession not implemented');
};

SchedulerSessionPort.prototype.touchSessionExpiry = function touchSessionExpiry(_db, _sessionId, _expiresAt) {
  throw new Error('SchedulerSessionPort.touchSessionExpiry not implemented');
};

SchedulerSessionPort.prototype.deleteSession = function deleteSession(_db, _sessionId) {
  throw new Error('SchedulerSessionPort.deleteSession not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy SchedulerSessionPort.
 * @type {ReadonlyArray<string>}
 */
var SCHEDULER_SESSION_PORT_METHODS = Object.freeze([
  'deleteExpiredSessions',
  'insertSession',
  'getActiveSession',
  'touchSessionExpiry',
  'deleteSession'
]);

module.exports = SchedulerSessionPort;
module.exports.SchedulerSessionPort = SchedulerSessionPort;
module.exports.SCHEDULER_SESSION_PORT_METHODS = SCHEDULER_SESSION_PORT_METHODS;
