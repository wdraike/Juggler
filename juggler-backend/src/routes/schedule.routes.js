/**
 * Schedule routes — run backend scheduler
 */

var express = require('express');
var rateLimit = require('express-rate-limit');
var router = express.Router();
var { authenticateJWT } = require('../middleware/jwt-auth');
var { runScheduleAndPersist, getSchedulePlacements } = require('../scheduler/runSchedule');
var { withSyncLock } = require('../lib/sync-lock');

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
    var opts = { timezone: req.headers['x-timezone'] || 'America/New_York' };
    var result = await runScheduleAndPersist(req.user.id, undefined, opts);
    // result now includes dayPlacements and unplaced from the same run (cached)
    res.json(result);
  } catch (error) {
    console.error('Schedule run error:', error);
    res.status(500).json({ error: 'Failed to run scheduler' });
  }
}));

/**
 * GET /api/schedule/placements — read-only: return scheduler placements
 */
router.get('/placements', authenticateJWT, async function(req, res) {
  try {
    var opts = { timezone: req.headers['x-timezone'] || 'America/New_York' };
    var placements = await getSchedulePlacements(req.user.id, opts);
    res.json(placements);
  } catch (error) {
    console.error('Schedule placements error:', error);
    res.status(500).json({ error: 'Failed to get placements' });
  }
});

/**
 * POST /api/schedule/debug — run scheduler in debug mode, return phase snapshots
 * Admin-only: hidden endpoint for visualizing the scheduler's decision process
 */
router.post('/debug', authenticateJWT, debugLimiter, async function(req, res) {
  try {
    var unifiedSchedule = require('../scheduler/unifiedSchedule');
    var db = require('../db');
    var TIMEZONE = req.headers['x-timezone'] || 'America/New_York';
    var userId = req.user.id;

    // Resolve date context in user's timezone
    var now = new Date();
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
    }).formatToParts(now);
    var vals = {};
    parts.forEach(function(p) { vals[p.type] = parseInt(p.value, 10); });
    var dateCtx = {
      todayKey: vals.month + '/' + vals.day,
      nowMins: (vals.hour % 24) * 60 + vals.minute
    };

    // Load tasks
    var tasks = await db('tasks_v').where({ user_id: userId }).whereNot('status', 'disabled');

    // Load config
    var configRows = await db('user_config').where({ user_id: userId });
    var cfg = {};
    configRows.forEach(function(r) {
      try { cfg[r.config_key] = JSON.parse(r.config_value); } catch { cfg[r.config_key] = r.config_value; }
    });

    // Build scheduler config with debug flag
    var schedCfg = {
      timeBlocks: cfg.timeBlocks || require('../scheduler/constants').DEFAULT_TIME_BLOCKS,
      toolMatrix: cfg.toolMatrix || require('../scheduler/constants').DEFAULT_TOOL_MATRIX,
      locSchedules: cfg.locSchedules || {},
      locScheduleDefaults: cfg.locScheduleDefaults || {},
      locScheduleOverrides: cfg.locScheduleOverrides || {},
      hourLocationOverrides: cfg.hourLocationOverrides || {},
      scheduleTemplates: cfg.scheduleTemplates || null,
      splitMinDefault: cfg.splitMinDefault || 15,
      preferences: cfg.preferences || {},
      timezone: TIMEZONE,
      _debug: true // Enable phase snapshots
    };

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
    console.error('Schedule debug error:', error);
    res.status(500).json({ error: 'Failed to run debug scheduler: ' + error.message });
  }
});

module.exports = router;
