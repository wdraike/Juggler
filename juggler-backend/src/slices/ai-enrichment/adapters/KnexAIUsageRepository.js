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
 * ── SPLIT CHECK/COMMIT INTERFACE (H5 W1b — B5 fix) ──────────────────────────
 * The original checkAndLogDailyQuota (single step: count+insert before call)
 * caused timed-out calls to permanently consume a quota slot. It has been
 * removed (WARN-1, no production callers).
 *
 * Current interface (two operations):
 *   checkQuota(userId)  — count-only (no insert). Returns { allowed: bool }.
 *                         Safe to call before the provider call.
 *   commitQuota(userId) — ATOMIC check-and-insert (W3 B11 fix). Called by the
 *                         controller ONLY after a successful Gemini call.
 *                         Never called on timeout/error (W1b B5 preserved).
 *
 * ── ATOMIC ACQUIRE (H5 W3 — B11 TOCTOU fix) ─────────────────────────────────
 * commitQuota wraps the count-check and INSERT in a single InnoDB transaction
 * and issues `SELECT COUNT(*) ... FOR UPDATE` to acquire an exclusive range lock
 * on the user's rows in idx_ai_command_log_user_time before inserting. This
 * serializes concurrent callers: the second caller's SELECT FOR UPDATE blocks
 * until the first transaction commits, at which point it sees count=50 and
 * skips the INSERT, ensuring finalCount ≤ dailyLimit.
 *
 * B5 reconciliation: commitQuota is still called ONLY after a successful Gemini
 * call (controller flow unchanged). A timeout never reaches commitQuota, so the
 * don't-count-on-timeout invariant is fully preserved.
 *
 * No new migration required: the existing idx_ai_command_log_user_time
 * composite index on (user_id, created_at) is the lock anchor.
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
 * checkQuota — count-only quota check. Returns { allowed: bool }. NO insert.
 * Safe to call before the Gemini call; does NOT consume a slot.
 *
 * @implements AIUsagePort.checkQuota
 * @param {string} userId
 * @returns {Promise<{allowed: boolean}>}
 */
KnexAIUsageRepository.prototype.checkQuota = async function checkQuota(userId) {
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
  return { allowed: true };
};

/**
 * commitQuota — ATOMIC check-and-insert. Consumes one quota slot for userId
 * ONLY if the current 24h window count is below dailyLimit.
 *
 * Mechanism (W3 B11 TOCTOU fix):
 *   Opens an InnoDB transaction with REPEATABLE READ (MySQL default). Issues
 *   a raw `SELECT COUNT(*) ... FOR UPDATE` to acquire an exclusive index lock
 *   on the user's rows before the INSERT decision. Concurrent callers block at
 *   the FOR UPDATE until the first transaction commits. After commit the second
 *   caller re-evaluates the count (now at limit), skips the INSERT, and returns
 *   without error. This ensures at most one caller commits the boundary slot.
 *
 * Called by the controller ONLY after a successful Gemini call.
 * Never called on ETIMEDOUT, network error, or any failure path (W1b B5).
 *
 * @implements AIUsagePort.commitQuota
 * @param {string} userId
 * @returns {Promise<void>}
 */
KnexAIUsageRepository.prototype.commitQuota = async function commitQuota(userId) {
  const db = this._getDb();
  const limit = this.dailyLimit;
  await db.transaction(async (trx) => {
    // SELECT FOR UPDATE: acquires an exclusive range lock on this user's rows
    // in idx_ai_command_log_user_time, serializing concurrent commitQuota calls.
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [lockRow] = await trx.raw(
      'SELECT COUNT(*) AS cnt FROM `ai_command_log`' +
      ' WHERE `user_id` = ? AND `created_at` >= ? FOR UPDATE',
      [userId, windowStart]
    );
    const count = Number((lockRow && lockRow[0] && lockRow[0].cnt) || 0);
    if (count < limit) {
      await trx('ai_command_log').insert({ user_id: userId });
    }
    // If count >= limit: skip INSERT; transaction commits cleanly with no new row.
  });
};

module.exports = KnexAIUsageRepository;
module.exports.AI_DAILY_LIMIT = AI_DAILY_LIMIT;
