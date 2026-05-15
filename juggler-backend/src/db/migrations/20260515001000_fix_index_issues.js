'use strict';

/**
 * Fix three categories of index issues across the DB schema.
 *
 * ── CATEGORY A: MISSING FK INDEXES (2) ────────────────────────────────────
 *
 * InnoDB requires an index on every FK referencing column. When a FK is added
 * with FOREIGN_KEY_CHECKS = 0 (as 20260515000200 did), MySQL skips the
 * auto-index creation, leaving the referencing column unindexed.
 *
 *  A1. oauth_auth_codes.user_id → users.id
 *      No index exists. Every JOIN or cascade on user deletion does a full-table
 *      scan on oauth_auth_codes.
 *
 *  A2. oauth_auth_codes.client_id → oauth_clients.client_id
 *      No index exists. Same problem for client-scoped lookups.
 *
 * ── CATEGORY B: DUPLICATE INDEXES (4) ─────────────────────────────────────
 *
 * A shorter index is completely covered by a longer index that starts with the
 * same leading column(s). MySQL's optimizer prefers the longer index for the
 * same queries, making the shorter one dead weight that wastes space and slows
 * writes.
 *
 *  B1. task_instances: task_instances_master_id_index (single)
 *      Covered by: UNIQUE uq_instance_ordinals (master_id, occurrence_ordinal,
 *      split_ordinal). Any lookup filtered on master_id alone uses the UNIQUE
 *      as a prefix scan — the single-column index is redundant.
 *
 *  B2. task_instances: task_instances_user_id_status_index (user_id, status)
 *      Covered by: idx_task_instances_purge (user_id, status, completed_at).
 *      MySQL can satisfy every (user_id, status) lookup via the 3-column index
 *      prefix. The 2-column index adds no value.
 *
 *  B3. task_masters: task_masters_user_id_index (single)
 *      Covered by: task_masters_user_id_project_index (user_id, project).
 *      Any query filtering only on user_id is served by the composite's leftmost
 *      prefix. idx_tm_user_split (user_id, split) also covers the prefix.
 *
 *  B4. plan_usage: plan_usage_user_id_usage_key_index (user_id, usage_key)
 *      Covered by: UNIQUE plan_usage_user_id_usage_key_period_start_unique
 *      (user_id, usage_key, period_start). The UNIQUE's leading two columns are
 *      exactly (user_id, usage_key), so every filtered read on those columns is
 *      served by the UNIQUE. The non-unique index is a pure duplicate.
 *
 * ── CATEGORY C: UNUSED INDEXES (2) ────────────────────────────────────────
 *
 * The column is never referenced in a WHERE, JOIN ON, or ORDER BY clause in
 * juggler-backend/src/**. Grep-verified 2026-05-15.
 *
 *  C1. feature_events: idx_fe_plan (plan_slug, created_at)
 *      plan_slug is written at event-insert time but never read in any query.
 *      All reads filter on feature_key, event_type, user_id, or created_at.
 *      Confirmed by grepping src/ for "plan_slug" — zero WHERE/JOIN hits.
 *
 *  C2. scheduler_sessions: scheduler_sessions_user_id_index (user_id)
 *      Every query against scheduler_sessions uses either the primary key
 *      (session_id) or expires_at (covered by idx_scheduler_sessions_expires).
 *      No code path filters on user_id. Index is unreachable by the query planner.
 *
 * ── SKIPPED / CONSERVATIVE DECISIONS ──────────────────────────────────────
 *
 *  - cal_sync_ledger.user_id (single): Although the (user_id, provider)
 *    composite covers it as a prefix, several queries filter on user_id + status
 *    (not provider), making the single-column index genuinely useful as a tiebreak
 *    when the optimizer chooses not to use the composite. Kept.
 *
 *  - feature_events idx_fe_feature (feature_key, event_type, created_at):
 *    Used in the aggregate query (WHERE feature_key = ?). Kept.
 *
 *  - projects/locations/tools/user_config user_id: All have a UNIQUE index whose
 *    first column is user_id, which MySQL can use as a prefix — the FK is already
 *    covered. No action needed.
 */

exports.up = async function(knex) {
  // ── A. Add missing FK indexes ─────────────────────────────────────────────

  const hasOauthCodes = await knex.schema.hasTable('oauth_auth_codes');
  if (hasOauthCodes) {
    // A1: oauth_auth_codes.user_id
    const hasUserIdx = await knex.raw(
      "SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oauth_auth_codes' " +
      "AND COLUMN_NAME = 'user_id' AND SEQ_IN_INDEX = 1 LIMIT 1"
    );
    if (!hasUserIdx[0] || hasUserIdx[0].length === 0) {
      await knex.raw(
        'CREATE INDEX idx_oauth_auth_codes_user_id ' +
        'ON oauth_auth_codes (user_id) ' +
        "COMMENT 'FK index: user_id → users.id'"
      );
    }

    // A2: oauth_auth_codes.client_id
    const hasClientIdx = await knex.raw(
      "SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oauth_auth_codes' " +
      "AND COLUMN_NAME = 'client_id' AND SEQ_IN_INDEX = 1 LIMIT 1"
    );
    if (!hasClientIdx[0] || hasClientIdx[0].length === 0) {
      await knex.raw(
        'CREATE INDEX idx_oauth_auth_codes_client_id ' +
        'ON oauth_auth_codes (client_id) ' +
        "COMMENT 'FK index: client_id → oauth_clients.client_id'"
      );
    }
  }

  // ── B. Drop duplicate indexes ─────────────────────────────────────────────

  // B1: task_instances.master_id single — covered by uq_instance_ordinals
  const hasTI = await knex.schema.hasTable('task_instances');
  if (hasTI) {
    const tiMasterIdx = await knex.raw(
      "SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_instances' " +
      "AND INDEX_NAME = 'task_instances_master_id_index' LIMIT 1"
    );
    if (tiMasterIdx[0] && tiMasterIdx[0].length > 0) {
      await knex.raw('DROP INDEX task_instances_master_id_index ON task_instances');
    }

    // B2: task_instances.(user_id, status) — covered by idx_task_instances_purge
    const tiStatusIdx = await knex.raw(
      "SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_instances' " +
      "AND INDEX_NAME = 'task_instances_user_id_status_index' LIMIT 1"
    );
    if (tiStatusIdx[0] && tiStatusIdx[0].length > 0) {
      await knex.raw('DROP INDEX task_instances_user_id_status_index ON task_instances');
    }
  }

  // B3: task_masters.user_id single — covered by (user_id, project) composite
  const hasTM = await knex.schema.hasTable('task_masters');
  if (hasTM) {
    const tmUserIdx = await knex.raw(
      "SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_masters' " +
      "AND INDEX_NAME = 'task_masters_user_id_index' LIMIT 1"
    );
    if (tmUserIdx[0] && tmUserIdx[0].length > 0) {
      await knex.raw('DROP INDEX task_masters_user_id_index ON task_masters');
    }
  }

  // B4: plan_usage.(user_id, usage_key) — covered by UNIQUE (user_id, usage_key, period_start)
  const hasPU = await knex.schema.hasTable('plan_usage');
  if (hasPU) {
    const puIdx = await knex.raw(
      "SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plan_usage' " +
      "AND INDEX_NAME = 'plan_usage_user_id_usage_key_index' LIMIT 1"
    );
    if (puIdx[0] && puIdx[0].length > 0) {
      await knex.raw('DROP INDEX plan_usage_user_id_usage_key_index ON plan_usage');
    }
  }

  // ── C. Drop unused indexes ────────────────────────────────────────────────

  // C1: feature_events idx_fe_plan (plan_slug, created_at) — plan_slug never queried
  const hasFE = await knex.schema.hasTable('feature_events');
  if (hasFE) {
    const feIdx = await knex.raw(
      "SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feature_events' " +
      "AND INDEX_NAME = 'idx_fe_plan' LIMIT 1"
    );
    if (feIdx[0] && feIdx[0].length > 0) {
      await knex.raw('DROP INDEX idx_fe_plan ON feature_events');
    }
  }

  // C2: scheduler_sessions.user_id — all queries use session_id (PK) or expires_at
  const hasSS = await knex.schema.hasTable('scheduler_sessions');
  if (hasSS) {
    const ssIdx = await knex.raw(
      "SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scheduler_sessions' " +
      "AND INDEX_NAME = 'scheduler_sessions_user_id_index' LIMIT 1"
    );
    if (ssIdx[0] && ssIdx[0].length > 0) {
      await knex.raw('DROP INDEX scheduler_sessions_user_id_index ON scheduler_sessions');
    }
  }
};

exports.down = async function(knex) {
  // ── Restore dropped indexes ───────────────────────────────────────────────

  // C2: scheduler_sessions.user_id
  const hasSS = await knex.schema.hasTable('scheduler_sessions');
  if (hasSS) {
    await knex.schema.alterTable('scheduler_sessions', function(t) {
      t.index('user_id');
    });
  }

  // C1: feature_events idx_fe_plan
  const hasFE = await knex.schema.hasTable('feature_events');
  if (hasFE) {
    await knex.raw(
      "CREATE INDEX idx_fe_plan ON feature_events (plan_slug, created_at)"
    );
  }

  // B4: plan_usage (user_id, usage_key)
  const hasPU = await knex.schema.hasTable('plan_usage');
  if (hasPU) {
    await knex.schema.alterTable('plan_usage', function(t) {
      t.index(['user_id', 'usage_key']);
    });
  }

  // B3: task_masters.user_id
  const hasTM = await knex.schema.hasTable('task_masters');
  if (hasTM) {
    await knex.schema.alterTable('task_masters', function(t) {
      t.index('user_id');
    });
  }

  // B2 + B1: task_instances
  const hasTI = await knex.schema.hasTable('task_instances');
  if (hasTI) {
    await knex.schema.alterTable('task_instances', function(t) {
      t.index(['user_id', 'status']);
      t.index('master_id');
    });
  }

  // A1 + A2: Drop the FK indexes we added in up()
  const hasOauthCodes = await knex.schema.hasTable('oauth_auth_codes');
  if (hasOauthCodes) {
    await knex.raw('DROP INDEX idx_oauth_auth_codes_client_id ON oauth_auth_codes').catch(function() {});
    await knex.raw('DROP INDEX idx_oauth_auth_codes_user_id ON oauth_auth_codes').catch(function() {});
  }
};
