---
type: explanation
status: active
version: leg/juggler-hex-h0-calendar @ 2026-06-09
Last-updated: 2026-06-09
---

# Calendar Slice

Hexagonal (ports-and-adapters) vertical slice for all calendar provider
functionality. Phase H0 of the juggler hex migration — the first real domain
slice.

External code must import only `slices/calendar/facade` (or
`slices/calendar`). Imports of slice internals (adapters, ports, entities) from
outside the slice are forbidden by the active ESLint boundary rule
(`npm run lint:boundaries`).

---

## Structure

```
slices/calendar/
├── domain/
│   ├── entities/
│   │   ├── CalendarEvent.js          # Core domain entity
│   │   └── SyncState.js              # Per-user, per-provider sync record
│   ├── ports/
│   │   ├── CalendarPort.js           # Driven-port contract (JSDoc typedef + CALENDAR_PORT_METHODS)
│   │   ├── SyncStateRepositoryPort.js # Sync-state persistence port (SYNC_STATE_REPOSITORY_PORT_METHODS)
│   │   └── CalendarAccountRepositoryPort.js # Account/OAuth mgmt port (CALENDAR_ACCOUNT_REPOSITORY_PORT_METHODS)
│   └── value-objects/
│       ├── EventId.js                # Immutable event ID wrapper
│       └── ProviderType.js           # Validated provider enum ('gcal'|'msft'|'apple'|'memory')
├── adapters/
│   ├── GoogleCalendarAdapter.js      # Google Calendar implementation
│   ├── MicrosoftCalendarAdapter.js   # Microsoft Calendar implementation
│   ├── AppleCalendarAdapter.js       # Apple CalDAV implementation
│   ├── InMemoryCalendarAdapter.js    # Test double (NOT in default registry)
│   ├── KnexSyncStateRepository.js    # SyncStateRepositoryPort backed by users table
│   ├── KnexCalendarAccountRepository.js     # CalendarAccountRepositoryPort — users/user_config/user_calendars/oauth_code_nonces
│   └── InMemoryCalendarAccountRepository.js # CalendarAccountRepositoryPort test double
├── facade.js                         # Public API — owns the adapter registry
└── index.js                          # Re-exports facade + `{ calendar: facade }` namespace
```

---

## Adapter Registry

The facade owns the adapter registry directly. The default registry contains
exactly three providers:

| Key | Adapter | Provider |
|-----|---------|----------|
| `gcal` | `GoogleCalendarAdapter` | Google Calendar |
| `msft` | `MicrosoftCalendarAdapter` | Microsoft/Outlook Calendar |
| `apple` | `AppleCalendarAdapter` | Apple CalDAV |

`InMemoryCalendarAdapter` is a named export from the facade and from
`slices/calendar` but is **not** in the default registry. It must be registered
explicitly if needed in non-test contexts (rare; normal test usage goes through
the named import directly).

---

## CalendarPort Interface

All calendar adapters must implement the required method set listed in
`CALENDAR_PORT_METHODS` (exported from `domain/ports/CalendarPort.js`). A
contract test asserts conformance.

### Required Methods

| Method | Description |
|--------|-------------|
| `providerId` | Unique identifier string: `'gcal'` \| `'msft'` \| `'apple'` \| `'memory'` |
| `isConnected(user)` | Returns true if the user has this provider connected |
| `getValidAccessToken(user)` | Resolves a fresh OAuth token, or a ready-to-use CalDAV client (Apple) |
| `getEvents(token, startDate, endDate, userId)` | Fetch + normalize events in date range. (Legacy alias: `listEvents`) |
| `createEvent(token, event, userId, year, tz, opts?)` | Create a new calendar event from a task-shaped object |
| `updateEvent(token, eventId, event, userId, year, tz, opts?)` | Update an existing calendar event |
| `deleteEvent(token, eventId, userId)` | Delete a calendar event |
| `sync(token, user)` | Lightweight change-detection check, returns `{ hasChanges, nextSyncToken? }`. (Legacy alias: `hasChanges`) |
| `getEventIdColumn()` | DB column name for this provider's event ID (e.g. `gcal_event_id`) |
| `getLastSyncedColumn()` | DB column name for this provider's last-synced timestamp |

Port method names are `getEvents` and `sync`. The slice adapters relocated from
`lib/cal-adapters/` also keep the legacy aliases `listEvents` and `hasChanges`
for callers that have not migrated.

### Optional Methods

| Method | Description |
|--------|-------------|
| `batchCreateEvents(token, pairs, year, tz)` | Batch event creation |
| `batchDeleteEvents(token, eventIds)` | Batch event deletion |
| `batchUpdateEvents(token, updatePairs, year, tz)` | Batch event update |
| `applyEventToTaskFields(event, tz, currentTask?)` | Convert event fields to task shape |
| `eventHash(event)` | Compute hash for change detection |
| `normalizeEvent(rawEvent)` | Normalize raw provider response to CalendarEvent |
| `getEnabledCalendars(userId)` | Multi-calendar support |
| `getWriteCalendar(userId)` | Get default write calendar for the user |

---

## SyncStateRepositoryPort

`KnexSyncStateRepository` implements `SyncStateRepositoryPort` and is the
concrete persistence adapter for per-user, per-provider sync state.

Column mapping (all on the `users` table):

| Provider | Last-synced column | Event ID column | Sync token column |
|----------|--------------------|-----------------|-------------------|
| `gcal` | `gcal_last_synced_at` | `gcal_event_id` | `gcal_sync_token` |
| `msft` | `msft_cal_last_synced_at` | `msft_event_id` | `msft_cal_delta_link` |
| `apple` | `apple_cal_last_synced_at` | `apple_event_id` | `apple_cal_sync_token` |

**Invariant P1 (ADR-0003):** `setLastSyncedAt` writes the timestamp as a JS
`new Date()` value. `db.fn.now()` and raw `NOW()` SQL are never used.

---

## Usage

### Importing the facade

```javascript
// Namespaced (matches index.js `{ calendar: facade }` export)
const { calendar } = require('./slices/calendar');

// Direct (facade methods at top level)
const facade = require('./slices/calendar/facade');
```

### Adapter registry

```javascript
const { calendar } = require('./slices/calendar');

// Get a specific adapter by provider key
const gcal = calendar.getAdapter('gcal');
const msft = calendar.getAdapter('msft');
const apple = calendar.getAdapter('apple');

// All registered adapters (gcal, msft, apple — not InMemory)
const all = calendar.getAllAdapters();

// Connected adapters for a user
const connected = calendar.getConnectedAdapters(user);

// Register an additional provider (rarely needed outside tests)
calendar.registerAdapter(myAdapter);
```

### Using a provider adapter

```javascript
const { calendar } = require('./slices/calendar');

const gcal = calendar.getAdapter('gcal');
if (gcal.isConnected(user)) {
  const token = await gcal.getValidAccessToken(user);
  const events = await gcal.getEvents(token, startDate, endDate, user.id);
}
```

### Using the InMemoryCalendarAdapter in tests

`InMemoryCalendarAdapter` is a named export but is not in the default registry.
Import it directly for test use.

```javascript
const { InMemoryCalendarAdapter } = require('./slices/calendar');

// Connect a test user
await InMemoryCalendarAdapter.connect(userId, { username: 'test' });
const token = await InMemoryCalendarAdapter.getValidAccessToken({ id: userId });

// Create an event
const result = await InMemoryCalendarAdapter.createEvent(token, {
  text: 'Test Event',
  dur: 60,
  date: '2026-05-28',
  time: '2:00 PM'
}, userId, 2026, 'America/New_York');

// Cleanup
InMemoryCalendarAdapter.clearAll();
```

### Sync-lock helpers (re-exported from facade)

The facade re-exports `lib/sync-lock` by reference. Controllers can import sync
lock operations directly from the facade:

```javascript
const { withSyncLock, acquireLock, releaseLock } = require('./slices/calendar/facade');
```

### 60-day sync-window date helpers (re-exported from facade)

The facade re-exports `localToUtc`, `utcToLocal`, and `dateHelpers` from
`scheduler/dateHelpers` by reference, for the 14-day-back / 60-day-forward sync
window computation that controllers perform inline.

---

## Event Object Shape

```javascript
{
  id: 'event-id-123',                    // Provider event ID
  title: 'Event Title',
  description: 'Event description',
  startDateTime: '2026-05-28T14:00:00Z',
  endDateTime: '2026-05-28T15:00:00Z',
  startTimezone: 'America/New_York',
  isAllDay: false,
  durationMinutes: 60,
  lastModified: '2026-05-28T10:00:00Z',
  isTransparent: false,                  // showsAs 'free'
  eventUrl: 'https://calendar.google.com/...',
  calendarId: null,                      // For multi-calendar support
  _raw: { /* raw provider response */ }
}
```

---

## Architecture Boundary

The ESLint boundary rule (`eslint.boundaries.config.js`, run via
`npm run lint:boundaries`) enforces that external code imports only the facade,
never slice internals. Direct imports of `slices/calendar/adapters/*`,
`slices/calendar/domain/ports/*`, or `slices/calendar/domain/entities/*` from
outside the slice are a lint error.

**Known gap:** `domain/value-objects/` is not yet covered by the boundary rule.
The value-object types (`EventId`, `ProviderType`) are available as named
exports from the facade; external code should use those exports rather than
importing `domain/value-objects/` directly.

---

## Back-compat Shims

`lib/cal-adapters/{gcal,msft,apple}.adapter.js` and
`lib/cal-adapters/index.js` are thin re-export shims that point at the facade.
They exist solely to keep the frozen migration history
(`20260523000100`) working without modification.

Controllers and all live code now import from the facade directly. The shim
files contain no logic and must not be edited — make changes in the slice
adapters instead. These shims are flagged for removal in a later hex phase
(H7 cleanup) once the migration history is no longer a constraint.

---

## Testing

The calendar sync suite (222 tests) covers this slice. Run via test-bed:

```bash
cd test-bed && make test-juggler
```

The suite includes:

- Contract tests asserting every registered adapter satisfies `CALENDAR_PORT_METHODS`
- `InMemoryCalendarAdapter` CRUD and batch operations
- `KnexSyncStateRepository` column-mapping and P1 timestamp invariant
- Before-and-after behavior verification (W0: behavior preserved through relocation)

---

## Dependencies

The slice adapters delegate to:

- `lib/gcal-api.js` — Google Calendar HTTP client
- `lib/msft-cal-api.js` — Microsoft Calendar HTTP client
- `lib/apple-cal-api.js` — Apple CalDAV client
- `lib/placementModes.js` — placement mode constants
- `controllers/cal-sync-helpers.js` — shared sync helpers
- `scheduler/dateHelpers.js` — date conversion utilities (also re-exported by facade)
