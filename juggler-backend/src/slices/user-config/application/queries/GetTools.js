/**
 * GetTools — application query use-case (Phase H4 / W5).
 *
 * Reproduces the legacy `getTools` handler (config.controller.js:362-370) over the
 * W3 ConfigRepositoryPort: read tools ordered by sort_order, map to the
 * {id,name,icon} API shape, return { status: 200, body: {tools} }.
 *
 * @typedef {Object} GetToolsDeps
 * @property {import('../../domain/ports/ConfigRepositoryPort')} repo
 */

'use strict';

/** @param {GetToolsDeps} deps */
function GetTools(deps) {
  if (!deps || !deps.repo) throw new Error('GetTools: { repo } is required');
  this.repo = deps.repo;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @returns {Promise<{ status: number, body: Object }>}
 */
GetTools.prototype.execute = async function execute(input) {
  var rows = await this.repo.getTools(input.userId);
  return {
    status: 200,
    body: { tools: rows.map(function (t) { return { id: t.tool_id, name: t.name, icon: t.icon }; }) }
  };
};

module.exports = GetTools;
