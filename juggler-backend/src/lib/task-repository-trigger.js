/**
 * task-repository-trigger.js — the write-queue → task-repository seam
 * (TaskRepositoryTriggerPort, 999.1628 JUG-REQUIRE-CYCLES-X13).
 *
 * lib/task-write-queue.js used to lazy-require slices/task/facade.js for
 * KnexTaskRepository — a lazy require is STILL a graph edge for
 * check-require-cycles.js (its own header: "a lazy require is still a graph
 * edge; laziness only papers over init order"), and slices/task/facade.js
 * top-level-requires lib/task-write-queue.js (isLocked/enqueueWrite/
 * splitFields), closing the cycle
 *   task-write-queue → slices/task/facade → task-write-queue.
 * This module INVERTS that edge: it is a dependency-free registry that
 * slices/task/facade.js populates at ITS load time (see the
 * registerKnexTaskRepository call at the bottom of facade.js). The write-queue
 * flush (the sole external consumer) depends only on this seam; nothing here
 * requires the facade back.
 *
 * Wiring guarantee: every production entrypoint loads slices/task/facade.js
 * before any write-queue flush can fire (server.js/routes/controllers require
 * it at boot — e.g. controllers/cal-sync.controller.js requires it directly
 * for its own KnexTaskRepository use, and task/facade.js itself is required
 * across the app's route wiring), so the registry is always populated in a
 * running app.
 *
 * Unregistered contract: getKnexTaskRepository loudly logs and returns
 * undefined when nothing has registered yet (mirrors scheduleTrigger's
 * fail-loud unregistered contract) — no silent substitution of a different
 * repository implementation.
 */

'use strict';

var { createLogger } = require('@raike/lib-logger');
var logger = createLogger('task-repository-trigger');

var _KnexTaskRepository = null;

/**
 * Register the real KnexTaskRepository constructor. Called by
 * slices/task/facade.js at module load; tests may register a stub.
 * @param {Function} Ctor the KnexTaskRepository class
 */
function registerKnexTaskRepository(Ctor) {
  _KnexTaskRepository = Ctor;
}

/**
 * Read the registered KnexTaskRepository constructor.
 * @returns {Function|undefined}
 */
function getKnexTaskRepository() {
  if (!_KnexTaskRepository) {
    logger.error('[TASK-REPO-TRIGGER] no KnexTaskRepository registered — '
      + '(slices/task/facade was never loaded)');
  }
  return _KnexTaskRepository;
}

module.exports = {
  registerKnexTaskRepository: registerKnexTaskRepository,
  getKnexTaskRepository: getKnexTaskRepository
};
