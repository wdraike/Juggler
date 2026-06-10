/**
 * GetVersion — application query use-case (Phase H3 / W5).
 *
 * Reproduces the legacy `getVersion` HTTP handler (task.controller.js ~710)
 * step-for-step, over the W3/W4 ports:
 *
 *   1. cache hit → return cached `{ version }` (TaskCachePort.getVersion).
 *   2. miss → compute the version token (TaskRepositoryPort.getTasksVersion),
 *      cache it (TaskCachePort.setVersion, legacy 30s TTL owned by the adapter),
 *      return `{ version }`.
 *
 * Behavior-identical: same cache key (`user:<id>:version`) + 30s TTL + payload
 * shape as the legacy handler. Errors propagate (W6 keeps the 500 mapping).
 *
 * @typedef {Object} GetVersionDeps
 * @property {import('../../domain/ports/TaskRepositoryPort')} repo
 * @property {import('../../domain/ports/TaskCachePort')} cache
 */

'use strict';

/** @param {GetVersionDeps} deps */
function GetVersion(deps) {
  if (!deps || !deps.repo || !deps.cache) {
    throw new Error('GetVersion: { repo, cache } are required');
  }
  this.repo = deps.repo;
  this.cache = deps.cache;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @returns {Promise<{ version: string }>}
 */
GetVersion.prototype.execute = function execute(input) {
  var self = this;
  var userId = input.userId;
  return this.cache.getVersion(userId).then(function (cached) {
    if (cached) return cached;
    return self.repo.getTasksVersion(userId).then(function (version) {
      var result = { version: version };
      return self.cache.setVersion(userId, result).then(function () { return result; });
    });
  });
};

module.exports = GetVersion;
