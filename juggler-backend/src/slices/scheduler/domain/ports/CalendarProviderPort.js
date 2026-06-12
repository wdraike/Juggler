/**
 * CalendarProviderPort — driven-port contract for the scheduler's view of
 * externally-busy calendar time (Phase H6 / W2).
 *
 * The pure `ConflictResolver` resolves placements against a `calendarBusy`
 * occupancy set. In the current scheduler, externally-fixed calendar events are
 * represented as FIXED tasks in the working set (synced in by cal-sync), so the
 * busy intervals already flow through the `tasks_v` read. This port exists to
 * make that dependency EXPLICIT and to give the W3 command a typed seam over the
 * calendar slice facade (`slices/calendar/facade.js`) for any direct busy-time
 * query a future scheduler revision needs — without re-coupling the scheduler to
 * the cal-sync controller.
 *
 * Contract only (W2) — JSDoc `@typedef` + throw-not-implemented base. The default
 * adapter is a thin pass-through over the calendar facade; the InMemory test
 * double returns an empty busy set (the golden-master fixtures carry their busy
 * intervals as FIXED tasks, so the default scheduler path needs no live busy
 * query — this keeps that behavior bit-for-bit while the seam exists for W3+).
 *
 * ── BINDING INVARIANT (no behavior change) ───────────────────────────────────
 * In the H6 extraction the scheduler's OUTPUT is pinned bit-for-bit. The default
 * `SchedulerCalendarProvider` MUST NOT introduce any new busy interval the legacy
 * scheduler did not already see (those arrive as FIXED tasks). `getBusyIntervals`
 * defaults to an empty set so the golden-master output is unchanged; the method
 * is the forward-looking seam, not a live behavior in W2.
 *
 * @typedef {Object} BusyInterval
 * @property {string} dateKey
 * @property {number} start  local minutes-from-midnight
 * @property {number} dur    minutes
 *
 * @typedef {Object} CalendarProviderPort
 *
 * @property {(userId: string, opts?: {timezone?: string, horizonDays?: number}) => Promise<BusyInterval[]>} getBusyIntervals
 *   Externally-busy intervals for the user over the scheduling horizon. The
 *   default adapter returns `[]` (busy time arrives as FIXED tasks in the working
 *   set — H6 behavior preserved). The seam lets W3+ source busy time from the
 *   calendar facade without re-coupling to the cal-sync controller.
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function CalendarProviderPort() {}

CalendarProviderPort.prototype.getBusyIntervals = function getBusyIntervals(_userId, _opts) {
  throw new Error('CalendarProviderPort.getBusyIntervals not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy CalendarProviderPort.
 * @type {ReadonlyArray<string>}
 */
var CALENDAR_PROVIDER_PORT_METHODS = Object.freeze([
  'getBusyIntervals'
]);

module.exports = CalendarProviderPort;
module.exports.CalendarProviderPort = CalendarProviderPort;
module.exports.CALENDAR_PROVIDER_PORT_METHODS = CALENDAR_PROVIDER_PORT_METHODS;
