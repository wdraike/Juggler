/**
 * schedulerSession — DB-backed session store for the admin Stepper UI.
 *
 * A session pre-runs unifiedScheduleV2() once with cfg._stepRecorder enabled,
 * producing a full snapshots[] array (one entry per placement commit). The
 * admin UI then walks forward/backward through snapshots indexically; the
 * server doesn't re-run the scheduler per step. V2 emits steps tagged with
 * phases 'V2: Immovable' / 'V2: Constrained' / 'V2: Unconstrained' /
 * 'V2: Retry' — corresponding to the immovable pass, the slack-sorted main
 * loop (finite vs Infinity slack), and the dep-deferred retry pass.
 *
 * Dry-run only: sessions never call runScheduleAndPersist or any
 * tasksWrite.*Task function. The scheduler output is never persisted from
 * this path.
 *
 * Sessions are keyed by a random id, scoped to the admin who started them,
 * and expire after 1h. The DB sweep deletes expired rows every 5 minutes.
 */

var crypto = require('crypto');
var db = require('../db');
var { createLogger } = require('@raike/lib-logger');
var { safeTimezone } = require('juggler-shared/scheduler/dateHelpers');
var { getNowInTimezone, DEFAULT_TIMEZONE } = require('juggler-shared/scheduler/getNowInTimezone');
var config = require('../lib/config');
var logger = createLogger('schedulerSession');

// H7 (JUG-SCHEDULER-LEGACY-DB-BYPASS / 999.1532): the 6 inline
// scheduler_sessions/tasks_v call sites route through SchedulerSessionPort +
// TaskProviderPort.loadStepperRows — verbatim query moves, no behavior change.
var SchedulerSessionRepository = require('../slices/scheduler/adapters/SchedulerSessionRepository');
var _sessionRepo = new SchedulerSessionRepository();
var SchedulerTaskProvider = require('../slices/scheduler/adapters/SchedulerTaskProvider');
var _taskProvider = new SchedulerTaskProvider();

// Injectable clock (999.1195): every wall-clock read in this module derives from
// a ClockPort — MysqlClockAdapter in production (same adapter RunScheduleCommand
// defaults to), swappable via the _setClock test seam below.
var MysqlClockAdapter = require('../slices/scheduler/adapters/MysqlClockAdapter');
var _clock = new MysqlClockAdapter();

var SESSION_TTL_MS = 60 * 60 * 1000; // 1h
var SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5m

function newSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

async function sweep() {
  try {
    await _sessionRepo.deleteExpiredSessions(db, _clock.now());
  } catch (e) {
    logger.warn('[schedulerSession] sweep error:', { error: e });
  }
}

// Start a background sweeper. Unref so it doesn't block process shutdown.
var sweepTimer = setInterval(function() { sweep(); }, SWEEP_INTERVAL_MS);
if (sweepTimer.unref) sweepTimer.unref();

/**
 * Create a new stepper session for the given user. Loads the user's tasks
 * + config, runs unifiedSchedule in recorder mode, stores snapshots.
 *
 * Returns { sessionId, totalSteps, todayKey, nowMins, timezone, summary }.
 */
async function startSession(userId, options) {
  var opts = options || {};
  var unifiedSchedule = require('../slices/scheduler/facade').unifiedScheduleV2;
  // 999.1192/999.1198: rowToTask is the task slice's pure domain mapper — take
  // it from taskMappers directly instead of reaching through the HTTP
  // controller (whose re-export is the same function object).
  var rowToTask = require('../slices/task/domain/mappers/taskMappers').rowToTask;

  var TIMEZONE = safeTimezone(opts.timezone, DEFAULT_TIMEZONE);
  // 999.1185: shared R50.8 contract (was an inline formatToParts copy).
  var nowInfo = getNowInTimezone(TIMEZONE, _clock);
  var todayKey = nowInfo.todayKey;
  var nowMins = nowInfo.nowMins;

  // Match runSchedule.js's schedulable-row filter: open/wip instances,
  // NULL-status rows, and ALL recurring templates (templates have
  // status=NULL in the view, so a naive `whereNot('status', 'disabled')`
  // excludes them via SQL three-valued logic — stepper would see zero
  // templates and never expand any recurrings).
  var tasks = await _taskProvider.loadStepperRows(db, userId);
  // 999.1187: single scheduler-config loader (reads the real snake_case
  // user_config keys) shared with runSchedule.js and schedule.routes.js.
  // The previous inline copy read camelCase keys (cfg.timeBlocks, …) that
  // never exist in user_config, so the stepper always ran on
  // DEFAULT_TIME_BLOCKS / DEFAULT_TOOL_MATRIX regardless of user settings.
  var stepRecorder = [];
  var schedCfg = await require('./loadSchedulerConfig').loadSchedulerConfig(userId);
  schedCfg.timezone = TIMEZONE;
  schedCfg._stepRecorder = stepRecorder;

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
  var unplacedSummary = (result.unplaced || []).map(function(t) {
    return {
      id: t.id, text: t.text, project: t.project, pri: t.pri,
      reason: t._unplacedReason || null, detail: t._unplacedDetail || null
    };
  });

  await _sessionRepo.insertSession(db, {
    session_id: sessionId,
    user_id: userId,
    today_key: todayKey,
    now_mins: nowMins,
    timezone: TIMEZONE,
    snapshots: JSON.stringify(stepRecorder),
    tasks_by_id: JSON.stringify(tasksById),
    unplaced: JSON.stringify(unplacedSummary),
    score: JSON.stringify(result.score || {}),
    warnings: JSON.stringify(result.warnings || []),
    slack_by_task_id: JSON.stringify(result.slackByTaskId || {}),
    created_at: _clock.now(),
    expires_at: new Date(_clock.now().getTime() + SESSION_TTL_MS)
  });

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

/**
 * Load a session from the DB. Returns a session object (camelCase fields)
 * or null if not found / expired. Also touches expires_at to extend TTL.
 */
async function getSession(sessionId) {
  var row = await _sessionRepo.getActiveSession(db, sessionId, _clock.now());
  if (!row) return null;

  // Extend TTL on access.
  await _sessionRepo.touchSessionExpiry(db, sessionId, new Date(_clock.now().getTime() + SESSION_TTL_MS));

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    todayKey: row.today_key,
    nowMins: row.now_mins,
    timezone: row.timezone,
    snapshots: typeof row.snapshots === 'string' ? JSON.parse(row.snapshots) : row.snapshots,
    tasksById: typeof row.tasks_by_id === 'string' ? JSON.parse(row.tasks_by_id) : row.tasks_by_id,
    unplaced: typeof row.unplaced === 'string' ? JSON.parse(row.unplaced) : row.unplaced,
    score: typeof row.score === 'string' ? JSON.parse(row.score) : row.score,
    warnings: typeof row.warnings === 'string' ? JSON.parse(row.warnings) : row.warnings,
    slackByTaskId: typeof row.slack_by_task_id === 'string' ? JSON.parse(row.slack_by_task_id) : row.slack_by_task_id
  };
}

/**
 * Sync helper: compute a single step from an already-fetched session object.
 */
function _computeStep(s, stepIndex) {
  if (stepIndex < 0 || stepIndex >= s.snapshots.length) return null;
  var raw = s.snapshots[stepIndex];
  var task = s.tasksById[raw.taskId] || null;
  return Object.assign({}, raw, {
    totalSteps: s.snapshots.length,
    task: task ? {
      id: task.id, text: task.text, project: task.project, pri: task.pri,
      dur: task.dur, when: task.when, deadline: task.deadline,
      earliestStart: task.earliestStart, recurring: !!task.recurring,
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

/**
 * Sync helper: compute the summary from an already-fetched session object.
 */
function _computeSummary(s) {
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
    sessionId: s.sessionId,
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

/**
 * Return a single step enriched with task detail for the UI.
 */
async function getStep(sessionId, stepIndex) {
  var s = await getSession(sessionId);
  if (!s) return null;
  return _computeStep(s, stepIndex);
}

async function getSummary(sessionId) {
  var s = await getSession(sessionId);
  if (!s) return null;
  return _computeSummary(s);
}

async function stopSession(sessionId) {
  await _sessionRepo.deleteSession(db, sessionId);
}

module.exports = {
  startSession: startSession,
  getSession: getSession,
  getStep: getStep,
  getSummary: getSummary,
  stopSession: stopSession,
  _computeStep: _computeStep,
  _computeSummary: _computeSummary,
  // Test-only clock seam (999.1195): swap the ClockPort so session TTL /
  // expiry boundaries are deterministic under FakeClockAdapter. Returns the
  // previous clock so callers can restore it in a finally block.
  _setClock: config.getString('NODE_ENV') === 'test' ? function _setClock(clock) { // 999.1473
    var prev = _clock;
    _clock = clock || new MysqlClockAdapter();
    return prev;
  } : undefined,
};
