/**
 * Seed a fully-configured test user into the real test DB.
 *
 * Config mirrors the actual Strive user setup from real-config-fixtures.js
 * so scheduler tests run against realistic time blocks, locations, and tools.
 *
 * Usage:
 *   const { seedBaseUser, TEST_USER } = require('./seed/base-user');
 *   const user = await seedBaseUser(db);           // default test user
 *   const user = await seedBaseUser(db, 'user-2'); // custom id suffix
 */

var { REAL_TIME_BLOCKS, REAL_TOOL_MATRIX, REAL_LOC_SCHEDULES, REAL_LOC_SCHEDULE_DEFAULTS } =
  require('../real-config-fixtures');

var TEST_USER = {
  id: 'test-user-00000000-0000-0000-0000',
  email: 'test@juggler.local',
  name: 'Test User',
  timezone: 'America/New_York'
};

// Config keys written to user_config
var CONFIG_KEYS = {
  timeBlocks:           REAL_TIME_BLOCKS,
  toolMatrix:           REAL_TOOL_MATRIX,
  locSchedules:         REAL_LOC_SCHEDULES,
  locScheduleDefaults:  REAL_LOC_SCHEDULE_DEFAULTS,
  locScheduleOverrides: {},
  hourLocationOverrides:{},
  preferences: {
    splitDefault: false,
    splitMinDefault: 15
  }
};

/**
 * Insert (or upsert) the test user + full config into the DB.
 * Returns the user row object.
 *
 * @param {import('knex').Knex} db
 * @param {string} [idSuffix] - optional suffix appended to default user id
 */
async function seedBaseUser(db, idSuffix) {
  var userId = idSuffix
    ? 'test-user-' + idSuffix.replace(/[^a-z0-9-]/gi, '-')
    : TEST_USER.id;

  var email = idSuffix ? ('test-' + idSuffix + '@juggler.local') : TEST_USER.email;

  // Upsert user
  await db('users')
    .insert({
      id: userId,
      email: email,
      name: TEST_USER.name,
      timezone: TEST_USER.timezone,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    })
    .onConflict('id')
    .merge(['email', 'name', 'timezone', 'updated_at']);

  // Upsert all config keys
  for (var [key, value] of Object.entries(CONFIG_KEYS)) {
    await db('user_config')
      .insert({
        user_id: userId,
        config_key: key,
        config_value: JSON.stringify(value),
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      })
      .onConflict(['user_id', 'config_key'])
      .merge(['config_value', 'updated_at']);
  }

  // Seed default project
  await db('projects')
    .insert({
      user_id: userId,
      name: 'Inbox',
      color: '#6B7280',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    })
    .onConflict(['user_id', 'name'])
    .ignore();

  return { id: userId, email, name: TEST_USER.name, timezone: TEST_USER.timezone };
}

/**
 * Seed a secondary user for multi-user isolation tests.
 */
async function seedSecondUser(db) {
  return seedBaseUser(db, 'sec-00000000-0000-0000');
}

module.exports = { seedBaseUser, seedSecondUser, TEST_USER, CONFIG_KEYS };
