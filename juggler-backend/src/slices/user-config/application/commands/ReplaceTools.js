/**
 * ReplaceTools — application command use-case (Phase H4 / W5).
 *
 * Reproduces the legacy `replaceTools` handler (config.controller.js:372-397)
 * over the W3 ConfigRepositoryPort (transaction) + injected cache + injected parse.
 *
 * ── STEP-FOR-STEP ────────────────────────────────────────────────────────────
 *   1. parseBody(body) (the legacy toolsBodySchema.safeParse) — !success → 400
 *      { error: 'Invalid tools payload', details: error.issues }.
 *   2. repo.runInTransaction(trxRepo => trxRepo.replaceTools(userId, rows)) — the
 *      delete-all-then-insert the legacy ran inside the transaction; the row mapping
 *      (tool_id, sort_order=index, icon||'') is byte-identical to lines 381-388.
 *   3. cache.invalidateConfig(userId).
 *   4. respond { tools } — the PARSED tools (golden-master H1-23 echoes the input).
 *
 * ── NO NEW FALLBACKS ── `t.icon || ''` preserved verbatim.
 *
 * @typedef {Object} ReplaceToolsDeps
 * @property {import('../../domain/ports/ConfigRepositoryPort')} repo
 * @property {{invalidateConfig: Function}} cache
 * @property {(body: *) => {success: boolean, data?: {tools: Object[]}, error?: {issues: *}}} parseBody
 *   the toolsBodySchema.safeParse — injected (application layer stays zod-free).
 */

'use strict';

/** @param {ReplaceToolsDeps} deps */
function ReplaceTools(deps) {
  if (!deps || !deps.repo || !deps.cache || !deps.parseBody) {
    throw new Error('ReplaceTools: { repo, cache, parseBody } are required');
  }
  this.repo = deps.repo;
  this.cache = deps.cache;
  this.parseBody = deps.parseBody;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @param {*} input.body  the raw request body ({ tools: [...] }).
 * @returns {Promise<{ status: number, body: Object }>}
 */
ReplaceTools.prototype.execute = async function execute(input) {
  var userId = input.userId;

  var parsed = this.parseBody(input.body);
  if (!parsed.success) {
    return { status: 400, body: { error: 'Invalid tools payload', details: parsed.error.issues } };
  }
  var tools = parsed.data.tools;

  await this.repo.runInTransaction(function (trxRepo) {
    var rows = tools.map(function (t, i) {
      return {
        user_id: userId,
        tool_id: t.id,
        name: t.name,
        icon: t.icon || '',
        sort_order: i
      };
    });
    return trxRepo.replaceTools(userId, rows);
  });

  await this.cache.invalidateConfig(userId);
  return { status: 200, body: { tools: tools } };
};

module.exports = ReplaceTools;
