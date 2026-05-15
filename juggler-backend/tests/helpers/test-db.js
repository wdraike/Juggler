/**
 * Test DB connection + reset utilities.
 *
 * Uses the `test` knex environment (port 3308, juggler_test).
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

var knex = require('knex');
var knexConfig = require('../../knexfile');

// Single shared connection used by all test helpers and seed scripts
var db = knex(knexConfig.test);

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
