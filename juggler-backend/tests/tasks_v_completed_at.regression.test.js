/**
 * tasks_v_completed_at.regression.test.js
 *
 * Traceability: .planning/kermit/jug-tasksv-completed-at/TRACEABILITY.md — 999.308a
 * Bug: tasks_v does NOT project completed_at even though task_instances.completed_at
 * exists. The 2026-06-03 migration that claimed to add it silently no-op'd (regex on
 * normalized SHOW CREATE VIEW never matched). LIVE-VERIFIED: information_schema count=0.
 *
 * STEP 0 — RED tests:  authoring BEFORE the fix migration.
 * All four assertions below MUST FAIL against the current view.
 * After the fix migration they MUST PASS.
 *
 * Tests:
 *   1. tasks_v HAS a completed_at column (information_schema check).
 *   2. Projection correctness: seeded task_instance.completed_at appears in tasks_v.
 *   3. Recurring-template rows project completed_at = NULL (no instance, so NULL).
 *   4. Column-set superset guard: post-fix view has every pre-fix column PLUS completed_at.
 */

'use strict';

var db = require('../src/db');
var { v7: uuidv7 } = require('uuid');
var { insertTask } = require('../src/lib/tasks-write');
var { assertDbAvailable } = require('./helpers/requireDB');

var TEST_USER_ID = 'telly-tasksv-completed-at-test';

// All columns present in tasks_v BEFORE the fix (63 columns, captured 2026-06-14).
// After the fix the view must contain ALL of these plus completed_at.
// 'overdue' removed (sched-drop-overdue-column, M-5, 2026-07-03): tasks_v no
// longer projects it — an AUTHORIZED, intentional column removal (SPEC.md AC1/
// MIG-1), not a regression this guard should catch. Per-leg drop_overdue_column
// migration test (tests/drop_overdue_column.regression.test.js) owns verifying
// that specific removal; this pre-existing guard's baseline is updated to match
// the new, permanent tasks_v shape.
var PRE_FIX_COLUMNS = [
  'id', 'user_id', 'task_type', 'text', 'dur', 'pri', 'project', 'section',
  'notes', 'url', 'location', 'tools', 'when', 'day_req', 'recurring',
  'time_flex', 'flex_when', 'split', 'split_min', 'recur', 'recur_start',
  'recur_end', 'marker', 'preferred_time_mins', 'placement_mode',
  'travel_before', 'travel_after', 'depends_on', 'desired_at', 'disabled_at',
  'disabled_reason', 'deadline', 'start_after_at', 'tz', 'weather_precip',
  'weather_cloud', 'weather_temp_min', 'weather_temp_max', 'weather_temp_unit',
  'weather_humidity_min', 'weather_humidity_max', 'source_id', 'scheduled_at',
  'date', 'day', 'time', 'status', 'time_remaining', 'unscheduled',
  'slack_mins', 'occurrence_ordinal', 'split_ordinal', 'split_total',
  'split_group', 'generated', 'gcal_event_id', 'depends_on_json',
  'created_at', 'updated_at', 'msft_event_id', 'apple_event_id', 'master_id'
];

beforeAll(async () => {
  await assertDbAvailable();
  // Clean up any leftover rows from a previous run
  await db('task_instances').where('user_id', TEST_USER_ID).del();
  await db('task_masters').where('user_id', TEST_USER_ID).del();
  await db('users').where('id', TEST_USER_ID).del();
  await db('users').insert({
    id: TEST_USER_ID,
    email: 'telly-tasksv-cat@test.invalid',
    name: 'Telly tasks_v completed_at Test',
    timezone: 'America/New_York',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
});

afterAll(async () => {
  await db('task_instances').where('user_id', TEST_USER_ID).del();
  await db('task_masters').where('user_id', TEST_USER_ID).del();
  await db('users').where('id', TEST_USER_ID).del();
  await db.destroy();
});

beforeEach(async () => {
  // Isolate each test — wipe instances + masters for this test user
  await db('task_instances').where('user_id', TEST_USER_ID).del();
  await db('task_masters').where('user_id', TEST_USER_ID).del();
});

describe('999.308a — tasks_v must project completed_at', () => {

  // ------------------------------------------------------------------
  // Test 1: Column presence (information_schema)
  // RED now (count=0); GREEN after fix migration adds completed_at to
  // both UNION branches in the view DDL.
  // ------------------------------------------------------------------
  test('1. tasks_v has a completed_at column (information_schema)', async () => {
    var rows = await db('information_schema.COLUMNS')
      .where('TABLE_SCHEMA', db.client.config.connection.database || 'juggler_test')
      .where('TABLE_NAME', 'tasks_v')
      .where('COLUMN_NAME', 'completed_at')
      .count('* as cnt');
    var count = Number(rows[0].cnt);
    // Fails pre-fix (count=0); passes post-fix (count=1)
    expect(count).toBe(1);
  });

  // ------------------------------------------------------------------
  // Test 2: Projection correctness — seeded completed_at appears in view
  // Seed a non-recurring task + instance with a known completed_at
  // timestamp and terminal status (done); assert the view row equals it.
  // RED now (column absent → query error / NULL); GREEN after fix.
  // ------------------------------------------------------------------
  test('2. non-recurring done task: tasks_v.completed_at matches task_instances.completed_at', async () => {
    var taskId = uuidv7();
    var knownCompletedAt = new Date('2026-06-03T14:30:00Z');

    // insertTask creates both master + instance (non-recurring path)
    await insertTask(db, {
      id: taskId,
      user_id: TEST_USER_ID,
      text: 'test completed task',
      task_type: 'task',
      dur: 30,
      pri: 'P2',
      status: 'done',
      scheduled_at: new Date('2026-06-03T14:00:00Z'),
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    // insertTask's pickInstance does not copy completed_at (not in INSTANCE_FIELDS —
    // completed_at lives in INSTANCE_UPDATE_FIELDS, the update-only list; pickInstance
    // used at insert time only reads INSTANCE_FIELDS). Set it directly on the instance
    // row — the same path updateTask uses.
    await db('task_instances')
      .where('id', taskId)
      .update({ completed_at: knownCompletedAt });

    // Read the actual completed_at value back from task_instances — this is the
    // source-of-truth the view must project.
    var rawInstance = await db('task_instances').where('id', taskId).first();
    expect(rawInstance.completed_at).not.toBeNull();

    // The view must project the same value the instance row holds.
    // Pre-fix: this SELECT throws (column unknown) or returns undefined.
    // Post-fix: row.completed_at matches task_instances.completed_at exactly.
    var viewRow = await db('tasks_v')
      .where('id', taskId)
      .select('completed_at')
      .first();
    expect(viewRow).toBeTruthy();

    // Normalise both sides to comparable strings — MySQL may return Date objects
    // or datetime strings depending on dateStrings config.
    function toComparable(val) {
      if (val instanceof Date) return val.toISOString();
      return String(val);
    }
    var viewVal = toComparable(viewRow.completed_at);
    var instanceVal = toComparable(rawInstance.completed_at);

    // Primary assertion: view projects the ACTUAL source column, not just the
    // seeded literal. This catches a wrong-source bug (e.g. projecting master
    // updated_at instead of instance completed_at) that would survive a literal
    // comparison (MUT-C discriminator preserved per zoe review).
    expect(viewVal).toBe(instanceVal);

    // Time-discriminator strength: confirm the projected value encodes the
    // correct date/time (different-date mutant MUT-C is still caught here).
    expect(viewVal).toMatch(/2026-06-03/);
    expect(viewVal).toMatch(/14:30:00/);
  });

  // ------------------------------------------------------------------
  // Test 3: Recurring-template row projects completed_at = NULL
  // A template has no instance row -> tasks_v UNION branch for templates
  // must project NULL for completed_at (it lives on instance, not master).
  // RED now (column absent → undefined / query error); GREEN after fix.
  // ------------------------------------------------------------------
  test('3. recurring template row: tasks_v.completed_at is NULL (no instance)', async () => {
    var templateId = uuidv7();

    await insertTask(db, {
      id: templateId,
      user_id: TEST_USER_ID,
      text: 'recurring daily template',
      task_type: 'recurring_template',
      recurring: 1,
      dur: 45,
      pri: 'P1',
      recur: JSON.stringify({ type: 'daily' }),
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    // Confirm row is in tasks_v (template branch)
    var viewRow = await db('tasks_v')
      .where('id', templateId)
      .select('id', 'task_type', 'completed_at')
      .first();
    expect(viewRow).toBeTruthy();
    expect(viewRow.task_type).toBe('recurring_template');

    // Pre-fix: completed_at property doesn't exist on viewRow → undefined
    // Post-fix: property exists and is null
    expect(viewRow.completed_at).toBeNull();
  });

  // ------------------------------------------------------------------
  // Test 4: Column-set superset guard
  // Post-fix: tasks_v must contain every column that existed pre-fix,
  // PLUS completed_at. No existing column may be dropped or renamed.
  // This assertion is intentionally inert pre-fix (the missing
  // completed_at is already caught by Test 1); it becomes an active
  // regression pin post-fix to prevent future view recreations from
  // accidentally dropping columns.
  // ------------------------------------------------------------------
  test('4. tasks_v column set is a superset of pre-fix columns plus completed_at', async () => {
    var dbName = db.client.config.connection.database || 'juggler_test';
    var columnRows = await db('information_schema.COLUMNS')
      .where('TABLE_SCHEMA', dbName)
      .where('TABLE_NAME', 'tasks_v')
      .select('COLUMN_NAME');
    var currentCols = columnRows.map(function(r) { return r.COLUMN_NAME; });

    // Every pre-fix column must still be present
    var missingPreFix = PRE_FIX_COLUMNS.filter(function(col) {
      return currentCols.indexOf(col) === -1;
    });
    expect(missingPreFix).toEqual([]); // no existing column was dropped

    // completed_at must also be present (catches the fix itself)
    expect(currentCols).toContain('completed_at');
  });
});
