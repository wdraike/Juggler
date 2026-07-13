/**
 * CalendarAccountRepositoryPort — driven-port contract for provider
 * account/OAuth management (JUG-FACADE-DB-VIOLATIONS stage 3).
 *
 * Covers the tables the calendar facade's 18 account-management functions
 * (getGcalStatus/gcalConnect/gcalCallback/gcalDisconnect/setGcalAutoSync,
 * getMsftStatus/msftConnect/msftCallback/msftDisconnect/setMsftAutoSync,
 * appleGetStatus/appleConnect/appleSelectCalendar/appleSelectCalendars/
 * appleGetCalendars/appleUpdateCalendar/appleRefreshCalendars/appleDisconnect/
 * setAppleAutoSync, plus gcalMarkCodeUsed/msftMarkCodeUsed) read/write:
 *
 *   - `users`             — provider token/credential columns (gcal_*, msft_cal_*,
 *                           apple_cal_*) via getUser/updateUser
 *   - `user_config`        — per-provider `{provider}_auto_sync` boolean rows via
 *                           getUserConfig/insertUserConfig/updateUserConfig/deleteUserConfig
 *   - `user_calendars`     — Apple calendar selection rows via the findUserCalendar family/
 *                           insertUserCalendar/updateUserCalendarById/deleteUserCalendars
 *   - `oauth_code_nonces`  — the replay guard (deleteExpiredOAuthNonces +
 *                           insertOAuthNonceIgnoreDuplicate) shared by gcal/msft callback
 *
 * Every method is a THIN passthrough over the exact query chain the facade ran
 * inline before this extraction (999.942 discipline: byte-identical SQL, no
 * shape change). Branching, error handling, JSON (de)serialization, and crypto
 * hashing all stay in the facade — this port only models the persistence call.
 *
 * `now()` is the MySQL server-clock raw expression (knex `fn.now()`) used for
 * `updated_at` stamps on these tables — NOT the P1/ADR-0003-governed
 * last-synced columns (those stay owned by SyncStateRepositoryPort, which
 * requires a JS Date, never db.fn.now()). This is a DIFFERENT column/invariant;
 * `updated_at` here always used db.fn.now() in the legacy code and that is
 * reproduced verbatim, not "fixed".
 *
 * @typedef {Object} CalendarAccountRepositoryPort
 *
 * @property {(userId: (string|number)) => Promise<?Object>} getUser
 * @property {(userId: (string|number), fields: Object) => Promise<number>} updateUser
 * @property {() => *} now
 *
 * @property {(userId: (string|number), configKey: string) => Promise<?Object>} getUserConfig
 * @property {(fields: Object) => Promise<*>} insertUserConfig
 * @property {(userId: (string|number), configKey: string, fields: Object) => Promise<number>} updateUserConfig
 * @property {(userId: (string|number), configKey: string) => Promise<number>} deleteUserConfig
 *
 * @property {() => Promise<*>} deleteExpiredOAuthNonces
 * @property {(hash: string) => Promise<*>} insertOAuthNonceIgnoreDuplicate
 *
 * @property {(userId: (string|number), provider: string) => Promise<Object[]>} findUserCalendars
 * @property {(userId: (string|number), provider: string, calendarId: string) => Promise<?Object>} findUserCalendarByCalendarId
 * @property {(userId: (string|number), provider: string) => Promise<?Object>} findFirstEnabledUserCalendar
 * @property {(id: (string|number)) => Promise<?Object>} findUserCalendarById
 * @property {(id: (string|number), userId: (string|number)) => Promise<?Object>} findUserCalendarByIdForUser
 * @property {(fields: Object) => Promise<*>} insertUserCalendar
 * @property {(id: (string|number), fields: Object) => Promise<number>} updateUserCalendarById
 * @property {(userId: (string|number), provider: string) => Promise<number>} deleteUserCalendars
 */

/**
 * The exact set of methods a CalendarAccountRepositoryPort implementation
 * MUST expose. A contract test asserts adapters conform to this list.
 * @type {ReadonlyArray<string>}
 */
var CALENDAR_ACCOUNT_REPOSITORY_PORT_METHODS = Object.freeze([
  'getUser',
  'updateUser',
  'now',
  'getUserConfig',
  'insertUserConfig',
  'updateUserConfig',
  'deleteUserConfig',
  'deleteExpiredOAuthNonces',
  'insertOAuthNonceIgnoreDuplicate',
  'findUserCalendars',
  'findUserCalendarByCalendarId',
  'findFirstEnabledUserCalendar',
  'findUserCalendarById',
  'findUserCalendarByIdForUser',
  'insertUserCalendar',
  'updateUserCalendarById',
  'deleteUserCalendars'
]);

module.exports = {
  CALENDAR_ACCOUNT_REPOSITORY_PORT_METHODS: CALENDAR_ACCOUNT_REPOSITORY_PORT_METHODS
};
