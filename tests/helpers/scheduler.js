var db = require('./test-db');
var runSchedule = require('../../src/scheduler/runSchedule');

/**
 * Run scheduler in DB-backed mode.
 *
 * Test pattern: insert recurring templates into DB, then call runScheduler.
 * This wrapper calls the real runScheduleAndPersist which:
 * 1. Loads tasks + templates from DB
 * 2. Expands recurring templates into instances
 * 3. Runs unifiedScheduleV2 on expanded tasks
 * 4. Persists results to task_instances
 * 5. Returns scheduling result with todayKey/nowMins
 *
 * After the call, tests can query task_instances from DB to verify.
 */
async function runScheduler(taskInput, statusInput, todayKey, nowMins, cfg) {
  // The real DB-backed scheduler. taskInput/statusInput are ignored —
  // runScheduleAndPersist reads directly from the database.
  var result = await runSchedule.runScheduleAndPersist(1, 0, {
    timezone: (cfg && cfg.timezone) || 'America/New_York',
  }, {
    todayKey: todayKey,
    nowMins: nowMins,
    instantRun: true
  });

  // Query the persisted instances
  var instances = await db('task_instances')
    .where('user_id', 1)
    .where(function() {
      this.where('status', '').orWhereNull('status');
    })
    .select();

  return {
    scheduledTasks: instances,
    dayPlacements: result ? (result.dayPlacements || {}) : {},
    newStatuses: result ? (result.newStatuses || {}) : {},
    unplaced: result ? (result.unplaced || []) : [],
    placedCount: result ? (result.placedCount || 0) : 0,
    todayKey: todayKey,
    nowMins: nowMins
  };
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
