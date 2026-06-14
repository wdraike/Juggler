'use strict';

/**
 * Fix collation mismatch on knex internal tracking tables (ROADMAP 999.242).
 *
 * Root cause: knex_migrations and knex_migrations_lock are created by knex at
 * first migrate run without an explicit charset/collate. MySQL 8 defaults both
 * to utf8mb4_0900_ai_ci, while every app table uses utf8mb4_unicode_ci (see
 * CLAUDE.md §Collation). The mismatch silently breaks any JOIN across these
 * tables and causes "Illegal mix of collations" errors under stricter modes.
 *
 * Fix: CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci converts
 * the table definition and every column in one atomic DDL step.
 *
 * Concurrency note: knex_migrations_lock is knex's migration mutex — it holds
 * one row during this migrate run. The ALTER is a metadata/table-rebuild on a
 * 1-row uncontended table and completes within the same migrate run without
 * causing a self-deadlock. Do NOT wrap in an explicit transaction; knex's own
 * lock handling manages concurrency here.
 */
// DDL (ALTER … CONVERT TO) forces MySQL implicit commits — knex's per-migration
// transaction wrapper cannot make them atomic. Declare non-transactional explicitly
// so knex does not wrap these statements in a (misleading) transaction.
exports.config = { transaction: false };

exports.up = async function(knex) {
  await knex.raw(
    'ALTER TABLE `knex_migrations` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  await knex.raw(
    'ALTER TABLE `knex_migrations_lock` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
};

exports.down = async function(knex) {
  // Revert to MySQL 8 default collation (the prior state before this migration).
  await knex.raw(
    'ALTER TABLE `knex_migrations` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'
  );
  await knex.raw(
    'ALTER TABLE `knex_migrations_lock` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'
  );
};
