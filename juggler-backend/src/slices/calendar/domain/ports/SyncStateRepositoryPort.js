/**
 * SyncStateRepositoryPort — driven-port contract for persisting per-user,
 * per-provider calendar sync state.
 *
 * Today this state lives as columns on the `users` table, keyed by provider:
 *   - last-synced timestamp:  `{provider}_last_synced_at`
 *                             (column name from CalendarPort.getLastSyncedColumn())
 *   - provider event id col:  `{provider}_event_id`
 *                             (column name from CalendarPort.getEventIdColumn())
 *   - sync-position token:    provider-specific —
 *        gcal:  `gcal_sync_token`
 *        msft:  `msft_cal_delta_link`
 *        apple: `apple_cal_sync_token`
 *
 * This port abstracts those reads/writes so the domain/application layer never
 * touches Knex or column names directly. The concrete adapter (W2+) owns the
 * column mapping above.
 *
 * INVARIANT P1 (ADR-0003): the last-synced timestamp MUST be written with a
 * JS `new Date()` value (or a MySQL-now value obtained explicitly), NEVER via
 * `db.fn.now()` inline in the update. Implementations of `setLastSyncedAt`
 * must honor this.
 *
 * @typedef {Object} SyncStateRepositoryPort
 *
 * @property {(userId: (string|number), providerId: string) => Promise<?SyncState>} getSyncState
 *   Read the full sync-state record for a user+provider. Resolves null if the
 *   user does not exist.
 *
 * @property {(userId: (string|number), providerId: string) => Promise<?(string|Date)>} getLastSyncedAt
 *   Read the last-synced timestamp for a user+provider (null if never synced).
 *
 * @property {(userId: (string|number), providerId: string, when: Date) => Promise<void>} setLastSyncedAt
 *   Persist the last-synced timestamp. `when` MUST be a JS Date (P1/ADR-0003).
 *
 * @property {(userId: (string|number), providerId: string) => Promise<?string>} getSyncToken
 *   Read the provider's sync-position token (gcal sync token / msft delta link /
 *   apple sync token). Null when no token is stored yet (forces full sync).
 *
 * @property {(userId: (string|number), providerId: string, token: ?string) => Promise<void>} setSyncToken
 *   Persist the provider's sync-position token. Passing null clears it
 *   (e.g. on a 410 / expired-token condition), forcing the next full sync.
 *
 * @property {(userId: (string|number), providerId: string) => Promise<void>} clearSyncToken
 *   Convenience to clear the sync-position token. Equivalent to
 *   setSyncToken(userId, providerId, null).
 */

/**
 * The exact set of methods a SyncStateRepositoryPort implementation MUST
 * expose. A contract test asserts adapters conform to this list.
 * @type {ReadonlyArray<string>}
 */
var SYNC_STATE_REPOSITORY_PORT_METHODS = Object.freeze([
  'getSyncState',
  'getLastSyncedAt',
  'setLastSyncedAt',
  'getSyncToken',
  'setSyncToken',
  'clearSyncToken'
]);

module.exports = {
  SYNC_STATE_REPOSITORY_PORT_METHODS: SYNC_STATE_REPOSITORY_PORT_METHODS
};
