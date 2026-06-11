/**
 * CreateProject — application command use-case (Phase H4 / W5).
 *
 * Reproduces the legacy `createProject` handler (config.controller.js:241-261)
 * over the W3 ConfigRepositoryPort + injected cache.
 *
 * ── STEP-FOR-STEP ────────────────────────────────────────────────────────────
 *   1. name guard: !name → 400 'Project name required'.
 *   2. maxOrder = repo.getMaxProjectSortOrder(userId); sort_order = (maxOrder||0)+1.
 *   3. id = repo.insertProject(userId, { name, color||null, icon||null, sort_order }).
 *   4. cache.invalidateConfig(userId).
 *   5. respond 201 { project: { id, name, color, icon } }.
 *
 * NOTE the route-layer checkProjectLimit (entity-limit) + zod projectSchema
 * validation fire BEFORE this handler (golden-master H1-12/H1-13). They are
 * route-middleware concerns (W6 wires checkProjectLimit → EnforceEntityLimit), NOT
 * part of this handler body. The handler's own `!name → 400` guard IS reproduced.
 *
 * ── NO NEW FALLBACKS ── `color || null`, `icon || null`, `(maxOrder?.max || 0)`
 * preserved verbatim.
 *
 * @typedef {Object} CreateProjectDeps
 * @property {import('../../domain/ports/ConfigRepositoryPort')} repo
 * @property {{invalidateConfig: Function}} cache
 */

'use strict';

/** @param {CreateProjectDeps} deps */
function CreateProject(deps) {
  if (!deps || !deps.repo || !deps.cache) {
    throw new Error('CreateProject: { repo, cache } are required');
  }
  this.repo = deps.repo;
  this.cache = deps.cache;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @param {Object} input.body  { name, color, icon }.
 * @returns {Promise<{ status: number, body: Object }>}
 */
CreateProject.prototype.execute = async function execute(input) {
  var userId = input.userId;
  var body = input.body || {};
  var name = body.name;
  var color = body.color;
  var icon = body.icon;

  if (!name) return { status: 400, body: { error: 'Project name required' } };

  var maxOrder = await this.repo.getMaxProjectSortOrder(userId);
  var id = await this.repo.insertProject(userId, {
    name: name,
    color: color || null,
    icon: icon || null,
    sort_order: (maxOrder || 0) + 1
  });

  await this.cache.invalidateConfig(userId);
  return { status: 201, body: { project: { id: id, name: name, color: color, icon: icon } } };
};

module.exports = CreateProject;
