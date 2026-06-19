/**
 * Jest globalSetup — runs once before all test suites.
 * Runs pending migrations on juggler_test if the DB is reachable.
 * Tests that need DB call db.isAvailable() themselves and skip if false.
 */

process.env.NODE_ENV = 'test';

var knex = require('knex');
var knexConfig = require('../../knexfile');

// ── SAFETY GUARD ────────────────────────────────────────────────────────────
// The `test` knexfile config inherits DB_PORT from .env via dotenv. The project
// .env points at the production Cloud SQL Proxy (port 3307 / db `juggler`), so a
// bare `npx jest` (without DB_PORT=3407) would run migrate.latest() AND data-
// writing tests against PRODUCTION. Refuse to run if the target looks like prod.
// Tests MUST target test-bed (DB_PORT=3407) — use `cd test-bed && make test-juggler`.
function assertNotProduction(conn) {
  var port = String(conn && conn.port);
  var reasons = [];
  if (port === '3307') reasons.push('DB_PORT=3307 is the production Cloud SQL Proxy');
  if (process.env.CLOUD_SQL_CONNECTION_NAME) reasons.push('CLOUD_SQL_CONNECTION_NAME is set (production)');
  if (reasons.length) {
    throw new Error(
      '\n\n🛑 REFUSING TO RUN TESTS AGAINST PRODUCTION.\n' +
      '   ' + reasons.join('; ') + '.\n' +
      '   Tests must target test-bed MySQL on 3407.\n' +
      '   Run:  cd test-bed && make test-juggler   (or set DB_PORT=3407 explicitly).\n'
    );
  }
}

module.exports = async function globalSetup() {
  assertNotProduction(knexConfig.test.connection);
  var db = knex(knexConfig.test);
  try {
    await db.raw('SELECT 1');
  } catch (e) {
    // DB not running — tests will self-skip via isAvailable()
    await db.destroy();
    return;
  }

  try {
    await db.migrate.latest();
    console.log('\n✓  juggler_test migrations up to date');
  } catch (err) {
    if (err.message && err.message.includes('already exists')) {
      console.log('\n✓  Table already exists — skipping migration');
    } else {
      console.error('\n✗  Migration failed in globalSetup:', err.message);
      throw err;
    }
  } finally {
    await db.destroy();
  }
};
