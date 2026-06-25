'use strict';
/**
 * Migration integration test — 20260621000000_add_implied_deadline_to_task_instances (W2, R50.7)
 *
 * Verifies up/down/re-up against test-bed MySQL (3407, juggler_test).
 * Requires test-bed running; skipped with TEST-FR-001 if DB is not reachable.
 *
 * Assertions:
 *   up:   implied_deadline column exists, is nullable DATE, tasks_v exposes it
 *   down: this migration's down() drops the column + restores prior view shape
 *   re-up: column restored after re-apply (round-trip clean)
 *
 * Exercises THIS migration's own down()/up() directly rather than
 * db.migrate.rollback(). knex's rollback reverses only the LAST applied BATCH,
 * and once later migrations exist (they do — 20260622+, 20260624*), the
 * implied_deadline migration is no longer in the last batch, so a batch
 * rollback would leave its column in place (the round-trip would be a no-op for
 * this column). Driving the migration module directly is order-independent and
 * tests the actual reversibility contract of this migration.
 */

const { assertDbAvailable } = require('../helpers/requireDB');
const migration = require('../../src/db/migrations/20260621000000_add_implied_deadline_to_task_instances');

describe('migration 20260621000000 — implied_deadline column (W2 R50.7)', function() {
  var db;

  beforeAll(async function() {
    await assertDbAvailable();
    db = require('../../src/db');
    // Ensure ALL pending migrations are applied (idempotent)
    await db.migrate.latest();
  });

  afterAll(async function() {
    // Ensure the migration's schema is restored even if a test rolled it back
    await migration.up(db).catch(function() {});
    if (db) await db.destroy();
  });

  it('up: task_instances.implied_deadline column exists and is nullable DATE', async function() {
    var info = await db('task_instances').columnInfo();
    expect(info.implied_deadline).toBeDefined();
    expect(info.implied_deadline.type).toBe('date');
    expect(info.implied_deadline.nullable).toBe(true);
  });

  it('up: tasks_v exposes implied_deadline column', async function() {
    // SELECT will throw if the column is absent — that IS the assertion
    var result = await db.raw('SELECT implied_deadline FROM tasks_v LIMIT 0');
    expect(result).toBeDefined();
  });

  it('down + re-up: down() drops column; re-apply restores it', async function() {
    // Run THIS migration's own down() (order-independent — does not depend on
    // implied_deadline being in knex's last applied batch).
    await migration.down(db);

    // Post-down: column must be gone
    var infoAfterDown = await db('task_instances').columnInfo();
    expect(infoAfterDown.implied_deadline).toBeUndefined();

    // Post-down: tasks_v must NOT expose implied_deadline
    var viewThrew = false;
    try { await db.raw('SELECT implied_deadline FROM tasks_v LIMIT 0'); }
    catch (_e) { viewThrew = true; }
    expect(viewThrew).toBe(true);

    // Re-apply (up again)
    await migration.up(db);

    // Post-re-up: column must be restored
    var infoAfterReUp = await db('task_instances').columnInfo();
    expect(infoAfterReUp.implied_deadline).toBeDefined();
    expect(infoAfterReUp.implied_deadline.type).toBe('date');
    expect(infoAfterReUp.implied_deadline.nullable).toBe(true);

    // Post-re-up: tasks_v must expose implied_deadline again
    var resultReUp = await db.raw('SELECT implied_deadline FROM tasks_v LIMIT 0');
    expect(resultReUp).toBeDefined();
  });
});
