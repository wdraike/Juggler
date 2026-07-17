/**
 * ListProjects — application query use-case (999.1404).
 *
 * Reproduces the legacy MCP `list_projects` tool handler
 * (mcp/tools/config.js:64-97) over the ConfigRepositoryPort: read projects
 * (optionally filtered by name), fetch per-project task counts from tasks_v,
 * merge them, and return { status: 200, body: [{id,name,color,icon,taskCount,doneCount}] }.
 *
 * ── STEP-FOR-STEP ────────────────────────────────────────────────────────────
 *   1. repo.getProjects(userId) → rows ordered by sort_order.
 *   2. If name filter given, keep only rows where row.name === name.
 *   3. repo.getProjectTaskCounts(userId, projectNames) → [{project,total,done}].
 *   4. Build countMap: { projectName → {total, done} }.
 *   5. Map rows → [{ id, name, color, icon, taskCount, doneCount }].
 *   6. Return { status: 200, body: result }.
 *
 * ── NO NEW FALLBACKS ── `countMap[p.name]?.total || 0` preserved verbatim
 * from the legacy MCP handler (the `|| 0` is the characterized behavior when
 * a project has no tasks — not an unapproved data-integrity fallback).
 *
 * @typedef {Object} ListProjectsDeps
 * @property {import('../../domain/ports/ConfigRepositoryPort')} repo
 */

'use strict';

/** @param {ListProjectsDeps} deps */
function ListProjects(deps) {
  if (!deps || !deps.repo) throw new Error('ListProjects: { repo } is required');
  this.repo = deps.repo;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @param {string} [input.name]  optional exact-name filter
 * @returns {Promise<{ status: number, body: Object }>}
 */
ListProjects.prototype.execute = async function execute(input) {
  var userId = input.userId;
  var nameFilter = input.name;

  var projects = await this.repo.getProjects(userId);
  if (nameFilter) {
    projects = projects.filter(function (p) { return p.name === nameFilter; });
  }

  var projectNames = projects.map(function (p) { return p.name; });
  var counts = await this.repo.getProjectTaskCounts(userId, projectNames);

  var countMap = {};
  counts.forEach(function (c) { countMap[c.project] = { total: c.total, done: c.done }; });

  var result = projects.map(function (p) {
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      icon: p.icon,
      taskCount: countMap[p.name] ? countMap[p.name].total : 0,
      doneCount: countMap[p.name] ? countMap[p.name].done : 0
    };
  });

  return { status: 200, body: result };
};

module.exports = ListProjects;