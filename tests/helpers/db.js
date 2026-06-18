const db = require('./test-db');

async function setupTestDB() {
  if (!await db.isAvailable()) {
    throw new Error('Test database is not available');
  }
  await db.clearAll();
  // Seed a default user — FK constraint requires users(id) to exist
  await db('users').insert({
    id: '1',
    email: 'test@raike.test',
    name: 'Test User',
    created_at: new Date(),
    updated_at: new Date()
  }).catch(() => {}); // ignore if already exists
}

async function teardownTestDB() {
  // No-op. Shared pool singleton survives across describe blocks.
  // --forceExit handles cleanup at process end.
  return Promise.resolve();
}

module.exports = { setupTestDB, teardownTestDB };
