/**
 * Create cron_locks — a dedicated named-lock table for cron/background-job
 * leader election (jug-elected-sweeper-topology / 999.555).
 *
 * WHY a new table: the cal-history cron previously tried to leader-elect against
 * `sync_locks`, but `sync_locks` is the PER-USER calendar-sync lock — keyed by
 * `user_id` (PRIMARY KEY) with an FK to `users.id` (mig 20260515000200), and is
 * actively used by lib/sync-lock.js / task-write-queue.js. It cannot hold a
 * synthetic named cron lock (no matching user row → FK violation), and it has no
 * `name`/`lock_name` column. A separate `cron_locks` table keyed by `lock_name`
 * gives the cron an atomic INSERT … ON DUPLICATE KEY UPDATE election primitive
 * without touching the per-user lock surface.
 */
'use strict';

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('cron_locks');
  if (!exists) {
    await knex.raw(`
      CREATE TABLE cron_locks (
        lock_name  VARCHAR(100) NOT NULL COLLATE utf8mb4_unicode_ci,
        locked_by  VARCHAR(100) NOT NULL COLLATE utf8mb4_unicode_ci,
        locked_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP    NOT NULL,
        PRIMARY KEY (lock_name),
        INDEX idx_cron_locks_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('cron_locks');
};
