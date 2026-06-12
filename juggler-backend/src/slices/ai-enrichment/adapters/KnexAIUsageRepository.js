/**
 * KnexAIUsageRepository — implements `AIUsagePort` (Phase H5). The per-user daily
 * AI-command quota over the `ai_command_log` table, lifted VERBATIM from
 * `ai.controller.checkAndLogDailyQuota`, but obtaining its knex via `lib/db`
 * (ADR-0002) instead of `src/db.js`.
 *
 * ── CONNECTION (ADR-0002 — lib/db, NOT src/db.js) ────────────────────────────
 * `require('../../../lib/db').getDefaultDb()` — the same shared pool src/db.js
 * re-exports, so behavior is identical. Injectable for tests.
 *
 * ── BEHAVIOR-IDENTICAL (H5 refactor — W1) ────────────────────────────────────
 * Reproduces checkAndLogDailyQuota step-for-step: count rows where
 * `created_at >= now-24h`; `count >= AI_DAILY_LIMIT` (50) → `{ allowed: false }`
 * (no insert); else `insert({ user_id })` (created_at via the DB default, NOT
 * changed — the legacy insert does not write it) → `{ allowed: true }`.
 */

'use strict';

const AI_DAILY_LIMIT = 50;

/**
 * @param {object}   [deps]
 * @param {Function} [deps.db]          knex handle (default: lib/db getDefaultDb())
 * @param {number}   [deps.dailyLimit]  override the 50/day cap (tests)
 */
function KnexAIUsageRepository(deps) {
  const d = deps || {};
  this._db = d.db || null;
  this.dailyLimit = typeof d.dailyLimit === 'number' ? d.dailyLimit : AI_DAILY_LIMIT;
}

KnexAIUsageRepository.prototype._getDb = function _getDb() {
  if (!this._db) this._db = require('../../../lib/db').getDefaultDb();
  return this._db;
};

/**
 * @implements AIUsagePort.checkAndLogDailyQuota
 */
KnexAIUsageRepository.prototype.checkAndLogDailyQuota = async function checkAndLogDailyQuota(userId) {
  const db = this._getDb();
  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const row = await db('ai_command_log')
    .where('user_id', userId)
    .where('created_at', '>=', windowStart)
    .count('id as cnt')
    .first();
  const count = Number(row && row.cnt) || 0;
  if (count >= this.dailyLimit) {
    return { allowed: false };
  }
  await db('ai_command_log').insert({ user_id: userId });
  return { allowed: true };
};

module.exports = KnexAIUsageRepository;
module.exports.AI_DAILY_LIMIT = AI_DAILY_LIMIT;
