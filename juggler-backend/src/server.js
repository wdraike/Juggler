/**
 * Raike & Sons Backend Server
 */

require('dotenv').config();

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
      pids.forEach(function(p) { try { process.kill(p, 'SIGKILL'); } catch (e) { /* already dead */ } });
      console.log('[startup] Killed ' + pids.length + ' zombie process(es) on port ' + port + ': ' + pids.join(', '));
    }
  } catch (e) { /* lsof not available, skip */ }
}

const app = require('./app');
const { loadJWTSecrets } = require('./middleware/jwt-auth');
const db = require('./db');
const { enqueueScheduleRun, stopPollLoop } = require('./scheduler/scheduleQueue');

const PORT = process.env.PORT || 5002;

var server;

async function start() {
  console.log('Starting Raike & Sons backend...');
  console.log(`  NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`  DB_HOST: ${process.env.DB_HOST}`);
  console.log(`  DB_NAME: ${process.env.DB_NAME}`);
  console.log(`  PORT: ${PORT}`);

  // Clear stale sync locks before accepting requests
  try {
    var cleared = await db('sync_locks').del();
    if (cleared > 0) console.log('[startup] Cleared ' + cleared + ' stale sync lock(s)');
  } catch (e) { /* table might not exist yet */ }

  // Load JWT secrets
  await loadJWTSecrets();

  server = app.listen(PORT, () => {
    console.log(`Raike & Sons backend running on port ${PORT}`);

    // Enqueue a scheduler run for all active users on startup
    // so placements are fresh without waiting for the first mutation.
    db('tasks').distinct('user_id').then(function(rows) {
      rows.forEach(function(r) {
        enqueueScheduleRun(r.user_id, 'startup');
      });
      if (rows.length > 0) console.log('[SCHED] enqueued startup runs for ' + rows.length + ' user(s)');
    }).catch(function(err) {
      console.error('[SCHED] startup enqueue failed:', err.message);
    });
  });

  // Give in-flight requests time to finish on shutdown
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
}

// ── Graceful shutdown ──
var shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — shutting down`);

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
      console.log('HTTP server closed');
      db.destroy().then(function() {
        console.log('Database pool destroyed');
        process.exit(0);
      }).catch(function(err) {
        console.error('Error destroying DB pool:', err);
        process.exit(1);
      });
    });
  }

  setTimeout(function() {
    console.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', function() { shutdown('SIGTERM'); });
process.on('SIGINT', function() { shutdown('SIGINT'); });

start().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

// Handle unhandled rejections — log but don't crash
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

// Uncaught exceptions — in production, shut down gracefully; in dev, log and keep running
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  if (process.env.NODE_ENV === 'production') {
    shutdown('uncaughtException');
  }
});
