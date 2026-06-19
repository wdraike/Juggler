'use strict';

/**
 * Fix collation drift on action_log (999.293 triage finding A1).
 *
 * Root cause: action_log was created 2026-06-18 by 20260618000000_create_action_log.js
 * without an explicit charset/collate directive. MySQL 8 defaults to
 * utf8mb4_0900_ai_ci, which silently breaks joins against the utf8mb4_unicode_ci
 * tables that action_log.user_id (→ users.id) and action_log.task_id (→ task tables)
 * reference. This is the exact JOIN-break pattern the project's CLAUDE.md collation
 * rule guards against and that 20260515000100 remediated for the earlier tables.
 *
 * Fix: CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci (idempotent and
 * safe to re-run), plus an explicit per-column MODIFY on the join columns so the
 * collation is pinned even if CONVERT is ever partially applied.
 */
exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('action_log');
  if (!exists) return;

  // Disable FK checks so cross-table collation mismatches don't block the
  // conversion mid-flight (mirrors 20260515000100).
  await knex.raw('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await knex.raw(
      'ALTER TABLE `action_log` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    // Explicitly pin the join columns' collation (defensive; CONVERT already
    // sets these, but a MODIFY makes the intent unambiguous and idempotent).
    await knex.raw(
      'ALTER TABLE `action_log` ' +
        'MODIFY `user_id` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL, ' +
        'MODIFY `task_id` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL'
    );
  } finally {
    await knex.raw('SET FOREIGN_KEY_CHECKS = 1');
  }
};

exports.down = async function (_knex) {
  // No-op: converting back to utf8mb4_0900_ai_ci would re-introduce the drift
  // and is not a safe/meaningful rollback (mirrors 20260515000100).
};
