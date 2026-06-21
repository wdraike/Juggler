const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateJWT } = require('../middleware/jwt-auth');
const { getLastError } = require('../scheduler/scheduleQueue');
const { roundCoord } = require('../controllers/weather.controller');
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('health.routes');

// 999.683 / leg fixy-health-copy: the health popup is user-facing — it shows
// plain language only. Raw error text / SQL / internal table names go to the
// server log, never to detail.*. These are the friendly strings the popup shows.
const FRIENDLY = {
  schedulerError: 'The scheduler hit a temporary problem and is retrying. If it persists, reload the app.',
  schedulerUnavailable: 'Scheduler status is unavailable right now.',
  syncError: 'Calendar sync is having trouble right now.',
  syncRetry: 'Calendar sync is retrying after a temporary hiccup.',
  syncUnavailable: 'Sync status is unavailable right now.'
};

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
router.get('/detailed', async (req, res) => {
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
  } catch (_error) {
    healthStatus.services.database = 'error';
    healthStatus.detail.database = 'Database unavailable';
  }

  // Scheduler: two true-failure signals replace the old "time since last run" check.
  // The reactive system never self-triggers, so idle time is not a failure signal (D-06, D-07).
  //
  // Signal 1 — Stuck claim: rows claimed longer than CLAIM_TTL + 60s without release.
  //   CLAIM_TTL_SECONDS = 60 (from scheduleQueue.js); 120s = TTL + 60s buffer avoids
  //   false positives during a slow scheduler run. Hardcoded here to avoid circular imports.
  //
  // Signal 2 — Last error: module-level error recorded by processUser catch.
  //   Only errors from the last 10 minutes are flagged (stale errors cleared implicitly).
  if (healthStatus.services.database === 'operational') {
    try {
      const stuckRow = await db('schedule_queue')
        .whereNotNull('claimed_by')
        .whereRaw('claimed_at < DATE_SUB(NOW(), INTERVAL 120 SECOND)')
        .count('id as cnt')
        .first();
      const stuckCount = parseInt((stuckRow && stuckRow.cnt) || 0, 10);

      const lastErr = getLastError();
      const TEN_MIN_MS = 10 * 60 * 1000;
      const recentError = lastErr && (Date.now() - lastErr.timestamp) < TEN_MIN_MS;

      if (stuckCount > 0) {
        // Internal table name + count stay in the log; user sees plain language.
        logger.warn('scheduler health: stuck claims detected', { stuckCount: stuckCount });
        healthStatus.services.scheduler = 'error';
        healthStatus.detail.scheduler = FRIENDLY.schedulerError;
      } else if (recentError) {
        // 999.683: the raw message never reaches the popup. It was already logged
        // at the throw site (scheduleQueue claimAndRun/runScheduleForPush catch).
        healthStatus.services.scheduler = 'error';
        healthStatus.detail.scheduler = FRIENDLY.schedulerError;
      } else {
        healthStatus.services.scheduler = 'operational';
      }
    } catch (error) {
      // The health probe itself failed — log the real reason, show plain language.
      logger.error('scheduler health probe failed', { error: error.message, stack: error.stack });
      healthStatus.services.scheduler = 'error';
      healthStatus.detail.scheduler = FRIENDLY.schedulerUnavailable;
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
  } catch (_error) {
    healthStatus.services.sse = 'unknown';
  }

  // Sync: per-provider view of this user's cal sync state. Surfaces what
  // lives in cal_sync_ledger today (invisible without raw DB access),
  // plus connection status from the users row. Transient vs permanent
  // errors are split by regex on error_detail — rate-limit / 5xx / 429
  // errors are expected to clear on the next sync cycle and are reported
  // as "pendingRetry" rather than "error", so a momentarily-throttled
  // provider goes to DEGRADED instead of ERROR.
  if (healthStatus.services.database === 'operational') {
    try {
      const userId = req.user.id;
      const userRow = await db('users').where('id', userId).first();
      const rows = await db('cal_sync_ledger')
        .where('user_id', userId)
        .select('provider', 'status', 'error_detail', 'synced_at');
      const providers = {};
      const ensure = (p) => providers[p] || (providers[p] = {
        connected: false, active: 0, pendingRetry: 0, permanentError: 0, lastSync: null
      });
      const transientRe = /HTTP 403|HTTP 429|HTTP 5\d\d|rateLimitExceeded|quota.*exceeded/i;
      for (const r of rows) {
        const p = ensure(r.provider);
        if (r.status === 'active') p.active++;
        else if (r.status === 'error') {
          if (r.error_detail && transientRe.test(r.error_detail)) p.pendingRetry++;
          else p.permanentError++;
        }
        // Track latest synced_at (across any status)
        if (r.synced_at && (!p.lastSync || r.synced_at > p.lastSync)) {
          p.lastSync = r.synced_at;
        }
      }
      // Connection status from the user row
      ['gcal', 'msft', 'apple'].forEach(p => {
        const slot = ensure(p);
        if (p === 'gcal') slot.connected = !!(userRow && userRow.gcal_refresh_token);
        else if (p === 'msft') slot.connected = !!(userRow && userRow.msft_cal_refresh_token);
        else if (p === 'apple') slot.connected = !!(userRow && userRow.apple_cal_password);
      });
      healthStatus.sync = providers;

      // Promote the overall status if any connected provider has pending
      // retries (DEGRADED) or permanent errors (ERROR). An error dominates
      // pending. Disconnected providers never affect the rollup — the user
      // may simply not have connected them.
      for (const p of Object.values(providers)) {
        if (!p.connected) continue;
        if (p.permanentError > 0) healthStatus.services.sync = 'error';
        else if (p.pendingRetry > 0 && healthStatus.services.sync !== 'error') {
          healthStatus.services.sync = 'degraded';
        }
      }
      // Plain-language detail for the popup (the per-provider counts above are the
      // structured data; this is the human sentence).
      if (healthStatus.services.sync === 'error') healthStatus.detail.sync = FRIENDLY.syncError;
      else if (healthStatus.services.sync === 'degraded') healthStatus.detail.sync = FRIENDLY.syncRetry;
      if (!healthStatus.services.sync) healthStatus.services.sync = 'operational';
    } catch (error) {
      // Was leaking the raw error/SQL into the popup (detail.sync = error.message)
      // — the 999.683 leak, fixed for scheduler but missed here. Log it; show plain.
      logger.error('sync health probe failed', { error: error.message, stack: error.stack });
      healthStatus.services.sync = 'unknown';
      healthStatus.detail.sync = FRIENDLY.syncUnavailable;
    }
  } else {
    healthStatus.services.sync = 'unknown';
  }

  // Weather: flag if the forecast cache for the user's primary location is
  // stale (> 2h). Stale weather means weather-constrained tasks may be
  // scheduled incorrectly. Not an error — the app still works.
  if (healthStatus.services.database === 'operational') {
    try {
      const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
      const userId = req.user.id;
      const userLoc = await db('locations')
        .where('user_id', userId)
        .whereNotNull('lat')
        .whereNotNull('lon')
        .orderBy('sort_order')
        .first();

      if (!userLoc) {
        healthStatus.services.weather = 'not_configured';
      } else {
        const latGrid = roundCoord(userLoc.lat);
        const lonGrid = roundCoord(userLoc.lon);
        const weatherRow = await db('weather_cache')
          .where('lat_grid', latGrid)
          .where('lon_grid', lonGrid)
          .orderBy('fetched_at', 'desc')
          .first();

        if (!weatherRow) {
          healthStatus.services.weather = 'degraded';
          healthStatus.detail.weather = 'no forecast data — open the app to fetch';
        } else {
          const ageMs = Date.now() - new Date(weatherRow.fetched_at).getTime();
          if (ageMs > TWO_HOURS_MS) {
            healthStatus.services.weather = 'degraded';
            healthStatus.detail.weather = 'forecast is ' + Math.round(ageMs / 60000) + ' min old — weather constraints may not be enforced';
          } else {
            healthStatus.services.weather = 'operational';
            healthStatus.detail.weather = 'forecast fetched ' + Math.round(ageMs / 60000) + ' min ago';
          }
        }
      }
    } catch (error) {
      // Same leak class as sync/scheduler: keep raw error/SQL out of the popup.
      logger.error('weather health probe failed', { error: error.message, stack: error.stack });
      healthStatus.services.weather = 'unknown';
      healthStatus.detail.weather = 'Weather status is unavailable right now.';
    }
  } else {
    healthStatus.services.weather = 'unknown';
  }

  // Rollup: 'error' dominates; 'operational' only wins when every service
  // reports it. 'idle' / 'unknown' / 'degraded' collapse to DEGRADED rather
  // than ERROR so the dot doesn't scream at users when e.g. no one has
  // scheduled anything in the last ten minutes.
  // 'not_configured' is treated the same as 'operational' for rollup purposes:
  // a user who has never set a weather location is not in a degraded state.
  const statuses = Object.values(healthStatus.services);
  const configurableStatuses = statuses.map(s => s === 'not_configured' ? 'operational' : s);
  if (configurableStatuses.some(s => s === 'error')) {
    healthStatus.status = 'ERROR';
  } else if (configurableStatuses.every(s => s === 'operational')) {
    healthStatus.status = 'OK';
  } else {
    healthStatus.status = 'DEGRADED';
  }

  res.json(healthStatus);
});

module.exports = router;
