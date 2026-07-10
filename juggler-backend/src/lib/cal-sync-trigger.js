/**
 * cal-sync-trigger.js — the task-mutation → outbound-calendar-sync seam
 * (CalSyncTriggerPort, 999.1192 JUG-HEX-SLICES-CALL-CONTROLLERS).
 *
 * slices/task/facade used to lazy-require controllers/cal-sync.controller from
 * inside the domain layer and call sync() with a FAKE express req/res — the
 * hexagon inverted (domain → HTTP controller) and one of the 11 require cycles
 * (task facade → cal-sync.controller → calendar facade/scheduleQueue → … →
 * task facade). This module inverts the edge: it is a dependency-free registry;
 * controllers/cal-sync.controller registers the HTTP-shaped sync entry here at
 * ITS load time (the fake req/res construction now lives controller-side, where
 * request shapes belong). The task facade depends only on this seam.
 *
 * NOTE (999.1025): cal-sync.controller.sync() itself is untouched — only the
 * CALLER's dependency moved, per the 999.1192 leg constraint.
 *
 * Unregistered contract: triggerSync is fire-and-forget; the legacy facade code
 * swallowed ALL trigger failures (try/catch around the require + call, logging
 * via logger.error and resolving). When no trigger is registered (production
 * always registers — routes load cal-sync.controller at boot) the call LOUDLY
 * logs and resolves, byte-equivalent to the legacy swallow path.
 */

'use strict';

var { createLogger } = require('@raike/lib-logger');
var logger = createLogger('cal-sync-trigger');

var _trigger = null;

/**
 * Register the outbound-sync trigger. Called by controllers/cal-sync.controller
 * at module load; tests may register a stub.
 * @param {Function} fn ({ userId }) → Promise
 */
function registerCalSyncTrigger(fn) {
  _trigger = fn;
}

/**
 * Fire the outbound cal-sync for a user (fire-and-forget; never throws).
 * @param {{userId: string}} args
 * @returns {Promise}
 */
function triggerSync(args) {
  if (!_trigger) {
    logger.error('[cal-sync] no outbound sync trigger registered — sync skipped '
      + '(controllers/cal-sync.controller was never loaded) userId=' + (args && args.userId));
    return Promise.resolve();
  }
  try {
    return _trigger(args);
  } catch (err) {
    logger.error('[cal-sync] trigger failed:', err && err.message);
  }
  return Promise.resolve();
}

module.exports = {
  registerCalSyncTrigger: registerCalSyncTrigger,
  triggerSync: triggerSync
};
