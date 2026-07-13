/**
 * InMemoryCalendarAccountRepository — CalendarAccountRepositoryPort test
 * double (JUG-FACADE-DB-VIOLATIONS stage 3). A faithful in-memory
 * implementation of the SAME contract KnexCalendarAccountRepository
 * implements (CALENDAR_ACCOUNT_REPOSITORY_PORT_METHODS), for unit-testing
 * facade account-management functions with NO live DB.
 *
 * ── STORE MODEL ──────────────────────────────────────────────────────────
 *   _users        — { [userId]: rowObject } (mutated in place by updateUser)
 *   _userConfig   — { [`${userId} ${configKey}`]: rowObject }
 *   _userCalendars — array of rows with an auto-increment `id`
 *   _oauthNonces  — { [codeHash]: expiresAtMs }
 *
 * `now()` returns a JS Date — there is no DB here to hand back a raw
 * fn.now() expression, and callers only ever store the returned value into a
 * plain field (this port's `updated_at`/`created_at` usage, not the
 * P1/ADR-0003 last-synced columns governed by SyncStateRepositoryPort).
 */

'use strict';

function configKeyOf(userId, configKey) {
  return userId + ' ' + configKey;
}

/**
 * @param {Object} [deps]
 * @param {Object} [deps.users] seed { [userId]: row } map.
 * @param {Object[]} [deps.userConfig] seed user_config rows.
 * @param {Object[]} [deps.userCalendars] seed user_calendars rows (id assigned if absent).
 */
function InMemoryCalendarAccountRepository(deps) {
  var d = deps || {};
  this._users = {};
  this._userConfig = {};
  this._userCalendars = [];
  this._oauthNonces = {};
  this._calSeq = 0;

  var self = this;
  Object.keys(d.users || {}).forEach(function (id) {
    self._users[id] = Object.assign({}, d.users[id]);
  });
  (d.userConfig || []).forEach(function (r) {
    self._userConfig[configKeyOf(r.user_id, r.config_key)] = Object.assign({}, r);
  });
  (d.userCalendars || []).forEach(function (r) {
    var row = Object.assign({}, r);
    if (row.id === undefined) row.id = ++self._calSeq;
    else self._calSeq = Math.max(self._calSeq, Number(row.id) || 0);
    self._userCalendars.push(row);
  });
}

// ── users ────────────────────────────────────────────────────────────────

InMemoryCalendarAccountRepository.prototype.getUser = function (userId) {
  var row = this._users[userId];
  return Promise.resolve(row ? Object.assign({}, row) : undefined);
};

InMemoryCalendarAccountRepository.prototype.updateUser = function (userId, fields) {
  var row = this._users[userId];
  if (!row) return Promise.resolve(0);
  Object.assign(row, fields);
  return Promise.resolve(1);
};

InMemoryCalendarAccountRepository.prototype.now = function () {
  return new Date();
};

// ── user_config ──────────────────────────────────────────────────────────

InMemoryCalendarAccountRepository.prototype.getUserConfig = function (userId, configKey) {
  var row = this._userConfig[configKeyOf(userId, configKey)];
  return Promise.resolve(row ? Object.assign({}, row) : undefined);
};

InMemoryCalendarAccountRepository.prototype.insertUserConfig = function (fields) {
  this._userConfig[configKeyOf(fields.user_id, fields.config_key)] = Object.assign({}, fields);
  return Promise.resolve();
};

InMemoryCalendarAccountRepository.prototype.updateUserConfig = function (userId, configKey, fields) {
  var key = configKeyOf(userId, configKey);
  var row = this._userConfig[key];
  if (!row) return Promise.resolve(0);
  Object.assign(row, fields);
  return Promise.resolve(1);
};

InMemoryCalendarAccountRepository.prototype.deleteUserConfig = function (userId, configKey) {
  var key = configKeyOf(userId, configKey);
  if (!Object.prototype.hasOwnProperty.call(this._userConfig, key)) return Promise.resolve(0);
  delete this._userConfig[key];
  return Promise.resolve(1);
};

// ── oauth_code_nonces ────────────────────────────────────────────────────

InMemoryCalendarAccountRepository.prototype.deleteExpiredOAuthNonces = function () {
  var store = this._oauthNonces;
  var now = Date.now();
  Object.keys(store).forEach(function (hash) {
    if (store[hash] < now) delete store[hash];
  });
  return Promise.resolve();
};

InMemoryCalendarAccountRepository.prototype.insertOAuthNonceIgnoreDuplicate = function (hash) {
  // Mirrors INSERT IGNORE: a pre-existing (non-expired-pruned) hash is a no-op
  // (affectedRows 0); a fresh hash inserts (affectedRows 1).
  var existed = Object.prototype.hasOwnProperty.call(this._oauthNonces, hash);
  if (!existed) {
    this._oauthNonces[hash] = Date.now() + 2 * 60 * 1000; // DATE_ADD(NOW(), INTERVAL 2 MINUTE)
  }
  return Promise.resolve([{ affectedRows: existed ? 0 : 1 }]);
};

// ── user_calendars ───────────────────────────────────────────────────────

InMemoryCalendarAccountRepository.prototype.findUserCalendars = function (userId, provider) {
  var rows = this._userCalendars.filter(function (c) {
    return c.user_id === userId && c.provider === provider;
  });
  return Promise.resolve(rows.map(function (r) { return Object.assign({}, r); }));
};

InMemoryCalendarAccountRepository.prototype.findUserCalendarByCalendarId = function (userId, provider, calendarId) {
  var row = this._userCalendars.filter(function (c) {
    return c.user_id === userId && c.provider === provider && c.calendar_id === calendarId;
  })[0];
  return Promise.resolve(row ? Object.assign({}, row) : undefined);
};

InMemoryCalendarAccountRepository.prototype.findFirstEnabledUserCalendar = function (userId, provider) {
  var row = this._userCalendars.filter(function (c) {
    return c.user_id === userId && c.provider === provider && !!c.enabled;
  })[0];
  return Promise.resolve(row ? Object.assign({}, row) : undefined);
};

InMemoryCalendarAccountRepository.prototype.findUserCalendarById = function (id) {
  var row = this._userCalendars.filter(function (c) { return String(c.id) === String(id); })[0];
  return Promise.resolve(row ? Object.assign({}, row) : undefined);
};

InMemoryCalendarAccountRepository.prototype.findUserCalendarByIdForUser = function (id, userId) {
  var row = this._userCalendars.filter(function (c) {
    return String(c.id) === String(id) && c.user_id === userId;
  })[0];
  return Promise.resolve(row ? Object.assign({}, row) : undefined);
};

InMemoryCalendarAccountRepository.prototype.insertUserCalendar = function (fields) {
  var row = Object.assign({ id: ++this._calSeq }, fields);
  this._userCalendars.push(row);
  return Promise.resolve([row.id]);
};

InMemoryCalendarAccountRepository.prototype.updateUserCalendarById = function (id, fields) {
  var row = this._userCalendars.filter(function (c) { return String(c.id) === String(id); })[0];
  if (!row) return Promise.resolve(0);
  Object.assign(row, fields);
  return Promise.resolve(1);
};

InMemoryCalendarAccountRepository.prototype.deleteUserCalendars = function (userId, provider) {
  var before = this._userCalendars.length;
  this._userCalendars = this._userCalendars.filter(function (c) {
    return !(c.user_id === userId && c.provider === provider);
  });
  return Promise.resolve(before - this._userCalendars.length);
};

InMemoryCalendarAccountRepository.CALENDAR_ACCOUNT_REPOSITORY_PORT_METHODS =
  require('../domain/ports/CalendarAccountRepositoryPort').CALENDAR_ACCOUNT_REPOSITORY_PORT_METHODS;

module.exports = InMemoryCalendarAccountRepository;
