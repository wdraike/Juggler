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
 *      acting_as_admin=admin id).
 *   2. AUDIT ATTRIBUTION FIX (jug-impersonation-stop-audit-misattribution / 999.553):
 *      only insert an audit row when actingAsAdmin is present — admin=actingAsAdmin,
 *      target=user.id. A plain authenticated user (no impersonation token) has no active
 *      impersonation, so no row is written. The legacy handler used
 *      `adminUserId = actingAsAdmin || user.id; targetUserId = actingAsAdmin ? user.id : null`,
 *      which falsely attributed a 'stop_impersonation' action to a non-admin (admin=self,
 *      target=null) on every plain /stop. That misattribution is corrected here.
 *   3. respond 200 { message: 'Impersonation stopped. Discard the impersonation token
 *      client-side.' } — unchanged in all cases.
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

  // jug-impersonation-stop-audit-misattribution (999.553): only record an audit row for a
  // REAL impersonation stop. The token of an active session carries acting_as_admin=<admin id>
  // and sub=<impersonated target>, so actingAsAdmin = the admin and user.id = the target —
  // correct attribution. A plain authenticated user (no impersonation token → no actingAsAdmin)
  // hitting /stop has no active impersonation; the old `actingAsAdmin || user.id` /
  // `actingAsAdmin ? user.id : null` recorded admin=self, target=null, falsely attributing a
  // 'stop_impersonation' action to a non-admin. Skip the audit insert in that case. The response
  // is unchanged (200) — any token is simply discarded client-side.
  if (actingAsAdmin) {
    await this._insertAuditRow(actingAsAdmin, user.id, 'stop_impersonation', input.audit || {});
  }

  return {
    status: 200,
    body: { message: 'Impersonation stopped. Discard the impersonation token client-side.' }
  };
};

module.exports = StopImpersonation;
