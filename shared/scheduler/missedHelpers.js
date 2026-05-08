/**
 * juggler-cal-history — shared helpers for "missed" status computation.
 *
 * A pending recurring instance becomes "missed" once its placement window has closed.
 * Window-close = scheduled_at + timeFlex minutes (default 60).
 *
 * Used by:
 *   - juggler-backend/src/scheduler/runSchedule.js (event-triggered auto-mark)
 *   - juggler-backend/src/cron/cal-history-cron.js (periodic auto-mark sweep)
 *
 * Pure functions, no DB access — safe to import in either backend or shared/.
 */

function getScheduledAt(task) {
  return task && (task.scheduledAt || task.scheduled_at);
}

function windowCloseUtc(task) {
  var sa = getScheduledAt(task);
  if (!sa) return null;
  var saDate = new Date(sa);
  if (isNaN(saDate.getTime())) return null;
  var flexMin = (task.timeFlex != null) ? task.timeFlex : 60;
  return new Date(saDate.getTime() + flexMin * 60 * 1000);
}

function isPastWindow(task, now) {
  var wc = windowCloseUtc(task);
  if (!wc) return false;
  return wc.getTime() < (now ? now.getTime() : Date.now());
}

module.exports = {
  windowCloseUtc: windowCloseUtc,
  isPastWindow: isPastWindow
};
