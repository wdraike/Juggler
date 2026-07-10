/**
 * GetStepperSessionOwner — application query use-case (999.1196).
 *
 * Extracted VERBATIM from schedule.routes.js POST /step/:sessionId/stop's
 * fallback branch: when schedulerSession.getSession(sessionId) has already
 * returned null (session expired or never existed), the route needs the RAW
 * scheduler_sessions row — bypassing getSession's expiry filter — to tell
 * "gone" (200, idempotent) from "not yours" (403).
 *
 * scheduler_sessions is NOT modeled on ScheduleRepositoryPort (that port
 * covers only the scheduler's task-write surface) and schedulerSession.js
 * (the module that owns every OTHER scheduler_sessions touchpoint) is a
 * concurrently-owned file this leg does not modify — so this one read is its
 * own small use-case, injected with a `findOwner` collaborator, mirroring the
 * user-config facade's "lifted verbatim, port doesn't model this table" idiom.
 *
 * @typedef {Object} GetStepperSessionOwnerDeps
 * @property {(sessionId: string) => Promise<{user_id: string}|undefined>} findOwner
 */

'use strict';

function GetStepperSessionOwner(deps) {
  this._findOwner = deps.findOwner;
}

/**
 * @param {string} sessionId
 * @returns {Promise<{user_id: string}|undefined>}
 */
GetStepperSessionOwner.prototype.execute = function execute(sessionId) {
  return this._findOwner(sessionId);
};

module.exports = GetStepperSessionOwner;
