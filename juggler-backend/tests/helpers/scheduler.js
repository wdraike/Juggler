var db = require('./test-db');
var runScheduleModule = require('../../src/scheduler/runSchedule');
var expandRecurring = require('../../../shared/scheduler/expandRecurring').expandRecurring;
var unifiedScheduleV2 = require('../../src/scheduler/unifiedScheduleV2');

/**
 * Run scheduler — dual mode:
 *
 * MODE 1 (default): In-memory expand+schedule. Loads recurring templates from DB,
 * expands them via expandRecurring, schedules via unifiedScheduleV2.
 * Returns { scheduledTasks: [{text, date, day}, ...] }.
 * Use for tests that need time control (recurrenceTypes, etc.).
 *
 * MODE 2 (persist=true): Calls runScheduleAndPersist. Use for tests that
 * insert task_instances directly and need the real persistence path.
 */
async function runScheduler(taskInput, statusInput, todayKey, nowMins, cfg) {
  var persist = cfg && cfg.persist;
  if (persist) {
    return runPersistScheduler(taskInput, statusInput, todayKey, nowMins, cfg);
  }

  // MODE 1: In-memory expand+schedule
  var masters = await db('task_masters').where('user_id', 1).select();
  var tasks = [];
  masters.forEach(function(m) {
    tasks.push({
      id: m.id, user_id: m.user_id, text: m.text, dur: m.dur, pri: m.pri,
      when: m.when, day_req: m.day_req, recurring: m.recurring,
      recur: typeof m.recur === 'string' ? JSON.parse(m.recur) : m.recur,
      recurStart: m.recur_start, recurEnd: m.recur_end,
      disabledAt: m.disabled_at, disabledReason: m.disabled_reason,
      placementMode: m.placement_mode, deadline: m.deadline,
      dependsOn: m.depends_on, startAfterAt: m.start_after_at,
      taskType: 'recurring_template'
    });
  });

  var tk = todayKey || computeTodayKey();
  var tkParts = tk.split('/');
  if (tkParts.length === 3 && tkParts[2].length === 4) {
    tk = tkParts[2] + '-' + (tkParts[0].length < 2 ? '0' : '') + tkParts[0] + '-' + (tkParts[1].length < 2 ? '0' : '') + tkParts[1];
  }
  var nm = nowMins !== undefined ? nowMins : 480;

  var startDate = parseDate(tk);
  var endDate = new Date(startDate);
  var maxEnd = null;
  tasks.forEach(function(t) {
    if (t.recurEnd) { var e = parseDate(t.recurEnd); if (e && (!maxEnd || e > maxEnd)) maxEnd = e; }
  });
  if (maxEnd) { endDate = new Date(maxEnd); endDate.setDate(endDate.getDate() + 1); }
  else { endDate.setDate(endDate.getDate() + 30); }

  var expanded = expandRecurring(tasks, startDate, endDate, { statuses: statusInput || {} });
  var allTasks = tasks.concat(expanded || []);
  var result = unifiedScheduleV2(allTasks, statusInput || {}, tk, nm, cfg || {});

  var scheduledTasks = [];
  if (result.dayPlacements) {
    Object.keys(result.dayPlacements).forEach(function(dk) {
      var entries = result.dayPlacements[dk];
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        var task = entry.task || {};
        var dateStr = dk;
        var dp = dk.split('-');
        if (dp.length === 3) dateStr = parseInt(dp[1], 10) + '/' + parseInt(dp[2], 10) + '/' + dp[0];
        scheduledTasks.push({
          id: task.id, text: task.text, dur: entry.dur || task.dur,
          start: entry.start, date: dateStr,
          day: task.day || dayNameFromDateKey(dk),
          scheduled_at: null, status: task.status || ''
        });
      }
    });
  }

  return { scheduledTasks: scheduledTasks, dayPlacements: result.dayPlacements,
    newStatuses: result.newStatuses || {}, unplaced: result.unplaced || [],
    placedCount: result.placedCount || 0, todayKey: tk, nowMins: nm };
}

// MODE 2: Persistence path
async function runPersistScheduler(taskInput, statusInput, todayKey, nowMins, cfg) {
  var result = await runScheduleModule.runScheduleAndPersist(1, 0, {
    timezone: (cfg && cfg.timezone) || 'America/New_York',
  });
  var instances = await db('task_instances').where('user_id', 1).select();
  var scheduledTasks = instances.map(function(t) {
    return { id: t.id, text: t.text, dur: t.dur,
      date: t.date ? fmtKey(t.date) : (t.scheduled_at ? fmtKey(t.scheduled_at) : ''),
      day: t.day, scheduled_at: t.scheduled_at, status: t.status };
  });
  return { scheduledTasks: scheduledTasks, dayPlacements: result ? (result.dayPlacements || {}) : {},
    newStatuses: result ? (result.newStatuses || {}) : {}, unplaced: result ? (result.unplaced || []) : [],
    placedCount: result ? (result.placedCount || 0) : 0, todayKey: todayKey, nowMins: nowMins };
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

function fmtKey(d) {
  if (!d) return '';
  if (typeof d === 'string') { var p = d.split('-'); if (p.length === 3) return parseInt(p[1], 10) + '/' + parseInt(p[2], 10) + '/' + p[0]; return d; }
  return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
}

function computeTodayKey() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function pad(n) { return n < 10 ? '0' + n : '' + n; }

async function runSchedulerWithClock(clock) {
  var result = await runScheduler([], {}, clock.todayKey, clock.nowMins, {});
  return { timeInfo: { todayKey: clock.todayKey, nowMins: clock.nowMins }, ...result };
}

module.exports = { runScheduler: runScheduler, runSchedulerWithClock: runSchedulerWithClock };
