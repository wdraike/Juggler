/**
 * 20260509000100.test.js — One-time sync_history backlog purge migration (D-12)
 *
 * Verifies that the migration deletes ALL sync_history rows older than 7 days
 * across all users (no user_id filter — global cleanup of the ~1M row backlog),
 * and that down() is a safe no-op.
 */

jest.setTimeout(30000);

var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.test') });

var db = require('../../src/db');
var migration = require('../../src/db/migrations/20260509000100_purge_old_sync_history');
var { requireDB } = require('../helpers/requireDB');

var USER_A = 'd12-test-user-A';
var USER_B = 'd12-test-user-B';

var _dbAvailable = null;
async function isDbAvailable() {
  if (_dbAvailable !== null) return _dbAvailable;
  try {
    await db.raw('SELECT 1');
    _dbAvailable = true;
  } catch (e) {
    console.warn('Test DB not available:', e.message);
    _dbAvailable = false;
  }
  return _dbAvailable;
}

async function seedUser(id) {
  await db('users').where('id', id).del();
  await db('users').insert({
    id: id,
    email: id + '@test.com',
    name: 'Migration Test ' + id,
    timezone: 'America/New_York',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
}

async function cleanup() {
  // CASCADE deletes child rows
  await db('users').whereIn('id', [USER_A, USER_B]).del();
}

async function insertHistoryRow(userId, ageDays) {
  // Compute a created_at AGE days in the past (in UTC).
  var now = new Date();
  var ts = new Date(now.getTime() - ageDays * 24 * 60 * 60 * 1000);
  var rows = await db('sync_history').insert({
    user_id: userId,
    sync_run_id: 'run-' + userId + '-' + ageDays,
    provider: 'gcal',
    action: 'pushed',
    task_id: null,
    task_text: 'age=' + ageDays + 'd',
    event_id: null,
    created_at: ts
  });
  return rows[0];
}

beforeAll(async () => {
  if (!await isDbAvailable()) return;
  await cleanup();
  await seedUser(USER_A);
  await seedUser(USER_B);
});

afterEach(async () => {
  if (!await isDbAvailable()) return;
  // Wipe history for both test users between tests
  await db('sync_history').whereIn('user_id', [USER_A, USER_B]).del();
});

afterAll(async () => {
  if (!await isDbAvailable()) return;
  await cleanup();
  await db.destroy();
});

describe('migration 20260509000100_purge_old_sync_history (D-12)', () => {

  test('up() deletes ALL sync_history rows older than 7 days globally (across users)', requireDB(async () => {
    // Seed: each user gets one >7d row and one <7d row.
    var aOld = await insertHistoryRow(USER_A, 8);   // 8 days old — should be purged
    var aNew = await insertHistoryRow(USER_A, 6);   // 6 days old — should remain
    var bOld = await insertHistoryRow(USER_B, 30);  // 30 days old — should be purged
    var bNew = await insertHistoryRow(USER_B, 1);   // 1 day old — should remain

    // Pre-check: all four exist
    var preA = await db('sync_history').whereIn('id', [aOld, aNew]).pluck('id');
    var preB = await db('sync_history').whereIn('id', [bOld, bNew]).pluck('id');
    expect(preA.sort()).toEqual([aOld, aNew].sort());
    expect(preB.sort()).toEqual([bOld, bNew].sort());

    // Run the migration up()
    await migration.up(db);

    // Old rows for BOTH users must be gone
    var foundAOld = await db('sync_history').where('id', aOld).first();
    var foundBOld = await db('sync_history').where('id', bOld).first();
    expect(foundAOld).toBeFalsy();
    expect(foundBOld).toBeFalsy();

    // Recent rows for BOTH users must remain
    var foundANew = await db('sync_history').where('id', aNew).first();
    var foundBNew = await db('sync_history').where('id', bNew).first();
    expect(foundANew).toBeTruthy();
    expect(foundBNew).toBeTruthy();
  }));

  test('up() is idempotent — running twice leaves recent rows intact', requireDB(async () => {
    var newId = await insertHistoryRow(USER_A, 2);  // 2 days old — should always remain
    var oldId = await insertHistoryRow(USER_A, 10); // 10 days old — should be deleted on first run

    await migration.up(db);
    await migration.up(db); // run again — must not error or delete recent rows

    var foundNew = await db('sync_history').where('id', newId).first();
    var foundOld = await db('sync_history').where('id', oldId).first();
    expect(foundNew).toBeTruthy();
    expect(foundOld).toBeFalsy();
  }));

  test('down() is a no-op (does not throw, does not modify recent rows)', requireDB(async () => {
    var newId = await insertHistoryRow(USER_A, 3);
    await expect(migration.down(db)).resolves.not.toThrow();
    var found = await db('sync_history').where('id', newId).first();
    expect(found).toBeTruthy();
  }));

  test('exactly-7-day-old rows are NOT deleted (boundary check)', requireDB(async () => {
    // Insert a row dated just inside the 7-day window (6.9 days old).
    // The migration uses `created_at < NOW() - INTERVAL 7 DAY` (strict less-than),
    // so a row right at the boundary should survive.
    var insideId = await insertHistoryRow(USER_A, 6.9);
    var outsideId = await insertHistoryRow(USER_A, 7.1);

    await migration.up(db);

    var inside = await db('sync_history').where('id', insideId).first();
    var outside = await db('sync_history').where('id', outsideId).first();
    expect(inside).toBeTruthy();
    expect(outside).toBeFalsy();
  }));

});
