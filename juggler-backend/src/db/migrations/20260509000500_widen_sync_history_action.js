/**
 * Widen sync_history.action from varchar(20) to varchar(64).
 *
 * Background: commit 108fa1c (2026-05-08) introduced action
 * 'past_recurring_cleanup' (22 chars). The original column width of 20
 * caused MySQL "Data too long for column 'action'" on every bulk insert
 * that included a past-recurring cleanup row, rolling back the entire
 * sync transaction (sync_history + cal_sync_ledger writes both lost).
 *
 * Effect: cal-sync stuck since 2026-05-08 12:46Z for any user with past
 * recurring instances tracked in their ledger.
 *
 * Fix: widen to varchar(64) — comfortable headroom for current and future
 * descriptive action names, still indexable.
 *
 * Note: sync_history.user_id (utf8mb4_0900_ai_ci) and users.id
 * (utf8mb4_unicode_ci) have a known collation drift. MySQL re-validates
 * all FK columns on ANY ALTER, so we toggle foreign_key_checks around
 * the ALTER to avoid spurious "incompatible" errors. The data integrity
 * of the user_id FK is unaffected.
 */
exports.up = async function(knex) {
  await knex.raw('SET FOREIGN_KEY_CHECKS=0');
  try {
    await knex.raw(
      "ALTER TABLE sync_history MODIFY COLUMN action VARCHAR(64) NOT NULL"
    );
  } finally {
    await knex.raw('SET FOREIGN_KEY_CHECKS=1');
  }
};

exports.down = async function(knex) {
  await knex.raw('SET FOREIGN_KEY_CHECKS=0');
  try {
    await knex.raw(
      "ALTER TABLE sync_history MODIFY COLUMN action VARCHAR(20) NOT NULL"
    );
  } finally {
    await knex.raw('SET FOREIGN_KEY_CHECKS=1');
  }
};
