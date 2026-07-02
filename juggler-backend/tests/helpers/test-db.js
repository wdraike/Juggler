/**
 * Test DB connection + reset utilities.
 *
 * Uses the `test` knex environment (test-bed Docker MySQL on port 3407, juggler_test).
 * All helpers are safe to call from beforeAll / afterAll hooks.
 *
 * Usage:
 *   const db = require('./helpers/test-db');
 *   if (!await db.isAvailable()) return; // skip if Docker not running
 *   await db.clearUser(USER_ID);         // delete all rows for one user
 *   await db.clearAll();                 // truncate every data table
 *   await db.destroy();                  // close pool when suite ends
 */

process.env.NODE_ENV = 'test';

// 999.1037: load .env.test EXPLICITLY (by path), the same way
// tests/cal-sync/helpers/test-setup.js does, instead of relying on
// knexfile.js's bare `require('dotenv').config()` (which loads the default
// `.env` — a file that does not exist in this repo — and is a no-op here).
// Without this, DB_HOST/DB_PORT/DB_USER/DB_PASSWORD depend on whatever order
// OTHER test files happened to require/mutate process.env in the same jest
// worker — exactly the "intermittently hangs or misconnects" (Access denied
// ...@192.168.65.1, no password) failure mode reported in 999.1037,
// reproduced on an unrelated pre-existing file (confirming a require-order
// race, not a test-specific bug). dotenv.config() never overrides an
// already-set process.env var, so an explicit shell export (e.g.
// `DB_PORT=3407 jest`) still takes precedence over .env.test.
var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.test') });

var knex = require('knex');
var knexConfig = require('../../knexfile');

// 999.1037: bound the connect/acquire attempt so a genuinely-unreachable DB
// (test-bed not started, wrong host) fails FAST with a clear error instead of
// hanging on the OS-level TCP timeout for a half-open port. Applied only to
// this test-helper's own knex instance — dev/production knexfile configs
// are unaffected.
var testConnConfig = Object.assign({}, knexConfig.test.connection, { connectTimeout: 5000 });
var testPoolConfig = Object.assign({}, knexConfig.test.pool, { acquireTimeoutMillis: 5000 });

// Single shared connection used by all test helpers and seed scripts
var db = knex(Object.assign({}, knexConfig.test, { connection: testConnConfig, pool: testPoolConfig }));

// Tables that hold user-scoped data, in deletion order (FK-safe)
var USER_TABLES = [
  'task_write_queue',
  'task_instances',
  'task_masters',
  'cal_sync_ledger',
  'gcal_sync_ledger',
  'msft_cal_sync_ledger',
  'user_calendars',
  'sync_history',
  'sync_locks',
  'schedule_queue',
  'scheduler_sessions',
  'ai_usage_outbox',
  'ai_command_log',
  'user_config',
  'locations',
  'tools',
  'projects',
  'plan_usage',
  'oauth_auth_codes',
  'impersonation_log',
  'feature_events',
  'gcal_deleted_events',
  'users'
];

// Tables with no user FK — safe to truncate independently
var SYSTEM_TABLES = [
  'weather_cache',
  'oauth_clients',
  'oauth_code_nonces'
];

/**
 * Returns true if the test DB is reachable.
 * Call at the top of every integration test beforeAll — skip suite if false.
 */
async function isAvailable() {
  try {
    await db.raw('SELECT 1');
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Delete all rows for a single user (FK cascade handles child tables).
 * Faster than clearAll for single-user test isolation.
 */
async function clearUser(userId) {
  // tasks cascade from users via FK — delete user row last
  await db('task_write_queue').where('user_id', userId).del();
  await db('task_instances').where('user_id', userId).del();
  await db('task_masters').where('user_id', userId).del();
  await db('cal_sync_ledger').where('user_id', userId).del();
  await db('gcal_sync_ledger').where('user_id', userId).del().catch(() => {});
  await db('msft_cal_sync_ledger').where('user_id', userId).del().catch(() => {});
  await db('user_calendars').where('user_id', userId).del();
  await db('sync_history').where('user_id', userId).del().catch(() => {});
  await db('sync_locks').where('user_id', userId).del().catch(() => {});
  await db('schedule_queue').where('user_id', userId).del().catch(() => {});
  await db('scheduler_sessions').where('user_id', userId).del().catch(() => {});
  await db('ai_usage_outbox').where('user_id', userId).del().catch(() => {});
  await db('ai_command_log').where('user_id', userId).del().catch(() => {});
  await db('user_config').where('user_id', userId).del();
  await db('locations').where('user_id', userId).del().catch(() => {});
  await db('tools').where('user_id', userId).del().catch(() => {});
  await db('projects').where('user_id', userId).del();
  await db('plan_usage').where('user_id', userId).del().catch(() => {});
  await db('oauth_auth_codes').where('user_id', userId).del().catch(() => {});
  await db('impersonation_log').where('impersonator_id', userId).del().catch(() => {});
  await db('feature_events').where('user_id', userId).del().catch(() => {});
  await db('gcal_deleted_events').where('user_id', userId).del().catch(() => {});
  await db('users').where('id', userId).del();
}

/**
 * Truncate all data tables (fastest full reset — run between test suites).
 * Uses TRUNCATE not DELETE — resets auto-increment counters too.
 * Disables FK checks during truncation so order doesn't matter.
 */
async function clearAll() {
  await db.raw('SET FOREIGN_KEY_CHECKS = 0');
  for (var t of USER_TABLES.concat(SYSTEM_TABLES)) {
    await db.raw('TRUNCATE TABLE ??', [t]).catch(() => {}); // skip missing tables
  }
  await db.raw('SET FOREIGN_KEY_CHECKS = 1');
}

/**
 * Close the connection pool. Call in afterAll of the last test that uses it.
 * Jest's --forceExit makes this optional but it suppresses the open-handles warning.
 */
async function destroy() {
  await db.destroy();
}

module.exports = db;
module.exports.isAvailable = isAvailable;
module.exports.clearUser = clearUser;
module.exports.clearAll = clearAll;
module.exports.destroy = destroy;
