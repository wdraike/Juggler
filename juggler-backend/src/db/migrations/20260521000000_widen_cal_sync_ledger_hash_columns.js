/**
 * Widen cal_sync_ledger hash columns from VARCHAR(32) to VARCHAR(64).
 *
 * The gcal/msft/apple adapters write SHA-256 hex digests (64 chars).
 * cal-sync-helpers.js writes MD5 digests (32 chars) for taskHash/userHash.
 * The wider column accommodates both without truncation.
 *
 * MySQL 8 executes VARCHAR 32→64 as ALGORITHM=INSTANT (no table rebuild, no lock).
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('cal_sync_ledger', function(table) {
    table.string('last_pushed_hash', 64).collate('utf8mb4_unicode_ci').nullable().alter();
    table.string('last_pulled_hash', 64).collate('utf8mb4_unicode_ci').nullable().alter();
    table.string('last_user_hash', 64).collate('utf8mb4_unicode_ci').nullable().alter();
  });
};

/**
 * Narrowing VARCHAR(64) back to VARCHAR(32) would silently truncate SHA-256 hashes
 * written after the up migration, corrupting change-detection on rollback.
 * This migration is intentionally irreversible — a no-op down is safe.
 */
exports.down = async function(_knex) {
  // Intentional no-op: narrowing would silently truncate existing 64-char hashes.
};
