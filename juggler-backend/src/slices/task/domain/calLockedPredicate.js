/**
 * calLockedPredicate — single source of truth for the "cal_locked" derivation:
 * a task/instance is calendar-born (cal_locked) when it has an ACTIVE
 * cal_sync_ledger row whose origin is a real calendar provider, not 'juggler'.
 *
 * FIX bert (cookie ARCH-REVIEW-W2.json W2-ARCH-W3, 2026-07-09): this rule was
 * duplicated — once inline in KnexTaskRepository.fetchTaskWithEventIds's JS
 * loop (adapters/KnexTaskRepository.js) and once as a raw knex WHERE clause in
 * facade.findCalLockedSeriesInstance (facade.js) — with no shared home, so the
 * two copies could silently drift if the rule (e.g. a new provider-origin
 * value) ever changed and only one copy was updated. Both call sites now use
 * this module: `isCalLockedLedgerRow` for the per-row JS check, and
 * `applyCalLockedLedgerFilter` for the equivalent knex WHERE-clause shape.
 */
'use strict';

var JUGGLER_ORIGIN = 'juggler';

/**
 * True when a cal_sync_ledger row counts as a "cal_locked" (calendar-born)
 * lock: status is 'active' AND origin is set to something other than
 * 'juggler' (a real calendar provider).
 * @param {{status?: string, origin?: string}} row
 * @returns {boolean}
 */
function isCalLockedLedgerRow(row) {
  return !!(row && row.status === 'active' && row.origin && row.origin !== JUGGLER_ORIGIN);
}

/**
 * Apply the SAME predicate as a knex WHERE-clause filter, for queries that
 * derive cal_locked at the SQL level instead of looping over fetched rows.
 * `alias` is the optional table/alias prefix for the ledger table's columns
 * (e.g. 'l' for `cal_sync_ledger as l`).
 * @param {Object} qb knex query builder
 * @param {string} [alias]
 * @returns {Object} the same query builder, for chaining
 */
function applyCalLockedLedgerFilter(qb, alias) {
  var prefix = alias ? alias + '.' : '';
  return qb.where(prefix + 'status', 'active').where(prefix + 'origin', '!=', JUGGLER_ORIGIN);
}

module.exports = {
  JUGGLER_ORIGIN: JUGGLER_ORIGIN,
  isCalLockedLedgerRow: isCalLockedLedgerRow,
  applyCalLockedLedgerFilter: applyCalLockedLedgerFilter
};
