/**
 * InMemoryActionLogRepository — ActionLogPort test double (999.681).
 *
 * In-memory implementation for unit testing. Semantically identical to
 * KnexActionLogRepository: record deletes any previous entry for the task,
 * findLatest returns the single entry, remove deletes it.
 */

'use strict';

var ACTION_LOG_PORT_METHODS =
  require('../domain/ports/ActionLogPort').ACTION_LOG_PORT_METHODS;

/**
 * @param {Object} [deps]
 * @param {Object[]} [deps.rows]  seed entries (same shape as ActionLogEntry)
 */
function InMemoryActionLogRepository(deps) {
  var d = deps || {};
  this._store = {}; // key: "taskId:userId" → entry
  if (Array.isArray(d.rows)) {
    var self = this;
    d.rows.forEach(function (r) {
      self._store[r.task_id + ':' + r.user_id] = Object.assign({}, r);
    });
  }
}

InMemoryActionLogRepository.prototype.record = function record(entry) {
  // Delete previous + insert (single-undo semantics)
  var key = entry.task_id + ':' + entry.user_id;
  this._store[key] = Object.assign({}, entry);
  // Deep-clone before/after so external mutation can't corrupt stored state
  if (this._store[key].before) this._store[key].before = JSON.parse(JSON.stringify(this._store[key].before));
  if (this._store[key].after) this._store[key].after = JSON.parse(JSON.stringify(this._store[key].after));
  return Promise.resolve();
};

InMemoryActionLogRepository.prototype.findLatest = function findLatest(taskId, userId) {
  var key = taskId + ':' + userId;
  var entry = this._store[key];
  if (!entry) return Promise.resolve(null);
  var out = Object.assign({}, entry);
  if (out.before) out.before = JSON.parse(JSON.stringify(out.before));
  if (out.after) out.after = JSON.parse(JSON.stringify(out.after));
  return Promise.resolve(out);
};

InMemoryActionLogRepository.prototype.remove = function remove(taskId, userId) {
  var key = taskId + ':' + userId;
  var existed = key in this._store;
  delete this._store[key];
  return Promise.resolve(existed ? 1 : 0);
};

InMemoryActionLogRepository.ACTION_LOG_PORT_METHODS = ACTION_LOG_PORT_METHODS;

module.exports = InMemoryActionLogRepository;