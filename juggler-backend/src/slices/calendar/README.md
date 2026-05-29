# Calendar Port Slice

Domain-driven slice for calendar functionality following hexagonal architecture.

## Structure

```
slices/calendar/
├── domain/
│   ├── entities/
│   │   └── CalendarEvent.js     # Core domain entity
│   └── ports/
│       └── CalendarPort.js      # Interface contract (JSDoc typedef)
├── adapters/
│   ├── GoogleCalendarAdapter.js   # Google Calendar implementation
│   ├── MicrosoftCalendarAdapter.js # Microsoft Calendar implementation
│   ├── AppleCalendarAdapter.js   # Apple CalDAV implementation
│   └── InMemoryCalendarAdapter.js # Test implementation
├── facade.js                     # Main API entry point
└── index.js                      # Module exports
```

## CalendarPort Interface

All calendar adapters must implement the following interface:

### Required Methods

| Method | Description |
|--------|-------------|
| `providerId` | Unique identifier string ('gcal', 'msft', 'apple', 'memory') |
| `isConnected(user)` | Check if user has this calendar provider connected |
| `getValidAccessToken(user)` | Get fresh access token (or client instance for CalDAV) |
| `getEvents(token, startDate, endDate, userId)` | Fetch events in date range |
| `createEvent(token, event, userId, year, tz, opts)` | Create new calendar event |
| `updateEvent(token, eventId, event, userId, year, tz, opts)` | Update existing event |
| `deleteEvent(token, eventId, userId)` | Delete calendar event |
| `sync(token, user)` | Lightweight sync check (returns `{ hasChanges, nextSyncToken? }`) |
| `getEventIdColumn()` | DB column name for storing event ID |
| `getLastSyncedColumn()` | DB column name for storing last sync timestamp |

### Optional Methods

| Method | Description |
|--------|-------------|
| `batchCreateEvents(token, pairs, year, tz)` | Batch create events |
| `batchDeleteEvents(token, eventIds)` | Batch delete events |
| `applyEventToTaskFields(event, tz, currentTask)` | Convert event to task fields |
| `eventHash(event)` | Compute hash for change detection |
| `normalizeEvent(rawEvent)` | Normalize provider response |
| `getEnabledCalendars(userId)` | Multi-calendar support |
| `getWriteCalendar(userId)` | Get default write calendar |

## Usage

### Basic Usage

```javascript
const { calendar } = require('./slices/calendar');

// Initialize
const facade = calendar.initialize();

// Get specific adapter
const gcal = calendar.getAdapter('gcal');
const msft = calendar.getAdapter('msft');

// Check connection
if (gcal.isConnected(user)) {
  const token = await gcal.getValidAccessToken(user);
  const events = await gcal.getEvents(token, startDate, endDate, user.id);
}
```

### Using the In-Memory Adapter for Tests

```javascript
const { InMemoryCalendarAdapter } = require('./slices/calendar');

// Setup
await InMemoryCalendarAdapter.connect(userId, { username: 'test' });
const token = await InMemoryCalendarAdapter.getValidAccessToken({ id: userId });

// Create event
const result = await InMemoryCalendarAdapter.createEvent(token, {
  text: 'Test Event',
  dur: 60,
  date: '2026-05-28',
  time: '2:00 PM'
}, userId, 2026, 'America/New_York');

// Cleanup
InMemoryCalendarAdapter.clearAll();
```

### Facade Operations

```javascript
const facade = calendar.initialize();

// Get connected adapters
const connected = facade.getConnectedAdapters(user);

// Sync all connected calendars
const syncResults = await facade.syncAll(user);

// Create event in first available calendar
const result = await facade.createEvent(user, taskData, { year: 2026, tz: 'America/New_York' });
```

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
  isTransparent: false,                   // showsAs 'free'
  eventUrl: 'https://calendar.google.com/...',
  calendarId: null,                       // For multi-calendar support
  _raw: { ... }                           // Raw provider response
}
```

## Migration from Old Adapters

The new CalendarPort adapters wrap the existing:
- `lib/gcal-api.js` → `GoogleCalendarAdapter.js`
- `lib/msft-cal-api.js` → `MicrosoftCalendarAdapter.js`
- `lib/apple-cal-api.js` → `AppleCalendarAdapter.js`

The legacy adapters in `lib/cal-adapters/` remain functional and can be migrated incrementally.

To use the new slice in existing sync code:

```javascript
// Old way (still works)
const gcalAdapter = require('../lib/cal-adapters/gcal.adapter');

// New way
const { calendar } = require('../slices/calendar');
calendar.initialize();
const gcalAdapter = calendar.getAdapter('gcal');
```

## Testing

Run manual test:
```bash
node test-calendar-slice.js
```

This verifies:
1. All adapters implement CalendarPort
2. InMemoryAdapter CRUD operations
3. Batch operations
4. Facade operations

## Dependencies

Adapters depend on existing library modules:
- `lib/gcal-api.js`
- `lib/msft-cal-api.js`
- `lib/apple-cal-api.js`
- `lib/placementModes.js`
- `controllers/cal-sync-helpers.js`
- `scheduler/dateHelpers.js`

Dependencies are injected via `initialize(deps)` for testability.
