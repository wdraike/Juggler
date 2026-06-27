/**
 * Jest globalSetup — runs once before all test suites.
 * Runs pending migrations on juggler_test if the DB is reachable.
 * Tests that need DB call db.isAvailable() themselves and skip if false.
 */

process.env.NODE_ENV = 'test';

var knex = require('knex');
var knexConfig = require('../../knexfile');

// ── SAFETY GUARD (999.751) ──────────────────────────────────────────────────
// The `test` knexfile config inherits DB_PORT/DB_NAME from .env via dotenv. A
// bare `npx jest` with a *dev* .env present (DB_NAME=juggler, DB_PORT=3308) would
// run migrate.latest() AND data-writing test setup/teardown against the live DEV
// database — wiping task_instances/masters (this happened 2026-06-19). The prior
// guard only refused prod (3307); it did NOT refuse dev (3308). So instead of an
// allow-prod blocklist, REQUIRE a genuine test target: port 3407 (test-bed) OR a
// database name ending in `_test`. Anything else (dev 3308, prod 3307, or an
// unrecognised target) is refused. Tests MUST target test-bed — use
// `cd test-bed && make test-juggler`.
function assertSafeTestTarget(conn) {
  var port = String((conn && conn.port) || '');
  var database = String((conn && conn.database) || '');
  // Test-bed ports: the fixed instance (3407) plus the ephemeral pool band
  // (3410-3417, test-bed/scripts/instance.sh). The safety invariant is unchanged
  // — still requires a `_test` DB name and no prod signal — only the recognised
  // test-port set widened. Dev (3308) and prod (3307) remain refused.
  // ⚠ COUPLED to POOL_SIZE=8 in test-bed/scripts/instance.sh: the `341[0-7]` band
  //   matches slots 0-7 (ports 3410-3417). If the pool grows past 8 slots, widen
  //   this regex too — otherwise the new slots' ports are REFUSED (fails safe, but
  //   surprising). Keep the two in sync.
  var isTestbedPort = port === '3407' || /^341[0-7]$/.test(port);
  var isTestDbName = /_test$/.test(database);
  var prodSignals = [];
  if (port === '3307') prodSignals.push('DB_PORT=3307 is the production Cloud SQL Proxy');
  if (process.env.CLOUD_SQL_CONNECTION_NAME) prodSignals.push('CLOUD_SQL_CONNECTION_NAME is set (production)');
  // Safe only when the target is unambiguously a test target AND carries no prod signal.
  if (isTestbedPort && isTestDbName && prodSignals.length === 0) return;
  var reasons = prodSignals.slice();
  if (!isTestbedPort) reasons.push('DB_PORT=' + (port || '(unset)') + ' is not the test-bed port 3407');
  if (!isTestDbName) reasons.push('DB_NAME=' + (database || '(unset)') + ' does not end in `_test` (refusing to write to a non-test database)');
  throw new Error(
    '\n\n🛑 REFUSING TO RUN TESTS AGAINST A NON-TEST DATABASE.\n' +
    '   ' + reasons.join('; ') + '.\n' +
    '   Tests must target test-bed MySQL on 3407 with a `*_test` database.\n' +
    '   Run:  cd test-bed && make test-juggler   (or set DB_PORT=3407 + a `*_test` DB_NAME explicitly).\n'
  );
}

module.exports = async function globalSetup() {
  assertSafeTestTarget(knexConfig.test.connection);
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
