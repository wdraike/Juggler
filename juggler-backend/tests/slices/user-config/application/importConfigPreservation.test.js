/**
 * 999.1603 — replace-mode import must not lose config keys it does not carry,
 * export must be round-trip complete, and imports are version-checked + verified.
 *
 * Bug: ImportData wiped ALL user_config rows (clearUserConfigTables) but
 * re-inserted only 7 keys — schedule_templates / template_defaults /
 * template_overrides / cal_sync_settings / temp_unit_pref were destroyed by
 * every replace-mode import (Settings then shows no editable template), and
 * preferences was rebuilt from 5 scalars, dropping every other subkey
 * (e.g. calCompletedBehavior). ExportData also omitted the template keys, so
 * export→import lost them from both directions.
 *
 * Ruling (David 2026-07-13): default/existing templates survive an import
 * unless the import explicitly carries replacement values; imports leave the
 * DB consistent — verify and autofix (preserve) or reject; exports carry a
 * format version the import validates.
 *
 * Requires: test-bed DB at 127.0.0.1:3407 (cd test-bed && make test-juggler[-pool]).
 */

'use strict';

var db = require('../../../../src/db');
var facade = require('../../../../src/slices/user-config/facade');
var { assertDbAvailable } = require('../../../helpers/requireDB');

jest.mock('../../../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
}));

var USER_ID = 'import-config-preserve-user-001';

var TEMPLATES = { weekday: { blocks: [{ start: 480, end: 1020 }] }, weekend: { blocks: [] } };
var TEMPLATE_DEFAULTS = { Mon: 'weekday', Tue: 'weekday', Wed: 'weekday', Thu: 'weekday', Fri: 'weekday', Sat: 'weekend', Sun: 'weekend' };
var TEMPLATE_OVERRIDES = { '2026-07-04': 'weekend' };
var CAL_SYNC_SETTINGS = { ingestMode: 'busy-block' };
var PREFERENCES = { gridZoom: 45, splitDefault: true, splitMinDefault: 20, schedFloor: 420, schedCeiling: 1320, calCompletedBehavior: 'keep' };

// Minimal valid v7 replace payload WITHOUT any template/calSync/preference-extra keys —
// exactly what a legacy export (pre-999.1603) or hand-built import JSON carries.
function legacyPayload() {
  return {
    v7: true,
    extraTasks: [{ id: 'imp-1', text: 'Imported task', dur: 30, pri: 'P3' }],
    locations: [], tools: [], projects: [],
    toolMatrix: { probe: true }, timeBlocks: { Mon: [] },
    locSchedules: {}, locScheduleDefaults: {}, locScheduleOverrides: {},
    hourLocationOverrides: {},
    gridZoom: 60, splitDefault: false, splitMinDefault: 15,
    schedFloor: 480, schedCeiling: 1380
  };
}

async function seedConfig() {
  var rows = [
    ['schedule_templates', TEMPLATES],
    ['template_defaults', TEMPLATE_DEFAULTS],
    ['template_overrides', TEMPLATE_OVERRIDES],
    ['cal_sync_settings', CAL_SYNC_SETTINGS],
    ['temp_unit_pref', 'C'],
    ['preferences', PREFERENCES],
    ['tool_matrix', { old: true }]
  ].map(function (kv, i) {
    return {
      user_id: USER_ID, config_key: kv[0], config_value: JSON.stringify(kv[1]),
      created_at: db.fn.now(), updated_at: db.fn.now()
    };
  });
  await db('user_config').insert(rows);
}

async function readConfig(key) {
  var row = await db('user_config').where({ user_id: USER_ID, config_key: key }).first();
  if (!row) return undefined;
  // Guarded parse (mirrors UserConfig.parseConfigValue): config_value is a JSON
  // column and mysql2 unwraps scalar strings ('C', not '"C"') — bare JSON.parse throws.
  if (typeof row.config_value !== 'string') return row.config_value;
  try { return JSON.parse(row.config_value); } catch { return row.config_value; }
}

async function cleanup() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('user_config').where('user_id', USER_ID).del();
  await db('projects').where('user_id', USER_ID).del();
  await db('locations').where('user_id', USER_ID).del();
  await db('tools').where('user_id', USER_ID).del();
}

var available = false;

beforeAll(async () => {
  await assertDbAvailable();
  available = true;
  await db('users').where('id', USER_ID).del();
  await db('users').insert({
    id: USER_ID, email: 'preserve@test.com', name: 'Preserve Test',
    timezone: 'America/New_York', created_at: db.fn.now(), updated_at: db.fn.now()
  });
}, 20000);

beforeEach(async () => {
  await cleanup();
  await seedConfig();
});

afterAll(async () => {
  if (available) {
    await cleanup();
    await db('users').where('id', USER_ID).del();
  }
  await db.destroy();
});

describe('999.1603 replace-mode import preserves keys it does not carry', () => {
  test('templates + cal_sync_settings + temp_unit_pref survive a legacy payload import', async () => {
    var res = await facade.importData({ userId: USER_ID, data: legacyPayload(), confirm: 'delete_all' });
    expect(res.status).toBe(200);

    expect(await readConfig('schedule_templates')).toEqual(TEMPLATES);
    expect(await readConfig('template_defaults')).toEqual(TEMPLATE_DEFAULTS);
    expect(await readConfig('template_overrides')).toEqual(TEMPLATE_OVERRIDES);
    expect(await readConfig('cal_sync_settings')).toEqual(CAL_SYNC_SETTINGS);
    expect(await readConfig('temp_unit_pref')).toEqual('C');
    // carried keys ARE replaced (import still means import)
    expect(await readConfig('tool_matrix')).toEqual({ probe: true });
  });

  test('preferences subkeys not carried by the payload survive; carried scalars win', async () => {
    var res = await facade.importData({ userId: USER_ID, data: legacyPayload(), confirm: 'delete_all' });
    expect(res.status).toBe(200);

    var prefs = await readConfig('preferences');
    expect(prefs.gridZoom).toBe(60);            // payload scalar wins
    expect(prefs.splitMinDefault).toBe(15);     // payload scalar wins
    expect(prefs.calCompletedBehavior).toBe('keep'); // uncarried subkey survives
  });

  test('payload-carried template keys replace existing values', async () => {
    var payload = legacyPayload();
    payload.scheduleTemplates = { newday: { blocks: [] } };
    payload.templateDefaults = { Mon: 'newday' };
    payload.templateOverrides = {};
    payload.calSyncSettings = { ingestMode: 'off' };

    var res = await facade.importData({ userId: USER_ID, data: payload, confirm: 'delete_all' });
    expect(res.status).toBe(200);

    expect(await readConfig('schedule_templates')).toEqual({ newday: { blocks: [] } });
    expect(await readConfig('template_defaults')).toEqual({ Mon: 'newday' });
    expect(await readConfig('template_overrides')).toEqual({});
    expect(await readConfig('cal_sync_settings')).toEqual({ ingestMode: 'off' });
  });
});

describe('999.1603 export is round-trip complete + version-stamped', () => {
  test('export carries template keys, full preferences, and exportFormatVersion', async () => {
    var res = await facade.exportData({ userId: USER_ID });
    expect(res.status).toBe(200);

    expect(res.body.scheduleTemplates).toEqual(TEMPLATES);
    expect(res.body.templateDefaults).toEqual(TEMPLATE_DEFAULTS);
    expect(res.body.templateOverrides).toEqual(TEMPLATE_OVERRIDES);
    expect(res.body.tempUnitPref).toEqual('C');
    expect(res.body.preferences).toEqual(PREFERENCES);
    expect(res.body.exportFormatVersion).toBe(8);
    expect(res.body.v7).toBe(true); // legacy consumers keep working
  });

  test('export → import round-trip preserves everything', async () => {
    var exported = await facade.exportData({ userId: USER_ID });
    expect(exported.status).toBe(200);

    var res = await facade.importData({ userId: USER_ID, data: exported.body, confirm: 'delete_all' });
    expect(res.status).toBe(200);

    expect(await readConfig('schedule_templates')).toEqual(TEMPLATES);
    expect(await readConfig('template_defaults')).toEqual(TEMPLATE_DEFAULTS);
    expect(await readConfig('template_overrides')).toEqual(TEMPLATE_OVERRIDES);
    expect(await readConfig('cal_sync_settings')).toEqual(CAL_SYNC_SETTINGS);
    expect(await readConfig('temp_unit_pref')).toEqual('C');
    expect((await readConfig('preferences')).calCompletedBehavior).toBe('keep');
  });

  test('import from a NEWER export format is rejected with zero writes', async () => {
    var payload = legacyPayload();
    payload.exportFormatVersion = 99;

    var before = Number((await db('user_config').where('user_id', USER_ID).count('* as c').first()).c);
    var res = await facade.importData({ userId: USER_ID, data: payload, confirm: 'delete_all' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/export format version/i);

    var after = Number((await db('user_config').where('user_id', USER_ID).count('* as c').first()).c);
    expect(after).toBe(before);
    expect(await readConfig('schedule_templates')).toEqual(TEMPLATES); // untouched
  });
});
