/**
 * 20260630120000_add_task_instances_missed_scan_index.test.js
 *
 * jug956 / 999.956 — covering index for the cal-history cron's markMissedTasks
 * scan: idx_task_instances_missed_scan (overdue, scheduled_at).
 *
 * Verifies migration 20260630120000_add_task_instances_missed_scan_index.js:
 *   (A1) the index exists on `task_instances` with LEADING column `overdue`
 *        then `scheduled_at` (in that order) after migrate:latest applies it.
 *   (A2) down() drops the index cleanly (does not throw, index gone after).
 *   (A3) up() recreates it after a down() — the migration is reversible.
 *   (A4) up() is idempotent — re-running on a DB that ALREADY has the index
 *        does not throw and does not duplicate the index entry.
 *
 * Calls migration.up(db) / migration.down(db) directly against the shared
 * juggler_test connection (the lightweight pattern already used by
 * tests/migrations/20260509000100.test.js / 20260627000000_*.test.js) — this
 * migration is pure index DDL (idempotent, guarded by an information_schema
 * existence check), so round-tripping it on the shared schema carries no data
 * risk to sibling suites. An afterAll restores the index to the migrated
 * (present) state so the schema is left exactly as migrate:latest left it for
 * whichever suite runs next.
 *
 * ORDER-DEPENDENT BY DESIGN: A1 -> A2 -> A3 -> A4 narrate one up/down/up/up
 * round-trip against shared DDL state, same as the established migration
 * round-trip pattern in this test tree (e.g. 20260624170000's A1-A4). Not a
 * candidate for --randomize order-independence — DDL round-trip tests are the
 * documented exemption (BASE-TESTING §5 targets test-DATA interdependence,
 * not an intentionally sequenced infra round-trip).
 *
 * Run (test-bed/ephemeral pool, see test-bed/scripts/run-suite.sh):
 *   cd test-bed && make test-juggler-pool
 */

'use strict';

jest.setTimeout(30000);

var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.test') });

var db = require('../../src/db');
var { assertDbAvailable } = require('../helpers/requireDB');
var migration = require('../../src/db/migrations/20260630120000_add_task_instances_missed_scan_index');

var INDEX_NAME = 'idx_task_instances_missed_scan';
var TABLE_NAME = 'task_instances';

async function getIndexColumnsInOrder() {
  var rows = await db.raw(
    `SELECT COLUMN_NAME
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?
      ORDER BY seq_in_index`,
    [TABLE_NAME, INDEX_NAME]
  );
  return rows[0].map(function (r) { return r.COLUMN_NAME; });
}

beforeAll(async () => {
  await assertDbAvailable();
});

afterAll(async () => {
  // Leave the schema exactly as migrate:latest left it (index present) for
  // whichever suite runs next, regardless of which test in this file ran last.
  var cols = await getIndexColumnsInOrder();
  if (cols.length === 0) {
    await migration.up(db);
  }
  await db.destroy();
});

describe('Migration 20260630120000_add_task_instances_missed_scan_index (999.956)', () => {
  test('A1: idx_task_instances_missed_scan exists after migrate:latest, leading (overdue, scheduled_at)', async () => {
    var cols = await getIndexColumnsInOrder();
    expect(cols).toEqual(['overdue', 'scheduled_at']);
  });

  test('A2: down() drops the index cleanly', async () => {
    await expect(migration.down(db)).resolves.not.toThrow();
    var cols = await getIndexColumnsInOrder();
    expect(cols).toEqual([]);
  });

  test('A3: up() recreates the index after down() — reversible', async () => {
    // Precondition from A2: index is currently absent.
    expect(await getIndexColumnsInOrder()).toEqual([]);

    await expect(migration.up(db)).resolves.not.toThrow();

    var cols = await getIndexColumnsInOrder();
    expect(cols).toEqual(['overdue', 'scheduled_at']);
  });

  test('A4: up() is idempotent on a DB that already has the index — no throw, no duplicate', async () => {
    // Precondition from A3: index is currently present.
    expect(await getIndexColumnsInOrder()).toEqual(['overdue', 'scheduled_at']);

    await expect(migration.up(db)).resolves.not.toThrow();

    // Still exactly one index definition with exactly 2 key-part rows
    // (seq_in_index 1 and 2) — re-running up() must not register a second
    // CREATE INDEX / duplicate key-part entries.
    var rows = await db.raw(
      `SELECT seq_in_index
         FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND index_name = ?
        ORDER BY seq_in_index`,
      [TABLE_NAME, INDEX_NAME]
    );
    // information_schema columns come back upper-cased (mirrors COLUMN_NAME usage
    // in getIndexColumnsInOrder() above) — SEQ_IN_INDEX, not seq_in_index.
    expect(rows[0].map(function (r) { return r.SEQ_IN_INDEX; })).toEqual([1, 2]);
    expect(await getIndexColumnsInOrder()).toEqual(['overdue', 'scheduled_at']);
  });

  test('A5: down() is idempotent — calling it twice does not throw on the second (already-absent) call', async () => {
    // Precondition from A4: index is present. Drop once, then again.
    await expect(migration.down(db)).resolves.not.toThrow();
    expect(await getIndexColumnsInOrder()).toEqual([]);

    await expect(migration.down(db)).resolves.not.toThrow();
    expect(await getIndexColumnsInOrder()).toEqual([]);

    // Restore for the afterAll's own re-check / any suite that runs after this
    // file expecting the migrated (present) state.
    await migration.up(db);
    expect(await getIndexColumnsInOrder()).toEqual(['overdue', 'scheduled_at']);
  });
});
