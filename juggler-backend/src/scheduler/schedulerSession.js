/**
 * schedulerSession — in-memory session store for the admin Stepper UI.
 *
 * A session pre-runs unifiedSchedule() once with cfg._stepRecorder enabled,
 * producing a full snapshots[] array (one entry per recordPlace call). The
 * admin UI then walks forward/backward through snapshots indexically; the
 * server doesn't re-run the scheduler per step.
 *
 * Dry-run only: sessions never call runScheduleAndPersist or any
 * tasksWrite.*Task function. The scheduler output is never persisted from
 * this path.
 *
 * Sessions are keyed by a random id, scoped to the admin who started them,
 * and swept after 1h idle to bound memory.
 */

var crypto = require('crypto');

var SESSION_TTL_MS = 60 * 60 * 1000; // 1h
var SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5m

var sessions = new Map(); // sessionId -> session

function newSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

function now() { return Date.now(); }

function sweep() {
  var cutoff = now() - SESSION_TTL_MS;
  for (var entry of sessions.entries()) {
    var sid = entry[0], s = entry[1];
    if (s.lastAccess < cutoff) sessions.delete(sid);
  }
}

// Start a background sweeper. Unref so it doesn't block process shutdown.
var sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
if (sweepTimer.unref) sweepTimer.unref();

/**
 * Create a new stepper session for the given user. Loads the user's tasks
 * + config, runs unifiedSchedule in recorder mode, stores snapshots.
 *
 * Returns { sessionId, totalSteps, todayKey, nowMins, timezone, summary }.
 */
async function startSession(userId, options) {
  var opts = options || {};
  var db = require('../db');
  var unifiedSchedule = require('./unifiedSchedule');
  var constants = require('./constants');
  var rowToTask = require('../controllers/task.controller').rowToTask;

  var TIMEZONE = opts.timezone || 'America/New_York';
  var nowDt = new Date();
  var parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
  }).formatToParts(nowDt);
  var vals = {};
  parts.forEach(function(p) { vals[p.type] = parseInt(p.value, 10); });
  var todayKey = vals.month + '/' + vals.day;
  var nowMins = (vals.hour % 24) * 60 + vals.minute;

  // Match runSchedule.js's schedulable-row filter: open/wip instances,
  // NULL-status rows, and ALL recurring templates (templates have
  // status=NULL in the view, so a naive `whereNot('status', 'disabled')`
  // excludes them via SQL three-valued logic — stepper would see zero
  // templates and never expand any recurrings).
  var tasks = await db('tasks_v').where('user_id', userId)
    .where(function() {
      this.where('status', '').orWhere('status', 'wip').orWhereNull('status')
        .orWhere('task_type', 'recurring_template');
    })
    .select();
  var configRows = await db('user_config').where({ user_id: userId });
  var cfg = {};
  configRows.forEach(function(r) {
    try { cfg[r.config_key] = JSON.parse(r.config_value); }
    catch (e) { cfg[r.config_key] = r.config_value; }
  });

  var stepRecorder = [];
  var schedCfg = {
    timeBlocks: cfg.timeBlocks || constants.DEFAULT_TIME_BLOCKS,
    toolMatrix: cfg.toolMatrix || constants.DEFAULT_TOOL_MATRIX,
    locSchedules: cfg.locSchedules || {},
    locScheduleDefaults: cfg.locScheduleDefaults || {},
    locScheduleOverrides: cfg.locScheduleOverrides || {},
    hourLocationOverrides: cfg.hourLocationOverrides || {},
    scheduleTemplates: cfg.scheduleTemplates || null,
    splitMinDefault: cfg.splitMinDefault || 15,
    preferences: cfg.preferences || {},
    timezone: TIMEZONE,
    _stepRecorder: stepRecorder
  };

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = t.status || ''; });

  var srcMap = {};
  tasks.forEach(function(t) {
    if (t.task_type === 'recurring_template' || (!t.generated && t.recur)) {
      srcMap[t.id] = t;
    }
  });
  var mapped = tasks.map(function(r) { return rowToTask(r, TIMEZONE, srcMap); });

  var result = unifiedSchedule(mapped, statuses, todayKey, nowMins, schedCfg);

  // Build a simple task-index for step explanations.
  var tasksById = {};
  mapped.forEach(function(t) { tasksById[t.id] = t; });

  var sessionId = newSessionId();
  var session = {
    sessionId: sessionId,
    userId: userId,
    createdAt: now(),
    lastAccess: now(),
    todayKey: todayKey,
    nowMins: nowMins,
    timezone: TIMEZONE,
    tasksById: tasksById,
    snapshots: stepRecorder,
    unplaced: (result.unplaced || []).map(function(t) {
      return {
        id: t.id, text: t.text, project: t.project, pri: t.pri,
        reason: t._unplacedReason || null, detail: t._unplacedDetail || null
      };
    }),
    score: result.score || {},
    warnings: result.warnings || [],
    slackByTaskId: result.slackByTaskId || {}
  };
  sessions.set(sessionId, session);

  return {
    sessionId: sessionId,
    totalSteps: stepRecorder.length,
    todayKey: todayKey,
    nowMins: nowMins,
    timezone: TIMEZONE,
    summary: {
      taskCount: mapped.length,
      placedCount: result.placedCount || 0,
      unplacedCount: (result.unplaced || []).length,
      score: result.score || {}
    }
  };
}

function touch(session) { session.lastAccess = now(); }

function getSession(sessionId) {
  var s = sessions.get(sessionId);
  if (!s) return null;
  touch(s);
  return s;
}

/**
 * Return a single step enriched with task detail for the UI.
 */
function getStep(sessionId, stepIndex) {
  var s = getSession(sessionId);
  if (!s) return null;
  if (stepIndex < 0 || stepIndex >= s.snapshots.length) return null;
  var raw = s.snapshots[stepIndex];
  var task = s.tasksById[raw.taskId] || null;
  return Object.assign({}, raw, {
    totalSteps: s.snapshots.length,
    task: task ? {
      id: task.id, text: task.text, project: task.project, pri: task.pri,
      dur: task.dur, when: task.when, deadline: task.deadline,
      startAfter: task.startAfter, recurring: !!task.recurring,
      split: !!task.split, splitMin: task.splitMin,
      location: task.location, tools: task.tools,
      slackMins: s.slackByTaskId[task.id] != null ? s.slackByTaskId[task.id] : null
    } : null,
    // Preview of the next few tasks coming up in the queue.
    upcoming: s.snapshots.slice(stepIndex + 1, stepIndex + 6).map(function(next) {
      return {
        stepIndex: next.stepIndex,
        phase: next.phase,
        taskId: next.taskId,
        taskText: next.taskText,
        orderingSlack: next.orderingSlack
      };
    })
  });
}

function getSummary(sessionId) {
  var s = getSession(sessionId);
  if (!s) return null;
  // Lightweight queue: one entry per step so the UI can render a scrollable
  // sidebar. Strips the heavy per-step dayPlacementsSnapshot; just the
  // labels needed for an "up next" list.
  var queue = s.snapshots.map(function(st) {
    return {
      stepIndex: st.stepIndex,
      phase: st.phase,
      taskId: st.taskId,
      taskText: st.taskText,
      project: st.project,
      pri: st.pri,
      orderingSlack: st.orderingSlack,
      placement: st.placement ? {
        dateKey: st.placement.dateKey,
        start: st.placement.start,
        dur: st.placement.dur
      } : null
    };
  });
  return {
    sessionId: sessionId,
    totalSteps: s.snapshots.length,
    todayKey: s.todayKey,
    nowMins: s.nowMins,
    timezone: s.timezone,
    unplaced: s.unplaced,
    score: s.score,
    warnings: s.warnings,
    queue: queue
  };
}

function stopSession(sessionId) {
  sessions.delete(sessionId);
}

module.exports = {
  startSession: startSession,
  getSession: getSession,
  getStep: getStep,
  getSummary: getSummary,
  stopSession: stopSession,
  _sessions: sessions // for tests / debugging only
};
