/**
 * Schedule routes — run backend scheduler
 */

var express = require('express');
var rateLimit = require('express-rate-limit');
var router = express.Router();
var { authenticateJWT } = require('../middleware/jwt-auth');
var authenticateAdmin = require('../middleware/authenticateAdmin');
var { runScheduleAndPersist } = require('../slices/scheduler/facade');
var { withSyncLock } = require('../lib/sync-lock');
var schedulerSession = require('../scheduler/schedulerSession');
var { enqueueScheduleRun } = require('../scheduler/scheduleQueue');
const { createLogger } = require('@raike/lib-logger');
const { safeTimezone } = require('juggler-shared/scheduler/dateHelpers');
const { getNowInTimezone, DEFAULT_TIMEZONE } = require('juggler-shared/scheduler/getNowInTimezone');
const logger = createLogger('schedule.routes');

// Rate limit scheduler endpoints — expensive operations
var schedulerLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // max 10 scheduler runs per minute per user
  keyGenerator: function(req) { return req.user ? req.user.id : 'anon'; },
  message: { error: 'Too many scheduler requests. Try again in a minute.' },
  validate: false
});
var debugLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5, // max 5 debug runs per minute
  keyGenerator: function(req) { return req.user ? req.user.id : 'anon'; },
  message: { error: 'Too many debug requests. Try again in a minute.' },
  validate: false
});

/**
 * POST /api/schedule/run — run scheduler, persist date moves, return placements
 */
router.post('/run', authenticateJWT, schedulerLimiter, withSyncLock(async function(req, res) {
  try {
    var opts = { timezone: safeTimezone(req.headers['x-timezone'], DEFAULT_TIMEZONE) };
    var result = await runScheduleAndPersist(req.user.id, undefined, opts);
    // result now includes dayPlacements and unplaced from the same run (cached)
    res.json(result);
  } catch (error) {
    logger.error('Schedule run error:', error);
    res.status(500).json({ error: 'Failed to run scheduler' });
  }
}));

// GET /api/schedule/placements — REMOVED (W3 DB single source).
// All read consumers now derive placements from GET /api/tasks: the juggler
// frontend via utils/derivePlacements.js, and both MCP get_schedule paths via
// the server-side deriveSchedulePlacements helper. The schedule_cache write in
// runScheduleAndPersist remains as an INTERNAL detail that only cal-sync reads.

// POST /api/schedule/nudge — enqueue a scheduler run when an active task's end time passes
router.post('/nudge', authenticateJWT, schedulerLimiter, async function(req, res) {
  try {
    await enqueueScheduleRun(req.user.id, 'frontend:task-end-nudge');
    res.json({ queued: true });
  } catch (err) {
    logger.error('[NUDGE] enqueue failed:', err.message);
    res.status(500).json({ error: 'Failed to queue nudge' });
  }
});

/**
 * POST /api/schedule/debug — run scheduler in debug mode, return phase snapshots
 * Admin-only: hidden endpoint for visualizing the scheduler's decision process
 */
router.post('/debug', authenticateJWT, authenticateAdmin, debugLimiter, async function(req, res) {
  try {
    var unifiedSchedule = require('../slices/scheduler/facade').unifiedScheduleV2;
    var db = require('../db');
    var TIMEZONE = safeTimezone(req.headers['x-timezone'], DEFAULT_TIMEZONE);
    var userId = req.user.id;

    // Resolve date context in user's timezone — 999.1185: shared R50.8
    // contract (was an inline formatToParts copy).
    var nowInfo = getNowInTimezone(TIMEZONE);
    var dateCtx = { todayKey: nowInfo.todayKey, nowMins: nowInfo.nowMins };

    // Load tasks
    var tasks = await db('tasks_v').where({ user_id: userId }).whereNot('status', 'disabled');

    // Load config — 999.1187: single scheduler-config loader (reads the real
    // snake_case user_config keys) shared with runSchedule.js and
    // schedulerSession.js. The previous inline copy read camelCase keys that
    // never exist in user_config, so the debug run always used
    // DEFAULT_TIME_BLOCKS / DEFAULT_TOOL_MATRIX regardless of user settings.
    var schedCfg = await require('../scheduler/loadSchedulerConfig').loadSchedulerConfig(userId);
    schedCfg.timezone = TIMEZONE;
    schedCfg._debug = true; // Enable phase snapshots

    var statuses = {};
    tasks.forEach(function(t) { statuses[t.id] = t.status || ''; });

    // Map DB rows to scheduler format using the same rowToTask as runSchedule
    var rowToTask = require('../controllers/task.controller').rowToTask;

    // Build source map for recurring template inheritance
    var srcMap = {};
    tasks.forEach(function(t) {
      if (t.task_type === 'recurring_template' || (!t.generated && t.recur)) {
        srcMap[t.id] = t;
      }
    });

    var mapped = tasks.map(function(r) { return rowToTask(r, TIMEZONE, srcMap); });

    var result = unifiedSchedule(mapped, statuses, dateCtx.todayKey, dateCtx.nowMins, schedCfg);

    res.json({
      success: true,
      todayKey: dateCtx.todayKey,
      nowMins: dateCtx.nowMins,
      timezone: TIMEZONE,
      taskCount: mapped.length,
      placedCount: result.placedCount,
      unplacedCount: result.unplaced.length,
      score: result.score,
      warnings: result.warnings,
      phaseSnapshots: result.phaseSnapshots || [],
    });
  } catch (error) {
    logger.error('Schedule debug error:', error);
    res.status(500).json({ error: 'Failed to run debug scheduler' });
  }
});

// ── Admin Stepper endpoints ──────────────────────────────────────────
// Dry-run visualization: runs unifiedSchedule with a step recorder,
// stores snapshots per session, serves them one-at-a-time to the admin
// UI. Never persists placements. See schedulerSession.js.

var stepperLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: function(req) { return req.user ? req.user.id : 'anon'; },
  message: { error: 'Too many stepper requests. Try again in a minute.' },
  validate: false
});

router.post('/step/start', authenticateJWT, authenticateAdmin, stepperLimiter, async function(req, res) {
  try {
    var tz = safeTimezone(req.headers['x-timezone'], DEFAULT_TIMEZONE);
    var info = await schedulerSession.startSession(req.user.id, { timezone: tz });
    res.json(info);
  } catch (err) {
    logger.error('stepper start error:', err);
    res.status(500).json({ error: 'Failed to start stepper session' });
  }
});

// NB: declare /summary before the /:stepIndex pattern so the literal route
// wins. Express matches in declaration order; a numeric-looking stepIndex
// route would otherwise capture "summary".
router.get('/step/:sessionId/summary', authenticateJWT, authenticateAdmin, async function(req, res) {
  try {
    var sessionId = req.params.sessionId;
    var s = await schedulerSession.getSession(sessionId);
    if (!s || s.userId !== req.user.id) return res.status(404).json({ error: 'Session not found' });
    res.json(schedulerSession._computeSummary(s));
  } catch (err) {
    logger.error('stepper summary error:', err);
    res.status(500).json({ error: 'Failed to fetch session summary' });
  }
});

router.get('/step/:sessionId/:stepIndex', authenticateJWT, authenticateAdmin, async function(req, res) {
  try {
    var sessionId = req.params.sessionId;
    var idx = parseInt(req.params.stepIndex, 10);
    if (Number.isNaN(idx)) return res.status(400).json({ error: 'stepIndex must be an integer' });
    var s = await schedulerSession.getSession(sessionId);
    if (!s || s.userId !== req.user.id) return res.status(404).json({ error: 'Session not found' });
    var step = schedulerSession._computeStep(s, idx);
    if (!step) return res.status(404).json({ error: 'Step out of range' });
    res.json(step);
  } catch (err) {
    logger.error('stepper step error:', err);
    res.status(500).json({ error: 'Failed to fetch step' });
  }
});

router.post('/step/:sessionId/stop', authenticateJWT, authenticateAdmin, async function(req, res) {
  try {
    var sessionId = req.params.sessionId;
    var s = await schedulerSession.getSession(sessionId);
    if (!s) {
      // Session expired or already gone — check raw DB for ownership
      var db = require('../db');
      var row = await db('scheduler_sessions').where('session_id', sessionId).first();
      if (row && row.user_id !== req.user.id) return res.status(403).json({ error: 'Not your session' });
      return res.json({ ok: true }); // already gone — idempotent
    }
    if (s.userId !== req.user.id) return res.status(403).json({ error: 'Not your session' });
    await schedulerSession.stopSession(sessionId);
    res.json({ ok: true });
  } catch (err) {
    logger.error('stepper stop error:', err);
    res.status(500).json({ error: 'Failed to stop session' });
  }
});

module.exports = router;
