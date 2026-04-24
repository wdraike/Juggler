const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateJWT } = require('../middleware/jwt-auth');

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
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
    }).formatToParts(now);
    var vals = {};
    parts.forEach(function(p) { vals[p.type] = parseInt(p.value, 10); });
    var hour = vals.hour % 24;
    var _m = vals.month, _d = vals.day;
    var todayKey = vals.year + '-' + (_m < 10 ? '0' : '') + _m + '-' + (_d < 10 ? '0' : '') + _d;
    res.json({
      status: 'ok', db: 'connected', service: 'juggler-backend',
      serverUtc: now.toISOString(),
      schedulerTodayKey: todayKey,
      schedulerNowMins: hour * 60 + vals.minute
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
router.get('/detailed', authenticateJWT, async (req, res) => {
  const healthStatus = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    version: {
      gitCommit: process.env.GIT_COMMIT || null,
      buildDate: process.env.BUILD_DATE || null
    },
    services: {
      server: 'operational',
      database: 'checking',
      scheduler: 'checking',
      sse: 'checking'
    },
    detail: {}
  };

  // DB: simple SELECT 1 gates everything else. When it fails, scheduler /
  // cache checks are meaningless — mark them 'unknown' rather than
  // claiming operational based on a non-response.
  try {
    await db.raw('SELECT 1');
    healthStatus.services.database = 'operational';
  } catch (error) {
    healthStatus.services.database = 'error';
    healthStatus.detail.database = error.message;
  }

  // Scheduler: look at the most recent per-user schedule_cache generatedAt.
  // If nothing in the last 10 min, report 'idle' (informational) — the
  // scheduler only runs on user mutation or startup, so extended idle is
  // normal when no one's active. Only 'error' when the query itself fails.
  if (healthStatus.services.database === 'operational') {
    try {
      const row = await db('user_config')
        .where('config_key', 'schedule_cache')
        .select('config_value')
        .orderBy('updated_at', 'desc')
        .limit(1)
        .first();
      if (!row) {
        healthStatus.services.scheduler = 'idle';
        healthStatus.detail.scheduler = 'no cache entries yet';
      } else {
        let cache = row.config_value;
        if (typeof cache === 'string') { try { cache = JSON.parse(cache); } catch (e) { cache = null; } }
        if (cache && cache.generatedAt) {
          const ageMs = Date.now() - new Date(cache.generatedAt).getTime();
          const ageMin = Math.round(ageMs / 60000);
          healthStatus.services.scheduler = ageMs < 10 * 60 * 1000 ? 'operational' : 'idle';
          healthStatus.detail.scheduler = 'last run ' + ageMin + ' min ago';
        } else {
          healthStatus.services.scheduler = 'unknown';
        }
      }
    } catch (error) {
      healthStatus.services.scheduler = 'error';
      healthStatus.detail.scheduler = error.message;
    }
  } else {
    healthStatus.services.scheduler = 'unknown';
  }

  // SSE: report the current subscriber count. If the emitter module has
  // an introspection hook use it; otherwise fall back to 'unknown' (the
  // emitter works without public inspection).
  try {
    const sse = require('../lib/sse-emitter');
    if (typeof sse.getStats === 'function') {
      const stats = sse.getStats();
      healthStatus.services.sse = 'operational';
      healthStatus.detail.sse = (stats.activeConnections || 0) + ' active';
    } else {
      healthStatus.services.sse = 'operational';
    }
  } catch (error) {
    healthStatus.services.sse = 'unknown';
  }

  // Rollup: 'error' dominates; 'operational' only wins when every service
  // reports it. 'idle' / 'not configured' / 'unknown' collapse to DEGRADED
  // rather than ERROR so the dot doesn't scream at users when e.g. no one
  // has scheduled anything in the last ten minutes.
  const statuses = Object.values(healthStatus.services);
  if (statuses.some(s => s === 'error')) {
    healthStatus.status = 'ERROR';
  } else if (statuses.every(s => s === 'operational')) {
    healthStatus.status = 'OK';
  } else {
    healthStatus.status = 'DEGRADED';
  }

  res.json(healthStatus);
});

module.exports = router;
