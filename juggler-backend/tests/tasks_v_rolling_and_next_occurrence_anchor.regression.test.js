/**
 * tasks_v_rolling_and_next_occurrence_anchor.regression.test.js
 *
 * Traceability: 999.1091 (C1 — generalize the recurrence anchor) + 999.1094 (bug —
 * rolling_anchor silently absent from tasks_v/tasks_with_sync_v since 2026-06-14).
 *
 * Two related, DB-integration-level regressions, both about the SAME class of bug:
 * a hand-copied view-recreation migration (20260614010000) silently dropped
 * `rolling_anchor` from tasks_v/tasks_with_sync_v, and nothing caught it because
 * every existing rolling-anchor test (rollingAnchor.test.js, expandRecurring.test.js)
 * constructs its `src` object directly — never exercising the real DB->view->mapper
 * read path. This file closes that gap for BOTH the pre-existing `rolling_anchor`
 * (999.1094 fix migration `20260703220000_restore_rolling_anchor_in_tasks_v.js`) and
 * the new `next_occurrence_anchor` (999.1091 migration
 * `20260703210000_add_next_occurrence_anchor.js`) — modeled directly on the sibling
 * `tasks_v_completed_at.regression.test.js` (999.308a), which caught the identical
 * class of bug for `completed_at`.
 *
 * Tests:
 *   1. tasks_v HAS rolling_anchor AND next_occurrence_anchor columns (information_schema).
 *   2. tasks_with_sync_v HAS both columns too.
 *   3. Projection correctness: a seeded task_masters row's rolling_anchor AND
 *      next_occurrence_anchor both appear correctly in tasks_v.
 *   4. Column-set superset guard: the view still contains every pre-existing column.
 */

'use strict';

var db = require('../src/db');
var { v7: uuidv7 } = require('uuid');
var { assertDbAvailable } = require('./helpers/requireDB');

var TEST_USER_ID = 'telly-tasksv-anchor-test';

// Columns tasks_v is known to carry as of 999.1091/999.1094 (superset floor — any
// future view recreation must not drop these). Sourced from the sibling
// tasks_v_completed_at.regression.test.js PRE_FIX_COLUMNS list plus the columns
// added since (completed_at, implied_deadline, earliest_start, unplaced_reason,
// unplaced_detail, end_date).
var FLOOR_COLUMNS = [
  'id', 'user_id', 'task_type', 'text', 'dur', 'pri', 'project', 'section',
  'notes', 'url', 'location', 'tools', 'when', 'day_req', 'recurring',
  'time_flex', 'flex_when', 'split', 'split_min', 'recur', 'recur_start',
  'recur_end', 'marker', 'preferred_time_mins', 'placement_mode',
  'travel_before', 'travel_after', 'depends_on', 'desired_at', 'disabled_at',
  'disabled_reason', 'deadline', 'start_after_at', 'tz', 'weather_precip',
  'weather_cloud', 'weather_temp_min', 'weather_temp_max', 'weather_temp_unit',
  'weather_humidity_min', 'weather_humidity_max', 'source_id', 'scheduled_at',
  'date', 'day', 'time', 'status', 'time_remaining', 'unscheduled', 'overdue',
  'slack_mins', 'occurrence_ordinal', 'split_ordinal', 'split_total',
  'split_group', 'generated', 'gcal_event_id', 'depends_on_json',
  'created_at', 'updated_at', 'msft_event_id', 'apple_event_id', 'master_id',
  'completed_at', 'implied_deadline', 'earliest_start', 'unplaced_reason',
  'unplaced_detail', 'end_date'
];

beforeAll(async () => {
  await assertDbAvailable();
  await db('task_instances').where('user_id', TEST_USER_ID).del();
  await db('task_masters').where('user_id', TEST_USER_ID).del();
  await db('users').where('id', TEST_USER_ID).del();
  await db('users').insert({
    id: TEST_USER_ID,
    email: 'telly-tasksv-anchor@test.invalid',
    name: 'Telly tasks_v anchor Test',
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
  await db('task_instances').where('user_id', TEST_USER_ID).del();
  await db('task_masters').where('user_id', TEST_USER_ID).del();
});

describe('999.1091 / 999.1094 — tasks_v must project rolling_anchor + next_occurrence_anchor', () => {

  test('1. tasks_v has both anchor columns (information_schema)', async () => {
    var dbName = db.client.config.connection.database || 'juggler_test';
    var rows = await db('information_schema.COLUMNS')
      .where('TABLE_SCHEMA', dbName)
      .where('TABLE_NAME', 'tasks_v')
      .whereIn('COLUMN_NAME', ['rolling_anchor', 'next_occurrence_anchor'])
      .select('COLUMN_NAME');
    var found = rows.map(function(r) { return r.COLUMN_NAME; }).sort();
    expect(found).toEqual(['next_occurrence_anchor', 'rolling_anchor']);
  });

  test('2. tasks_with_sync_v has both anchor columns (information_schema)', async () => {
    var dbName = db.client.config.connection.database || 'juggler_test';
    var rows = await db('information_schema.COLUMNS')
      .where('TABLE_SCHEMA', dbName)
      .where('TABLE_NAME', 'tasks_with_sync_v')
      .whereIn('COLUMN_NAME', ['rolling_anchor', 'next_occurrence_anchor'])
      .select('COLUMN_NAME');
    var found = rows.map(function(r) { return r.COLUMN_NAME; }).sort();
    expect(found).toEqual(['next_occurrence_anchor', 'rolling_anchor']);
  });

  test('3. seeded rolling_anchor + next_occurrence_anchor round-trip through tasks_v and tasks_with_sync_v', async () => {
    var masterId = uuidv7();
    await db('task_masters').insert({
      id: masterId,
      user_id: TEST_USER_ID,
      text: 'anchor round-trip test',
      recurring: 1,
      recur: JSON.stringify({ type: 'weekly', days: 'W' }),
      recur_start: '2026-01-01',
      rolling_anchor: '2026-07-01',
      next_occurrence_anchor: '2026-07-08',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    var viewRow = await db('tasks_v')
      .where('id', masterId)
      .select('rolling_anchor', 'next_occurrence_anchor')
      .first();
    expect(viewRow).toBeTruthy();
    expect(String(viewRow.rolling_anchor)).toMatch(/2026-07-01/);
    expect(String(viewRow.next_occurrence_anchor)).toMatch(/2026-07-08/);

    var syncRow = await db('tasks_with_sync_v')
      .where('id', masterId)
      .select('rolling_anchor', 'next_occurrence_anchor')
      .first();
    expect(syncRow).toBeTruthy();
    expect(String(syncRow.rolling_anchor)).toMatch(/2026-07-01/);
    expect(String(syncRow.next_occurrence_anchor)).toMatch(/2026-07-08/);
  });

  test('4. tasks_v column set is a superset of the known floor columns plus both anchors', async () => {
    var dbName = db.client.config.connection.database || 'juggler_test';
    var columnRows = await db('information_schema.COLUMNS')
      .where('TABLE_SCHEMA', dbName)
      .where('TABLE_NAME', 'tasks_v')
      .select('COLUMN_NAME');
    var currentCols = columnRows.map(function(r) { return r.COLUMN_NAME; });

    var missing = FLOOR_COLUMNS.filter(function(col) {
      return currentCols.indexOf(col) === -1;
    });
    expect(missing).toEqual([]);
    expect(currentCols).toContain('rolling_anchor');
    expect(currentCols).toContain('next_occurrence_anchor');
  });
});
