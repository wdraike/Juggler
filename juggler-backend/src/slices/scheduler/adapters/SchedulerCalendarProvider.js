/**
 * SchedulerCalendarProvider — concrete CalendarProviderPort. Phase H6 / W2.
 *
 * Thin pass-through over the calendar slice facade (`slices/calendar/facade.js`).
 * In the H6 extraction the scheduler's externally-busy time arrives as FIXED tasks
 * in the `tasks_v` working set (synced in by cal-sync), so `getBusyIntervals`
 * defaults to an EMPTY set — this keeps the scheduler OUTPUT bit-for-bit identical
 * (the golden-master fixtures carry busy intervals as FIXED tasks). The seam over
 * the calendar facade exists so a future scheduler revision (W3+) can source busy
 * time directly without re-coupling to the cal-sync controller.
 *
 * No live behavior change in W2 — this is the forward-looking port boundary.
 */

'use strict';

var CALENDAR_PROVIDER_PORT_METHODS =
  require('../domain/ports/CalendarProviderPort').CALENDAR_PROVIDER_PORT_METHODS;

/**
 * @param {Object} [deps]
 * @param {Object} [deps.calendarFacade] the calendar slice facade (default: the
 *   real `slices/calendar/facade`). Injectable for unit tests / future busy-query
 *   wiring. Resolved LAZILY (the calendar facade pulls in adapters; lazy keeps the
 *   scheduler load light when busy-query is unused — the H6 default path).
 */
function SchedulerCalendarProvider(deps) {
  var d = deps || {};
  this._calendarFacade = d.calendarFacade || null;
}

SchedulerCalendarProvider.prototype._facade = function _facade() {
  if (!this._calendarFacade) {
    this._calendarFacade = require('../../calendar/facade');
  }
  return this._calendarFacade;
};

/**
 * Externally-busy intervals for the user. Default: `[]` (busy time arrives as
 * FIXED tasks — H6 behavior preserved bit-for-bit). The calendar facade is
 * available via `this._facade()` for W3+ to source real busy intervals.
 */
SchedulerCalendarProvider.prototype.getBusyIntervals = function getBusyIntervals(_userId, _opts) {
  return Promise.resolve([]);
};

module.exports = SchedulerCalendarProvider;
module.exports.SchedulerCalendarProvider = SchedulerCalendarProvider;
module.exports.CALENDAR_PROVIDER_PORT_METHODS = CALENDAR_PROVIDER_PORT_METHODS;
