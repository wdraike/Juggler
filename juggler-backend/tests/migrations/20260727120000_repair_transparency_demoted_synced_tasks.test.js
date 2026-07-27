/**
 * 20260727120000_repair_transparency_demoted_synced_tasks.test.js
 *
 * Migration regression test (999.4671) — one-time repair of provider-ingested
 * tasks that the old transparency→REMINDER mapping demoted to a dur=0 marker,
 * leaving their time slot unreserved so the scheduler double-booked it.
 * See the migration file's header for the evidence trail and the deliberate
 * exclusions (dur=0 rows; users who own a reminder-ingest calendar).
 *
 * Run (isolated DB — juggler_4671_test; test-bed 3407 must be up):
 *   export DB_PORT=3407 DB_HOST=127.0.0.1 DB_USER=root DB_PASSWORD=rootpass \
 *          DB_NAME=juggler_4671_test NODE_ENV=test
 *   npx jest tests/migrations/20260727120000_repair_transparency_demoted_synced_tasks.test.js \
 *          --runInBand --forceExit
 */

'use strict';

// 300s, not the usual 60s: beforeAll builds this isolated schema from scratch on
// its FIRST run (every migration in history), which does not fit in a minute.
jest.setTimeout(300000);

var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.test') });

process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '3407';
process.env.DB_USER = process.env.DB_USER || 'root';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'rootpass';
// 999.1037 pattern: reassert unconditionally so this isolated schema always wins
// over jest.setupEnv's .env.test default — never run against the shared schema.
process.env.DB_NAME = 'juggler_4671_test';

var knex = require('knex');
var knexConfig = require('../../knexfile');
var { ensureIsolatedDbExists } = require('../helpers/ensureIsolatedDb');

var db = knex(knexConfig.test);

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

var MIGRATION_NAME = '20260727120000_repair_transparency_demoted_synced_tasks.js';
var USER_A = 'w4671-user-a';  // plain user, no calendars configured
var USER_B = 'w4671-user-b';  // owns a calendar with ingest_mode='reminder'

async function seedUser(userId) {
  await db.raw(
    'INSERT IGNORE INTO users (id, email, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
    [userId, userId + '@w4671.local']
  );
}

async function seedTask(id, userId, placementMode, dur, when) {
  await db('task_masters').insert({
    id: id,
    user_id: userId,
    text: 'fixture ' + id,
    dur: dur,
    placement_mode: placementMode,
    when: when || null,
    created_by: 'test-fixture',
    updated_by: 'test-fixture'
  });
}

async function modeOf(id) {
  var row = await db('task_masters').where({ id: id }).first();
  return row && row.placement_mode;
}

// Re-run the migration over freshly seeded rows.
async function replayMigration() {
  await db.migrate.down({ name: MIGRATION_NAME });
  await db.migrate.latest();
}

describe('Migration 20260727120000 (repair transparency-demoted synced tasks, 999.4671)', () => {
  beforeAll(async () => {
    await ensureIsolatedDbExists();
    if (!(await isDbAvailable())) {
      console.warn('⚠ DB not available — migration tests will be skipped');
      return;
    }
    await db.migrate.latest();
    await seedUser(USER_A);
    await seedUser(USER_B);
  });

  beforeEach(async () => {
    if (!(await isDbAvailable())) return;
    await db.migrate.latest();
    await db('task_masters').where('id', 'like', '%w4671%').del();
    await db('user_calendars').where('user_id', 'like', 'w4671-%').del();
  });

  afterAll(async () => {
    if (await isDbAvailable()) {
      await db('task_masters').where('id', 'like', '%w4671%').del();
      await db('user_calendars').where('user_id', 'like', 'w4671-%').del();
      await db('users').where('id', 'like', 'w4671-%').del();
    }
    await db.destroy();
  });

  it('repairs a timed gcal-ingested reminder → fixed', async () => {
    if (!(await isDbAvailable())) return;
    await seedTask('gcal_w4671aaa', USER_A, 'reminder', 60);

    await replayMigration();

    expect(await modeOf('gcal_w4671aaa')).toBe('fixed');
  });

  it('repairs msft- and apple-ingested reminders too', async () => {
    if (!(await isDbAvailable())) return;
    await seedTask('msft_w4671bbb', USER_A, 'reminder', 30);
    await seedTask('apple_w4671ccc', USER_A, 'reminder', 45);

    await replayMigration();

    expect(await modeOf('msft_w4671bbb')).toBe('fixed');
    expect(await modeOf('apple_w4671ccc')).toBe('fixed');
  });

  it('leaves a dur=0 point marker alone (no grid occupancy either way)', async () => {
    if (!(await isDbAvailable())) return;
    await seedTask('gcal_w4671ddd', USER_A, 'reminder', 0);

    await replayMigration();

    expect(await modeOf('gcal_w4671ddd')).toBe('reminder');
  });

  // Transparency beat the all-day branch in the OLD ingest ternary, producing
  // when='allday' + placement_mode='reminder' — a combination the new ingest can
  // never write, and one that loses all-day treatment downstream.
  it("repairs the all-day residue (when='allday' + reminder) → all_day", async () => {
    if (!(await isDbAvailable())) return;
    await seedTask('gcal_w4671hhh', USER_A, 'reminder', 0, 'allday');

    await replayMigration();

    expect(await modeOf('gcal_w4671hhh')).toBe('all_day');
  });

  it("does NOT touch a Juggler-created when='allday' reminder", async () => {
    if (!(await isDbAvailable())) return;
    await seedTask('w4671-local-allday', USER_A, 'reminder', 0, 'allday');

    await replayMigration();

    expect(await modeOf('w4671-local-allday')).toBe('reminder');
  });

  it('leaves a Juggler-created (non provider-prefixed) reminder alone', async () => {
    if (!(await isDbAvailable())) return;
    await seedTask('w4671-local-task', USER_A, 'reminder', 60);

    await replayMigration();

    expect(await modeOf('w4671-local-task')).toBe('reminder');
  });

  it('leaves non-reminder synced tasks untouched', async () => {
    if (!(await isDbAvailable())) return;
    await seedTask('gcal_w4671eee', USER_A, 'anytime', 60);
    await seedTask('gcal_w4671fff', USER_A, 'all_day', 0);

    await replayMigration();

    expect(await modeOf('gcal_w4671eee')).toBe('anytime');
    expect(await modeOf('gcal_w4671fff')).toBe('all_day');
  });

  it('SKIPS every task of a user who owns a reminder-ingest calendar (their reminders may be intentional)', async () => {
    if (!(await isDbAvailable())) return;
    await seedTask('gcal_w4671ggg', USER_B, 'reminder', 60);
    await db('user_calendars').insert({
      user_id: USER_B,
      provider: 'gcal',
      calendar_id: 'w4671-primary',
      ingest_mode: 'reminder',
      created_by: 'test-fixture',
      updated_by: 'test-fixture'
    });

    await replayMigration();

    expect(await modeOf('gcal_w4671ggg')).toBe('reminder');
  });
});
