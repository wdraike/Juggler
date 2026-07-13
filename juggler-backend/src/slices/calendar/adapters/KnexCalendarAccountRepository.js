/**
 * KnexCalendarAccountRepository — CalendarAccountRepositoryPort implementation
 * (CALENDAR_ACCOUNT_REPOSITORY_PORT_METHODS), moved VERBATIM from
 * calendar/facade.js's 18 account/OAuth management functions
 * (JUG-FACADE-DB-VIOLATIONS stage 3) so the facade carries no direct db access
 * (adapters are the slice's only DB layer — see eslint.boundaries.config.js
 * DB_DIRECT_SELECTORS).
 *
 * Every method here is a THIN passthrough over the SAME query chain the
 * facade functions ran inline — no new logic, no shape change (REFACTOR mode,
 * 999.942 discipline: byte-identical). Branching / error-handling / JSON
 * (de)serialization / crypto hashing all stay in facade.js; this file only
 * owns the knex call. In particular, `updated_at`/`created_at` values are
 * NEVER computed here — callers pass the fully-built fields object (using
 * `now()` for the same db.fn.now() raw expression the legacy inline code
 * used), so every write is byte-identical to its pre-extraction shape,
 * including the pre-existing per-callsite inconsistencies (e.g. setAppleAutoSync's
 * user_config UPDATE omits updated_at while setGcalAutoSync/setMsftAutoSync's
 * do not; user_calendars INSERTs only set created_at+updated_at in
 * appleRefreshCalendars, not in appleSelectCalendar/appleSelectCalendars) —
 * reproduced as-is, not "fixed".
 *
 * The Knex instance is injected (defaults to lib/db's shared singleton via
 * require('../../../lib/db').getDefaultDb()), matching KnexSyncStateRepository's
 * convention in this same slice.
 */

/**
 * @param {Object} [deps]
 * @param {Function} [deps.db] Knex instance. Defaults to lib/db's shared
 *   singleton (getDefaultDb) — the single pool src/db.js also re-exports.
 */
function KnexCalendarAccountRepository(deps) {
  var d = deps || {};
  this.db = d.db || require('../../../lib/db').getDefaultDb();
}

// ── users (provider token/credential columns) ───────────────────────────────

/**
 * @param {(string|number)} userId
 * @returns {Promise<?Object>}
 */
KnexCalendarAccountRepository.prototype.getUser = function (userId) {
  return this.db('users').where('id', userId).first();
};

/**
 * @param {(string|number)} userId
 * @param {Object} fields — fully-built update payload (caller includes
 *   updated_at via `now()` where the legacy code did).
 * @returns {Promise<number>}
 */
KnexCalendarAccountRepository.prototype.updateUser = function (userId, fields) {
  return this.db('users').where('id', userId).update(fields);
};

/**
 * The MySQL server-clock NOW() raw expression (knex `fn.now()`) — verbatim
 * relocation of every `db.fn.now()` reference in the account-management
 * functions' `updated_at`/`created_at` stamps. NOT the P1/ADR-0003 last-synced
 * columns (SyncStateRepositoryPort.setLastSyncedAt requires a JS Date).
 * @returns {*} knex raw expression
 */
KnexCalendarAccountRepository.prototype.now = function () {
  return this.db.fn.now();
};

// ── user_config (per-provider {provider}_auto_sync boolean rows) ───────────

/**
 * @param {(string|number)} userId
 * @param {string} configKey
 * @returns {Promise<?Object>}
 */
KnexCalendarAccountRepository.prototype.getUserConfig = function (userId, configKey) {
  return this.db('user_config').where({ user_id: userId, config_key: configKey }).first();
};

/**
 * @param {Object} fields
 * @returns {Promise<*>}
 */
KnexCalendarAccountRepository.prototype.insertUserConfig = function (fields) {
  return this.db('user_config').insert(fields);
};

/**
 * @param {(string|number)} userId
 * @param {string} configKey
 * @param {Object} fields
 * @returns {Promise<number>}
 */
KnexCalendarAccountRepository.prototype.updateUserConfig = function (userId, configKey, fields) {
  return this.db('user_config').where({ user_id: userId, config_key: configKey }).update(fields);
};

/**
 * @param {(string|number)} userId
 * @param {string} configKey
 * @returns {Promise<number>}
 */
KnexCalendarAccountRepository.prototype.deleteUserConfig = function (userId, configKey) {
  return this.db('user_config').where({ user_id: userId, config_key: configKey }).del();
};

// ── oauth_code_nonces (gcalMarkCodeUsed/msftMarkCodeUsed replay guard) ──────

/**
 * Verbatim relocation of the shared "prune expired nonces" statement (identical
 * SQL in both gcalMarkCodeUsed and msftMarkCodeUsed).
 * @returns {Promise<*>}
 */
KnexCalendarAccountRepository.prototype.deleteExpiredOAuthNonces = function () {
  return this.db.raw('DELETE FROM oauth_code_nonces WHERE expires_at < NOW()');
};

/**
 * Verbatim relocation of the shared "claim this code hash" INSERT IGNORE
 * (identical SQL in both gcalMarkCodeUsed and msftMarkCodeUsed). The caller
 * interprets `result[0].affectedRows === 1` (unchanged — stays in facade.js).
 * @param {string} hash
 * @returns {Promise<*>}
 */
KnexCalendarAccountRepository.prototype.insertOAuthNonceIgnoreDuplicate = function (hash) {
  return this.db.raw(
    'INSERT IGNORE INTO oauth_code_nonces (code_hash, expires_at) ' +
    'VALUES (?, DATE_ADD(NOW(), INTERVAL 2 MINUTE))',
    [hash]
  );
};

// ── user_calendars (Apple calendar selections) ──────────────────────────────

/**
 * @param {(string|number)} userId
 * @param {string} provider
 * @returns {Promise<Object[]>}
 */
KnexCalendarAccountRepository.prototype.findUserCalendars = function (userId, provider) {
  return this.db('user_calendars').where({ user_id: userId, provider: provider });
};

/**
 * @param {(string|number)} userId
 * @param {string} provider
 * @param {string} calendarId
 * @returns {Promise<?Object>}
 */
KnexCalendarAccountRepository.prototype.findUserCalendarByCalendarId = function (userId, provider, calendarId) {
  return this.db('user_calendars')
    .where({ user_id: userId, provider: provider, calendar_id: calendarId })
    .first();
};

/**
 * @param {(string|number)} userId
 * @param {string} provider
 * @returns {Promise<?Object>}
 */
KnexCalendarAccountRepository.prototype.findFirstEnabledUserCalendar = function (userId, provider) {
  return this.db('user_calendars')
    .where({ user_id: userId, provider: provider, enabled: true })
    .first();
};

/**
 * @param {(string|number)} id
 * @returns {Promise<?Object>}
 */
KnexCalendarAccountRepository.prototype.findUserCalendarById = function (id) {
  return this.db('user_calendars').where('id', id).first();
};

/**
 * @param {(string|number)} id
 * @param {(string|number)} userId
 * @returns {Promise<?Object>}
 */
KnexCalendarAccountRepository.prototype.findUserCalendarByIdForUser = function (id, userId) {
  return this.db('user_calendars').where({ id: id, user_id: userId }).first();
};

/**
 * @param {Object} fields
 * @returns {Promise<*>}
 */
KnexCalendarAccountRepository.prototype.insertUserCalendar = function (fields) {
  return this.db('user_calendars').insert(fields);
};

/**
 * @param {(string|number)} id
 * @param {Object} fields
 * @returns {Promise<number>}
 */
KnexCalendarAccountRepository.prototype.updateUserCalendarById = function (id, fields) {
  return this.db('user_calendars').where('id', id).update(fields);
};

/**
 * @param {(string|number)} userId
 * @param {string} provider
 * @returns {Promise<number>}
 */
KnexCalendarAccountRepository.prototype.deleteUserCalendars = function (userId, provider) {
  return this.db('user_calendars').where({ user_id: userId, provider: provider }).del();
};

module.exports = KnexCalendarAccountRepository;
