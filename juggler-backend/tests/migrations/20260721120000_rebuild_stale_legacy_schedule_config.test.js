/**
 * 20260721120000_rebuild_stale_legacy_schedule_config.test.js
 *
 * Migration regression test (999.2146) — rebuilds stale legacy time_blocks/
 * loc_schedules user_config rows from canonical schedule_templates +
 * template_defaults, for users whose schedule_templates passes
 * validateScheduleTemplates. See the migration file's header for the
 * evidence-based "rebuild, not delete" reasoning.
 *
 * Run (isolated DB — juggler_2146_test; test-bed 3407 must be up):
 *   export DB_PORT=3407 DB_HOST=127.0.0.1 DB_USER=root DB_PASSWORD=rootpass \
 *          DB_NAME=juggler_2146_test NODE_ENV=test
 *   npx jest tests/migrations/20260721120000_rebuild_stale_legacy_schedule_config.test.js \
 *          --runInBand --forceExit
 */

'use strict';

jest.setTimeout(60000);

var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.test') });

process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '3407';
process.env.DB_USER = process.env.DB_USER || 'root';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'rootpass';
// 999.1037 pattern (see 20260627000000/20260626000000 precedent): reassert
// unconditionally so this isolated schema always wins over jest.setupEnv's
// .env.test default (DB_NAME=juggler_test) — never run against the shared schema.
process.env.DB_NAME = 'juggler_2146_test';

var knex = require('knex');
var knexConfig = require('../../knexfile');
var { ensureIsolatedDbExists } = require('../helpers/ensureIsolatedDb');
var defaultTemplates = require('../../src/slices/user-config/domain/defaultTemplates');

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

var MIGRATION_NAME = '20260721120000_rebuild_stale_legacy_schedule_config.js';
var USER_A = 'w2146-user-a'; // valid schedule_templates + template_defaults + stale legacy
var USER_B = 'w2146-user-b'; // missing/invalid schedule_templates -- skip
var USER_C = 'w2146-user-c'; // valid schedule_templates, NO template_defaults, NO legacy rows at all
var USER_D = 'w2146-user-d'; // template_defaults references an EMPTY-blocks template (harrison finding 1)
var USER_E = 'w2146-user-e'; // the 'weekday' template ITSELF has empty blocks -- falls to server defaults SSOT

var CUSTOM_TEMPLATES = {
  weekday: { name: 'Weekday', system: true, locOverrides: {}, blocks: [{ id: 'w1', tag: 'biz', name: 'Biz', start: 480, end: 720, loc: 'work' }] },
  weekend: { name: 'Weekend', system: true, locOverrides: {}, blocks: [{ id: 'w2', tag: 'morning', name: 'Morning', start: 420, end: 720, loc: 'home' }] }
};
var CUSTOM_DEFAULTS = { Mon: 'weekday', Tue: 'weekday', Wed: 'weekday', Thu: 'weekday', Fri: 'weekday', Sat: 'weekend', Sun: 'weekend' };
var STALE_LEGACY_TIME_BLOCKS = { Mon: [{ id: 'stale', tag: 'custom', name: 'Custom', start: 0, end: 540 }] };
var STALE_LEGACY_LOC_SCHEDULES = { weekday: { name: 'Old', icon: null, system: false, hours: {} } };

async function seedUserConfig(userId, key, value) {
  await db('user_config').insert({
    user_id: userId,
    config_key: key,
    config_value: JSON.stringify(value),
    created_by: 'test-fixture',
    updated_by: 'test-fixture'
  });
}

async function seedUser(userId) {
  await db.raw(
    'INSERT IGNORE INTO users (id, email, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
    [userId, userId + '@w2146.local']
  );
}

describe('Migration 20260721120000 (rebuild stale legacy schedule config, 999.2146)', () => {
  beforeAll(async () => {
    await ensureIsolatedDbExists();
    if (!(await isDbAvailable())) {
      console.warn('⚠ DB not available — migration tests will be skipped');
      return;
    }
    await db.migrate.latest(); // tables must exist before seeding FK-required users
    await seedUser(USER_A);
    await seedUser(USER_B);
    await seedUser(USER_C);
    await seedUser(USER_D);
    await seedUser(USER_E);
  });

  beforeEach(async () => {
    if (!(await isDbAvailable())) return;
    await db.migrate.latest();
    await db('user_config').where('user_id', 'like', 'w2146-%').del();
  });

  afterAll(async () => {
    if (await isDbAvailable()) {
      await db('user_config').where('user_id', 'like', 'w2146-%').del();
      await db('users').where('id', 'like', 'w2146-%').del();
    }
    await db.destroy();
  });

  it('rebuilds stale legacy time_blocks/loc_schedules from canonical for a user with valid schedule_templates + template_defaults', async () => {
    if (!(await isDbAvailable())) return;
    await seedUserConfig(USER_A, 'schedule_templates', CUSTOM_TEMPLATES);
    await seedUserConfig(USER_A, 'template_defaults', CUSTOM_DEFAULTS);
    await seedUserConfig(USER_A, 'time_blocks', STALE_LEGACY_TIME_BLOCKS);
    await seedUserConfig(USER_A, 'loc_schedules', STALE_LEGACY_LOC_SCHEDULES);

    await db.migrate.down({ name: MIGRATION_NAME });
    await db.migrate.latest();

    var tbRow = await db('user_config').where({ user_id: USER_A, config_key: 'time_blocks' }).first();
    var lsRow = await db('user_config').where({ user_id: USER_A, config_key: 'loc_schedules' }).first();
    var timeBlocks = tbRow.config_value;
    var locSchedules = lsRow.config_value;

    expect(timeBlocks.Mon).toEqual(CUSTOM_TEMPLATES.weekday.blocks);
    expect(timeBlocks.Sat).toEqual(CUSTOM_TEMPLATES.weekend.blocks);
    // Stale garbage block is GONE, not merely appended alongside.
    expect(timeBlocks.Mon.some(function (b) { return b.tag === 'custom'; })).toBe(false);
    expect(locSchedules.weekday.name).toBe('Weekday');
    expect(locSchedules.weekday.hours[480]).toBe('work');
  });

  it('SKIPS a user with missing schedule_templates row (self-heal handles it on next GetConfig read)', async () => {
    if (!(await isDbAvailable())) return;
    await seedUserConfig(USER_B, 'time_blocks', STALE_LEGACY_TIME_BLOCKS);

    await db.migrate.down({ name: MIGRATION_NAME });
    await db.migrate.latest();

    var tbRow = await db('user_config').where({ user_id: USER_B, config_key: 'time_blocks' }).first();
    expect(tbRow.config_value).toEqual(STALE_LEGACY_TIME_BLOCKS); // untouched
  });

  it('SKIPS a user whose schedule_templates fails shape validation', async () => {
    if (!(await isDbAvailable())) return;
    await seedUserConfig(USER_B, 'schedule_templates', { weekday: { name: 'x', blocks: [{ start: 0, end: 100 }] } }); // missing loc/tag
    await seedUserConfig(USER_B, 'time_blocks', STALE_LEGACY_TIME_BLOCKS);

    await db.migrate.down({ name: MIGRATION_NAME });
    await db.migrate.latest();

    var tbRow = await db('user_config').where({ user_id: USER_B, config_key: 'time_blocks' }).first();
    expect(tbRow.config_value).toEqual(STALE_LEGACY_TIME_BLOCKS); // untouched
  });

  it('a valid schedule_templates with NO template_defaults and NO existing legacy rows -- CREATES them (insert, not just update), using the GetConfig-style fallback defaults', async () => {
    if (!(await isDbAvailable())) return;
    await seedUserConfig(USER_C, 'schedule_templates', CUSTOM_TEMPLATES);
    // no template_defaults, no time_blocks, no loc_schedules rows at all

    await db.migrate.down({ name: MIGRATION_NAME });
    await db.migrate.latest();

    var tbRow = await db('user_config').where({ user_id: USER_C, config_key: 'time_blocks' }).first();
    var lsRow = await db('user_config').where({ user_id: USER_C, config_key: 'loc_schedules' }).first();
    expect(tbRow).toBeTruthy();
    expect(lsRow).toBeTruthy();
    // fallback template_defaults maps every weekday->'weekday'/weekend->'weekend'
    // since both ids are present (mirrors defaultTemplates.buildFallbackTemplateDefaults).
    expect(tbRow.config_value.Mon).toEqual(CUSTOM_TEMPLATES.weekday.blocks);
    expect(tbRow.config_value.Sat).toEqual(CUSTOM_TEMPLATES.weekend.blocks);
  });

  // harrison finding 1 (999.2146 review): the frontend's own read path
  // (useConfig.js initFromConfig:210-219) auto-populates a template's EMPTY
  // blocks array from templates.weekday?.blocks before deriving legacy
  // timeBlocks/locSchedules -- a legally-valid shape (scheduleTemplateValidation
  // tolerates blocks:[]) that, without this pre-step, would derive a
  // FLATTENED (zero-capacity) day instead of what the Settings UI actually
  // shows the user.
  it('a template_defaults day resolving to an EMPTY-blocks template -- rebuilds using weekday\'s blocks as fallback, not []', async () => {
    if (!(await isDbAvailable())) return;
    var templatesWithEmpty = {
      weekday: CUSTOM_TEMPLATES.weekday,
      weekend: CUSTOM_TEMPLATES.weekend,
      'empty-custom': { name: 'Empty Custom', system: false, locOverrides: {}, blocks: [] }
    };
    var defaultsUsingEmpty = Object.assign({}, CUSTOM_DEFAULTS, { Wed: 'empty-custom' });
    await seedUserConfig(USER_D, 'schedule_templates', templatesWithEmpty);
    await seedUserConfig(USER_D, 'template_defaults', defaultsUsingEmpty);

    await db.migrate.down({ name: MIGRATION_NAME });
    await db.migrate.latest();

    var tbRow = await db('user_config').where({ user_id: USER_D, config_key: 'time_blocks' }).first();
    var lsRow = await db('user_config').where({ user_id: USER_D, config_key: 'loc_schedules' }).first();
    // NOT flattened to [] -- populated from weekday's blocks.
    expect(tbRow.config_value.Wed).toEqual(CUSTOM_TEMPLATES.weekday.blocks);
    expect(tbRow.config_value.Wed.length).toBeGreaterThan(0);
    // loc_schedules.hours for the empty-custom template is likewise populated,
    // not {}.
    expect(Object.keys(lsRow.config_value['empty-custom'].hours).length).toBeGreaterThan(0);
  });

  it('the weekday template ITSELF has empty blocks -- falls back to the server defaults SSOT (buildDefaultScheduleTemplates)', async () => {
    if (!(await isDbAvailable())) return;
    var templatesWeekdayEmpty = {
      weekday: { name: 'Weekday', system: true, locOverrides: {}, blocks: [] },
      weekend: CUSTOM_TEMPLATES.weekend
    };
    await seedUserConfig(USER_E, 'schedule_templates', templatesWeekdayEmpty);
    await seedUserConfig(USER_E, 'template_defaults', CUSTOM_DEFAULTS);

    await db.migrate.down({ name: MIGRATION_NAME });
    await db.migrate.latest();

    var tbRow = await db('user_config').where({ user_id: USER_E, config_key: 'time_blocks' }).first();
    var serverDefaultWeekdayBlocks = defaultTemplates.buildDefaultScheduleTemplates().weekday.blocks;
    expect(tbRow.config_value.Mon).toEqual(serverDefaultWeekdayBlocks);
  });

  it('empty-blocks fixture stays idempotent across two runs', async () => {
    if (!(await isDbAvailable())) return;
    var templatesWithEmpty = {
      weekday: CUSTOM_TEMPLATES.weekday,
      weekend: CUSTOM_TEMPLATES.weekend,
      'empty-custom': { name: 'Empty Custom', system: false, locOverrides: {}, blocks: [] }
    };
    var defaultsUsingEmpty = Object.assign({}, CUSTOM_DEFAULTS, { Wed: 'empty-custom' });
    await seedUserConfig(USER_D, 'schedule_templates', templatesWithEmpty);
    await seedUserConfig(USER_D, 'template_defaults', defaultsUsingEmpty);

    await db.migrate.down({ name: MIGRATION_NAME });
    await db.migrate.latest();
    var first = await db('user_config').where({ user_id: USER_D, config_key: 'time_blocks' }).first();

    await db.migrate.down({ name: MIGRATION_NAME });
    await db.migrate.latest();
    var second = await db('user_config').where({ user_id: USER_D, config_key: 'time_blocks' }).first();

    expect(second.config_value).toEqual(first.config_value);
  });

  it('is idempotent: running twice produces an identical single row (upsert, not append)', async () => {
    if (!(await isDbAvailable())) return;
    await seedUserConfig(USER_A, 'schedule_templates', CUSTOM_TEMPLATES);
    await seedUserConfig(USER_A, 'template_defaults', CUSTOM_DEFAULTS);
    await seedUserConfig(USER_A, 'time_blocks', STALE_LEGACY_TIME_BLOCKS);

    await db.migrate.down({ name: MIGRATION_NAME });
    await db.migrate.latest();
    var first = await db('user_config').where({ user_id: USER_A, config_key: 'time_blocks' }).first();

    await db.migrate.down({ name: MIGRATION_NAME });
    await db.migrate.latest();
    var second = await db('user_config').where({ user_id: USER_A, config_key: 'time_blocks' }).first();

    expect(second.config_value).toEqual(first.config_value);
    var count = await db('user_config').where({ user_id: USER_A, config_key: 'time_blocks' }).count('* as n').first();
    expect(Number(count.n)).toBe(1);
  });

  it('does NOT touch loc_schedule_defaults / loc_schedule_overrides (independently load-bearing, dual-written elsewhere)', async () => {
    if (!(await isDbAvailable())) return;
    await seedUserConfig(USER_A, 'schedule_templates', CUSTOM_TEMPLATES);
    await seedUserConfig(USER_A, 'template_defaults', CUSTOM_DEFAULTS);
    await seedUserConfig(USER_A, 'loc_schedule_defaults', { Mon: 'weekday' });
    await seedUserConfig(USER_A, 'loc_schedule_overrides', { '2026-08-01': 'weekend' });

    await db.migrate.down({ name: MIGRATION_NAME });
    await db.migrate.latest();

    var defRow = await db('user_config').where({ user_id: USER_A, config_key: 'loc_schedule_defaults' }).first();
    var ovrRow = await db('user_config').where({ user_id: USER_A, config_key: 'loc_schedule_overrides' }).first();
    expect(defRow.config_value).toEqual({ Mon: 'weekday' });
    expect(ovrRow.config_value).toEqual({ '2026-08-01': 'weekend' });
  });

  it('down() is a safe no-op', async () => {
    if (!(await isDbAvailable())) return;
    await expect(db.migrate.down({ name: MIGRATION_NAME })).resolves.not.toThrow();
    await db.migrate.latest(); // restore applied state for subsequent test files
  });
});
