// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../../src/lib/audit-context').stampInsert(rows);
/**
 * Full-user seed and teardown helper for real-DB integration tests.
 *
 * Provides:
 *   seedFullUser(db, userId, opts) — inserts a complete user fixture with
 *     default time_blocks and tool_matrix config, plus any optional
 *     locations, projects, tools, and tasks supplied via opts.
 *
 *   teardownUser(db, userId) — deletes all rows for userId in FK-safe order.
 *
 * Usage:
 *   const { seedFullUser, teardownUser } = require('./seedFullUser');
 *   const db = require('../src/db');
 *
 *   beforeAll(async () => await seedFullUser(db, USER_ID, { locations: [...] }));
 *   afterAll(async () => await teardownUser(db, USER_ID));
 */

const testDb = require('./testDb');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');

/**
 * Seed a complete user with config defaults.
 *
 * @param {object} db - Knex instance (pass the real DB from require('../src/db'))
 * @param {string} userId - Unique user ID for this fixture
 * @param {object} opts
 * @param {string}   [opts.email]    - Override email (defaults to `${userId}@test.com`)
 * @param {string}   [opts.name]     - Override name (defaults to 'Full Test User')
 * @param {string}   [opts.timezone] - Override timezone (defaults to 'America/New_York')
 * @param {object[]} [opts.locations] - Location rows to insert (merged with user_id)
 * @param {object[]} [opts.projects]  - Project rows to insert (merged with user_id)
 * @param {object[]} [opts.tools]     - Tool rows to insert (merged with user_id)
 * @param {object[]} [opts.tasks]     - Task rows to seed via testDb.seedTask (merged with user_id)
 */
async function seedFullUser(db, userId, opts = {}) {
  const {
    email = `${userId}@test.com`,
    name = 'Full Test User',
    timezone = 'America/New_York',
    locations = [],
    projects = [],
    tools = [],
    tasks = [],
  } = opts;

  await db('users').insert(__stampFixture({
    id: userId,
    email,
    name,
    timezone,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  }));

  // Insert default scheduler config (same keys used by runScheduleIntegration.test.js)
  await db('user_config').insert(__stampFixture({
    user_id: userId,
    config_key: 'time_blocks',
    config_value: JSON.stringify(DEFAULT_TIME_BLOCKS),
  }));
  await db('user_config').insert(__stampFixture({
    user_id: userId,
    config_key: 'tool_matrix',
    config_value: JSON.stringify(DEFAULT_TOOL_MATRIX),
  }));

  for (const loc of locations) {
    await db('locations').insert(__stampFixture({ user_id: userId, ...loc }));
  }

  for (const proj of projects) {
    await db('projects').insert(__stampFixture({ user_id: userId, ...proj }));
  }

  for (const tool of tools) {
    await db('tools').insert(__stampFixture({ user_id: userId, ...tool }));
  }

  for (const task of tasks) {
    await testDb.seedTask({ user_id: userId, ...task });
  }
}

/**
 * Delete all data for userId in FK-safe dependency order.
 *
 * Mirrors the cleanup order in testDb.js but scoped to a single user so
 * parallel test suites with different USER_IDs can run safely.
 *
 * @param {object} db     - Knex instance
 * @param {string} userId - The user ID whose data should be removed
 */
async function teardownUser(db, userId) {
  await db('cal_sync_ledger').where('user_id', userId).del();
  await db('task_instances').where('user_id', userId).del();
  await db('task_masters').where('user_id', userId).del();
  await db('projects').where('user_id', userId).del();
  await db('locations').where('user_id', userId).del();
  await db('tools').where('user_id', userId).del();
  await db('user_config').where('user_id', userId).del();
  await db('sync_locks').where('user_id', userId).del();
  await db('users').where('id', userId).del();
}

module.exports = { seedFullUser, teardownUser };
