/**
 * KnexSyncStateRepository — concrete SyncStateRepositoryPort implementation
 * (SYNC_STATE_REPOSITORY_PORT_METHODS) backed by the per-provider sync columns
 * on the `users` table.
 *
 * Column mapping (verified against the live adapters in src/lib/cal-adapters/):
 *   provider  lastSyncedColumn            eventIdColumn       syncTokenColumn
 *   gcal      gcal_last_synced_at         gcal_event_id       gcal_sync_token
 *   msft      msft_cal_last_synced_at     msft_event_id       msft_cal_delta_link
 *   apple     apple_cal_last_synced_at    apple_event_id      apple_cal_sync_token
 *
 * INVARIANT P1 (ADR-0003): setLastSyncedAt writes the timestamp as a JS
 * `new Date()` value — NEVER `db.fn.now()` / `knex.fn.now()` / raw SQL NOW().
 * This mirrors the existing controller behavior
 * (src/controllers/cal-sync.controller.js: `var now = new Date(); userUpdate[syncedCol] = now;`)
 * so the refactor preserves the exact write semantics.
 *
 * The Knex instance is injected (defaults to lib/db's shared singleton via
 * require('../../../lib/db').getDefaultDb()) so the unit test can pass a stub
 * builder and avoid a live DB. W5 (juggler-hex-h2): default routes directly
 * through lib-db (the single pool); src/db.js re-exports the same instance.
 */

var SyncState = require('../domain/entities/SyncState');

/**
 * Centralized provider → users-table column mapping. The single source of
 * truth for which columns this repository reads/writes per provider.
 */
var PROVIDER_COLUMNS = Object.freeze({
  gcal: {
    lastSynced: 'gcal_last_synced_at',
    eventId: 'gcal_event_id',
    syncToken: 'gcal_sync_token'
  },
  msft: {
    lastSynced: 'msft_cal_last_synced_at',
    eventId: 'msft_event_id',
    syncToken: 'msft_cal_delta_link'
  },
  apple: {
    lastSynced: 'apple_cal_last_synced_at',
    eventId: 'apple_event_id',
    syncToken: 'apple_cal_sync_token'
  }
});

function columnsFor(providerId) {
  var cols = PROVIDER_COLUMNS[providerId];
  if (!cols) {
    throw new Error('KnexSyncStateRepository: unknown provider "' + providerId + '"');
  }
  return cols;
}

/**
 * @param {Object} [deps]
 * @param {Function} [deps.db] Knex instance. Defaults to lib/db's shared
 *   singleton (getDefaultDb) — the single pool src/db.js also re-exports.
 */
function KnexSyncStateRepository(deps) {
  var d = deps || {};
  this.db = d.db || require('../../../lib/db').getDefaultDb();
}

/**
 * Provider → column map (exposed for tests / introspection).
 */
KnexSyncStateRepository.PROVIDER_COLUMNS = PROVIDER_COLUMNS;
KnexSyncStateRepository.prototype.columnsFor = function (providerId) {
  return columnsFor(providerId);
};

/**
 * Read the full sync-state record for a user+provider.
 * @param {(string|number)} userId
 * @param {string} providerId
 * @returns {Promise<?SyncState>} null if the user row does not exist.
 */
KnexSyncStateRepository.prototype.getSyncState = function (userId, providerId) {
  var cols = columnsFor(providerId);
  return this.db('users')
    .where('id', userId)
    .first(cols.lastSynced, cols.syncToken)
    .then(function (row) {
      if (!row) return null;
      return new SyncState({
        userId: userId,
        providerId: providerId,
        lastSyncedAt: row[cols.lastSynced] != null ? row[cols.lastSynced] : null,
        syncToken: row[cols.syncToken] != null ? row[cols.syncToken] : null,
        eventIdColumn: cols.eventId
      });
    });
};

/**
 * Read the last-synced timestamp for a user+provider.
 * @returns {Promise<?(string|Date)>}
 */
KnexSyncStateRepository.prototype.getLastSyncedAt = function (userId, providerId) {
  var cols = columnsFor(providerId);
  return this.db('users')
    .where('id', userId)
    .first(cols.lastSynced)
    .then(function (row) {
      if (!row) return null;
      return row[cols.lastSynced] != null ? row[cols.lastSynced] : null;
    });
};

/**
 * Persist the last-synced timestamp.
 *
 * INVARIANT P1: the written value is a JS Date. If a caller passes `when` we
 * use it (it MUST already be a JS Date per the port contract); otherwise we
 * default to `new Date()`. We never substitute a knex.fn.now() raw.
 *
 * @param {(string|number)} userId
 * @param {string} providerId
 * @param {Date} when MUST be a JS Date (P1/ADR-0003).
 * @returns {Promise<void>}
 */
KnexSyncStateRepository.prototype.setLastSyncedAt = function (userId, providerId, when) {
  var cols = columnsFor(providerId);
  // P1 (ADR-0003): write a JS Date, never db.fn.now()/raw NOW().
  var value = (when instanceof Date) ? when : new Date();
  var update = {};
  update[cols.lastSynced] = value;
  return this.db('users').where('id', userId).update(update).then(function () {});
};

/**
 * Read the provider's sync-position token.
 * @returns {Promise<?string>}
 */
KnexSyncStateRepository.prototype.getSyncToken = function (userId, providerId) {
  var cols = columnsFor(providerId);
  return this.db('users')
    .where('id', userId)
    .first(cols.syncToken)
    .then(function (row) {
      if (!row) return null;
      return row[cols.syncToken] != null ? row[cols.syncToken] : null;
    });
};

/**
 * Persist the provider's sync-position token. Passing null clears it.
 * @returns {Promise<void>}
 */
KnexSyncStateRepository.prototype.setSyncToken = function (userId, providerId, token) {
  var cols = columnsFor(providerId);
  var update = {};
  update[cols.syncToken] = token != null ? token : null;
  return this.db('users').where('id', userId).update(update).then(function () {});
};

/**
 * Convenience to clear the sync-position token (forces next full sync).
 * @returns {Promise<void>}
 */
KnexSyncStateRepository.prototype.clearSyncToken = function (userId, providerId) {
  return this.setSyncToken(userId, providerId, null);
};

module.exports = KnexSyncStateRepository;
