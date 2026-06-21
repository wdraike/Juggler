'use strict';
/**
 * Migration integration test — 20260621000000_add_implied_deadline_to_task_instances (W2, R50.7)
 *
 * Verifies up/down/re-up against test-bed MySQL (3407, juggler_test).
 * Requires test-bed running; skipped with TEST-FR-001 if DB is not reachable.
 *
 * Assertions:
 *   up:   implied_deadline column exists, is nullable DATE, tasks_v exposes it
 *   down: single-batch rollback drops the column + restores prior view shape
 *   re-up: column restored after re-apply (round-trip clean)
 *
 * Uses single-batch rollback (not full-reset) to isolate only this migration.
 */

const { assertDbAvailable } = require('../helpers/requireDB');

describe('migration 20260621000000 — implied_deadline column (W2 R50.7)', function() {
  var db;

  beforeAll(async function() {
    await assertDbAvailable();
    db = require('../../src/db');
    // Ensure ALL pending migrations are applied (idempotent)
    await db.migrate.latest();
  });

  afterAll(async function() {
    // Ensure the migration is re-applied even if a test rolled it back
    await db.migrate.latest().catch(function() {});
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

  it('down + re-up: single-batch rollback drops column; re-apply restores it', async function() {
    // Roll back ONE batch (the implied_deadline migration)
    await db.migrate.rollback();

    // Post-rollback: column must be gone
    var infoAfterDown = await db('task_instances').columnInfo();
    expect(infoAfterDown.implied_deadline).toBeUndefined();

    // Post-rollback: tasks_v must NOT expose implied_deadline
    var viewThrew = false;
    try { await db.raw('SELECT implied_deadline FROM tasks_v LIMIT 0'); }
    catch (_e) { viewThrew = true; }
    expect(viewThrew).toBe(true);

    // Re-apply (up again)
    await db.migrate.latest();

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
