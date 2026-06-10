/**
 * SyncState — domain entity for one user's sync state with one calendar
 * provider. Corresponds to the per-provider sync columns on the `users` table
 * (see SyncStateRepositoryPort for the column mapping).
 *
 * Fields:
 *   - userId        : the owning user's id
 *   - providerId    : 'gcal' | 'msft' | 'apple' | 'memory'
 *   - lastSyncedAt  : last successful sync timestamp (Date | ISO string | null)
 *   - syncToken     : provider sync-position token (gcal sync token /
 *                     msft delta link / apple sync token), or null
 *   - eventIdColumn : DB column name storing this provider's event id
 *                     (from CalendarPort.getEventIdColumn()), informational
 */

/**
 * @param {Object} props
 * @param {(string|number)} props.userId
 * @param {string} props.providerId
 * @param {?(Date|string)} [props.lastSyncedAt]
 * @param {?string} [props.syncToken]
 * @param {?string} [props.eventIdColumn]
 */
function SyncState(props) {
  var p = props || {};
  this.userId = p.userId != null ? p.userId : null;
  this.providerId = p.providerId != null ? p.providerId : null;
  this.lastSyncedAt = p.lastSyncedAt != null ? p.lastSyncedAt : null;
  this.syncToken = p.syncToken != null ? p.syncToken : null;
  this.eventIdColumn = p.eventIdColumn != null ? p.eventIdColumn : null;
}

/**
 * True if the provider has never completed a sync (no token stored), meaning
 * the next sync must be a full fetch.
 * @returns {boolean}
 */
SyncState.prototype.needsFullSync = function needsFullSync() {
  return this.syncToken == null;
};

module.exports = SyncState;
