/**
 * calendar-facade-trigger.js — the scheduler-adapter → calendar-facade seam
 * (CalendarFacadeTriggerPort, 999.1628 JUG-REQUIRE-CYCLES-X13).
 *
 * scheduler/adapters/SchedulerCalendarProvider.js's `_facade()` accessor used
 * to lazy-require slices/calendar/facade.js directly (a forward-looking seam
 * for a future scheduler revision to source busy time from the calendar slice
 * — `getBusyIntervals` itself never calls `_facade()` today, see that file's
 * header). A lazy require is STILL a graph edge for check-require-cycles.js
 * (its own header: "a lazy require is still a graph edge; laziness only
 * papers over init order"). slices/calendar/facade.js's gatherProviderSyncData
 * (999.1025 sub-leg 2) requires slices/scheduler/facade.js for ConstraintSolver,
 * which pulls in scheduler/adapters/index.js -> SchedulerCalendarProvider.js —
 * closing the cycle
 *   calendar/facade → scheduler/facade → adapters/index →
 *   SchedulerCalendarProvider → calendar/facade.
 * This module INVERTS that last edge: it is a dependency-free registry that
 * slices/calendar/facade.js populates at ITS load time (see the
 * registerCalendarFacade call at the bottom of that file).
 * SchedulerCalendarProvider reads from it instead of requiring the facade
 * directly; nothing here requires the calendar facade back.
 *
 * Wiring guarantee: every production entrypoint loads slices/calendar/facade.js
 * before a scheduler run could construct a SchedulerCalendarProvider (app.js's
 * route mounting requires the calendar facade well before any scheduler
 * request is served).
 *
 * Unregistered contract: getCalendarFacade loudly logs and returns null when
 * nothing has registered yet (mirrors scheduleTrigger/cal-sync-trigger's
 * fail-loud unregistered contract) — no silent substitution.
 */

'use strict';

var { createLogger } = require('@raike/lib-logger');
var logger = createLogger('calendar-facade-trigger');

var _calendarFacade = null;

/**
 * Register the calendar slice facade. Called by slices/calendar/facade.js at
 * module load; tests may register a stub.
 * @param {Object} facade the calendar slice facade module.exports
 */
function registerCalendarFacade(facade) {
  _calendarFacade = facade;
}

/**
 * Read the registered calendar facade.
 * @returns {Object|null}
 */
function getCalendarFacade() {
  if (!_calendarFacade) {
    logger.error('[CAL-FACADE-TRIGGER] no calendar facade registered — '
      + '(slices/calendar/facade was never loaded)');
  }
  return _calendarFacade;
}

module.exports = {
  registerCalendarFacade: registerCalendarFacade,
  getCalendarFacade: getCalendarFacade
};
