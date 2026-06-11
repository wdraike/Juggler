/**
 * GetImpersonationLog — application query use-case (Phase H4 / W5).
 *
 * Reproduces the legacy `getImpersonationLog` handler
 * (impersonation.controller.js:123-154) over the W3 ConfigRepositoryPort.
 *
 * ── AUTHZ NOTE ── ADMIN-only read (golden-master H5-11: non-admin → 403). The
 * admin gate is the route-layer `authenticateAdmin` (W6), firing BEFORE this
 * use-case. This reproduces the handler BODY only (clamp + repo list + pagination).
 * The repo's listImpersonationLog query is admin-scoped (the leftJoin to
 * admin_users for admin_email) exactly as the legacy query — preserved as-is.
 *
 * ── STEP-FOR-STEP ────────────────────────────────────────────────────────────
 *   1. clamp limit/offset identically to the targets list.
 *   2. repo.listImpersonationLog({ limit, offset, adminUserId, targetUserId }) →
 *      {logs, total}. The optional admin/target filters are forwarded verbatim.
 *   3. body = { logs, pagination: { total, limit, offset, hasMore } }.
 *
 * ── NO NEW FALLBACKS ── preserved verbatim from the handler.
 *
 * @typedef {Object} GetImpersonationLogDeps
 * @property {import('../../domain/ports/ConfigRepositoryPort')} repo
 */

'use strict';

/** @param {GetImpersonationLogDeps} deps */
function GetImpersonationLog(deps) {
  if (!deps || !deps.repo) throw new Error('GetImpersonationLog: { repo } is required');
  this.repo = deps.repo;
}

/**
 * @param {Object} input
 * @param {Object} input.query  the req.query (limit, offset, adminUserId, targetUserId).
 * @returns {Promise<{ status: number, body: Object }>}
 */
GetImpersonationLog.prototype.execute = async function execute(input) {
  var q = input.query || {};
  var limit = q.limit === undefined ? 50 : q.limit;
  var offset = q.offset === undefined ? 0 : q.offset;
  var adminUserId = q.adminUserId;
  var targetUserId = q.targetUserId;

  var parsedLimit = parseInt(limit);
  var lim = Math.min(Math.max(1, Number.isNaN(parsedLimit) ? 50 : parsedLimit), 100);
  var off = Math.max(0, parseInt(offset) || 0);

  var result = await this.repo.listImpersonationLog({
    limit: lim,
    offset: off,
    adminUserId: adminUserId,
    targetUserId: targetUserId
  });
  var total = parseInt(result.total);

  return {
    status: 200,
    body: {
      logs: result.logs,
      pagination: { total: total, limit: lim, offset: off, hasMore: off + lim < total }
    }
  };
};

module.exports = GetImpersonationLog;
