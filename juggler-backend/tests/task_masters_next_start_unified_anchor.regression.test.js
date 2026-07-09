/**
 * task_masters_next_start_unified_anchor.regression.test.js
 *
 * Traceability: juggler-recur-lifecycle-redesign SPEC.md FR-1 (Unified anchor) / AC1 / AC2.
 *
 * FR-1 replaces `task_masters.rolling_anchor` + `next_occurrence_anchor` with ONE
 * `next_start` date column: the first non-terminal instance date for that master.
 * AC1: `task_masters.next_start` exists; `rolling_anchor`/`next_occurrence_anchor`
 *      values are migrated into it.
 * AC2: a terminal-status write advances `next_start` monotonically per FR-1(a); a
 *      scheduler run advances non-rolling stale (`< today`) anchors per FR-1(b);
 *      rolling masters are unaffected.
 *
 * This test is WRITTEN FIRST (telly step 0, mode=new) against a migration that does
 * NOT exist yet — it MUST fail RED for the expected reason (missing `next_start`
 * column / missing backfill), not for an unrelated setup error. Modeled directly on
 * the sibling `tasks_v_rolling_and_next_occurrence_anchor.regression.test.js`
 * (same assertDbAvailable / TEST_USER_ID seeding / information_schema.COLUMNS /
 * FLOOR_COLUMNS superset-guard house style).
 *
 * Tie-break rule under test (backfill, item 2 of the work-item spec): whichever of
 * `rolling_anchor` / `next_occurrence_anchor` is non-null wins. If a row somehow has
 * BOTH set, `rolling_anchor` WINS — it is the more-specific/older mechanism (it was
 * the original anchor column; `next_occurrence_anchor` was added later as a
 * generalization — see 20260703210000_add_next_occurrence_anchor.js header). This
 * tie-break must be encoded in the (not-yet-written) backfill migration.
 *
 * Tests:
 *   1. task_masters HAS a nullable `next_start` DATE column (information_schema).
 *   2. Backfill (one-time migration UPDATE): a PRE-EXISTING row seeded with ONLY
 *      rolling_anchor set (next_start left NULL, as a real pre-existing row would
 *      be before this migration's up() ran) -> re-running the migration's exact
 *      backfill UPDATE derives next_start == rolling_anchor.
 *   3. Backfill: a PRE-EXISTING row seeded with ONLY next_occurrence_anchor set ->
 *      backfill UPDATE derives next_start == next_occurrence_anchor.
 *   4. Backfill tie-break: a PRE-EXISTING row seeded with BOTH set (different
 *      values) -> backfill UPDATE derives next_start == rolling_anchor (rolling_anchor
 *      wins), NOT next_occurrence_anchor.
 *   4a. Post-migration NEW row (no backfill applicable -- it only ever touched rows
 *       existing AT MIGRATION TIME): a row inserted fresh with anchors set but no
 *       W2 application-layer derivation yet (W2 doesn't exist in this leg) correctly
 *       has next_start == NULL. This is the accepted, spec-legal state per SPEC.md
 *       FR-1 (next_start nullable-until-first-anchor-event), NOT a gap -- see the
 *       migration's own header note (20260709120000_add_next_start_unified_anchor.js
 *       lines 56-59) and cookie's ARCH-REVIEW-W1.json finding W1-ARCH-3 (INFO).
 *   5. tasks_v exposes next_start (information_schema check).
 *   6. tasks_with_sync_v exposes next_start (information_schema check).
 *   7. Seeded round-trip: next_start set directly on task_masters appears correctly
 *      in BOTH tasks_v and tasks_with_sync_v.
 *   8. tasks_v column set is a superset of the known floor columns plus next_start
 *      (guards against the exact "hand-copied view recreation silently drops a
 *      column" class of bug documented in the sibling anchor regression test).
 *
 * REHOMED 2026-07-09 (telly, TELLY-W1-REHOME-REVIEW.md): tests #2-4 originally
 * inserted a FRESH row post-migration and expected a `BEFORE INSERT` trigger to
 * auto-derive next_start on INSERT. Bert removed that trigger (per cookie
 * W1-ARCH-1/-2 + ernie ernie-w1-trigger-convention/ernie-w1-w2-column-drop-landmine
 * WARNs) because it duplicated the tie-break rule in a second, DB-side home and
 * forward-referenced columns W2 is scoped to drop. The migration's ACTUAL FR-1/AC1
 * requirement is the ONE-TIME BACKFILL of PRE-EXISTING rows (up() step 2, migration
 * lines 118-127), not ongoing per-INSERT auto-derivation -- auto-derivation is now
 * W2's application-layer job. Tests #2-4 below now seed a row the way a
 * pre-existing row would look (anchors set, next_start NULL, since no trigger
 * populates it on INSERT), then invoke the REAL migration module's exported up()
 * directly against the test DB, and assert the derivation lands correctly.
 *
 * RE-FIXED 2026-07-09 (bert, per zoe zoe-w1-backfill-mirror-noreach WARN): tests
 * #2-4 previously invoked a test-local string-mirrored copy of the backfill SQL
 * (runMigrationBackfillUpdate(), verbatim-identical to the migration's SQL at the
 * time telly wrote it but with ZERO drift protection -- zoe proved that flipping
 * the REAL migration's COALESCE order left #2-4 GREEN because the migration module
 * was never require()'d). Fixed by calling the real exported `up(knex)` directly
 * instead of a mirrored string. This is SAFE to invoke ad hoc (not just via the
 * knex migration runner) because up() is fully idempotent when re-run against an
 * already-migrated DB (which the test-bed DB always is by the time these tests
 * run, since migrate:latest already ran the migration once during test-bed setup):
 *   - step 1 (add column) no-ops via hasColumn() guard.
 *   - step 2 (the backfill UPDATE) is itself idempotent (`WHERE next_start IS
 *     NULL AND (...)`) -- re-running it only touches rows still NULL, which is
 *     exactly the row(s) this test just seeded. This is the line under test.
 *   - steps 3-6 (view recreation) short-circuit via the
 *     `vAlreadyInjected && syncAlreadyInjected` early-return (migration.js:149)
 *     since both views already carry next_start from the earlier real run --
 *     up() never touches tasks_v/tasks_with_sync_v again.
 * So calling `require('../src/db/migrations/20260709120000_add_next_start_unified_
 * anchor')` and invoking its `up(db)` exercises the REAL shipped backfill UPDATE
 * (line 124-127) with no risk of duplicate view-DROP/CREATE churn. Verified live
 * (test-bed 3407): flipping the real migration's COALESCE order now flips test #4
 * RED (see BERT-W1-TESTFIX-REVIEW.json for the mutation proof), closing the
 * false-pass gap zoe found. Test #4a is unchanged: it confirms the companion fact
 * that a genuinely NEW row (inserted after migration, no backfill re-run) is
 * correctly left NULL -- this is not a gap, it's FR-1's nullable-until-
 * first-anchor-event design, to be filled by W2.
 *
 * PENDING (test.todo, item 4 of the work-item spec): the monotonic-advance
 * behavioral guard (a repo/service method that refuses to write an earlier
 * next_start and accepts a later one) is NOT encoded here as a real assertion —
 * the write-path mechanism (W2, a later wave) does not exist yet and no function
 * name/shape has been confirmed. Filling in a fake API now would risk pinning the
 * WRONG contract. Left as `test.todo` to be filled in once W2 ships.
 */

'use strict';

var db = require('../src/db');
var { v7: uuidv7 } = require('uuid');
var { assertDbAvailable } = require('./helpers/requireDB');
var nextStartMigration = require('../src/db/migrations/20260709120000_add_next_start_unified_anchor');

var TEST_USER_ID = 'telly-tasksmasters-nextstart-test';

// Columns tasks_v is known to carry as of the sibling
// tasks_v_rolling_and_next_occurrence_anchor.regression.test.js FLOOR_COLUMNS list
// (copied verbatim — same superset-guard house style) PLUS `next_start` (this leg).
// rolling_anchor / next_occurrence_anchor themselves are DELIBERATELY EXCLUDED from
// this floor list: per SPEC AC1, "no code path reads/writes the two old columns
// after this leg" — a later leg (once the migration + read-path cutover both ship)
// is expected to DROP them from the view. This test only floors the columns that
// must survive; it does not assert the old anchor columns are gone (that is a
// later work item's job, not W1's).
var FLOOR_COLUMNS = [
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
  'created_at', 'updated_at', 'msft_event_id', 'apple_event_id', 'master_id',
  'completed_at', 'implied_deadline', 'earliest_start', 'unplaced_reason',
  'unplaced_detail', 'end_date', 'next_start'
];

beforeAll(async () => {
  await assertDbAvailable();
  await db('task_instances').where('user_id', TEST_USER_ID).del();
  await db('task_masters').where('user_id', TEST_USER_ID).del();
  await db('users').where('id', TEST_USER_ID).del();
  await db('users').insert({
    id: TEST_USER_ID,
    email: 'telly-tasksmasters-nextstart@test.invalid',
    name: 'Telly next_start Test',
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

// Invokes the REAL migration module's exported up() directly against the test DB
// (bert fix, per zoe zoe-w1-backfill-mirror-noreach WARN -- see the file-header
// note above for why this is safe/idempotent to re-run ad hoc). This replaces the
// former test-local string-mirrored copy of the backfill SQL, so a future edit to
// the shipped migration's backfill UPDATE is caught by this suite instead of
// silently drifting from an un-synced test copy.
function runMigrationBackfillUpdate() {
  return nextStartMigration.up(db);
}

describe('FR-1/AC1 — task_masters.next_start unified anchor column + backfill', () => {

  test('1. task_masters has a nullable next_start DATE column (information_schema)', async () => {
    var dbName = db.client.config.connection.database || 'juggler_test';
    var row = await db('information_schema.COLUMNS')
      .where('TABLE_SCHEMA', dbName)
      .where('TABLE_NAME', 'task_masters')
      .where('COLUMN_NAME', 'next_start')
      .select('COLUMN_NAME', 'IS_NULLABLE', 'DATA_TYPE')
      .first();
    expect(row).toBeTruthy();
    expect(row.IS_NULLABLE).toBe('YES');
    expect(row.DATA_TYPE).toBe('date');
  });

  test('2. backfill (one-time migration UPDATE): rolling_anchor-only pre-existing row -> next_start == rolling_anchor', async () => {
    var masterId = uuidv7();
    // Seed the row the way a PRE-EXISTING row (created before this migration ever
    // ran) would actually look: rolling_anchor set, next_start omitted. With the
    // trigger removed, a plain INSERT already leaves next_start NULL by column
    // default (migration line 114) -- no bypass mechanism is needed to reach this
    // state, it is simply what happens today.
    await db('task_masters').insert({
      id: masterId,
      user_id: TEST_USER_ID,
      text: 'backfill rolling-only test',
      recurring: 1,
      recur: JSON.stringify({ type: 'rolling' }),
      recur_start: '2026-01-01',
      rolling_anchor: '2026-07-01',
      next_occurrence_anchor: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    var preRow = await db('task_masters').where('id', masterId).select('next_start').first();
    expect(preRow.next_start).toBeNull(); // sanity: confirms no trigger auto-derives on INSERT

    // Invoke the SAME backfill logic the migration's up() runs (step 2).
    await runMigrationBackfillUpdate();

    var row = await db('task_masters').where('id', masterId).select('next_start').first();
    expect(row).toBeTruthy();
    expect(String(row.next_start)).toMatch(/2026-07-01/);
  });

  test('3. backfill: next_occurrence_anchor-only pre-existing row -> next_start == next_occurrence_anchor', async () => {
    var masterId = uuidv7();
    await db('task_masters').insert({
      id: masterId,
      user_id: TEST_USER_ID,
      text: 'backfill next-occurrence-only test',
      recurring: 1,
      recur: JSON.stringify({ type: 'weekly', days: 'W' }),
      recur_start: '2026-01-01',
      rolling_anchor: null,
      next_occurrence_anchor: '2026-07-08',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    var preRow = await db('task_masters').where('id', masterId).select('next_start').first();
    expect(preRow.next_start).toBeNull();

    await runMigrationBackfillUpdate();

    var row = await db('task_masters').where('id', masterId).select('next_start').first();
    expect(row).toBeTruthy();
    expect(String(row.next_start)).toMatch(/2026-07-08/);
  });

  test('4. backfill tie-break: pre-existing row with BOTH set -> next_start == rolling_anchor (rolling_anchor wins)', async () => {
    var masterId = uuidv7();
    await db('task_masters').insert({
      id: masterId,
      user_id: TEST_USER_ID,
      text: 'backfill tie-break test',
      recurring: 1,
      recur: JSON.stringify({ type: 'rolling' }),
      recur_start: '2026-01-01',
      rolling_anchor: '2026-07-01',
      next_occurrence_anchor: '2026-07-08',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    var preRow = await db('task_masters').where('id', masterId).select('next_start').first();
    expect(preRow.next_start).toBeNull();

    await runMigrationBackfillUpdate();

    var row = await db('task_masters').where('id', masterId).select('next_start').first();
    expect(row).toBeTruthy();
    // rolling_anchor (2026-07-01) wins the tie, NOT next_occurrence_anchor (2026-07-08).
    expect(String(row.next_start)).toMatch(/2026-07-01/);
    expect(String(row.next_start)).not.toMatch(/2026-07-08/);
  });

  test('4a. post-migration NEW row (no backfill re-run): anchors set but no derivation applied yet -> next_start stays NULL (spec-legal per SPEC.md FR-1, not a gap)', async () => {
    var masterId = uuidv7();
    // Simulates a task_masters row created in the real W1->W2 window: the
    // (now-removed) trigger no longer auto-derives on INSERT, and W2's
    // application-layer derivation (src/lib/tasks-write.js and friends) does not
    // exist yet in this leg. Per SPEC.md FR-1, next_start is nullable-until-first-
    // anchor-event -- this is the CORRECT, accepted state, not a defect. See
    // cookie's ARCH-REVIEW-W1.json W1-ARCH-3 (INFO) and the migration header
    // (20260709120000_add_next_start_unified_anchor.js lines 56-59).
    await db('task_masters').insert({
      id: masterId,
      user_id: TEST_USER_ID,
      text: 'post-migration new row, no derivation yet',
      recurring: 1,
      recur: JSON.stringify({ type: 'rolling' }),
      recur_start: '2026-01-01',
      rolling_anchor: '2026-07-20',
      next_occurrence_anchor: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    // Deliberately do NOT invoke runMigrationBackfillUpdate() here -- the backfill
    // is a ONE-TIME migration-time operation, not something re-run per INSERT.
    var row = await db('task_masters').where('id', masterId).select('next_start').first();
    expect(row).toBeTruthy();
    expect(row.next_start).toBeNull();
  });

  test('5. tasks_v has next_start column (information_schema)', async () => {
    var dbName = db.client.config.connection.database || 'juggler_test';
    var row = await db('information_schema.COLUMNS')
      .where('TABLE_SCHEMA', dbName)
      .where('TABLE_NAME', 'tasks_v')
      .where('COLUMN_NAME', 'next_start')
      .select('COLUMN_NAME')
      .first();
    expect(row).toBeTruthy();
  });

  test('6. tasks_with_sync_v has next_start column (information_schema)', async () => {
    var dbName = db.client.config.connection.database || 'juggler_test';
    var row = await db('information_schema.COLUMNS')
      .where('TABLE_SCHEMA', dbName)
      .where('TABLE_NAME', 'tasks_with_sync_v')
      .where('COLUMN_NAME', 'next_start')
      .select('COLUMN_NAME')
      .first();
    expect(row).toBeTruthy();
  });

  test('7. seeded next_start round-trips through tasks_v and tasks_with_sync_v', async () => {
    var masterId = uuidv7();
    await db('task_masters').insert({
      id: masterId,
      user_id: TEST_USER_ID,
      text: 'next_start round-trip test',
      recurring: 1,
      recur: JSON.stringify({ type: 'weekly', days: 'W' }),
      recur_start: '2026-01-01',
      next_start: '2026-07-15',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    var viewRow = await db('tasks_v').where('id', masterId).select('next_start').first();
    expect(viewRow).toBeTruthy();
    expect(String(viewRow.next_start)).toMatch(/2026-07-15/);

    var syncRow = await db('tasks_with_sync_v').where('id', masterId).select('next_start').first();
    expect(syncRow).toBeTruthy();
    expect(String(syncRow.next_start)).toMatch(/2026-07-15/);
  });

  test('8. tasks_v column set is a superset of the known floor columns plus next_start', async () => {
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
    expect(currentCols).toContain('next_start');
  });

  // COMPLETED (W2, this leg's W2 wave, telly step-0): the write-path shape is now
  // known — the REAL entry point is `facade.updateTaskStatus` (via the real
  // controller/facade -> applyRollingAnchor seam, facade.js:558-597), not a new
  // standalone function. Rather than retrofit a DB-integration test into THIS
  // pure information_schema/migration-focused file (different mocking/fixture
  // shape — controller req/res + jest.mock'd scheduleQueue/redis/sse), the
  // monotonic-advance guard (and the rest of FR-1(a)/(b)'s write-path/sweep
  // behavior) is authored in a dedicated sibling file:
  //   tests/next_start_terminal_writepath_w2.regression.test.js
  //     ("monotonic guard (FR-1a): next_start never regresses ... does advance")
  //   tests/next_start_scheduler_sweep_w2.regression.test.js (FR-1(b) sweep)
  // Both confirmed RED against current code (2026-07-09, TELLY-W2-REVIEW.md).
  test.todo('9. [DONE — see tests/next_start_terminal_writepath_w2.regression.test.js "monotonic guard (FR-1a)"] monotonic-advance guard: write mechanism refuses an earlier next_start and accepts a later one (new = MAX(current, computed))');
});
