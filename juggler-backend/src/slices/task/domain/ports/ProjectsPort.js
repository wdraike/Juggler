/**
 * ProjectsPort — driven-port contract for the projects table (999.354).
 *
 * The task slice does NOT own the `projects` table — it only needs to guarantee
 * a project row exists for a (user, name) pair before a task references it
 * (`task_masters.project` is a free-text name, upserted lazily). Historically
 * this was the injected `ensureProject` facade helper that the CreateTask /
 * UpdateTask / BatchCreateTasks use-cases reached through. This port promotes
 * that single DB-touching seam so the use-cases depend on a typed interface
 * instead of a bare facade function (matching the ActionLogPort / TaskCachePort
 * pattern).
 *
 * Behavior-preserving: the Knex adapter performs the exact same select-then-
 * insert upsert the legacy `ensureProject` did (controller L729-735).
 *
 * @typedef {Object} ProjectsPort
 * @property {(userId: string, projectName: ?string) => Promise<void>} ensureProject
 *   Idempotent upsert: if `projectName` is falsy, no-op. Otherwise insert a
 *   `projects` row for (userId, projectName) when one does not already exist.
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function ProjectsPort() {}

ProjectsPort.prototype.ensureProject = function ensureProject(_userId, _projectName) {
  throw new Error('ProjectsPort.ensureProject not implemented');
};

var PROJECTS_PORT_METHODS = Object.freeze([
  'ensureProject'
]);

module.exports = ProjectsPort;
module.exports.ProjectsPort = ProjectsPort;
module.exports.PROJECTS_PORT_METHODS = PROJECTS_PORT_METHODS;
