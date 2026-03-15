/**
 * Raike & Sons Backend Server
 */

require('dotenv').config();

const app = require('./app');
const { loadJWTSecrets } = require('./middleware/jwt-auth');

const PORT = process.env.PORT || 5002;

async function start() {
  console.log('Starting Raike & Sons backend...');
  console.log(`  NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`  DB_HOST: ${process.env.DB_HOST}`);
  console.log(`  DB_NAME: ${process.env.DB_NAME}`);
  console.log(`  PORT: ${PORT}`);

  // Load JWT secrets
  await loadJWTSecrets();

  app.listen(PORT, () => {
    console.log(`Raike & Sons backend running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

// Handle unhandled rejections
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});
