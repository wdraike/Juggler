/**
 * health.diagnostics — per-service probe functions for GET /api/health/detailed
 * (999.1196).
 *
 * Extracted VERBATIM from health.routes.js: each probe runs the SAME queries,
 * in the SAME order, against an injected `db` (the route passes its own
 * `require('../db')` singleton — the same instance lib/db.getDefaultDb()
 * returns), and returns the SAME plain-language shape the route used to build
 * inline. health.routes.js is now a thin orchestration + response-shaping
 * caller (`runDetailedHealthCheck`).
 *
 * health spans the scheduler/calendar/weather domains rather than owning one
 * of them, so this is a plain diagnostics module (injected repos), not a hex
 * slice.
 */

'use strict';

const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('health.diagnostics');

// 999.683 / leg fixy-health-copy: the health popup is user-facing — plain
// language only. Raw error text / SQL / internal table names go to the server
// log, never to detail.*. Preserved verbatim (moved from health.routes.js).
const FRIENDLY = {
  schedulerError: 'The scheduler hit a temporary problem and is retrying. If it persists, reload the app.',
  schedulerUnavailable: 'Scheduler status is unavailable right now.',
  syncError: 'Calendar sync is having trouble right now.',
  syncRetry: 'Calendar sync is retrying after a temporary hiccup.',
  syncUnavailable: 'Sync status is unavailable right now.'
};

/**
 * checkDatabase — SELECT 1 ping.
 * @param {Function} db  knex instance
 * @returns {Promise<{status: string, detail?: string}>}
 */
async function checkDatabase(db) {
  try {
    await db.raw('SELECT 1');
    return { status: 'operational' };
  } catch (_error) {
    return { status: 'error', detail: 'Database unavailable' };
  }
}

/**
 * checkScheduler — stuck-claim + last-error probe.
 *
 * Signal 1 — Stuck claim: rows claimed longer than CLAIM_TTL + 60s without
 *   release. CLAIM_TTL_SECONDS = 60 (scheduleQueue.js); 120s = TTL + 60s
 *   buffer avoids false positives during a slow scheduler run. Hardcoded here
 *   to avoid circular imports.
 * Signal 2 — Last error: module-level error recorded by processUser's catch,
 *   flagged only if within the last 10 minutes (stale errors clear implicitly).
 *
 * @param {Function} db  knex instance
 * @param {() => {timestamp: number}|null} getLastError
 * @returns {Promise<{status: string, detail?: string}>}
 */
async function checkScheduler(db, getLastError) {
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
      return { status: 'error', detail: FRIENDLY.schedulerError };
    }
    if (recentError) {
      // 999.683: the raw message never reaches the popup. It was already
      // logged at the throw site (scheduleQueue claimAndRun/runScheduleForPush catch).
      return { status: 'error', detail: FRIENDLY.schedulerError };
    }
    return { status: 'operational' };
  } catch (error) {
    // The health probe itself failed — log the real reason, show plain language.
    logger.error('scheduler health probe failed', { error: error.message, stack: error.stack });
    return { status: 'error', detail: FRIENDLY.schedulerUnavailable };
  }
}

/**
 * checkSse — subscriber-count probe. Lazily requires the SSE emitter (matches
 * the original inline try/catch, which also guards against the require itself
 * failing) — if it has an introspection hook use it; otherwise 'operational'
 * (the emitter works without public inspection).
 * @returns {{status: string, detail?: string}}
 */
function checkSse() {
  try {
    const sse = require('../lib/sse-emitter');
    if (typeof sse.getStats === 'function') {
      const stats = sse.getStats();
      return { status: 'operational', detail: (stats.activeConnections || 0) + ' active' };
    }
    return { status: 'operational' };
  } catch (_error) {
    return { status: 'unknown' };
  }
}

/**
 * checkSync — per-provider view of a user's cal sync state, sourced from
 * cal_sync_ledger + the users row's connection tokens. Transient vs permanent
 * errors are split by regex on error_detail — rate-limit / 5xx / 429 errors
 * are expected to clear on the next sync cycle and are reported as
 * "pendingRetry" rather than "error", so a momentarily-throttled provider
 * rolls up to DEGRADED instead of ERROR.
 *
 * @param {Function} db  knex instance
 * @param {string} userId
 * @returns {Promise<{status: string, detail?: string, providers: Object|null}>}
 */
async function checkSync(db, userId) {
  try {
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

    // Promote the overall status if any connected provider has pending
    // retries (DEGRADED) or permanent errors (ERROR). An error dominates
    // pending. Disconnected providers never affect the rollup — the user
    // may simply not have connected them.
    let status = null;
    for (const p of Object.values(providers)) {
      if (!p.connected) continue;
      if (p.permanentError > 0) status = 'error';
      else if (p.pendingRetry > 0 && status !== 'error') status = 'degraded';
    }
    // Plain-language detail for the popup (the per-provider counts above are
    // the structured data; this is the human sentence).
    let detail;
    if (status === 'error') detail = FRIENDLY.syncError;
    else if (status === 'degraded') detail = FRIENDLY.syncRetry;
    if (!status) status = 'operational';

    return { status, detail, providers };
  } catch (error) {
    // Was leaking the raw error/SQL into the popup (detail.sync = error.message)
    // — the 999.683 leak, fixed for scheduler but missed here. Log it; show plain.
    logger.error('sync health probe failed', { error: error.message, stack: error.stack });
    return { status: 'unknown', detail: FRIENDLY.syncUnavailable, providers: null };
  }
}

/**
 * checkWeather — flags if the forecast cache for the user's primary location
 * is stale (> 2h). Stale weather means weather-constrained tasks may be
 * scheduled incorrectly. Not an error — the app still works.
 *
 * @param {Function} db  knex instance
 * @param {string} userId
 * @param {(coord: number) => number} roundCoord
 * @returns {Promise<{status: string, detail?: string}>}
 */
async function checkWeather(db, userId, roundCoord) {
  try {
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    const userLoc = await db('locations')
      .where('user_id', userId)
      .whereNotNull('lat')
      .whereNotNull('lon')
      .orderBy('sort_order')
      .first();

    if (!userLoc) {
      return { status: 'not_configured' };
    }

    const latGrid = roundCoord(userLoc.lat);
    const lonGrid = roundCoord(userLoc.lon);
    const weatherRow = await db('weather_cache')
      .where('lat_grid', latGrid)
      .where('lon_grid', lonGrid)
      .orderBy('fetched_at', 'desc')
      .first();

    if (!weatherRow) {
      return { status: 'degraded', detail: 'no forecast data — open the app to fetch' };
    }
    const ageMs = Date.now() - new Date(weatherRow.fetched_at).getTime();
    if (ageMs > TWO_HOURS_MS) {
      return { status: 'degraded', detail: 'forecast is ' + Math.round(ageMs / 60000) + ' min old — weather constraints may not be enforced' };
    }
    return { status: 'operational', detail: 'forecast fetched ' + Math.round(ageMs / 60000) + ' min ago' };
  } catch (error) {
    // Same leak class as sync/scheduler: keep raw error/SQL out of the popup.
    logger.error('weather health probe failed', { error: error.message, stack: error.stack });
    return { status: 'unknown', detail: 'Weather status is unavailable right now.' };
  }
}

/**
 * runDetailedHealthCheck — the GET /api/health/detailed orchestration.
 * Preserves the exact probe order (database gates scheduler/sync/weather; sse
 * always runs) and the exact status rollup rule.
 *
 * @param {Object} deps
 * @param {Function} deps.db  knex instance
 * @param {string} deps.userId
 * @param {() => {timestamp: number}|null} deps.getLastError
 * @param {(coord: number) => number} deps.roundCoord
 * @returns {Promise<Object>} the healthStatus response body
 */
async function runDetailedHealthCheck(deps) {
  const db = deps.db;
  const userId = deps.userId;
  const getLastError = deps.getLastError;
  const roundCoord = deps.roundCoord;

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
  // cache checks are meaningless — mark them 'unknown' rather than claiming
  // operational based on a non-response.
  const dbCheck = await checkDatabase(db);
  healthStatus.services.database = dbCheck.status;
  if (dbCheck.detail) healthStatus.detail.database = dbCheck.detail;

  if (healthStatus.services.database === 'operational') {
    const schedulerCheck = await checkScheduler(db, getLastError);
    healthStatus.services.scheduler = schedulerCheck.status;
    if (schedulerCheck.detail) healthStatus.detail.scheduler = schedulerCheck.detail;
  } else {
    healthStatus.services.scheduler = 'unknown';
  }

  const sseCheck = checkSse();
  healthStatus.services.sse = sseCheck.status;
  if (sseCheck.detail) healthStatus.detail.sse = sseCheck.detail;

  if (healthStatus.services.database === 'operational') {
    const syncCheck = await checkSync(db, userId);
    healthStatus.services.sync = syncCheck.status;
    if (syncCheck.detail) healthStatus.detail.sync = syncCheck.detail;
    if (syncCheck.providers) healthStatus.sync = syncCheck.providers;
  } else {
    healthStatus.services.sync = 'unknown';
  }

  if (healthStatus.services.database === 'operational') {
    const weatherCheck = await checkWeather(db, userId, roundCoord);
    healthStatus.services.weather = weatherCheck.status;
    if (weatherCheck.detail) healthStatus.detail.weather = weatherCheck.detail;
  } else {
    healthStatus.services.weather = 'unknown';
  }

  // Rollup: 'error' dominates; 'operational' only wins when every service
  // reports it. 'idle' / 'unknown' / 'degraded' collapse to DEGRADED rather
  // than ERROR so the dot doesn't scream at users when e.g. no one has
  // scheduled anything in the last ten minutes. 'not_configured' is treated
  // the same as 'operational' for rollup purposes: a user who has never set a
  // weather location is not in a degraded state.
  const statuses = Object.values(healthStatus.services);
  const configurableStatuses = statuses.map(s => s === 'not_configured' ? 'operational' : s);
  if (configurableStatuses.some(s => s === 'error')) {
    healthStatus.status = 'ERROR';
  } else if (configurableStatuses.every(s => s === 'operational')) {
    healthStatus.status = 'OK';
  } else {
    healthStatus.status = 'DEGRADED';
  }

  return healthStatus;
}

module.exports = {
  FRIENDLY,
  checkDatabase,
  checkScheduler,
  checkSse,
  checkSync,
  checkWeather,
  runDetailedHealthCheck
};
