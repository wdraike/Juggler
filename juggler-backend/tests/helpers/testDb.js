/**
 * Test database helper — provides a real knex connection to juggler_test.
 * Includes helpers to seed and clean up test data.
 */
var knex = require('knex');
var config = require('../../knexfile').test;

var db = null;

function getDb() {
  if (!db) {
    db = knex(config);
  }
  return db;
}

async function isAvailable() {
  try {
    await getDb().raw('SELECT 1');
    return true;
  } catch (e) {
    return false;
  }
}

async function cleanup() {
  var d = getDb();
  // Delete in dependency order
  await d('cal_sync_ledger').del();
  await d('tasks').del();
  await d('projects').del();
  await d('locations').del();
  await d('tools').del();
  await d('user_config').del();
  await d('sync_locks').del();
  await d('users').del();
}

async function seedUser(overrides) {
  var d = getDb();
  var user = Object.assign({
    id: 'test-user-001',
    email: 'test@test.com',
    name: 'Test User',
    timezone: 'America/New_York',
    created_at: d.fn.now(),
    updated_at: d.fn.now()
  }, overrides);
  await d('users').insert(user);
  return user;
}

async function seedTask(overrides) {
  var d = getDb();
  var task = Object.assign({
    id: 'task-' + Math.random().toString(36).slice(2, 10),
    user_id: 'test-user-001',
    task_type: 'task',
    text: 'Test task',
    dur: 30,
    pri: 'P3',
    status: '',
    recurring: 0,
    created_at: d.fn.now(),
    updated_at: d.fn.now()
  }, overrides);
  await d('tasks').insert(task);
  return task;
}

async function seedTemplate(overrides) {
  return seedTask(Object.assign({
    task_type: 'recurring_template',
    recurring: 1,
    recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' })
  }, overrides));
}

async function seedInstance(templateId, overrides) {
  return seedTask(Object.assign({
    task_type: 'recurring_instance',
    recurring: 1,
    source_id: templateId
  }, overrides));
}

async function destroy() {
  if (db) {
    await db.destroy();
    db = null;
  }
}

module.exports = { getDb, isAvailable, cleanup, seedUser, seedTask, seedTemplate, seedInstance, destroy };
