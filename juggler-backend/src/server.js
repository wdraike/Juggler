/**
 * Raike & Sons Backend Server
 */

require('dotenv').config();
const { serverLogger } = require('./lib/logger');

// Kill any zombie server processes from previous nodemon restarts.
// Nodemon's SIGKILL doesn't reliably kill all child processes.
// Use lsof to find processes holding our port — specific to this server, won't kill other backends.
if (process.env.NODE_ENV !== 'production') {
  try {
    var myPid = process.pid;
    var port = process.env.PORT || 5002;
    var pids = require('child_process')
      .execSync('lsof -ti :' + port + ' 2>/dev/null || true')
      .toString().trim().split('\n').filter(Boolean).map(Number)
      .filter(function(p) { return p !== myPid && p > 0; });
    if (pids.length > 0) {
      pids.forEach(function(p) { try { process.kill(p, 'SIGKILL'); } catch (_e) { /* already dead */ } });
      serverLogger.info('Killed zombie processes', { count: pids.length, port, pids: pids.join(', ') });
    }
  } catch (_e) { /* lsof not available, skip */ }
}

const app = require('./app');
const { loadJWTSecrets } = require('./middleware/jwt-auth');
const db = require('./db');
const { enqueueScheduleRun, startPollLoop, stopPollLoop } = require('./scheduler/scheduleQueue');

const PORT = process.env.PORT || 5002;

var server;

async function start() {
  serverLogger.info('Starting Raike & Sons backend', { 
    nodeEnv: process.env.NODE_ENV,
    dbHost: process.env.DB_HOST,
    dbName: process.env.DB_NAME,
    port: PORT
  });

  // Clear EXPIRED sync locks before accepting requests.
  // Uses a TTL-bounded sweep (acquired_at older than 10 minutes) so a rolling
  // deploy cannot steal active locks held by peer instances still serving traffic.
  // Rationale: MAX_LOCK_AGE = 5 min in sync-lock.js; any lock older than 10 min
  // is definitionally abandoned (heartbeat would have refreshed within 5 min if
  // the owner were still alive). See Phase 07 FIX-01.
  try {
    var cleared = await db('sync_locks')
      .where('acquired_at', '<', db.raw('DATE_SUB(NOW(), INTERVAL 10 MINUTE)'))
      .del();
    if (cleared > 0) serverLogger.info('Cleared expired sync locks', { count: cleared });
  } catch (_e) { /* table might not exist yet */ }

  // Redis connectivity health check (999.954). Non-fatal: SSE degrades gracefully.
  if (process.env.REDIS_URL) {
    try {
      var redisLib = require('./lib/redis');
      var client = redisLib.getClient();
      if (client && client.status === 'ready') {
        await client.ping();
        serverLogger.info('Redis connectivity OK');
      } else if (client) {
        // Client exists but not yet ready — wait briefly for connection
        await new Promise(function(resolve) {
          var onReady = function() {
            client.ping().then(function() {
              serverLogger.info('Redis connectivity OK (after connect)');
            }).catch(function(e) {
              serverLogger.warn('Redis ping failed after connect', { error: e.message });
            }).finally(resolve);
            client.off('ready', onReady);
          };
          client.on('ready', onReady);
          // Timeout after 3s
          setTimeout(function() {
            client.off('ready', onReady);
            serverLogger.warn('Redis did not become ready within 3s — SSE fan-out and rate limiters will be local-only');
            resolve();
          }, 3000);
        });
      } else {
        serverLogger.warn('Redis client not available — SSE fan-out and rate limiters will be local-only');
      }
    } catch (e) {
      serverLogger.warn('Redis connectivity check failed', { error: e.message });
    }
  } else {
    serverLogger.info('REDIS_URL not set — skipping Redis connectivity check');
  }

  // Load JWT secrets
  await loadJWTSecrets();

  // Boot-init all slice facades that expose an async init() hook.
  //
  // 999.428: iterate over a list instead of hardcoding per-slice init() calls.
  // H0-H4 slices load lazily (no init cost at boot), but slices that validate
  // a DB dependency (like ai-enrichment, B9 / 999.421) expose init() to fail
  // fast on misconfig. Add new slices here when they grow an init() hook.
  //
  // 999.427: the ai-enrichment init() call is INTENTIONALLY redundant with
  // `require('./db')` at the top of this file (line ~28), which already triggers
  // getDefaultDb() and would abort boot on a bad DB config first. We keep the
  // facade.init() anyway as an EXPLICIT, testable assertion of the AI slice's
  // own DB dependency — it pins the B9 fail-fast contract and survives someone
  // reordering or removing the top-level require. getDefaultDb() is idempotent
  // (cached), so the second call is a no-op.
  var BOOT_SLICES = [
    { path: './slices/ai-enrichment/facade', label: 'ai-enrichment' },
  ];
  for (var bsi = 0; bsi < BOOT_SLICES.length; bsi++) {
    var slice = BOOT_SLICES[bsi];
    try {
      await require(slice.path).init();
    } catch (initErr) {
      serverLogger.error('Slice boot-init failed', { slice: slice.label, error: initErr });
      throw initErr; // fail-fast — boot halts on any slice init error
    }
  }

  server = app.listen(PORT, () => {
    serverLogger.info('Raike & Sons backend running', { port: PORT });

    // Startup scheduler refresh: only enqueue for users who don't already
    // have pending queue entries. The scheduleQueue's own startup scan
    // picks up anything already in the queue via the in-memory dirty flag;
    // re-inserting here just duplicates rows on every restart.
    Promise.all([
      db('tasks_v').distinct('user_id'),
      db('schedule_queue').distinct('user_id')
    ]).then(function(results) {
      var existing = {};
      results[1].forEach(function(r) { existing[r.user_id] = true; });
      var newUsers = results[0].filter(function(r) { return !existing[r.user_id]; });
      newUsers.forEach(function(r) { enqueueScheduleRun(r.user_id, 'startup'); });
      if (newUsers.length > 0) serverLogger.info('Enqueued startup runs', { userCount: newUsers.length });
    }).catch(function(err) {
      serverLogger.error('Startup enqueue failed', { error: err });
    });
  });

  // Give in-flight requests time to finish on shutdown
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  // Start AI usage flusher
  try {
    const { createFlusher } = require('./services/ai-usage-flusher.service');
    const flusher = createFlusher({
      db,
      billingUrl: process.env.BILLING_SERVICE_URL || 'http://localhost:5020',
      serviceKey: process.env.INTERNAL_SERVICE_KEY || '',
      sourceApp:  process.env.AI_USAGE_SOURCE_APP  || 'juggler',
    });
    flusher.start();
    serverLogger.info('AI usage flusher started');
  } catch (err) {
    serverLogger.warn('AI usage flusher failed to start', { error: err });
  }

  // juggler-cal-history Plan D — sharded cron for missed auto-mark + 12mo purge.
  // Non-fatal: server continues if cron init fails.
  try {
    const CalHistoryCron = require('./jobs/cal-history-cron');
    const calHistoryCron = new CalHistoryCron();
    calHistoryCron.start();
    serverLogger.info('cal-history-cron started');
  } catch (err) {
    serverLogger.warn('cal-history-cron failed to start', { error: err });
  }

  // Missed Auto-Mark Cron - Phase D
  // Sharded daily cron for missed auto-mark with leader election
  try {
    const MissedAutoMarkCron = require('./jobs/missed-auto-mark-cron');
    const missedAutoMarkCron = new MissedAutoMarkCron();
    missedAutoMarkCron.start();
    serverLogger.info('missed-auto-mark-cron started');
  } catch (err) {
    serverLogger.warn('missed-auto-mark-cron failed to start', { error: err });
  }

  // Start the schedule queue poll loop
  startPollLoop();
  serverLogger.info('Schedule queue poll loop started');
}

// ── Graceful shutdown ──
var shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  serverLogger.info(`${signal} received - shutting down`);

  stopPollLoop();

  if (process.env.NODE_ENV !== 'production') {
    // Dev mode: exit immediately. Graceful shutdown is pointless when
    // nodemon is about to spawn a replacement — lingering processes
    // create zombie server instances that hold DB locks and ports.
    process.exit(0);
    return;
  }

  // Production: graceful shutdown
  if (server) {
    server.close(function() {
      serverLogger.info('HTTP server closed');
      db.destroy().then(function() {
        serverLogger.info('Database pool destroyed');
        process.exit(0);
      }).catch(function(err) {
        serverLogger.error('Error destroying DB pool:', { error: err });
        process.exit(1);
      });
    });
  }

  setTimeout(function() {
    serverLogger.error('Graceful shutdown timed out - forcing exit');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', function() { shutdown('SIGTERM'); });
process.on('SIGINT', function() { shutdown('SIGINT'); });

start().catch(err => {
  serverLogger.error('Fatal startup error:', { error: err });
  process.exit(1);
});

// Handle unhandled rejections — log but don't crash
process.on('unhandledRejection', (reason) => {
  serverLogger.error('Unhandled Rejection:', { reason });
});

// Uncaught exceptions — in production, shut down gracefully; in dev, log and keep running
process.on('uncaughtException', (error) => {
  serverLogger.error('Uncaught Exception:', { error });
  if (process.env.NODE_ENV === 'production') {
    shutdown('uncaughtException');
  }
});
