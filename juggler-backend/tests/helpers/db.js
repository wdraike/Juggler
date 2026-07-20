// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../../src/lib/audit-context').stampInsert(rows);
const db = require('./test-db');
async function setupTestDB() {
  if (!await db.isAvailable()) throw new Error('Test database is not available');
  await db.clearAll();
  await db('users').insert(__stampFixture({ id: '1', email: 'test@raike.test', name: 'Test User', created_at: new Date(), updated_at: new Date() })).catch(() => {});
}
async function teardownTestDB() { return Promise.resolve(); }
module.exports = { setupTestDB, teardownTestDB };
