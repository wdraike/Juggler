/**
 * CalendarPort — the driven-port contract every calendar provider adapter
 * must satisfy. This is the authoritative interface for the calendar slice.
 *
 * This file defines the contract via JSDoc `@typedef` only (no runtime class):
 * adapters are plain CommonJS modules that export the required method set.
 * The exported `CALENDAR_PORT_METHODS` array is the machine-checkable list a
 * contract test asserts every adapter conforms to.
 *
 * The method set here mirrors the "CalendarPort Interface" table in
 * `src/slices/calendar/README.md`. Keep the two in sync.
 *
 * IMPORTANT (behavior-preserving refactor — W1):
 *   - The README/port name `getEvents` corresponds to the legacy adapter method
 *     `listEvents`, and `sync` corresponds to the legacy `hasChanges`. The new
 *     slice adapters (W2+) adopt the README names; the legacy adapters in
 *     `src/lib/cal-adapters/` keep their existing names until migrated. W1
 *     introduces no production wiring — only the contract.
 *
 * @typedef {Object} CalendarPort
 *
 * @property {string} providerId
 *   Unique provider identifier string: 'gcal' | 'msft' | 'apple' | 'memory'.
 *   See {@link ProviderType}.
 *
 * @property {(user: Object) => boolean} isConnected
 *   Returns true if `user` has this provider connected (has the required
 *   credential columns populated).
 *
 * @property {(user: Object) => Promise<*>} getValidAccessToken
 *   Resolves a fresh access token for OAuth providers, or a ready-to-use
 *   client instance for CalDAV (Apple). Throws if not connected.
 *
 * @property {(token: *, startDate: (string|Date), endDate: (string|Date), userId: (string|number)) => Promise<CalendarEvent[]>} getEvents
 *   Fetch + normalize events within the date range. (Legacy name: `listEvents`.)
 *
 * @property {(token: *, event: Object, userId: (string|number), year: number, tz: string, opts?: Object) => Promise<{providerEventId: string, raw: *, calendarId?: string}>} createEvent
 *   Create a new calendar event from a task-shaped object.
 *
 * @property {(token: *, eventId: string, event: Object, userId: (string|number), year: number, tz: string, opts?: Object) => Promise<*>} updateEvent
 *   Update an existing calendar event.
 *
 * @property {(token: *, eventId: string, userId: (string|number)) => Promise<*>} deleteEvent
 *   Delete a calendar event.
 *
 * @property {(token: *, user: Object) => Promise<{hasChanges: boolean, nextSyncToken?: string, deltaLink?: string, syncToken?: string, tokenInvalid?: boolean}>} sync
 *   Lightweight change-detection check. (Legacy name: `hasChanges`.)
 *
 * @property {() => string} getEventIdColumn
 *   DB column name on the `users`/link table for this provider's event id
 *   (e.g. 'gcal_event_id', 'msft_event_id', 'apple_event_id').
 *
 * @property {() => string} getLastSyncedColumn
 *   DB column name on the `users` table for this provider's last-synced
 *   timestamp (e.g. 'gcal_last_synced_at').
 *
 * Optional methods (documented in README "Optional Methods"; not required for
 * conformance, but adapters that support them should match these signatures):
 *
 * @property {(token: *, pairs: Array<{task: Object}>, year: number, tz: string) => Promise<Array<{taskId: *, providerEventId: ?string, raw: *, error: ?string}>>} [batchCreateEvents]
 * @property {(token: *, eventIds: string[]) => Promise<Array<{eventId: string, error: ?string}>>} [batchDeleteEvents]
 * @property {(token: *, updatePairs: Array<{eventId: string, task: Object}>, year: number, tz: string) => Promise<Array<{eventId: string, error: ?string}>>} [batchUpdateEvents]
 * @property {(event: CalendarEvent, tz: string, currentTask?: Object) => Object} [applyEventToTaskFields]
 * @property {(event: CalendarEvent) => string} [eventHash]
 * @property {(rawEvent: Object) => CalendarEvent} [normalizeEvent]
 * @property {(userId: (string|number)) => Promise<Object[]>} [getEnabledCalendars]
 * @property {(userId: (string|number)) => Promise<?Object>} [getWriteCalendar]
 */

/**
 * The exact set of methods/properties an adapter MUST expose to satisfy
 * CalendarPort. A contract test asserts this is exactly the required set
 * documented in the README (no more, no fewer).
 * @type {ReadonlyArray<string>}
 */
var CALENDAR_PORT_METHODS = Object.freeze([
  'providerId',
  'isConnected',
  'getValidAccessToken',
  'getEvents',
  'createEvent',
  'updateEvent',
  'deleteEvent',
  'sync',
  'getEventIdColumn',
  'getLastSyncedColumn'
]);

/**
 * Optional methods an adapter MAY expose. Listed for documentation/test use;
 * absence does NOT break conformance.
 * @type {ReadonlyArray<string>}
 */
var CALENDAR_PORT_OPTIONAL_METHODS = Object.freeze([
  'batchCreateEvents',
  'batchDeleteEvents',
  'batchUpdateEvents',
  'applyEventToTaskFields',
  'eventHash',
  'normalizeEvent',
  'getEnabledCalendars',
  'getWriteCalendar'
]);

module.exports = {
  CALENDAR_PORT_METHODS: CALENDAR_PORT_METHODS,
  CALENDAR_PORT_OPTIONAL_METHODS: CALENDAR_PORT_OPTIONAL_METHODS
};
