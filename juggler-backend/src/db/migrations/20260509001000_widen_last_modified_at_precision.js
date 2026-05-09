/**
 * Widen cal_sync_ledger.last_modified_at from TIMESTAMP (second precision)
 * to TIMESTAMP(6) (microsecond precision).
 *
 * Background: MSFT Graph emits lastModifiedDateTime in microseconds
 * (e.g. "2026-05-09T16:34:05.123456Z"). The original TIMESTAMP column
 * truncated to seconds, so every subsequent sync compared the
 * microsecond event timestamp against the truncated stored value and
 * decided the event was newer — pulling it over and over even when
 * nothing had changed.
 *
 * GCal happens to emit millisecond-precision values whose ms portion is
 * always .000Z, so the truncation was lossless there. Apple's CalDAV
 * adapter doesn't surface LAST-MODIFIED at all — that's filed as a
 * separate todo (issue #6 in this session).
 *
 * Note: cal_sync_ledger.user_id (utf8mb4_0900_ai_ci) and users.id
 * (utf8mb4_unicode_ci) have a known collation drift. MySQL re-validates
 * all FK columns on ANY ALTER, so we toggle foreign_key_checks around
 * the ALTER to avoid spurious "incompatible" errors. The data integrity
 * of the user_id FK is unaffected.
 */
exports.up = async function(knex) {
  await knex.raw('SET FOREIGN_KEY_CHECKS=0');
  try {
    await knex.raw(
      "ALTER TABLE cal_sync_ledger MODIFY COLUMN last_modified_at TIMESTAMP(6) NULL DEFAULT NULL"
    );
  } finally {
    await knex.raw('SET FOREIGN_KEY_CHECKS=1');
  }
};

exports.down = async function(knex) {
  await knex.raw('SET FOREIGN_KEY_CHECKS=0');
  try {
    await knex.raw(
      "ALTER TABLE cal_sync_ledger MODIFY COLUMN last_modified_at TIMESTAMP NULL DEFAULT NULL"
    );
  } finally {
    await knex.raw('SET FOREIGN_KEY_CHECKS=1');
  }
};
