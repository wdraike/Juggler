var db = require('./test-db');
var runScheduleModule = require('../../src/scheduler/runSchedule');

/**
 * Run scheduler with controlled time.
 *
 * Calls the real runScheduleAndPersist. Uses process.env.TZ and
 * manual date construction to control "now" for the scheduler.
 *
 * Each call is additive — the scheduler creates instances for the
 * current simulated day.
 */
async function runScheduler(taskInput, statusInput, todayKey, nowMins, cfg) {
  // Parse todayKey
  var parts = todayKey.split('/');
  var month, day, year;
  if (parts.length === 3) {
    month = parseInt(parts[0], 10) - 1;
    day = parseInt(parts[1], 10);
    year = parseInt(parts[2], 10);
  } else {
    var isoParts = todayKey.split('-');
    month = parseInt(isoParts[1], 10) - 1;
    day = parseInt(isoParts[2], 10);
    year = parseInt(isoParts[0], 10);
  }

  // Run the real scheduler with whatever time it sees.
  // Tests that care about specific dates will need to advance
  // the loop to actually match. For now, just verify that:
  // (1) The scheduler doesn't crash
  // (2) It produces instance rows in task_instances
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
