'use strict';

/**
 * migrate-guard.js — Production safety guard for knex migrations.
 *
 * PROBLEM: `npm run migrate` (knex migrate:latest) has no guard. If DB_PORT=3307
 * (GCP Cloud SQL Proxy) is active in .env, running `npm run migrate` from dev
 * silently migrates PRODUCTION.
 *
 * SOLUTION: This CLI wrapper checks for production signals before spawning knex.
 * The guard lives HERE, NOT in knexfile.js — knexfile is imported by the running
 * app (src/db.js, src/lib/db/index.js) and must never throw on import.
 *
 * Production signals:
 *   DB_PORT=3307              → GCP Cloud SQL Proxy (production)
 *   CLOUD_SQL_CONNECTION_NAME → set by Cloud Run / Cloud SQL (production)
 *
 * Opt-in override: ALLOW_PROD_MIGRATE=1 (only '1' is accepted)
 *
 * Usage (via package.json scripts):
 *   node scripts/migrate-guard.js migrate:latest
 *   node scripts/migrate-guard.js migrate:rollback
 *
 * Traceability: jug-migrate-prod-guard AC1–AC4b, ROADMAP 999.302
 */

var spawnSync = require('child_process').spawnSync;

/**
 * Collect production signals from the env object.
 * Uses String() coercion so numeric 3307 is caught as well as string '3307'.
 *
 * @param {Object} env - environment object (defaults to process.env)
 * @throws {Error} when a production signal is detected and ALLOW_PROD_MIGRATE !== '1'
 */
function assertSafeMigrateTarget(env) {
  if (env === undefined) env = process.env;

  var reasons = [];
  if (String(env.DB_PORT) === '3307') {
    reasons.push('DB_PORT=3307 is the production Cloud SQL Proxy');
  }
  if (env.CLOUD_SQL_CONNECTION_NAME) {
    reasons.push('CLOUD_SQL_CONNECTION_NAME is set (production)');
  }

  if (reasons.length && env.ALLOW_PROD_MIGRATE !== '1') {
    throw new Error(
      '\n\n🛑 REFUSING TO MIGRATE: target looks like PRODUCTION.\n' +
      '   ' + reasons.join('; ') + '.\n' +
      '   To migrate safely:\n' +
      '     • Local/test-bed: ensure DB_PORT=3407 (test-bed Docker MySQL)\n' +
      '     • Dev-bed:        ensure DB_PORT=3308 (dev-bed Docker MySQL)\n' +
      '     • Intentional prod migrate: ALLOW_PROD_MIGRATE=1 npm run migrate\n'
    );
  }
}

module.exports = { assertSafeMigrateTarget: assertSafeMigrateTarget };

// ── CLI entry point ──────────────────────────────────────────────────────────
// Only runs when executed directly (node scripts/migrate-guard.js ...).
// When require()'d by tests or app code, this block is skipped.
if (require.main === module) {
  try {
    assertSafeMigrateTarget(process.env);
  } catch (err) {
    process.stderr.write(err.message + '\n');
    process.exit(1);
  }

  // Guard passed — forward argv to knex (process.argv.slice(2) = subcommand + flags)
  var args = ['knex'].concat(process.argv.slice(2));
  var result = spawnSync('npx', args, { stdio: 'inherit', shell: false });
  process.exit(result.status !== null ? result.status : 1);
}
