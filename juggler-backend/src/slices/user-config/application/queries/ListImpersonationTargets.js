/**
 * ListImpersonationTargets — application query use-case (Phase H4 / W5).
 *
 * Reproduces the legacy `getImpersonationTargets` handler
 * (impersonation.controller.js:95-121) over the W3 ConfigRepositoryPort.
 *
 * ── AUTHZ NOTE ──────────────────────────────────────────────────────────────
 * This is an ADMIN-only read (golden-master H5-8: non-admin → 403). The admin
 * gate is the route-layer `authenticateAdmin` middleware (W6) — it fires BEFORE
 * this use-case. This use-case reproduces the handler BODY (the limit/offset
 * clamps + the repo list + the pagination shape); it does NOT re-implement the
 * admin gate (that is the route's job, preserved in W6). The repo's
 * listImpersonationTargets query is admin-scoped (NOT user-tenant-scoped) exactly
 * as the legacy query was — preserved as-is.
 *
 * ── STEP-FOR-STEP ────────────────────────────────────────────────────────────
 *   1. clamp limit: parsedLimit = parseInt(limit); lim = min(max(1, NaN?50:parsed), 100).
 *   2. clamp offset: off = max(0, parseInt(offset) || 0).
 *   3. repo.listImpersonationTargets({ search, limit: lim, offset: off }) → {users, total}.
 *   4. body = { users, pagination: { total, limit, offset, hasMore: off+lim < total } }.
 *
 * ── NO NEW FALLBACKS ── the `limit = 50` / `offset = 0` query defaults + the
 * `NaN ? 50 : parsed` + `parseInt(offset) || 0` are preserved verbatim.
 *
 * @typedef {Object} ListImpersonationTargetsDeps
 * @property {import('../../domain/ports/ConfigRepositoryPort')} repo
 */

'use strict';

/** @param {ListImpersonationTargetsDeps} deps */
function ListImpersonationTargets(deps) {
  if (!deps || !deps.repo) throw new Error('ListImpersonationTargets: { repo } is required');
  this.repo = deps.repo;
}

/**
 * @param {Object} input
 * @param {Object} input.query  the req.query (search, limit, offset).
 * @returns {Promise<{ status: number, body: Object }>}
 */
ListImpersonationTargets.prototype.execute = async function execute(input) {
  var q = input.query || {};
  var search = q.search;
  var limit = q.limit === undefined ? 50 : q.limit;
  var offset = q.offset === undefined ? 0 : q.offset;

  var parsedLimit = parseInt(limit);
  var lim = Math.min(Math.max(1, Number.isNaN(parsedLimit) ? 50 : parsedLimit), 100);
  var off = Math.max(0, parseInt(offset) || 0);

  var result = await this.repo.listImpersonationTargets({ search: search, limit: lim, offset: off });
  var total = parseInt(result.total);

  return {
    status: 200,
    body: {
      users: result.users,
      pagination: { total: total, limit: lim, offset: off, hasMore: off + lim < total }
    }
  };
};

module.exports = ListImpersonationTargets;
