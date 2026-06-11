/**
 * StopImpersonation — application command use-case (Phase H4 / W5).
 *
 * Reproduces the legacy `stopImpersonation` handler (impersonation.controller.js:81-93)
 * over the W3 ConfigRepositoryPort audit insert.
 *
 * ── AUTHZ NOTE ── any AUTHENTICATED user may call /stop (golden-master H5-6/H5-7);
 * the route requires only authentication (W6), NOT the admin gate. This use-case
 * reproduces the handler body: derive admin/target from the impersonation token
 * context, insert the audit row, respond.
 *
 * ── STEP-FOR-STEP (handler L82-88) ───────────────────────────────────────────
 *   1. actingAsAdmin = auth.actingAsAdmin (from the impersonation token: sub=target,
 *      acting_as_admin=admin id). adminUserId = actingAsAdmin || user.id;
 *      targetUserId = actingAsAdmin ? user.id : null. (Preserved verbatim.)
 *   2. insert the audit row ('stop_impersonation', P1 new Date(), best-effort).
 *   3. respond 200 { message: 'Impersonation stopped. Discard the impersonation token
 *      client-side.' }.
 *
 * ── NO NEW FALLBACKS ── `actingAsAdmin || user.id` and the `actingAsAdmin ? … : null`
 * are preserved verbatim from the handler.
 *
 * @typedef {Object} StopImpersonationDeps
 * @property {import('../../domain/ports/ConfigRepositoryPort')} repo
 * @property {Object} [auditLogger]  { warn } — for the swallowed audit-insert error.
 */

'use strict';

/** @param {StopImpersonationDeps} deps */
function StopImpersonation(deps) {
  if (!deps || !deps.repo) throw new Error('StopImpersonation: { repo } is required');
  this.repo = deps.repo;
  this.auditLogger = deps.auditLogger || { warn: function () {} };
}

StopImpersonation.prototype._insertAuditRow = async function _insertAuditRow(adminUserId, targetUserId, action, audit) {
  try {
    await this.repo.insertImpersonationLog({
      admin_user_id: adminUserId,
      target_user_id: targetUserId || null,
      action: action,
      ip_address: audit.ip,
      user_agent: audit.userAgent,
      created_at: new Date(),
      updated_at: new Date()
    });
  } catch (auditErr) {
    this.auditLogger.warn('[juggler/impersonation] audit insert failed:', auditErr.message);
  }
};

/**
 * @param {Object} input
 * @param {Object} input.user  the authenticated user (req.user).
 * @param {?string} [input.actingAsAdmin]  req.auth?.actingAsAdmin (from the token).
 * @param {Object} input.audit  { ip, userAgent }.
 * @returns {Promise<{ status: number, body: Object }>}
 */
StopImpersonation.prototype.execute = async function execute(input) {
  var user = input.user;
  var actingAsAdmin = input.actingAsAdmin;

  // sub=target, acting_as_admin=admin ID (handler L83-86).
  var adminUserId = actingAsAdmin || user.id;
  var targetUserId = actingAsAdmin ? user.id : null;

  await this._insertAuditRow(adminUserId, targetUserId, 'stop_impersonation', input.audit || {});

  return {
    status: 200,
    body: { message: 'Impersonation stopped. Discard the impersonation token client-side.' }
  };
};

module.exports = StopImpersonation;
