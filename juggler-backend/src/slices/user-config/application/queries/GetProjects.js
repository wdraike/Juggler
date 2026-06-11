/**
 * GetProjects — application query use-case (Phase H4 / W5).
 *
 * Reproduces the legacy `getProjects` handler (config.controller.js:196-204) over
 * the W3 ConfigRepositoryPort: read projects ordered by sort_order, map to the
 * {id,name,color,icon,sortOrder} API shape, return { status: 200, body: {projects} }.
 *
 * @typedef {Object} GetProjectsDeps
 * @property {import('../../domain/ports/ConfigRepositoryPort')} repo
 */

'use strict';

/** @param {GetProjectsDeps} deps */
function GetProjects(deps) {
  if (!deps || !deps.repo) throw new Error('GetProjects: { repo } is required');
  this.repo = deps.repo;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @returns {Promise<{ status: number, body: Object }>}
 */
GetProjects.prototype.execute = async function execute(input) {
  var rows = await this.repo.getProjects(input.userId);
  return {
    status: 200,
    body: {
      projects: rows.map(function (p) {
        return { id: p.id, name: p.name, color: p.color, icon: p.icon, sortOrder: p.sort_order };
      })
    }
  };
};

module.exports = GetProjects;
