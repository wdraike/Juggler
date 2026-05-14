'use strict';

/**
 * Add missing foreign-key constraints for tables that declare referential
 * columns but have no FOREIGN KEY, allowing orphaned rows to accumulate silently.
 *
 * 7 constraint gaps addressed:
 *
 *  1. feature_events.user_id → users.id
 *     Analytics log — cascade delete is appropriate (no audit obligation).
 *
 *  2. plan_usage.user_id → users.id
 *     Usage counters — cascade delete is appropriate (tied to user billing).
 *
 *  3. sync_locks.user_id → users.id
 *     Lock rows are transient and user-scoped — cascade delete is safe.
 *     Note: user_id is the PRIMARY KEY of sync_locks, so there are no orphan
 *     rows in practice; the FK prevents stale lock rows surviving a user drop.
 *
 *  4. ai_command_log.user_id → users.id
 *     Quota tracking — cascade delete is appropriate (rate-limit counters).
 *     Note: ai_command_log.user_id is INT UNSIGNED, while users.id is VARCHAR(36).
 *     They are therefore incompatible for a real FK; the column is altered to
 *     VARCHAR(36) COLLATE utf8mb4_unicode_ci to match users.id before adding
 *     the constraint.
 *
 *  5. oauth_auth_codes.user_id → users.id
 *     OAuth codes are short-lived; cascade delete ensures no dangling codes
 *     survive account removal.
 *
 *  6. oauth_auth_codes.client_id → oauth_clients.client_id
 *     A code must reference a valid client — RESTRICT prevents orphan codes
 *     from pointing at deleted clients (client deletion must clear codes first).
 *
 *  7. impersonation_log.admin_user_id → users.id
 *     impersonation_log.target_user_id → users.id
 *     Audit log rows must survive user deletion — use SET NULL so history is
 *     retained even after the referenced account is removed.
 *     target_user_id is already nullable; admin_user_id is made nullable here.
 *
 * Pre-flight notes:
 *   - All FK pairs use the same data type after the ai_command_log alteration.
 *   - Collation for the tables was fixed by 20260515000100 which runs before
 *     this migration, ensuring no cross-collation FK rejection.
 *   - FK_CHECKS are disabled during the migration to allow the alterations to
 *     proceed even if residual orphan data exists. The FKs are re-enabled at
 *     the end; any newly inserted rows must satisfy the constraints going forward.
 */

exports.up = async function(knex) {
  await knex.raw('SET FOREIGN_KEY_CHECKS = 0');
  try {
    // ── 1. feature_events.user_id → users.id ──────────────────────────────
    const hasFeatureEvents = await knex.schema.hasTable('feature_events');
    if (hasFeatureEvents) {
      await knex.schema.alterTable('feature_events', function(t) {
        t.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
      });
    }

    // ── 2. plan_usage.user_id → users.id ──────────────────────────────────
    const hasPlanUsage = await knex.schema.hasTable('plan_usage');
    if (hasPlanUsage) {
      await knex.schema.alterTable('plan_usage', function(t) {
        t.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
      });
    }

    // ── 3. sync_locks.user_id → users.id ──────────────────────────────────
    const hasSyncLocks = await knex.schema.hasTable('sync_locks');
    if (hasSyncLocks) {
      await knex.schema.alterTable('sync_locks', function(t) {
        t.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
      });
    }

    // ── 4. ai_command_log.user_id → users.id ──────────────────────────────
    // The original column was INT UNSIGNED (incompatible with users.id VARCHAR(36)).
    // Alter the column type first, then add the FK.
    const hasAiCommandLog = await knex.schema.hasTable('ai_command_log');
    if (hasAiCommandLog) {
      await knex.raw(
        'ALTER TABLE `ai_command_log` ' +
        'MODIFY COLUMN `user_id` VARCHAR(36) NOT NULL COLLATE utf8mb4_unicode_ci'
      );
      await knex.schema.alterTable('ai_command_log', function(t) {
        t.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
      });
    }

    // ── 5 & 6. oauth_auth_codes FKs ───────────────────────────────────────
    const hasOauthCodes = await knex.schema.hasTable('oauth_auth_codes');
    if (hasOauthCodes) {
      await knex.schema.alterTable('oauth_auth_codes', function(t) {
        // user_id → users.id (cascade — codes die with the account)
        t.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
        // client_id → oauth_clients.client_id (restrict — must clear codes before removing client)
        t.foreign('client_id').references('client_id').inTable('oauth_clients').onDelete('RESTRICT');
      });
    }

    // ── 7. impersonation_log → users.id (SET NULL — preserve audit history) ─
    const hasImpersonationLog = await knex.schema.hasTable('impersonation_log');
    if (hasImpersonationLog) {
      // Make admin_user_id nullable so SET NULL can fire on user deletion
      await knex.raw(
        'ALTER TABLE `impersonation_log` ' +
        'MODIFY COLUMN `admin_user_id` VARCHAR(36) NULL COLLATE utf8mb4_unicode_ci'
      );
      await knex.schema.alterTable('impersonation_log', function(t) {
        t.foreign('admin_user_id').references('id').inTable('users').onDelete('SET NULL');
        // target_user_id was already nullable from creation
        t.foreign('target_user_id').references('id').inTable('users').onDelete('SET NULL');
      });
    }
  } finally {
    await knex.raw('SET FOREIGN_KEY_CHECKS = 1');
  }
};

exports.down = async function(knex) {
  await knex.raw('SET FOREIGN_KEY_CHECKS = 0');
  try {
    const hasImpersonationLog = await knex.schema.hasTable('impersonation_log');
    if (hasImpersonationLog) {
      await knex.schema.alterTable('impersonation_log', function(t) {
        t.dropForeign('target_user_id');
        t.dropForeign('admin_user_id');
      });
      await knex.raw(
        'ALTER TABLE `impersonation_log` ' +
        'MODIFY COLUMN `admin_user_id` VARCHAR(36) NOT NULL COLLATE utf8mb4_unicode_ci'
      );
    }

    const hasOauthCodes = await knex.schema.hasTable('oauth_auth_codes');
    if (hasOauthCodes) {
      await knex.schema.alterTable('oauth_auth_codes', function(t) {
        t.dropForeign('client_id');
        t.dropForeign('user_id');
      });
    }

    const hasAiCommandLog = await knex.schema.hasTable('ai_command_log');
    if (hasAiCommandLog) {
      await knex.schema.alterTable('ai_command_log', function(t) {
        t.dropForeign('user_id');
      });
      await knex.raw(
        'ALTER TABLE `ai_command_log` ' +
        'MODIFY COLUMN `user_id` INT UNSIGNED NOT NULL'
      );
    }

    const hasSyncLocks = await knex.schema.hasTable('sync_locks');
    if (hasSyncLocks) {
      await knex.schema.alterTable('sync_locks', function(t) {
        t.dropForeign('user_id');
      });
    }

    const hasPlanUsage = await knex.schema.hasTable('plan_usage');
    if (hasPlanUsage) {
      await knex.schema.alterTable('plan_usage', function(t) {
        t.dropForeign('user_id');
      });
    }

    const hasFeatureEvents = await knex.schema.hasTable('feature_events');
    if (hasFeatureEvents) {
      await knex.schema.alterTable('feature_events', function(t) {
        t.dropForeign('user_id');
      });
    }
  } finally {
    await knex.raw('SET FOREIGN_KEY_CHECKS = 1');
  }
};
