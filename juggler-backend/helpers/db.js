const db = require('./test-db');

async function setupTestDB() {
  if (!await db.isAvailable()) {
    throw new Error('Test database is not available');
  }
  await db.clearAll();
}

async function teardownTestDB() {
  await db.destroy();
}

module.exports = { setupTestDB, teardownTestDB };