/**
 * KnexActionLogRepository — concrete ActionLogPort implementation (999.681).
 *
 * Persists action log entries in the `action_log` MySQL table via Knex.
 * Only the LATEST action per task is stored (single-undo semantics):
 * `record` deletes any existing entry for the same task before inserting.
 *
 * INVARIANT P1: created_at is stamped with new Date() (never db.fn.now()).
 */

'use strict';

var ACTION_LOG_PORT_METHODS =
  require('../domain/ports/ActionLogPort').ACTION_LOG_PORT_METHODS;

/**
 * @param {Object} [deps]
 * @param {Function} [deps.db] Knex instance (default: lib/db's shared pool).
 */
function KnexActionLogRepository(deps) {
  var d = deps || {};
  this.db = d.db || require('../../../lib/db').getDefaultDb();
}

/**
 * Record an action log entry. Deletes any previous entry for the task first
 * (single-undo: only the most recent action is reversible).
 * @param {Object} entry
 * @param {string} entry.id         uuidv7 primary key
 * @param {string} entry.user_id
 * @param {string} entry.task_id
 * @param {string} entry.action_type  'status_change' | 'field_update' | 'delete'
 * @param {Object} [entry.before]     JSON-serializable snapshot before action
 * @param {Object} [entry.after]      JSON-serializable snapshot after action
 * @param {Date}   entry.created_at   P1: JS Date, never fn.now()
 * @returns {Promise<void>}
 */
KnexActionLogRepository.prototype.record = function record(entry) {
  var db = this.db;
  // Delete any previous entry for this task (single-undo semantics)
  return db('action_log')
    .where({ task_id: entry.task_id, user_id: entry.user_id })
    .del()
    .then(function () {
      return db('action_log').insert({
        id: entry.id,
        user_id: entry.user_id,
        task_id: entry.task_id,
        action_type: entry.action_type,
        before: entry.before ? JSON.stringify(entry.before) : null,
        after: entry.after ? JSON.stringify(entry.after) : null,
        created_at: entry.created_at
      });
    });
};

/**
 * Find the latest action log entry for a task + user.
 * Returns null if no entry exists.
 * @param {string} taskId
 * @param {string} userId
 * @returns {Promise<?Object>}
 */
KnexActionLogRepository.prototype.findLatest = function findLatest(taskId, userId) {
  return this.db('action_log')
    .where({ task_id: taskId, user_id: userId })
    .first()
    .then(function (row) {
      if (!row) return null;
      // Parse JSON columns back to objects
      return {
        id: row.id,
        user_id: row.user_id,
        task_id: row.task_id,
        action_type: row.action_type,
        before: row.before ? (typeof row.before === 'string' ? JSON.parse(row.before) : row.before) : null,
        after: row.after ? (typeof row.after === 'string' ? JSON.parse(row.after) : row.after) : null,
        created_at: row.created_at
      };
    });
};

/**
 * Delete the action log entry for a task + user. Returns rows removed (0 or 1).
 * @param {string} taskId
 * @param {string} userId
 * @returns {Promise<number>}
 */
KnexActionLogRepository.prototype.remove = function remove(taskId, userId) {
  return this.db('action_log')
    .where({ task_id: taskId, user_id: userId })
    .del()
    .then(function (count) {
      return typeof count === 'number' ? count : 0;
    });
};

KnexActionLogRepository.ACTION_LOG_PORT_METHODS = ACTION_LOG_PORT_METHODS;

module.exports = KnexActionLogRepository;