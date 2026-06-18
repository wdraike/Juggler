/**
 * KnexProjectsRepository — concrete ProjectsPort implementation (999.354).
 *
 * Upserts `projects` rows via Knex. Verbatim port of the legacy `ensureProject`
 * facade helper (controller L729-735): select-by-(user,name), insert if absent.
 * The `projects` table has no created_at/updated_at columns touched here, so
 * there is no P1 fn.now() concern on this path.
 */

'use strict';

var PROJECTS_PORT_METHODS =
  require('../domain/ports/ProjectsPort').PROJECTS_PORT_METHODS;

/**
 * @param {Object} [deps]
 * @param {Function} [deps.getDb]  () => Knex instance. Defaults to the shared pool.
 */
function KnexProjectsRepository(deps) {
  var d = deps || {};
  this.getDb = d.getDb || function () { return require('../../../lib/db').getDefaultDb(); };
}

/**
 * Idempotent project upsert. No-op when projectName is falsy.
 * @param {string} userId
 * @param {?string} projectName
 * @returns {Promise<void>}
 */
KnexProjectsRepository.prototype.ensureProject = async function ensureProject(userId, projectName) {
  if (!projectName) return;
  var db = this.getDb();
  var exists = await db('projects').where({ user_id: userId, name: projectName }).first();
  if (!exists) {
    await db('projects').insert({ user_id: userId, name: projectName });
  }
};

KnexProjectsRepository.PROJECTS_PORT_METHODS = PROJECTS_PORT_METHODS;

module.exports = KnexProjectsRepository;
