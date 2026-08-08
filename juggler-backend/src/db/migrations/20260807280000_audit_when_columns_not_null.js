/**
 * 999.4920 — make juggler's created_at/updated_at NOT NULL.
 *
 * David's ruling 2026-08-07: full standard. Column POSITION excluded — cosmetic,
 * and it would rebuild every table for no functional gain.
 *
 * juggler was already the furthest along, because 999.1576 built this standard
 * here first. Measured on the migrated schema, only ONE gap remained:
 *
 *   * presence of all four audit columns — DONE (999.1576 increment 1, and its
 *     contract test has enforced it since).
 *   * who-columns NOT NULL — DONE (999.1576 increment 4, strict who-attribution).
 *     juggler is the only service where that flip is safe today; auth, payment
 *     and RO are still staged behind 999.5313/5314/5316 because their write
 *     paths do not universally supply attribution.
 *   * ON UPDATE CURRENT_TIMESTAMP — ALREADY CORRECT, and deliberately not
 *     touched. The nine tables without it are exactly the APP_MANAGED_UPDATED_AT
 *     allowlist in tests/migrations/audit-columns-contract.test.js: cal-sync
 *     dirty-detection reads updated_at (KnexSyncStateRepository
 *     `.where('updated_at','>',since)`) and the task repos force-stamp it, so a
 *     DB-side auto-bump on internal writes would corrupt modified-since
 *     semantics. This migration adds ON UPDATE to nothing and strips it from
 *     nothing.
 *   * when-columns NOT NULL — the gap this closes: 38 columns across 20 base
 *     tables. A NULL created_at is a row with no provenance.
 *
 * VIEWS ARE UNTOUCHED. tasks_v and tasks_with_sync_v show up in a naive
 * information_schema sweep for nullable created_at/updated_at, but they are
 * VIEWS — their nullability is derived from the underlying tables, so fixing the
 * base tables is what fixes them. Restricting to TABLE_TYPE='BASE TABLE' also
 * keeps this away from the frozen view column lists (999.1189).
 *
 * A pre-flight refuses rather than forcing NOT NULL over data it cannot fill:
 * an existing NULL created_at has no honest value, and inventing one would
 * fabricate the provenance this ticket exists to establish.
 *
 * `down` is a deliberate no-op — re-widening to NULL restores a state where a
 * row can have no provenance, and a rollback aimed at another migration in the
 * same batch must never do that.
 */

'use strict';

const WHEN_COLS = ['created_at', 'updated_at'];

exports.up = async function up(knex) {
  const [rows] = await knex.raw(
    `SELECT c.TABLE_NAME, c.COLUMN_NAME, c.COLUMN_TYPE, c.COLUMN_DEFAULT, c.EXTRA
       FROM information_schema.COLUMNS c
       JOIN information_schema.TABLES t
         ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
      WHERE c.TABLE_SCHEMA = DATABASE()
        AND t.TABLE_TYPE = 'BASE TABLE'
        AND c.TABLE_NAME NOT LIKE 'knex\\_%'
        AND c.COLUMN_NAME IN (?, ?)
        AND c.IS_NULLABLE = 'YES'
      ORDER BY c.TABLE_NAME, c.COLUMN_NAME`,
    WHEN_COLS
  );

  for (const col of rows) {
    const { TABLE_NAME: table, COLUMN_NAME: column, COLUMN_TYPE: type } = col;

    const [nulls] = await knex.raw(
      'SELECT COUNT(*) AS n FROM ?? WHERE ?? IS NULL',
      [table, column]
    );
    const remaining = nulls && nulls[0] ? Number(nulls[0].n) : 0;
    if (remaining > 0) {
      throw new Error(
        `999.4920: ${table}.${column} holds ${remaining} NULL(s). Refusing to force NOT NULL `
        + 'over rows whose true time is unknown — inventing one would fabricate the provenance '
        + 'this establishes. Backfill deliberately from an honest source first.'
      );
    }

    // Preserve the column's existing DEFAULT and EXTRA verbatim. EXTRA carries
    // the ON UPDATE clause on the tables that legitimately have one, and the
    // app-managed allowlist depends on it NOT being added to the tables that do
    // not — so it is copied through, never synthesised.
    const def = col.COLUMN_DEFAULT === null
      ? 'DEFAULT CURRENT_TIMESTAMP'
      : `DEFAULT ${col.COLUMN_DEFAULT === 'CURRENT_TIMESTAMP' ? 'CURRENT_TIMESTAMP' : knex.raw('?', [col.COLUMN_DEFAULT]).toString()}`;
    const extra = /on update/i.test(col.EXTRA || '') ? ' ON UPDATE CURRENT_TIMESTAMP' : '';

    await knex.raw(`ALTER TABLE ?? MODIFY ?? ${type} NOT NULL ${def}${extra}`, [table, column]);
  }

  // Verify rather than assume.
  const [left] = await knex.raw(
    `SELECT c.TABLE_NAME, c.COLUMN_NAME
       FROM information_schema.COLUMNS c
       JOIN information_schema.TABLES t
         ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
      WHERE c.TABLE_SCHEMA = DATABASE()
        AND t.TABLE_TYPE = 'BASE TABLE'
        AND c.TABLE_NAME NOT LIKE 'knex\\_%'
        AND c.COLUMN_NAME IN (?, ?)
        AND c.IS_NULLABLE = 'YES'`,
    WHEN_COLS
  );
  if (left.length) {
    throw new Error(
      `999.4920: still nullable after the pass: ${left.map((r) => `${r.TABLE_NAME}.${r.COLUMN_NAME}`).join(', ')}`
    );
  }
};

exports.down = async function down() {};
