/**
 * Impersonate — application command use-case (Phase H4 / W5). SECURITY-SENSITIVE.
 *
 * Reproduces the legacy `startImpersonation` handler (impersonation.controller.js:44-79)
 * — the admin-gated actor-switch + audit-log insert — over the injected
 * auth-service call + the W3 ConfigRepositoryPort audit insert.
 *
 * ── AUTHZ GUARDS (BINDING — elmo gate; NONE dropped) ─────────────────────────
 *   1. ADMIN GATE: the route-layer `authenticateAdmin` middleware (W6) restricts
 *      /start to ADMIN_EMAILS (golden-master H5-1: non-admin → 403). It fires BEFORE
 *      this use-case — preserved in the route layer, NOT re-implemented here (it is
 *      an edge concern, exactly as the legacy split it). This use-case is reachable
 *      only behind that gate.
 *   2. SELF-IMPERSONATION GUARD: targetUserId === admin.id → 400 'Cannot impersonate
 *      yourself' (impersonation.controller.js:52-54). REPRODUCED here verbatim.
 *   3. MISSING TARGET GUARD: !targetUserId → 400 'targetUserId is required'
 *      (impersonation.controller.js:49-51). REPRODUCED here.
 *   4. INTERNAL_SERVICE_KEY GUARD: callAuthServiceImpersonate throws
 *      'INTERNAL_SERVICE_KEY is not set' when the key is unset
 *      (impersonation.controller.js:7-8). That guard lives INSIDE the injected
 *      `callAuthServiceImpersonate` collaborator (it reads process.env at call time
 *      + makes the HTTP call — infra). A thrown >= 500 (incl. the key-unset Error,
 *      which has no `.status`) → 503 'Impersonation service unavailable'
 *      (golden-master H5-13). PRESERVED via the error-classification below.
 *   5. AUTH-SERVICE ERROR PASS-THROUGH: a thrown error with `.status` < 500 →
 *      res.status(err.status).json(err.body || { error: err.message }) — the 4xx
 *      from auth-service propagates UNCHANGED (golden-master H5-4). PRESERVED.
 *
 * ── AUDIT (P1) ── on success, insert the impersonation_log row via the repo
 * (insertImpersonationLog) with created_at/updated_at = new Date() (the legacy
 * insertAuditRow already used new Date() — P1-correct, preserved). The audit insert
 * is best-effort: a thrown insert is swallowed (legacy insertAuditRow try/catch) so
 * a logging failure never blocks the impersonation — reproduced via the injected
 * `auditLogger.warn` on a swallowed error. The audit row is inserted AFTER the
 * successful auth-service call, exactly as the legacy ordered it.
 *
 * @typedef {Object} ImpersonateDeps
 * @property {import('../../domain/ports/ConfigRepositoryPort')} repo
 * @property {(adminUserId: string, targetUserId: string, reason: ?string) => Promise<Object>} callAuthServiceImpersonate
 *   the auth-service /internal/auth/impersonate call (legacy callAuthServiceImpersonate
 *   — reads INTERNAL_SERVICE_KEY, throws if unset, throws an err with `.status`/`.body`
 *   on a non-ok response). INJECTED (cross-service infra).
 * @property {Object} [auditLogger]  { warn } — for the swallowed audit-insert error
 *   (legacy insertAuditRow's catch). Defaults to a no-op.
 */

'use strict';

/** @param {ImpersonateDeps} deps */
function Impersonate(deps) {
  if (!deps || !deps.repo || !deps.callAuthServiceImpersonate) {
    throw new Error('Impersonate: { repo, callAuthServiceImpersonate } are required');
  }
  this.repo = deps.repo;
  this.callAuthServiceImpersonate = deps.callAuthServiceImpersonate;
  this.auditLogger = deps.auditLogger || { warn: function () {} };
}

/**
 * Best-effort audit insert — reproduces insertAuditRow (impersonation.controller.js:28-42).
 * A thrown insert is swallowed (warn) so a logging failure never blocks the action.
 * P1: created_at/updated_at = new Date().
 */
Impersonate.prototype._insertAuditRow = async function _insertAuditRow(adminUserId, targetUserId, action, audit) {
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
 * @param {Object} input.admin  the authenticated admin (req.user — { id, ... }).
 * @param {string} input.targetUserId
 * @param {?string} [input.reason]
 * @param {Object} input.audit  { ip, userAgent } — for the audit row.
 * @returns {Promise<{ status: number, body: Object }>}
 */
Impersonate.prototype.execute = async function execute(input) {
  var admin = input.admin;
  var targetUserId = input.targetUserId;
  var reason = input.reason;
  var audit = input.audit || {};

  // GUARD 3: missing target (handler L49-51)
  if (!targetUserId) {
    return { status: 400, body: { error: 'targetUserId is required' } };
  }
  // GUARD 2: self-impersonation (handler L52-54)
  if (targetUserId === admin.id) {
    return { status: 400, body: { error: 'Cannot impersonate yourself' } };
  }

  // auth-service call (handler L56-65) — GUARD 4 (INTERNAL_SERVICE_KEY) lives inside.
  var result;
  try {
    result = await this.callAuthServiceImpersonate(admin.id, targetUserId, reason);
  } catch (err) {
    // GUARD 5: 4xx pass-through (handler L60-61)
    if (err.status && err.status < 500) {
      return { status: err.status, body: err.body || { error: err.message } };
    }
    // >= 500 (incl. the INTERNAL_SERVICE_KEY-unset Error, which has no .status) → 503
    // (handler L62-64). The 'auth-service call failed' log line stays in the W6
    // controller (an express/logging concern); the classification is preserved here.
    return { status: 503, body: { error: 'Impersonation service unavailable' }, _serviceError: err };
  }

  // audit insert (handler L67) — AFTER the successful call, P1 new Date().
  await this._insertAuditRow(admin.id, targetUserId, 'start_impersonation', audit);

  // success (handler L69-74)
  return {
    status: 200,
    body: {
      message: 'Impersonation started',
      accessToken: result.access_token,
      expiresIn: result.expires_in,
      impersonating: result.impersonating
    }
  };
};

module.exports = Impersonate;
