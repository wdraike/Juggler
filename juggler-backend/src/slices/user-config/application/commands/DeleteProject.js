/**
 * DeleteProject — application command use-case (Phase H4 / W5).
 *
 * Reproduces the legacy `deleteProject` handler (config.controller.js:289-299)
 * over the W3 ConfigRepositoryPort + injected cache:
 *   1. repo.deleteProjectById(userId, id).
 *   2. cache.invalidateConfig(userId).
 *   3. respond { message: 'Project deleted', id }.
 *
 * NOTE the legacy handler returns the RAW route `id` (a string) in the body — the
 * golden-master H1-16 pins `res.body.id === '7'`. Preserved verbatim (the use-case
 * echoes input.id unchanged).
 *
 * @typedef {Object} DeleteProjectDeps
 * @property {import('../../domain/ports/ConfigRepositoryPort')} repo
 * @property {{invalidateConfig: Function}} cache
 */

'use strict';

/** @param {DeleteProjectDeps} deps */
function DeleteProject(deps) {
  if (!deps || !deps.repo || !deps.cache) {
    throw new Error('DeleteProject: { repo, cache } are required');
  }
  this.repo = deps.repo;
  this.cache = deps.cache;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @param {*} input.id  the project id (route param — echoed verbatim in the body).
 * @returns {Promise<{ status: number, body: Object }>}
 */
DeleteProject.prototype.execute = async function execute(input) {
  await this.repo.deleteProjectById(input.userId, input.id);
  await this.cache.invalidateConfig(input.userId);
  return { status: 200, body: { message: 'Project deleted', id: input.id } };
};

module.exports = DeleteProject;
