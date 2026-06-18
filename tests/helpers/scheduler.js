var db = require('./test-db');
var runScheduleModule = require('../../src/scheduler/runSchedule');

/**
 * Run scheduler — calls the real runScheduleAndPersist.
 *
 * For tests that insert recurring templates (task_masters), the scheduler
 * expands them and persists instances to task_instances.
 * For tests that insert task_instances directly, the scheduler schedules them.
 *
 * Returns { scheduledTasks, dayPlacements, newStatuses, unplaced, placedCount,
 *           todayKey, nowMins }
 * where scheduledTasks is the flat list of persisted task_instances from DB.
 */
async function runScheduler(taskInput, statusInput, todayKey, nowMins, cfg) {
  // Run the real scheduler
  var result = await runScheduleModule.runScheduleAndPersist(1, 0, {
    timezone: (cfg && cfg.timezone) || 'America/New_York',
  });

  // Query persisted instances
  var instances = await db('task_instances')
    .where('user_id', 1)
    .select();

  var scheduledTasks = instances.map(function(t) {
    return {
      id: t.id,
      text: t.text,
      dur: t.dur,
      date: t.date ? fmtKey(t.date) : (t.scheduled_at ? fmtKey(t.scheduled_at) : ''),
      day: t.day,
      scheduled_at: t.scheduled_at,
      status: t.status
    };
  });

  return {
    scheduledTasks: scheduledTasks,
    dayPlacements: result ? (result.dayPlacements || {}) : {},
    newStatuses: result ? (result.newStatuses || {}) : {},
    unplaced: result ? (result.unplaced || []) : [],
    placedCount: result ? (result.placedCount || 0) : 0,
    todayKey: todayKey,
    nowMins: nowMins
  };
}

function fmtKey(d) {
  if (!d) return '';
  if (typeof d === 'string') {
    var p = d.split('-');
    if (p.length === 3) return parseInt(p[1], 10) + '/' + parseInt(p[2], 10) + '/' + p[0];
    return d;
  }
  return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
}

async function runSchedulerWithClock(clock) {
  var result = await runScheduler([], {}, clock.todayKey, clock.nowMins, {});
  return {
    timeInfo: { todayKey: clock.todayKey, nowMins: clock.nowMins },
    ...result
  };
}

module.exports = {
  runScheduler: runScheduler,
  runSchedulerWithClock: runSchedulerWithClock
};
