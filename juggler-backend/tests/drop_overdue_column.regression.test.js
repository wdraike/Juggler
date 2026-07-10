/**
 * drop_overdue_column.regression.test.js
 *
 * Traceability: .planning/kermit/sched-drop-overdue-column/TRACEABILITY.md — MIG-1
 * (M-5 / 999.1085, migration 20260703190000_drop_overdue_column.js).
 *
 * Mirrors tests/tasks_v_completed_at.regression.test.js's pattern (information_schema
 * assertions against the live schema + a column-set guard), plus a direct up()/down()
 * exercise of the migration module itself (mirroring `20260624120000`'s template).
 *
 * Tests 1-4: current (post-migration, "up") schema state.
 * Test 5:    column-set guard — tasks_v/tasks_with_sync_v lost `overdue` and NOTHING else.
 * Test 6:    down()/up() round-trip, calling the migration's exported functions directly
 *            against the real test-bed connection (NOT via the knex_migrations ledger —
 *            this test does not touch that bookkeeping table). Wrapped in try/finally so
 *            the schema is GUARANTEED to end back in the "up" (column-dropped) state that
 *            every other suite in this run expects, even if an assertion inside fails.
 *            Run --runInBand (established recipe for this leg) — this test intentionally
 *            mutates the shared schema for the duration of one test body.
 */

'use strict';

var db = require('../src/db');
var migration = require('../src/db/migrations/20260703190000_drop_overdue_column.js');
var { assertDbAvailable } = require('./helpers/requireDB');

var DB_NAME_FALLBACK = 'juggler_test';

function dbName() {
  return db.client.config.connection.database || DB_NAME_FALLBACK;
}

// Every column tasks_v/tasks_with_sync_v carried BEFORE this migration (captured from
// the live schema immediately prior to authoring the migration) — see
// tasks_v_completed_at.regression.test.js's PRE_FIX_COLUMNS for the established pattern.
// `overdue` is the ONE column this migration removes.
var TASKS_V_PRE_FIX_COLUMNS = [
  'id', 'user_id', 'task_type', 'text', 'dur', 'pri', 'project', 'section',
  'notes', 'url', 'location', 'tools', 'when', 'day_req', 'recurring',
  'time_flex', 'flex_when', 'split', 'split_min', 'recur', 'recur_start',
  'recur_end', 'end_date', 'marker', 'preferred_time_mins', 'placement_mode',
  'travel_before', 'travel_after', 'depends_on', 'desired_at', 'disabled_at',
  'disabled_reason', 'deadline', 'start_after_at', 'tz', 'weather_precip',
  'weather_cloud', 'weather_temp_min', 'weather_temp_max', 'weather_temp_unit',
  'weather_humidity_min', 'weather_humidity_max', 'source_id', 'scheduled_at',
  'date', 'day', 'time', 'status', 'time_remaining', 'unscheduled', 'overdue',
  'slack_mins', 'occurrence_ordinal', 'split_ordinal', 'split_total',
  'split_group', 'generated', 'gcal_event_id', 'depends_on_json',
  'created_at', 'updated_at', 'msft_event_id', 'apple_event_id', 'master_id',
  'completed_at', 'implied_deadline', 'earliest_start',
  'unplaced_reason', 'unplaced_detail'
];

var TASKS_WITH_SYNC_V_PRE_FIX_COLUMNS = [
  'id', 'user_id', 'task_type', 'text', 'dur', 'pri', 'project', 'section',
  'notes', 'url', 'location', 'tools', 'when', 'day_req', 'recurring',
  'time_flex', 'flex_when', 'split', 'split_min', 'recur', 'recur_start',
  'recur_end', 'end_date', 'marker', 'preferred_time_mins', 'placement_mode',
  'travel_before', 'travel_after', 'depends_on', 'desired_at', 'disabled_at',
  'disabled_reason', 'deadline', 'start_after_at', 'tz', 'weather_precip',
  'weather_cloud', 'weather_temp_min', 'weather_temp_max', 'weather_temp_unit',
  'weather_humidity_min', 'weather_humidity_max', 'source_id', 'scheduled_at',
  'date', 'day', 'time', 'status', 'time_remaining', 'unscheduled', 'overdue',
  'slack_mins', 'occurrence_ordinal', 'split_ordinal', 'split_total',
  'split_group', 'generated', 'depends_on_json', 'created_at', 'updated_at',
  'master_id', 'gcal_event_id', 'msft_event_id', 'apple_event_id'
];

// Columns legitimately added to tasks_v/tasks_with_sync_v by OTHER legs that landed on
// origin/main after this migration's timestamp but before/around when this leg's branch was
// merged forward (999.1091 / leg sched-anchor-window, migrations 20260703210000 and
// 20260703220000 — both run AFTER 20260703190000_drop_overdue_column in the combined chain,
// confirmed via `ls src/db/migrations/ | sort`). This migration's own anchor-replace logic ran
// FIRST and only ever touched the `overdue` projection; these columns are unrelated additions,
// not something this migration should have dropped or that this test should treat as drift.
// Verified via a live merged-schema check (fresh DB, full migrate:latest, SHOW CREATE VIEW) that
// both migrations' effects coexist correctly with zero clobbering in either direction.
// 999.1247 gate triage (2026-07-09): 'next_start' added — projected into the
// views by the later next_start unified-anchor migration (see
// tests/task_masters_next_start_unified_anchor.regression.test.js), same
// unrelated-later-leg class as the two anchor columns.
var COLUMNS_ADDED_BY_OTHER_LEGS_AFTER_THIS_MIGRATION = ['next_occurrence_anchor', 'rolling_anchor', 'next_start'];

async function columnsOf(table) {
  var rows = await db('information_schema.COLUMNS')
    .where('TABLE_SCHEMA', dbName())
    .where('TABLE_NAME', table)
    .select('COLUMN_NAME');
  return rows.map(function (r) { return r.COLUMN_NAME; });
}

async function indexExistsOnTaskInstances() {
  var rows = await db('information_schema.statistics')
    .where('table_schema', dbName())
    .where('table_name', 'task_instances')
    .where('index_name', 'idx_task_instances_missed_scan');
  return rows.length > 0;
}

var available = false;

beforeAll(async () => {
  await assertDbAvailable();
  try {
    await db.raw('SELECT 1');
    available = true;
  } catch (e) {
    return;
  }
});

afterAll(async () => {
  await db.destroy();
});

describe('MIG-1 — 20260703190000_drop_overdue_column (up applied)', () => {
  test('1. task_instances has no `overdue` column', async () => {
    if (!available) return;
    var cols = await columnsOf('task_instances');
    expect(cols).not.toContain('overdue');
  });

  test('2. tasks_v has no `overdue` column', async () => {
    if (!available) return;
    var cols = await columnsOf('tasks_v');
    expect(cols).not.toContain('overdue');
  });

  test('3. tasks_with_sync_v has no `overdue` column', async () => {
    if (!available) return;
    var cols = await columnsOf('tasks_with_sync_v');
    expect(cols).not.toContain('overdue');
  });

  test('4. idx_task_instances_missed_scan index does not exist', async () => {
    if (!available) return;
    expect(await indexExistsOnTaskInstances()).toBe(false);
  });

  test('5. tasks_v / tasks_with_sync_v column sets lost `overdue` and NOTHING else', async () => {
    if (!available) return;
    var tvCols = await columnsOf('tasks_v');
    var svCols = await columnsOf('tasks_with_sync_v');

    var tvExpected = TASKS_V_PRE_FIX_COLUMNS.filter(function (c) { return c !== 'overdue'; });
    var svExpected = TASKS_WITH_SYNC_V_PRE_FIX_COLUMNS.filter(function (c) { return c !== 'overdue'; });

    // Every pre-fix column (minus overdue) must still be present — no OTHER column dropped.
    var tvMissing = tvExpected.filter(function (c) { return tvCols.indexOf(c) === -1; });
    var svMissing = svExpected.filter(function (c) { return svCols.indexOf(c) === -1; });
    expect(tvMissing).toEqual([]);
    expect(svMissing).toEqual([]);

    // No UNEXPECTED column beyond the expected set was accidentally introduced — allow the
    // documented, verified-coexisting additions from other legs (see the constant above),
    // but fail loud on anything else (which would indicate this migration's anchor-replace
    // silently clobbered or duplicated something).
    var tvExtra = tvCols.filter(function (c) {
      return tvExpected.indexOf(c) === -1 && COLUMNS_ADDED_BY_OTHER_LEGS_AFTER_THIS_MIGRATION.indexOf(c) === -1;
    });
    var svExtra = svCols.filter(function (c) {
      return svExpected.indexOf(c) === -1 && COLUMNS_ADDED_BY_OTHER_LEGS_AFTER_THIS_MIGRATION.indexOf(c) === -1;
    });
    expect(tvExtra).toEqual([]);
    expect(svExtra).toEqual([]);
  });
});

describe('MIG-1 — 20260703190000_drop_overdue_column (down()/up() round-trip)', () => {
  test('6. down() restores column+index+projections; up() re-drops them cleanly', async () => {
    if (!available) return;
    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');

    try {
      // ── down(): restore ──────────────────────────────────────────────────
      await migration.down(db);

      var colsAfterDown = await columnsOf('task_instances');
      expect(colsAfterDown).toContain('overdue');

      var tvColsAfterDown = await columnsOf('tasks_v');
      expect(tvColsAfterDown).toContain('overdue');

      var svColsAfterDown = await columnsOf('tasks_with_sync_v');
      expect(svColsAfterDown).toContain('overdue');

      expect(await indexExistsOnTaskInstances()).toBe(true);

      // Restored column is a NOT NULL tinyint defaulting to 0 (matches the
      // original 20260501000100_add_overdue_to_instances.js shape).
      var colMeta = await db('information_schema.COLUMNS')
        .where('TABLE_SCHEMA', dbName())
        .where('TABLE_NAME', 'task_instances')
        .where('COLUMN_NAME', 'overdue')
        .first();
      expect(colMeta).toBeTruthy();
      expect(colMeta.IS_NULLABLE).toBe('NO');

      // ── up(): re-drop ────────────────────────────────────────────────────
      await migration.up(db);

      var colsAfterUp = await columnsOf('task_instances');
      expect(colsAfterUp).not.toContain('overdue');

      var tvColsAfterUp = await columnsOf('tasks_v');
      expect(tvColsAfterUp).not.toContain('overdue');

      var svColsAfterUp = await columnsOf('tasks_with_sync_v');
      expect(svColsAfterUp).not.toContain('overdue');

      expect(await indexExistsOnTaskInstances()).toBe(false);
    } finally {
      // GUARANTEE the schema ends in the "up" (column-dropped) state every
      // other suite in this run expects, even if an assertion above threw
      // mid-way through the round-trip.
      var stillHasCol = await db.schema.hasColumn('task_instances', 'overdue');
      if (stillHasCol) {
        await migration.up(db);
      }
    }
  }, 30000);
});
