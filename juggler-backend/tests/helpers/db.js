const db = require('./test-db');
async function setupTestDB() {
  if (!await db.isAvailable()) throw new Error('Test database is not available');
  await db.clearAll();
  await db('users').insert({ id: '1', email: 'test@raike.test', name: 'Test User', created_at: new Date(), updated_at: new Date() }).catch(() => {});
}
async function teardownTestDB() { return Promise.resolve(); }
module.exports = { setupTestDB, teardownTestDB };
