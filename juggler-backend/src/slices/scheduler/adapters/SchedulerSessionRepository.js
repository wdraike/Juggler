/**
 * SchedulerSessionRepository — concrete SchedulerSessionPort
 * (SCHEDULER_SESSION_PORT_METHODS). JUG-SCHEDULER-LEGACY-DB-BYPASS (999.1532).
 *
 * Every query is a VERBATIM relocation of what
 * `src/scheduler/schedulerSession.js` ran inline — no behavior change. The
 * module never runs inside a transaction, so every method takes the caller's
 * `db` handle explicitly as its first argument, matching
 * `SchedulerQueueRepository`'s calling convention. Stateless singleton — no
 * constructor deps needed.
 */

'use strict';

var SCHEDULER_SESSION_PORT_METHODS =
  require('../domain/ports/SchedulerSessionPort').SCHEDULER_SESSION_PORT_METHODS;
var stampInsert = require('../../../lib/audit-context').stampInsert; // 999.1576 inc.4

function SchedulerSessionRepository() {}

/**
 * Delete every session whose expires_at is before `now` (verbatim —
 * schedulerSession.js `sweep` ~43).
 */
SchedulerSessionRepository.prototype.deleteExpiredSessions = function deleteExpiredSessions(db, now) {
  return db('scheduler_sessions').where('expires_at', '<', now).delete();
};

/**
 * Insert a new session row (verbatim — `startSession` ~119-133).
 */
SchedulerSessionRepository.prototype.insertSession = function insertSession(db, row) {
  return db('scheduler_sessions').insert(stampInsert(row));
};

/**
 * Read the session row for sessionId, scoped to expires_at > now (verbatim —
 * `getSession`'s read ~155-158).
 */
SchedulerSessionRepository.prototype.getActiveSession = function getActiveSession(db, sessionId, now) {
  return db('scheduler_sessions')
    .where('session_id', sessionId)
    .where('expires_at', '>', now)
    .first();
};

/**
 * Extend a session's TTL on access (verbatim — `getSession`'s touch
 * ~162-164).
 */
SchedulerSessionRepository.prototype.touchSessionExpiry = function touchSessionExpiry(db, sessionId, expiresAt) {
  return db('scheduler_sessions')
    .where('session_id', sessionId)
    .update({ expires_at: expiresAt });
};

/**
 * Delete a session by id (verbatim — `stopSession` ~263).
 */
SchedulerSessionRepository.prototype.deleteSession = function deleteSession(db, sessionId) {
  return db('scheduler_sessions').where('session_id', sessionId).delete();
};

module.exports = SchedulerSessionRepository;
module.exports.SchedulerSessionRepository = SchedulerSessionRepository;
module.exports.SCHEDULER_SESSION_PORT_METHODS = SCHEDULER_SESSION_PORT_METHODS;
