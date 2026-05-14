'use strict';

/**
 * Fix unsafe ON DELETE CASCADE on sync_history.user_id.
 *
 * Problem: sync_history is an append-only audit log (see SCHEMA.md — "lets you
 * answer: what did the sync do on Tuesday at 3pm?"). The original FK created in
 * 20260412000000_create_sync_history.js used ON DELETE CASCADE, which means
 * deleting a user account silently wipes their entire sync audit trail. This is
 * destructive beyond the intended scope — audit records should survive account
 * deletion for operational debuggability.
 *
 * Fix: change to ON DELETE SET NULL so that sync history rows are preserved when
 * a user is deleted; user_id becomes NULL (disassociated) rather than the row
 * disappearing. This matches the same pattern applied to impersonation_log in
 * 20260515000200_add_missing_fk_constraints.js.
 *
 * Steps:
 *   1. Drop the existing FK (cascade).
 *   2. Make user_id nullable (required for SET NULL to work).
 *   3. Recreate FK with ON DELETE SET NULL.
 *
 * Rollback restores ON DELETE CASCADE (and drops nullable, purging any NULL rows
 * that may have accumulated — acceptable because the down migration is a
 * last-resort operation, not a production path).
 */

exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('sync_history');
  if (!exists) return;

  await knex.raw('SET FOREIGN_KEY_CHECKS = 0');
  try {
    // 1. Drop the existing CASCADE FK.
    //    Knex generates the name as: sync_history_user_id_foreign
    await knex.schema.alterTable('sync_history', function(t) {
      t.dropForeign('user_id');
    });

    // 2. Make user_id nullable so SET NULL can fire.
    await knex.raw(
      'ALTER TABLE `sync_history` ' +
      'MODIFY COLUMN `user_id` VARCHAR(36) NULL COLLATE utf8mb4_unicode_ci'
    );

    // 3. Recreate with SET NULL — rows survive, user_id becomes null on deletion.
    await knex.schema.alterTable('sync_history', function(t) {
      t.foreign('user_id').references('id').inTable('users').onDelete('SET NULL');
    });
  } finally {
    await knex.raw('SET FOREIGN_KEY_CHECKS = 1');
  }
};

exports.down = async function(knex) {
  const exists = await knex.schema.hasTable('sync_history');
  if (!exists) return;

  await knex.raw('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await knex.schema.alterTable('sync_history', function(t) {
      t.dropForeign('user_id');
    });

    // Purge any rows whose user_id was NULL'd by a deletion — these would
    // violate NOT NULL on restoration.
    await knex('sync_history').whereNull('user_id').del();

    await knex.raw(
      'ALTER TABLE `sync_history` ' +
      'MODIFY COLUMN `user_id` VARCHAR(36) NOT NULL COLLATE utf8mb4_unicode_ci'
    );

    // Restore original CASCADE FK.
    await knex.schema.alterTable('sync_history', function(t) {
      t.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
    });
  } finally {
    await knex.raw('SET FOREIGN_KEY_CHECKS = 1');
  }
};
