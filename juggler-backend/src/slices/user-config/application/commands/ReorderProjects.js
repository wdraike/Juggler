/**
 * ReorderProjects — application command use-case (Phase H4 / W5).
 *
 * Reproduces the legacy `reorderProjects` handler (config.controller.js:212-238)
 * over the W3 ConfigRepositoryPort (transaction) + injected cache.
 *
 * ── STEP-FOR-STEP ────────────────────────────────────────────────────────────
 *   1. !Array.isArray(ids) → 400 'ids array required'.
 *   2. ids.length > 500 → 400 'Too many ids (max 500)'.
 *   3. escaped = ids.map(Number).filter(Number.isFinite); build [id, idx] pairs
 *      (the legacy CASE WHEN id THEN idx). When escaped is empty the legacy trx body
 *      early-returns (no UPDATE) — reproduced by passing an empty pair list (the
 *      repo no-ops on empty).
 *   4. repo.runInTransaction(trxRepo => trxRepo.reorderProjects(userId, pairs)) —
 *      the single CASE UPDATE the legacy ran inside the transaction (P1 updated_at
 *      = new Date() in the repo, correcting the legacy getDb().fn.now()).
 *   5. cache.invalidateConfig(userId).
 *   6. respond { reordered: ids.length } — the ORIGINAL ids length, NOT the escaped
 *      count (preserved verbatim, golden-master H1-17).
 *
 * ── NO NEW FALLBACKS ── preserved verbatim from the handler.
 *
 * @typedef {Object} ReorderProjectsDeps
 * @property {import('../../domain/ports/ConfigRepositoryPort')} repo
 * @property {{invalidateConfig: Function}} cache
 */

'use strict';

/** @param {ReorderProjectsDeps} deps */
function ReorderProjects(deps) {
  if (!deps || !deps.repo || !deps.cache) {
    throw new Error('ReorderProjects: { repo, cache } are required');
  }
  this.repo = deps.repo;
  this.cache = deps.cache;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @param {*} input.ids  the ordered id array (req.body.ids).
 * @returns {Promise<{ status: number, body: Object }>}
 */
ReorderProjects.prototype.execute = async function execute(input) {
  var userId = input.userId;
  var ids = input.ids;

  if (!Array.isArray(ids)) return { status: 400, body: { error: 'ids array required' } };
  if (ids.length > 500) return { status: 400, body: { error: 'Too many ids (max 500)' } };

  var escaped = ids.map(function (id) { return Number(id); }).filter(function (n) { return Number.isFinite(n); });
  var pairs = escaped.map(function (id, idx) { return [id, idx]; });

  await this.repo.runInTransaction(function (trxRepo) {
    return trxRepo.reorderProjects(userId, pairs);
  });

  await this.cache.invalidateConfig(userId);
  return { status: 200, body: { reordered: ids.length } };
};

module.exports = ReorderProjects;
