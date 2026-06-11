/**
 * UpdateProject — application command use-case (Phase H4 / W5).
 *
 * Reproduces the legacy `updateProject` handler (config.controller.js:263-287)
 * over the W3 ConfigRepositoryPort (transaction) + injected cache + the task-rename
 * cascade collaborator.
 *
 * ── STEP-FOR-STEP ────────────────────────────────────────────────────────────
 *   1. repo.runInTransaction(async trxRepo => {
 *        - trxRepo.updateProjectById(userId, id, { name, color, icon, updated_at:new Date() })
 *          (P1: the repo stamps new Date(), correcting the legacy getDb().fn.now()).
 *        - if (oldName && name && oldName !== name): renameTasks(trx, userId, oldName,
 *          name) — the cross-table tasks rename (tasksWrite.updateTasksWhere) is
 *          INJECTED (tasks table is outside the config repo port). It runs inside the
 *          SAME transaction (the legacy did the rename within the trx).
 *      }).
 *   2. cache.invalidateConfig(userId); if renamed → cache.invalidateTasks(userId).
 *   3. respond { project: { id:parseInt(id), name, color, icon },
 *               renamed: renamed ? { from: oldName, to: name } : null }.
 *
 * NOTE (golden-master H1-15): via the HTTP PUT route the zod schema STRIPS oldName,
 * so the rename branch never fires through that route — but the handler BODY still
 * contains the branch, so this use-case reproduces it faithfully (the W6 controller
 * passes whatever body.oldName survives validation, preserving the route behavior).
 *
 * ── NO NEW FALLBACKS ── the `renamed` ternary + parseInt(id) preserved verbatim.
 *
 * @typedef {Object} UpdateProjectDeps
 * @property {import('../../domain/ports/ConfigRepositoryPort')} repo
 * @property {{invalidateConfig: Function, invalidateTasks: Function}} cache
 * @property {(trxRepo: *, userId: string, oldName: string, name: string) => Promise<void>} renameTasks
 *   the cross-table task-project rename (legacy tasksWrite.updateTasksWhere within
 *   the trx) — injected. Receives the `trxRepo` the repo passes to its work fn; the
 *   real (W6) impl reads `trxRepo.db` (the knex trx handle) to run the rename inside
 *   the SAME transaction. The tasks table is outside the config repo port, so this
 *   is an injected collaborator (the CreateTask `ensureProject` seam pattern).
 */

'use strict';

/** @param {UpdateProjectDeps} deps */
function UpdateProject(deps) {
  if (!deps || !deps.repo || !deps.cache || !deps.renameTasks) {
    throw new Error('UpdateProject: { repo, cache, renameTasks } are required');
  }
  this.repo = deps.repo;
  this.cache = deps.cache;
  this.renameTasks = deps.renameTasks;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @param {*} input.id      the project id (route param — may be a string).
 * @param {Object} input.body  { name, color, icon, oldName }.
 * @returns {Promise<{ status: number, body: Object }>}
 */
UpdateProject.prototype.execute = async function execute(input) {
  var self = this;
  var userId = input.userId;
  var id = input.id;
  var body = input.body || {};
  var name = body.name;
  var color = body.color;
  var icon = body.icon;
  var oldName = body.oldName;

  var renamed = oldName && name && oldName !== name;

  await this.repo.runInTransaction(async function (trxRepo) {
    await trxRepo.updateProjectById(userId, id, {
      name: name, color: color, icon: icon, updated_at: new Date() // P1
    });
    if (renamed) {
      // Cross-table rename runs inside the SAME transaction (legacy boundary).
      // The real impl reads trxRepo.db (the knex trx handle).
      await self.renameTasks(trxRepo, userId, oldName, name);
    }
  });

  await this.cache.invalidateConfig(userId);
  if (renamed) await this.cache.invalidateTasks(userId); // project rename cascades to tasks

  return {
    status: 200,
    body: {
      project: { id: parseInt(id), name: name, color: color, icon: icon },
      renamed: renamed ? { from: oldName, to: name } : null
    }
  };
};

module.exports = UpdateProject;
