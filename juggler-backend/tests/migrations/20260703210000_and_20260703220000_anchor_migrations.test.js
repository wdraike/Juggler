'use strict';

/**
 * 20260703210000_and_20260703220000_anchor_migrations.test.js
 *
 * Migration round-trip test — 999.1091 (C1) + 999.1094 (side-fix), referred by
 * ernie's re-review (CODE-REVIEW.md finding #1 / Refer-outs): the down() rollback
 * path for both new migrations was BLOCK-fixed (bare-vs-aliased-literal strip bug)
 * and re-verified LIVE via an ad-hoc `node -e` script, but no COMMITTED, automated
 * jest test exercised up->down->up for either migration. This file closes that gap.
 *
 * Migrations under test (applied in this order; 220000 depends on 210000's
 * `next_occurrence_anchor` column/view-projection as its own inject anchor point):
 *   - 20260703210000_add_next_occurrence_anchor.js
 *       up:   task_masters.next_occurrence_anchor (nullable DATE) + projects it
 *             into tasks_v / tasks_with_sync_v.
 *       down: strips the column from both views, then drops it from task_masters.
 *   - 20260703220000_restore_rolling_anchor_in_tasks_v.js
 *       up:   projects the (pre-existing, already-on-task_masters) rolling_anchor
 *             column into tasks_v / tasks_with_sync_v, anchored next to
 *             next_occurrence_anchor.
 *       down: strips rolling_anchor from both views only (task_masters.rolling_anchor
 *             itself is untouched — this migration never added that column).
 *
 * Exercises THIS migration pair's own down()/up() directly (matching
 * tests/db/20260621000000_implied_deadline.test.js's documented rationale) rather
 * than knex's batch-based db.migrate.rollback() — order-independent regardless of
 * which batch either migration landed in, and lets us drive both DOWN in reverse
 * dependency order then both UP again within one test file.
 *
 * Assertions (per ernie's referral):
 *   1. up() is idempotent — re-running it against an already-migrated DB is a
 *      safe no-op (both anchor columns still present/queryable afterward).
 *   2. down() on both (reverse order: 220000 then 210000) leaves BOTH anchor
 *      columns absent from both views AND `SELECT ... LIMIT 0` against both
 *      views still succeeds (no dangling `AS <col>` / malformed view — the exact
 *      defect class ernie's prior BLOCK caught) — plus the next_occurrence_anchor
 *      column itself is dropped from task_masters (rolling_anchor's column is
 *      NOT dropped — 220000 never added it).
 *   3. Re-up (210000 then 220000) restores both columns; both views expose them
 *      again and remain queryable, including a real row's values round-tripping
 *      through both views.
 *
 * afterEachFile.js (setupFilesAfterEnv) restores tasks_v/tasks_with_sync_v from
 * the src/db/views SSOT (canonical-views.sql) after this file completes regardless
 * of the state left here — this file leaves both migrations fully re-applied
 * (final state matches canonical), so that restore is a no-op safety net, not a
 * dependency of this test's own assertions.
 */

jest.setTimeout(60000);

var { v7: uuidv7 } = require('uuid');
var { assertDbAvailable } = require('../helpers/requireDB');
var db = require('../../src/db');
var migration1 = require('../../src/db/migrations/20260703210000_add_next_occurrence_anchor');
var migration2 = require('../../src/db/migrations/20260703220000_restore_rolling_anchor_in_tasks_v');

var TEST_USER_ID = 'telly-anchmig-rt';

async function selectThrows(sql) {
  try {
    await db.raw(sql);
    return false;
  } catch (e) {
    return true;
  }
}

async function viewSelectable(viewName) {
  // A bare `SELECT * FROM <view> LIMIT 0` succeeding IS the assertion that the
  // view is well-formed (no dangling `AS <col>` from a mis-stripped down()).
  await db.raw('SELECT * FROM `' + viewName + '` LIMIT 0');
  return true;
}

// RETIRED (juggler-anchor-column-cleanup, W7, 2026-07-11): this suite drives
// 20260703210000_add_next_occurrence_anchor's and
// 20260703220000_restore_rolling_anchor_in_tasks_v's up()/down() DIRECTLY
// against the shared, fully-migrated test-bed DB, asserting both
// `next_occurrence_anchor` and `rolling_anchor` round-trip through
// task_masters/tasks_v/tasks_with_sync_v. Migration 20260711200000
// (drop_legacy_anchor_columns) now ALSO runs in the same chain and drops both
// columns permanently — once it has run, this suite's premise (these two
// migrations' schema effect is still live and reversible in isolation) no
// longer holds: its beforeAll's migrate.latest() runs 20260711200000 first,
// then test 1 re-adds both columns via migration1.up()/migration2.up()
// (idempotent add-if-missing), silently reintroducing them onto the SHARED
// test-bed schema for the rest of the run — the exact SSOT-vs-live-schema
// drift class tests/migrations/view-column-contract.test.js exists to catch
// (CAT-A in reviews/TELLY-BASELINE.md), and afterEachFile.js's per-file view
// restore would then fight this suite's own view mutations.
//
// DECISION (grover, count's INTAKE-BRIEF risk_flags #7 + characterization_targets):
// RETIRE, not isolate-on-scratch-schema. Rationale:
//   1. Per test-bed/scripts/init-juggler-schema.sh's own docblock, this
//      project's migration chain CANNOT build a DB from scratch (an early view
//      migration references a column that predates it) — every real DB
//      (dev/prod/test) is seeded from a schema snapshot + migration-log
//      baseline, then only migrations NEWER than the snapshot ever run. Once
//      the snapshot baseline moves past 20260711200000 (which it already has
//      in this leg — see the test-bed init above), 20260703210000/220000's
//      up()/down() will NEVER be exercised again in any real environment —
//      not just this test-bed instance.
//   2. Migrations are immutable once applied in a shared environment (juggler
//      CLAUDE.md "Migrations — transitional views" policy) — these two files
//      stay on disk verbatim as a permanent historical record; only the TEST
//      exercising their reversibility is now testing dead ground.
//   3. Building an isolated scratch-schema harness (a second DB/schema just to
//      keep re-running two already-proven, now-permanently-superseded
//      migrations' round-trip) would be meaningfully larger effort than the
//      value returned — the up()/down() correctness these migrations needed
//      proving (999.1091/999.1094, ernie's original referral) was already
//      exercised and shipped; the columns they manage are now gone by design.
// The suite body is left INTACT (not deleted) as the historical record of
// what was proven, per the same "never edit an already-applied migration"
// spirit — it is simply never executed. Skip the whole describe block.
describe.skip('[RETIRED — see comment above] migrations 20260703210000 + 20260703220000 — anchor columns/views round-trip (999.1091/999.1094)', function() {

  beforeAll(async function() {
    await assertDbAvailable();
    // Ensure ALL pending migrations are applied first (idempotent — this
    // worktree's isolated test DB is already fully migrated per dispatch note).
    await db.migrate.latest();
  });

  afterAll(async function() {
    // Restore full schema even if a test failed mid-round-trip, so later test
    // files in the same run (and afterEachFile.js's own canonical-view restore)
    // see a consistent, fully-migrated DB.
    await migration1.up(db).catch(function() {});
    await migration2.up(db).catch(function() {});
    await db('task_masters').where('user_id', TEST_USER_ID).del().catch(function() {});
    await db('users').where('id', TEST_USER_ID).del().catch(function() {});
  });

  test('1. up() is idempotent when already applied — no-op, both anchors still queryable', async function() {
    await expect(migration1.up(db)).resolves.not.toThrow();
    await expect(migration2.up(db)).resolves.not.toThrow();

    expect(await viewSelectable('tasks_v')).toBe(true);
    expect(await viewSelectable('tasks_with_sync_v')).toBe(true);
    expect(await selectThrows('SELECT next_occurrence_anchor FROM tasks_v LIMIT 0')).toBe(false);
    expect(await selectThrows('SELECT rolling_anchor FROM tasks_v LIMIT 0')).toBe(false);

    var info = await db('task_masters').columnInfo();
    expect(info.next_occurrence_anchor).toBeDefined();
    expect(info.rolling_anchor).toBeDefined();
  });

  test('2. down() in reverse order (220000 then 210000): both anchor columns gone from both views, views stay well-formed, next_occurrence_anchor column dropped', async function() {
    // --- down 220000 first: strips rolling_anchor from the views only ---
    await expect(migration2.down(db)).resolves.not.toThrow();

    // Views remain well-formed (no dangling AS from a bad strip).
    expect(await viewSelectable('tasks_v')).toBe(true);
    expect(await viewSelectable('tasks_with_sync_v')).toBe(true);

    // rolling_anchor no longer projected by either view...
    expect(await selectThrows('SELECT rolling_anchor FROM tasks_v LIMIT 0')).toBe(true);
    expect(await selectThrows('SELECT rolling_anchor FROM tasks_with_sync_v LIMIT 0')).toBe(true);
    // ...but next_occurrence_anchor (added by 210000, not yet reverted) still is.
    expect(await selectThrows('SELECT next_occurrence_anchor FROM tasks_v LIMIT 0')).toBe(false);
    expect(await selectThrows('SELECT next_occurrence_anchor FROM tasks_with_sync_v LIMIT 0')).toBe(false);

    // task_masters.rolling_anchor column itself is UNTOUCHED — 220000 never
    // added that column, only the view projection of it.
    var infoAfter220Down = await db('task_masters').columnInfo();
    expect(infoAfter220Down.rolling_anchor).toBeDefined();

    // --- down 210000 next: strips next_occurrence_anchor from views + drops column ---
    await expect(migration1.down(db)).resolves.not.toThrow();

    expect(await viewSelectable('tasks_v')).toBe(true);
    expect(await viewSelectable('tasks_with_sync_v')).toBe(true);
    expect(await selectThrows('SELECT next_occurrence_anchor FROM tasks_v LIMIT 0')).toBe(true);
    expect(await selectThrows('SELECT next_occurrence_anchor FROM tasks_with_sync_v LIMIT 0')).toBe(true);

    var infoAfter210Down = await db('task_masters').columnInfo();
    expect(infoAfter210Down.next_occurrence_anchor).toBeUndefined();
    // rolling_anchor's underlying column is STILL present (only 220000's view
    // projection was ever reverted; 210000 never touches rolling_anchor at all).
    expect(infoAfter210Down.rolling_anchor).toBeDefined();
  });

  test('3. re-up (210000 then 220000): both anchors restored, both views queryable, and a real row round-trips both values', async function() {
    await expect(migration1.up(db)).resolves.not.toThrow();
    await expect(migration2.up(db)).resolves.not.toThrow();

    var info = await db('task_masters').columnInfo();
    expect(info.next_occurrence_anchor).toBeDefined();
    expect(info.next_occurrence_anchor.type).toBe('date');
    expect(info.next_occurrence_anchor.nullable).toBe(true);

    expect(await viewSelectable('tasks_v')).toBe(true);
    expect(await viewSelectable('tasks_with_sync_v')).toBe(true);
    expect(await selectThrows('SELECT next_occurrence_anchor FROM tasks_v LIMIT 0')).toBe(false);
    expect(await selectThrows('SELECT rolling_anchor FROM tasks_v LIMIT 0')).toBe(false);
    expect(await selectThrows('SELECT next_occurrence_anchor FROM tasks_with_sync_v LIMIT 0')).toBe(false);
    expect(await selectThrows('SELECT rolling_anchor FROM tasks_with_sync_v LIMIT 0')).toBe(false);

    // Real-data round-trip, not just LIMIT 0 shape: proves the re-injected
    // column reads back correctly through BOTH views after the full
    // down->down->up->up cycle (would catch a duplicate-column-name view or a
    // mis-anchored inject that LIMIT 0 alone could miss under some MySQL
    // optimizer paths).
    await db('task_masters').where('user_id', TEST_USER_ID).del();
    await db('users').where('id', TEST_USER_ID).del();
    await db('users').insert({
      id: TEST_USER_ID,
      email: 'telly-anchor-migration-roundtrip@test.invalid',
      name: 'Telly anchor migration round-trip test',
      timezone: 'America/New_York',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    var masterId = uuidv7();
    await db('task_masters').insert({
      id: masterId,
      user_id: TEST_USER_ID,
      text: 'migration round-trip test master',
      recurring: 1,
      recur: JSON.stringify({ type: 'weekly', days: 'W' }),
      recur_start: '2026-01-01',
      rolling_anchor: '2026-08-01',
      next_occurrence_anchor: '2026-08-08',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    var viewRow = await db('tasks_v')
      .where('id', masterId)
      .select('rolling_anchor', 'next_occurrence_anchor')
      .first();
    expect(viewRow).toBeTruthy();
    expect(String(viewRow.rolling_anchor)).toMatch(/2026-08-01/);
    expect(String(viewRow.next_occurrence_anchor)).toMatch(/2026-08-08/);

    var syncRow = await db('tasks_with_sync_v')
      .where('id', masterId)
      .select('rolling_anchor', 'next_occurrence_anchor')
      .first();
    expect(syncRow).toBeTruthy();
    expect(String(syncRow.rolling_anchor)).toMatch(/2026-08-01/);
    expect(String(syncRow.next_occurrence_anchor)).toMatch(/2026-08-08/);

    await db('task_masters').where('user_id', TEST_USER_ID).del();
    await db('users').where('id', TEST_USER_ID).del();
  });
});
