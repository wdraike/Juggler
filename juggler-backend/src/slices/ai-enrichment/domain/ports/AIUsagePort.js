/**
 * AIUsagePort — driven-port contract for the per-user daily AI-command quota
 * (Phase H5). Implemented by `KnexAIUsageRepository` (over lib/db, ADR-0002);
 * the usage-telemetry enqueue (ai_usage_outbox) is separate and stays inside
 * the provider call (AIPort/trackedGeminiCall).
 *
 * ── SPLIT CHECK/COMMIT INTERFACE (H5 W1b — B5 fix) ──────────────────────────
 * checkQuota(userId)  — count-only (no insert). Returns { allowed: bool }.
 *                       Safe to call before the provider call.
 * commitQuota(userId) — insert-only. Called ONLY after a successful Gemini call.
 *                       Never called on ETIMEDOUT or any failure path.
 *
 * @typedef {Object} AIUsagePort
 * @property {(userId: string) => Promise<{allowed: boolean}>} checkQuota
 * @property {(userId: string) => Promise<void>}              commitQuota
 */

'use strict';

const AI_USAGE_PORT_METHODS = ['checkQuota', 'commitQuota'];

function AIUsagePort() {}

AIUsagePort.prototype.checkQuota = async function checkQuota() {
  throw new Error('AIUsagePort.checkQuota not implemented');
};

AIUsagePort.prototype.commitQuota = async function commitQuota() {
  throw new Error('AIUsagePort.commitQuota not implemented');
};

module.exports = { AIUsagePort, AI_USAGE_PORT_METHODS };
