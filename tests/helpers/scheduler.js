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
      recurStart: m.recur_start,
      recurEnd: m.recur_end,
      disabledAt: m.disabled_at,
      disabledReason: m.disabled_reason,
      placementMode: m.placement_mode,
      deadline: m.deadline,
      dependsOn: m.depends_on,
      startAfterAt: m.start_after_at,
      taskType: 'recurring_template'
    });
  });

  // 2. Determine today — convert M/D/YYYY to YYYY-MM-DD for scheduler
  var todayKey = reqTodayKey || computeTodayKey();
  var tkParts = todayKey.split('/');
  if (tkParts.length === 3 && tkParts[2].length === 4) {
    todayKey = tkParts[2] + '-' + (tkParts[0].length < 2 ? '0' : '') + tkParts[0] + '-' + (tkParts[1].length < 2 ? '0' : '') + tkParts[1];
  }
  var nowMins = reqNowMins !== undefined ? reqNowMins : 480;

  // 3. Expand recurring templates — use the template's recur_end if available
  var startDate = parseDate(todayKey);
  var endDate = new Date(startDate);
  // Find the furthest recur_end among all templates
  var maxEnd = null;
  tasks.forEach(function(t) {
    if (t.recurEnd) {
      var e = parseDate(t.recurEnd);
      if (e && (!maxEnd || e > maxEnd)) maxEnd = e;
    }
  });
  if (maxEnd) {
    endDate = new Date(maxEnd);
    endDate.setDate(endDate.getDate() + 1);
  } else {
    endDate.setDate(endDate.getDate() + 30);
  }

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
