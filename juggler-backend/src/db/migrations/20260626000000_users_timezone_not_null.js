'use strict';

/**
 * Make users.timezone NOT NULL (999.892-tz-notnull).
 *
 * Pre-condition: the column exists and carries DEFAULT 'America/New_York'
 * (established by the initial schema migration). Any existing NULL rows are
 * backfilled before the NOT NULL constraint is applied.
 *
 * Why knex.raw (not knex.schema.alterTable + .alter()):
 *   knex's .alter() silently drops the collation and may change other column
 *   attributes; ALTER TABLE … MODIFY is the only safe way to set NOT NULL
 *   while preserving the utf8mb4_unicode_ci collation convention
 *   (project rule: always set COLLATE utf8mb4_unicode_ci explicitly).
 *
 * down() reverts the column to nullable, preserving the DEFAULT + collation.
 * It does NOT drop the column — rollback only loosens the constraint.
 */

exports.up = async function up(knex) {
  // 1. Backfill any existing NULL rows before adding the NOT NULL constraint.
  await knex('users').whereNull('timezone').update({ timezone: 'America/New_York' });

  // 2. Alter column to NOT NULL, preserving DEFAULT + collation.
  await knex.raw(
    "ALTER TABLE users MODIFY timezone VARCHAR(100) NOT NULL DEFAULT 'America/New_York' COLLATE utf8mb4_unicode_ci"
  );
};

exports.down = async function down(knex) {
  // Revert to nullable; keep DEFAULT + collation intact.
  await knex.raw(
    "ALTER TABLE users MODIFY timezone VARCHAR(100) NULL DEFAULT 'America/New_York' COLLATE utf8mb4_unicode_ci"
  );
};
