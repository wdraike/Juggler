/**
 * task-instances.js — recurring-family id expansion.
 *
 * 999.1192/999.1198: extracted VERBATIM from
 * slices/task/adapters/KnexTaskRepository.expandToAllInstanceIds (itself the
 * verbatim relocation of the legacy controller helper) so lib/task-write-queue
 * can expand flushed ids to the whole recurring family WITHOUT requiring
 * controllers/task.controller (the require cycle
 * task-write-queue → task.controller → slices/task/facade → task-write-queue).
 * KnexTaskRepository delegates here, so the facade/controller exports are the
 * same function logic bound over the repo's own db handle.
 *
 * @param {Object} dbOrTrx  knex instance or transaction handle
 * @param {string} userId
 * @param {string[]} ids
 * @returns {Promise<string[]>} the input ids plus every master + sibling
 *   instance id of any recurring master they touch (deduped)
 */

'use strict';

function expandToAllInstanceIds(dbOrTrx, userId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return Promise.resolve(ids || []);
  var masterIds = new Set();
  return dbOrTrx('task_masters')
    .where('user_id', userId)
    .whereIn('id', ids)
    .where('recurring', 1)
    .select('id')
    .then(function (masters) {
      masters.forEach(function (r) { masterIds.add(r.id); });
      return dbOrTrx('task_instances')
        .where('user_id', userId)
        .whereIn('id', ids)
        .select('id', 'master_id');
    })
    .then(function (insts) {
      insts.forEach(function (r) { if (r.master_id) masterIds.add(r.master_id); });
      if (masterIds.size === 0) return ids;
      return dbOrTrx('task_instances')
        .where('user_id', userId)
        .whereIn('master_id', Array.from(masterIds))
        .select('id')
        .then(function (siblings) {
          var out = {};
          ids.forEach(function (i) { out[i] = true; });
          masterIds.forEach(function (m) { out[m] = true; });
          siblings.forEach(function (r) { out[r.id] = true; });
          return Object.keys(out);
        });
    });
}

module.exports = { expandToAllInstanceIds: expandToAllInstanceIds };
