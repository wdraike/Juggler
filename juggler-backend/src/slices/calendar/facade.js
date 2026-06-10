/**
 * Calendar slice facade — Wave 4 / W4.
 *
 * AGGREGATING RE-EXPORT SURFACE. This is the single public API the calendar
 * controllers will import in W5. It contains NO sync-orchestration logic and
 * NO behavior of its own — every function exposed here is the SAME
 * implementation already used in production, re-exported by reference.
 *
 * A controller swapping:
 *     require('../lib/cal-adapters')   ->  require('../slices/calendar/facade')
 *     require('../lib/sync-lock')      ->  require('../slices/calendar/facade')
 * gets byte-identical behavior.
 *
 * Design choice (registry): the facade OWNS the adapter registry directly over
 * the slice adapters (Wave 5 / W5). The tiny registry logic (getAllAdapters /
 * getConnectedAdapters / getAdapter / registerAdapter over {gcal, msft, apple})
 * is the SAME logic previously in `src/lib/cal-adapters/index.js`, copied
 * verbatim. The lib/cal-adapters/* files are now thin shims that re-export FROM
 * this facade, so the frozen migration history (which requires cal-adapters)
 * keeps working byte-identically while the dependency direction points into the
 * slice — no require cycle, since the facade no longer requires lib/cal-adapters.
 *
 * Design note (60d sync window): the controller computes the 14d-back / 60d-
 * forward window INLINE using `localToUtc` / `utcToLocal` from
 * `scheduler/dateHelpers`. There is no named window helper to re-export, so the
 * facade re-exports those SAME date helpers (by reference). No window is
 * recomputed here.
 */

// ── sync-lock (re-exported by reference, no wrapper logic) ──────────
var syncLock = require('../../lib/sync-lock');

// ── date helpers backing the 60d sync window (same refs as controller) ──
var dateHelpers = require('../../scheduler/dateHelpers');

// ── CalendarPort + adapter classes/singletons + repository ─────────
var CalendarPort = require('./domain/ports/CalendarPort');
var SyncStateRepositoryPort = require('./domain/ports/SyncStateRepositoryPort');
var CalendarEvent = require('./domain/entities/CalendarEvent');
var SyncState = require('./domain/entities/SyncState');
var EventId = require('./domain/value-objects/EventId');
var ProviderType = require('./domain/value-objects/ProviderType');

var GoogleCalendarAdapter = require('./adapters/GoogleCalendarAdapter');
var MicrosoftCalendarAdapter = require('./adapters/MicrosoftCalendarAdapter');
var AppleCalendarAdapter = require('./adapters/AppleCalendarAdapter');
var InMemoryCalendarAdapter = require('./adapters/InMemoryCalendarAdapter');
var KnexSyncStateRepository = require('./adapters/KnexSyncStateRepository');

// ── adapter registry (owned here over slice adapters — W5) ─────────
// Default registry is EXACTLY {gcal, msft, apple} — identical to the prior
// lib/cal-adapters/index.js registry. InMemory is a named export but is NOT in
// the default registry (it never was). Registry logic copied verbatim.
var adapters = {
  gcal: GoogleCalendarAdapter,
  msft: MicrosoftCalendarAdapter,
  apple: AppleCalendarAdapter
};

/**
 * Get all registered adapters as an array.
 */
function getAllAdapters() {
  return Object.values(adapters);
}

/**
 * Get adapters that are connected for a given user.
 */
function getConnectedAdapters(user) {
  return getAllAdapters().filter(function(a) { return a.isConnected(user); });
}

/**
 * Get a specific adapter by provider ID.
 */
function getAdapter(providerId) {
  return adapters[providerId] || null;
}

/**
 * Register a new adapter (for future providers like Apple, Yahoo).
 */
function registerAdapter(adapter) {
  adapters[adapter.providerId] = adapter;
}

/**
 * CalendarService — thin aggregation per the README shape.
 *
 * `initialize(deps)` is side-effect-free: it returns the facade itself so
 * callers can do `const facade = calendar.initialize()`. It does NOT wire up
 * any new orchestration, registration, or background work — sync orchestration
 * lives in the controllers (REFACTOR mode: no behavior change). `deps` is
 * accepted for README-shape compatibility but intentionally unused; the slice
 * adapters resolve their own dependencies as they do today.
 */
function initialize(/* deps */) {
  return module.exports;
}

module.exports = {
  // initializer (thin, side-effect-free)
  initialize: initialize,

  // adapter registry surface (owned here over slice adapters)
  getAdapter: getAdapter,
  getConnectedAdapters: getConnectedAdapters,
  getAllAdapters: getAllAdapters,
  registerAdapter: registerAdapter,

  // sync-lock surface (re-exported by reference — same function objects)
  acquireLock: syncLock.acquireLock,
  releaseLock: syncLock.releaseLock,
  refreshLock: syncLock.refreshLock,
  withSyncLock: syncLock.withSyncLock,
  withLock: syncLock.withLock,
  isLocked: syncLock.isLocked,

  // 60d sync-window date helpers (same refs the controller uses today)
  localToUtc: dateHelpers.localToUtc,
  utcToLocal: dateHelpers.utcToLocal,
  dateHelpers: dateHelpers,

  // domain ports
  CalendarPort: CalendarPort,
  SyncStateRepositoryPort: SyncStateRepositoryPort,

  // domain entities + value objects
  CalendarEvent: CalendarEvent,
  SyncState: SyncState,
  EventId: EventId,
  ProviderType: ProviderType,

  // adapter implementations
  GoogleCalendarAdapter: GoogleCalendarAdapter,
  MicrosoftCalendarAdapter: MicrosoftCalendarAdapter,
  AppleCalendarAdapter: AppleCalendarAdapter,
  InMemoryCalendarAdapter: InMemoryCalendarAdapter,
  KnexSyncStateRepository: KnexSyncStateRepository,
};
