var db = require('./test-db');
var expandRecurring = require('../../../shared/scheduler/expandRecurring').expandRecurring;
var unifiedScheduleV2 = require('../../src/scheduler/unifiedScheduleV2');

/**
 * Run scheduler in pure in-memory mode matching original test design.
 *
 * Loads recurring templates from DB, expands them (expandRecurring),
 * runs the pure scheduler (unifiedScheduleV2), and returns
 * { scheduledTasks: [{text, date, day, ...}, ...] }.
 *
 * This is a SINGLE-CALL scheduler — it expands all templates in the
 * recur_start..recur_end range and schedules them in one pass.
 * Tests assert on the full expanded set, not day-by-day.
 */
async function runScheduler(taskInput, statusInput, reqTodayKey, reqNowMins, cfg) {
  // 1. Load recurring templates from DB
  var masters = await db('task_masters')
    .where('user_id', 1)
    .select();

  var tasks = [];
  masters.forEach(function(m) {
    tasks.push({
      id: m.id,
      user_id: m.user_id,
      text: m.text,
      dur: m.dur,
      pri: m.pri,
      when: m.when,
      day_req: m.day_req,
      recurring: m.recurring,
      recur: typeof m.recur === 'string' ? JSON.parse(m.recur) : m.recur,
      recur_start: m.recur_start,
      recur_end: m.recur_end,
      disabled_at: m.disabled_at,
      disabled_reason: m.disabled_reason,
      placement_mode: m.placement_mode,
      deadline: m.deadline,
      depends_on: m.depends_on,
      start_after_at: m.start_after_at,
      taskType: 'recurring_template'
    });
  });

  // 2. Determine today
  var todayKey = reqTodayKey || computeTodayKey();
  var nowMins = reqNowMins !== undefined ? reqNowMins : 480;

  // 3. Expand recurring templates
  var startDate = parseDate(todayKey);
  var endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 30); // expand 30 days

  var expanded = expandRecurring(tasks, startDate, endDate, {
    statuses: statusInput || {}
  });

  // 4. Run the pure scheduler
  var allTasks = tasks.concat(expanded || []);
  var result = unifiedScheduleV2(allTasks, statusInput || {}, todayKey, nowMins, cfg || {});

  // 5. Transform dayPlacements into flat scheduledTasks
  var scheduledTasks = [];
  if (result.dayPlacements) {
    Object.keys(result.dayPlacements).forEach(function(dk) {
      var entries = result.dayPlacements[dk];
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        var task = entry.task || {};
        // Convert YYYY-MM-DD to M/D/YYYY for test compatibility
        var dateStr = dk;
        var dp = dk.split('-');
        if (dp.length === 3) {
          dateStr = parseInt(dp[1], 10) + '/' + parseInt(dp[2], 10) + '/' + dp[0];
        }
        scheduledTasks.push({
          id: task.id,
          text: task.text,
          dur: entry.dur || task.dur,
          start: entry.start,
          date: dateStr,
          day: task.day || dayNameFromDateKey(dk),
          scheduled_at: null,
          status: task.status || ''
        });
      }
    });
  }

  return {
    scheduledTasks: scheduledTasks,
    dayPlacements: result.dayPlacements,
    newStatuses: result.newStatuses || {},
    unplaced: result.unplaced || [],
    placedCount: result.placedCount || 0,
    todayKey: todayKey,
    nowMins: nowMins
  };
}

function parseDate(dk) {
  if (!dk) return new Date();
  var p = dk.split('/');
  if (p.length === 2) return new Date(2026, parseInt(p[0], 10) - 1, parseInt(p[1], 10));
  if (p.length === 3) return new Date(parseInt(p[2], 10), parseInt(p[0], 10) - 1, parseInt(p[1], 10));
  var ip = dk.split('-');
  if (ip.length === 3) return new Date(parseInt(ip[0], 10), parseInt(ip[1], 10) - 1, parseInt(ip[2], 10));
  return new Date();
}

function dayNameFromDateKey(dk) {
  var d = parseDate(dk);
  if (!d || isNaN(d.getTime())) return '';
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
}

function computeTodayKey() {
  var d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function pad(n) { return n < 10 ? '0' + n : '' + n; }

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
