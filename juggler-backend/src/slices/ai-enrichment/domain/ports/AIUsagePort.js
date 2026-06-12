/**
 * AIUsagePort — driven-port contract for the per-user daily AI-command quota
 * (Phase H5). Formalizes `ai.controller.checkAndLogDailyQuota` (the `ai_command_log`
 * 24h-window count + insert). Implemented by `KnexAIUsageRepository` (over lib/db,
 * ADR-0002); the usage-telemetry enqueue (ai_usage_outbox) is separate and stays
 * inside the provider call (AIPort/trackedGeminiCall).
 *
 * ── BEHAVIOR-IDENTICAL (H5 refactor contract) ────────────────────────────────
 * `checkAndLogDailyQuota(userId)` reproduces the legacy step-for-step: count
 * `ai_command_log` rows for the user with `created_at >= now-24h`; if `count >=
 * AI_DAILY_LIMIT` (50) → `{ allowed: false }` (no insert); else insert one row
 * (`{ user_id }`, created_at via the DB default — NOT changed) → `{ allowed: true }`.
 *
 * @typedef {Object} AIUsagePort
 * @property {(userId: string) => Promise<{allowed: boolean}>} checkAndLogDailyQuota
 */

'use strict';

const AI_USAGE_PORT_METHODS = ['checkAndLogDailyQuota'];

function AIUsagePort() {}
AIUsagePort.prototype.checkAndLogDailyQuota = async function checkAndLogDailyQuota() {
  throw new Error('AIUsagePort.checkAndLogDailyQuota not implemented');
};

module.exports = { AIUsagePort, AI_USAGE_PORT_METHODS };
