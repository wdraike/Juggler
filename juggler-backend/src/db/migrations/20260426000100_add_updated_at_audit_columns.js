/**
 * Add missing `updated_at` audit columns.
 *
 * Three tables are mutated after insert but only track `created_at`:
 *   - cal_sync_ledger  (sync state is updated on every sync run)
 *   - locations        (usage: delete-all + insert-all per save, but a future
 *                       incremental-update path shouldn't need a migration)
 *   - tools            (same pattern as locations)
 *
 * We use MySQL's native ON UPDATE CURRENT_TIMESTAMP so existing write paths
 * that don't explicitly set updated_at still get correct timestamps without
 * any code changes.
 *
 * Explicit COLLATE is not needed here — the columns are timestamps, not
 * strings — but this migration is part of the Bucket 2 hardening wave and
 * follows the convention (see Plan Transition Policy / MySQL 8 collation
 * memory): new/altered *string* columns elsewhere in this wave set
 * COLLATE utf8mb4_unicode_ci explicitly.
 *
 * Append-only tables (feature_events, sync_history) and ephemeral queues
 * (schedule_queue, task_write_queue, sync_locks) intentionally omit
 * updated_at — their rows are never mutated after insert.
 */
exports.up = async function(knex) {
  // cal_sync_ledger: mutations happen in cal-sync.controller.js
  await knex.raw(`
    ALTER TABLE cal_sync_ledger
    ADD COLUMN updated_at TIMESTAMP NOT NULL
      DEFAULT CURRENT_TIMESTAMP
      ON UPDATE CURRENT_TIMESTAMP
      AFTER created_at
  `);

  // locations: re-created per save today, but mutable in principle
  await knex.raw(`
    ALTER TABLE locations
    ADD COLUMN updated_at TIMESTAMP NOT NULL
      DEFAULT CURRENT_TIMESTAMP
      ON UPDATE CURRENT_TIMESTAMP
      AFTER created_at
  `);

  // tools: same pattern as locations
  await knex.raw(`
    ALTER TABLE tools
    ADD COLUMN updated_at TIMESTAMP NOT NULL
      DEFAULT CURRENT_TIMESTAMP
      ON UPDATE CURRENT_TIMESTAMP
      AFTER created_at
  `);
};

exports.down = async function(knex) {
  await knex.schema.alterTable('cal_sync_ledger', function(table) {
    table.dropColumn('updated_at');
  });
  await knex.schema.alterTable('locations', function(table) {
    table.dropColumn('updated_at');
  });
  await knex.schema.alterTable('tools', function(table) {
    table.dropColumn('updated_at');
  });
};
