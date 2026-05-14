/**
 * Phase 07 Plan 03 — FIX-03: OAuth callback dedup (multi-instance safe).
 *
 * Creates `oauth_code_nonces` table to replace the in-memory `usedCodes` Set
 * in msft-cal.controller.js. Storing a SHA-256 hash of the truncated code
 * (40-char prefix) allows atomic cross-instance dedup via INSERT IGNORE on
 * the PRIMARY KEY.
 *
 * Schema:
 *   code_hash  CHAR(64)  — SHA-256 hex digest of the 40-char code prefix
 *   expires_at DATETIME  — NOW() + 2 minutes; indexed for efficient sweep
 *
 * Security notes (RESEARCH.md Category 4g + Pitfall 5):
 *   - Raw OAuth codes are never stored — only the irreversible SHA-256 hash.
 *   - INSERT IGNORE is the canonical MySQL "claim this nonce or fail silently"
 *     idiom. affectedRows === 0 means the code was already seen on another
 *     instance (or earlier on this instance) within the 2-minute TTL window.
 *   - expires_at index keeps the best-effort sweep (DELETE WHERE expires_at < NOW())
 *     lightweight even as the table grows.
 *
 * Collation: utf8mb4_unicode_ci per CLAUDE.md (avoids utf8mb4_0900_ai_ci drift).
 */

exports.up = async function(knex) {
  await knex.schema.createTable('oauth_code_nonces', function(table) {
    table.specificType('code_hash', 'CHAR(64) NOT NULL')
      .comment('SHA-256 hex digest of the 40-char OAuth code prefix — never the raw code');
    table.dateTime('expires_at').notNullable()
      .comment('Row expires after 2 minutes — matching the OAuth code lifetime + retry window');

    table.primary(['code_hash']);
    table.index(['expires_at'], 'idx_oauth_code_nonces_expires_at');
  });

  // Apply explicit COLLATE utf8mb4_unicode_ci per CLAUDE.md (MySQL 8 defaults
  // to utf8mb4_0900_ai_ci which silently breaks joins against older tables).
  await knex.raw(
    'ALTER TABLE oauth_code_nonces CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  await knex.raw(
    'ALTER TABLE oauth_code_nonces ' +
    'MODIFY code_hash CHAR(64) NOT NULL COLLATE utf8mb4_unicode_ci ' +
    "COMMENT 'SHA-256 hex digest of the 40-char OAuth code prefix — never the raw code'"
  );
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('oauth_code_nonces');
};
