/**
 * FIX-04: Add DB-based claiming columns to schedule_queue.
 *
 * Adds:
 *   - claimed_by VARCHAR(64) NULL COLLATE utf8mb4_unicode_ci
 *       Stores the INSTANCE_ID (K_REVISION / HOSTNAME / random hex) of the
 *       instance currently processing this user's queue entry. NULL = unclaimed.
 *   - claimed_at DATETIME NULL
 *       When the claim was taken. Used for TTL expiry: an instance that crashed
 *       mid-run leaves a stale claimed_at; after CLAIM_TTL_SECONDS another
 *       instance can reclaim (see scheduleQueue.js tryClaim).
 *   - idx_claimed_at (claimed_at) — keeps the TTL sweep query cheap at scale.
 *
 * Migration is additive (all nullable, no backfill needed).
 * Rollback cleanly drops the columns + index.
 *
 * CLAUDE.md: COLLATE utf8mb4_unicode_ci required for all VARCHAR columns.
 */

exports.up = async function(knex) {
  // Use raw SQL for COLLATE — Knex's .collate() helper is not present in all
  // versions, and consistency with other migrations in this directory prefers
  // db.raw() for DDL that needs explicit collation control.
  await knex.raw(
    'ALTER TABLE schedule_queue ' +
    'ADD COLUMN claimed_by VARCHAR(64) NULL COLLATE utf8mb4_unicode_ci, ' +
    'ADD COLUMN claimed_at DATETIME NULL, ' +
    'ADD INDEX idx_claimed_at (claimed_at)'
  );
};

exports.down = async function(knex) {
  await knex.raw('ALTER TABLE schedule_queue DROP INDEX idx_claimed_at').catch(function() {});
  await knex.raw('ALTER TABLE schedule_queue DROP COLUMN claimed_at').catch(function() {});
  await knex.raw('ALTER TABLE schedule_queue DROP COLUMN claimed_by').catch(function() {});
};
