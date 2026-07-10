const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateJWT } = require('../middleware/jwt-auth');
const { getLastError } = require('../scheduler/scheduleQueue');
const { roundCoord } = require('../controllers/weather.controller');
const { getNowInTimezone, DEFAULT_TIMEZONE } = require('juggler-shared/scheduler/getNowInTimezone');
// 999.1196: the /detailed probes (schedule_queue stuck-claim check,
// cal_sync_ledger inspection, weather_cache freshness, plain-language error
// copy) moved to health.diagnostics.js — this route is now a thin
// orchestration + response-shaping caller.
const { runDetailedHealthCheck } = require('./health.diagnostics');

// Mount-level auth guard: apply JWT auth to all routes except public endpoints
router.use((req, res, next) => {
  // Public routes that don't require authentication
  const publicRoutes = ['/immediate', '/'];
  if (publicRoutes.includes(req.path)) {
    return next(); // Skip auth for public routes
  }
  // For all other routes, require authentication
  return authenticateJWT(req, res, next);
});

// Immediate health check (no DB). Suitable for load-balancer probes; no auth.
router.get('/immediate', (req, res) => {
  res.json({ status: 'ok', service: 'juggler-backend' });
});

// Full health check with DB ping + scheduler timezone info.
// Public on purpose (consumed by infra); no auth. Does NOT include
// anything user-scoped or sensitive.
router.get('/', async (req, res) => {
  try {
    await db.raw('SELECT 1');
    var now = new Date();
    // 999.1185: shared R50.8 contract (was an inline formatToParts copy).
    // The clock pins todayKey/nowMins to the same instant as serverUtc.
    var nowInfo = getNowInTimezone(DEFAULT_TIMEZONE, { now: function() { return now; } });
    res.json({
      status: 'ok', db: 'connected', service: 'juggler-backend',
      serverUtc: now.toISOString(),
      schedulerTodayKey: nowInfo.todayKey,
      schedulerNowMins: nowInfo.nowMins
    });
  } catch (error) {
    res.status(503).json({ status: 'error', db: 'disconnected', error: error.message });
  }
});

// Detailed per-service health. Authenticated — this exposes queue depth
// and timing internals that aren't meant for anonymous callers. Drives
// the status dot in the header and (issue #35) the "system health"
// surface the user asked for.
//
// Status rollup:
//   all services 'operational'               → 'OK'
//   any service 'error'                      → 'ERROR'
//   otherwise (stale / degraded / unknown)   → 'DEGRADED'
router.get('/detailed', async (req, res) => {
  const healthStatus = await runDetailedHealthCheck({
    db,
    userId: req.user.id,
    getLastError,
    roundCoord
  });
  res.json(healthStatus);
});

module.exports = router;
