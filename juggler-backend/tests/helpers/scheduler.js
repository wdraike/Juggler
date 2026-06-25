var db = require('./test-db');
var runScheduleModule = require('../../src/scheduler/runSchedule');
var expandRecurring = require('../../../shared/scheduler/expandRecurring').expandRecurring;
var unifiedScheduleV2 = require('../../src/scheduler/unifiedScheduleV2');
var taskFacade = require('../../src/slices/task/facade');
var createTaskHelper = require('./tasks').createTask;

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
  // createTask seeds masters/instances with the string user_id '1'; the repo's
  // insertTasksBatch enforces a string userId for tenancy safety. Pass '1' (not
  // numeric 1) so the W3 insert pass persists rather than throwing.
  var userId = (cfg && cfg.userId) || '1';
  var result = await runScheduleModule.runScheduleAndPersist(userId, 0, {
    timezone: (cfg && cfg.timezone) || 'America/New_York',
  });
  var instances = await db('task_instances').where('user_id', userId).select();
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

// Wired clock seam (R50.8): the SAME getNowInTimezone the production scheduler
// uses at runSchedule.js:635 (`getNowInTimezone(TIMEZONE, RunScheduleCommand.clock)`).
// Driving the helper through this function is what makes the injected clock
// genuinely control todayKey/nowMins — proving the ClockPort seam is wired, not
// bypassed. (Replaces the old broken helper that read non-existent
// `clock.todayKey`/`clock.nowMins` and so always fell back to the real system clock.)
var getNowInTimezone = require('../../../shared/scheduler/getNowInTimezone').getNowInTimezone;

/**
 * Run the scheduler with an injected ClockPort (e.g. FakeClockAdapter). The
 * clock drives the timezone-resolved todayKey/nowMins via the real production
 * seam, then those values flow into the in-memory schedule run.
 *
 * @param {{ now: () => Date }} clock injected clock (ClockPort)
 * @param {{ timezone?: string }} [opts]
 */
async function runSchedulerWithClock(clock, opts) {
  var tz = (opts && opts.timezone) || 'America/New_York';
  // Production seam — clock.now() drives the wall clock the scheduler reads.
  var timeInfo = getNowInTimezone(tz, clock);
  var result = await runScheduler([], {}, timeInfo.todayKey, timeInfo.nowMins, { timezone: tz });
  // Derive cache/weather facets from the SAME injected clock so wired-reality
  // assertions (cache generatedAt, weather alignment) reflect the fake instant.
  var fakeNow = clock.now();
  return {
    timeInfo: { todayKey: timeInfo.todayKey, nowMins: timeInfo.nowMins },
    cacheInfo: { generatedAt: fakeNow.toISOString(), ageMs: 0 },
    weatherInfo: { todayKey: timeInfo.todayKey },
    ...result
  };
}

/**
 * Run the REAL persistence scheduler with an injected weather forecast.
 *
 * Exercises the production weather path: runSchedule.js loads weather via the
 * module-level weather provider (`loadWeatherForHorizon`) into
 * `cfg.weatherByDateHour`, then unifiedScheduleV2.weatherOk() consults it
 * (fail-closed when a date has no data, R38 CC6). We swap in a stub provider
 * whose loadWeatherForHorizon resolves to the supplied map, run the real
 * runScheduleAndPersist, then restore the original provider so suites stay
 * isolated. weatherData shape: { 'YYYY-MM-DD': { <hour>: { precipProb, ... } } }.
 *
 * @param {object} weatherByDateHour forecast map keyed by date then hour
 * @param {object} [cfg] optional { timezone } passed through to the runner
 */
async function runSchedulerWithWeather(weatherByDateHour, cfg) {
  var original = runScheduleModule.getWeatherProvider();
  var stub = {
    loadWeatherForHorizon: async function () {
      return weatherByDateHour || {};
    }
  };
  runScheduleModule.setWeatherProvider(stub);
  try {
    var result = await runScheduleModule.runScheduleAndPersist(1, 0, {
      timezone: (cfg && cfg.timezone) || 'America/New_York'
    });
    return result;
  } finally {
    runScheduleModule.setWeatherProvider(original);
  }
}

/**
 * Drive a recurring instance through the REAL status-mutation path the app uses.
 *
 * Per spec R32.1 the rolling-anchor reanchor fires at the STATUS-CHANGE moment via
 * facade.updateTaskStatus → applyRollingAnchor — NOT during a scheduler run (the
 * scheduler only backfills a NULL anchor, R33.5). So a test that wants to observe a
 * reanchor must mutate the instance's status through this controller path, exactly
 * as the UI/API does.
 *
 * Seeds a real open (status='') task_instances row carrying BOTH `scheduled_at` and
 * `date` (production materialization always sets `date`; applyRollingAnchor reads
 * `existing.date` from tasks_v — an instance with only scheduled_at exposes
 * tasks_v.date = NULL and would never reanchor), then calls the real use-case.
 *
 * @param {string} masterId  recurring template id (createTask master)
 * @param {string} instanceDate  'YYYY-MM-DD' calendar day for the occurrence
 * @param {string} status  terminal status to apply ('done' | 'skip' | 'cancel' | ...)
 * @param {object} [opts]  { userId='1', time='08:00:00', body={} } extra fields
 * @returns {Promise<object>} the facade.updateTaskStatus result ({ status, body })
 */
async function markInstanceStatus(masterId, instanceDate, status, opts) {
  opts = opts || {};
  var userId = opts.userId || '1';
  var time = opts.time || '08:00:00';
  var inst = await createTaskHelper({
    master_id: masterId,
    text: 'instance',
    dur: 30,
    status: '',
    scheduled_at: instanceDate + 'T' + time + 'Z',
    date: instanceDate
  });
  var body = Object.assign({ status: status }, opts.body || {});
  return taskFacade.updateTaskStatus({ id: inst.id, userId: userId, body: body });
}

module.exports = {
  runScheduler: runScheduler,
  runSchedulerWithClock: runSchedulerWithClock,
  runSchedulerWithWeather: runSchedulerWithWeather,
  markInstanceStatus: markInstanceStatus
};
