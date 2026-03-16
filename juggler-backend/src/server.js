/**
 * Raike & Sons Backend Server
 */

require('dotenv').config();

const app = require('./app');
const { loadJWTSecrets } = require('./middleware/jwt-auth');
const db = require('./db');

const PORT = process.env.PORT || 5002;

var server;

async function start() {
  console.log('Starting Raike & Sons backend...');
  console.log(`  NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`  DB_HOST: ${process.env.DB_HOST}`);
  console.log(`  DB_NAME: ${process.env.DB_NAME}`);
  console.log(`  PORT: ${PORT}`);

  // Load JWT secrets
  await loadJWTSecrets();

  server = app.listen(PORT, () => {
    console.log(`Raike & Sons backend running on port ${PORT}`);
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
  console.log(`${signal} received — shutting down gracefully...`);

  // Stop accepting new connections
  if (server) {
    server.close(function() {
      console.log('HTTP server closed');
      // Destroy database pool
      db.destroy().then(function() {
        console.log('Database pool destroyed');
        process.exit(0);
      }).catch(function(err) {
        console.error('Error destroying DB pool:', err);
        process.exit(1);
      });
    });
  }

  // Force exit after 10 seconds if graceful shutdown stalls
  setTimeout(function() {
    console.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10000);
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
