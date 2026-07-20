'use strict';

// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../../src/lib/audit-context').stampInsert(rows);

/**
 * RC1 Regression: tasks_with_sync_v ER_VIEW_INVALID (999.816)
 *
 * Root cause: migration 20260614010000 recreated tasks_v with a hardcoded DDL
 * that dropped end_date (which 20260527230000 had added). tasks_with_sync_v
 * references v.end_date → MySQL marks it ER_VIEW_INVALID (error 1356) on every
 * read, blocking all task reads that go through the sync view.
 *
 * Fix: migration 20260623000000_restore_end_date_in_tasks_v.js restores end_date
 * in tasks_v (after recur_end, before marker, in both UNION branches) while
 * preserving completed_at and implied_deadline added by later migrations.
 *
 * Traceability: fixy-crud-rot TRACEABILITY.md RC1
 * Covers: RC1 RED→GREEN — SELECT tasks_with_sync_v no longer throws ER_VIEW_INVALID;
 *         tasks_v exposes end_date, completed_at, AND implied_deadline.
 *
 * Layer: integration (requires test-bed DB on 3407)
 */

var knex = require('knex');
var knexConfig = require('../../knexfile');
var { v7: uuidv7 } = require('uuid');

var db;
var USER_ID = 'rc1-regression-test-user';

beforeAll(async () => {
  db = knex(knexConfig.test);

  // TEST-FR-001: fail loud if DB is unreachable, never silently pass
  var reachable = false;
  try {
    await db.raw('SELECT 1');
    reachable = true;
  } catch (e) {
    // fall through
  }
  if (!reachable) {
    throw new Error(
      '[TEST-FR-001] Required DB (test-bed @3407 / juggler_fixy_test) is unreachable. ' +
      'Start test-bed (make up in test-bed/) and set DB_NAME=juggler_fixy_test before running.'
    );
  }

  // Clean up any leftover state from prior runs
  await db('cal_sync_ledger').where('user_id', USER_ID).del().catch(() => {});
  await db('task_instances').where('user_id', USER_ID).del().catch(() => {});
  await db('task_masters').where('user_id', USER_ID).del().catch(() => {});
  await db('users').where('id', USER_ID).del().catch(() => {});

  await db('users').insert(__stampFixture({
    id: USER_ID,
    email: 'rc1-regression@test.com',
    name: 'RC1 Regression Test',
    timezone: 'America/New_York',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  }));
}, 15000);

afterAll(async () => {
  if (db) {
    await db('cal_sync_ledger').where('user_id', USER_ID).del().catch(() => {});
    await db('task_instances').where('user_id', USER_ID).del().catch(() => {});
    await db('task_masters').where('user_id', USER_ID).del().catch(() => {});
    await db('users').where('id', USER_ID).del().catch(() => {});

    // CROSS-SUITE HYGIENE: this suite exercises the tasks_v / tasks_with_sync_v
    // view chain that the 20260623000000 migration restores end_date into. If
    // anything in this process left the view in an ER_VIEW_INVALID state (a
    // dropped column, a half-applied migration, an interleaved migration test),
    // later suites' view reads would break in the combined run. Guarantee the
    // view chain is valid on the way out by re-running migrate:latest (idempotent
    // — already-applied migrations are skipped) and confirming the view is
    // queryable. All failures swallowed: this teardown must never redden a suite.
    try {
      await db.migrate.latest();
    } catch (e) {
      /* no-op: migrations already current or unavailable */
    }
    try {
      await db('tasks_with_sync_v').limit(1).select();
    } catch (e) {
      /* no-op: nothing further we can safely do in teardown */
    }

    await db.destroy();
  }
});

// ---------------------------------------------------------------------------
// RC1-A: View-chain integrity — tasks_v exposes all three required columns
// ---------------------------------------------------------------------------

describe('RC1: tasks_v column presence (end_date + completed_at + implied_deadline)', () => {
  test('tasks_v exposes end_date column (was dropped by 20260614010000)', async () => {
    var cols = await db('information_schema.COLUMNS')
      .where('TABLE_SCHEMA', db.client.config.connection.database)
      .where('TABLE_NAME', 'tasks_v')
      .where('COLUMN_NAME', 'end_date')
      .select('COLUMN_NAME');
    expect(cols).toHaveLength(1);
    expect(cols[0].COLUMN_NAME).toBe('end_date');
  });

  test('tasks_v retains completed_at (added by 20260614010000 — must not be dropped)', async () => {
    var cols = await db('information_schema.COLUMNS')
      .where('TABLE_SCHEMA', db.client.config.connection.database)
      .where('TABLE_NAME', 'tasks_v')
      .where('COLUMN_NAME', 'completed_at')
      .select('COLUMN_NAME');
    expect(cols).toHaveLength(1);
  });

  test('tasks_v retains implied_deadline (added by 20260621000000 — must not be dropped)', async () => {
    var cols = await db('information_schema.COLUMNS')
      .where('TABLE_SCHEMA', db.client.config.connection.database)
      .where('TABLE_NAME', 'tasks_v')
      .where('COLUMN_NAME', 'implied_deadline')
      .select('COLUMN_NAME');
    expect(cols).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// RC1-B: tasks_with_sync_v is queryable (no ER_VIEW_INVALID / error 1356)
// This is the primary failing assertion before the fix.
// ---------------------------------------------------------------------------

describe('RC1: tasks_with_sync_v queryable (no ER_VIEW_INVALID)', () => {
  test('SELECT from tasks_with_sync_v does not throw (was ER_VIEW_INVALID 1356 pre-fix)', async () => {
    // This is the regression test: before 20260623000000, this throws:
    //   ER_VIEW_INVALID: View 'juggler_fixy_test.tasks_with_sync_v' references
    //   invalid table(s) or column(s) or function(s)
    var result;
    var error;
    try {
      result = await db('tasks_with_sync_v').limit(1).select();
    } catch (e) {
      error = e;
    }
    // Must NOT throw
    expect(error).toBeUndefined();
    expect(Array.isArray(result)).toBe(true);
  });

  test('tasks_with_sync_v projects end_date column from tasks_v', async () => {
    // Confirm the dependent view exposes end_date (validates the full chain)
    var cols = await db('information_schema.COLUMNS')
      .where('TABLE_SCHEMA', db.client.config.connection.database)
      .where('TABLE_NAME', 'tasks_with_sync_v')
      .where('COLUMN_NAME', 'end_date')
      .select('COLUMN_NAME');
    expect(cols).toHaveLength(1);
    expect(cols[0].COLUMN_NAME).toBe('end_date');
  });
});

// ---------------------------------------------------------------------------
// RC1-C: end_date value round-trips through both views correctly
// Seeds a task instance with end_date set and reads back through tasks_with_sync_v.
// ---------------------------------------------------------------------------

describe('RC1: end_date value round-trips through view chain', () => {
  test('instance end_date is visible through tasks_v and tasks_with_sync_v', async () => {
    var masterId = uuidv7();
    var instanceId = uuidv7();
    var testEndDate = '2026-06-30';

    // Insert master (non-recurring so it surfaces in the instance branch)
    await db('task_masters').insert(__stampFixture({
      id: masterId,
      user_id: USER_ID,
      text: 'RC1 multiday task',
      dur: 60,
      pri: 'P3',
      recurring: 0,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    }));

    // Insert instance with end_date
    await db('task_instances').insert(__stampFixture({
      id: instanceId,
      user_id: USER_ID,
      master_id: masterId,
      status: '',
      scheduled_at: new Date('2026-06-28T10:00:00Z'),
      date: '2026-06-28',
      end_date: testEndDate,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    }));

    // Read back through tasks_v
    var tvRow = await db('tasks_v').where('id', instanceId).first();
    expect(tvRow).toBeDefined();
    expect(tvRow.end_date).toBe(testEndDate);

    // Read back through tasks_with_sync_v (the broken view pre-fix)
    var svRow = await db('tasks_with_sync_v').where('id', instanceId).first();
    expect(svRow).toBeDefined();
    expect(svRow.end_date).toBe(testEndDate);

    // completed_at and implied_deadline also surface correctly (preserved cols)
    expect('completed_at' in tvRow).toBe(true);
    expect('implied_deadline' in tvRow).toBe(true);

    // Clean up
    await db('task_instances').where('id', instanceId).del();
    await db('task_masters').where('id', masterId).del();
  });

  test('recurring template branch: tasks_v end_date column is present (NULL for templates)', async () => {
    var masterId = uuidv7();

    await db('task_masters').insert(__stampFixture({
      id: masterId,
      user_id: USER_ID,
      text: 'RC1 recurring template',
      dur: 30,
      pri: 'P3',
      recurring: 1,
      recur: JSON.stringify({ type: 'daily' }),
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    }));

    var row = await db('tasks_v').where('id', masterId).first();
    expect(row).toBeDefined();
    expect(row.task_type).toBe('recurring_template');
    // end_date column present (NULL for template branch — m.end_date)
    expect('end_date' in row).toBe(true);

    // Clean up
    await db('task_masters').where('id', masterId).del();
  });
});
