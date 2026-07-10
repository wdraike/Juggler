# Timezone Crossing Rules

**Document:** TIMEZONE-RULES.md
**Service:** juggler
**Status:** active
**Last Updated:** 2026-06-26

## Purpose

Define unambiguous rules for how juggler handles timezone crossings across all
subsystems: storage, display, scheduling, recurrence, calendar sync, and DST
boundaries. Every use case and requirement involving time must have a defined
rule for timezone handling.

---

## 1. Storage Timezone

**Rule TZ-STORAGE-1 (UTC Canonical):** All datetime values in the database MUST
be stored in UTC. No local-time or floating-time values are written to the DB.

**Rule TZ-STORAGE-2 (ISO 8601):** All stored datetime values MUST use ISO 8601
format with Z suffix (e.g., `2026-06-17T14:30:00Z`). No offset-based formats
(e.g., `+05:00`) are stored.

**Rule TZ-STORAGE-3 (Date-only fields):** Fields that represent a date without
a time (e.g., `date` column on tasks) store the date in the user's local
timezone context at the time of creation. The date string `2026-06-17` means
"June 17 in whatever timezone the user was in when the task was created."

**Rule TZ-SCHEMA-1 (users.timezone NOT NULL — migration 20260626000000):** The
`users.timezone` column is schema-level `NOT NULL DEFAULT 'America/New_York'
COLLATE utf8mb4_unicode_ci` (migration
`20260626000000_users_timezone_not_null.js`). All pre-existing NULL values were
backfilled to `'America/New_York'` on migration up. For any existing `users`
row, `timezone` is therefore always non-null. Readers of `users.timezone` do
NOT need a column-null fallback; the `America/New_York` default is enforced at
both the schema level (DEFAULT) and the application level.

**Application-layer nuance:** As of 999.1222 (ruling 2026-07-06, superseding the
999.899 auto-detect), `users.timezone` is owned by **Settings only**. It is set
ONCE at first-login provisioning from the real browser IANA zone sent in the
dedicated `X-Browser-Timezone` header; the `America/New_York` default is only
used when that header is absent or contains an invalid IANA name. The
`X-Timezone` header carries the configured/display timezone (TZ-DISPLAY-3) and
is **display-only** — jwt-auth never overwrites the stored timezone on
subsequent requests.

**Rationale:** UTC storage eliminates ambiguity across server locations, DST
transitions, and multi-timezone teams. Date-only fields are an exception because
they represent a calendar day boundary, not an instant in time. The NOT NULL
DEFAULT contract (TZ-SCHEMA-1) moves the America/New_York fallback from
application code into the schema, enforcing it as a single-source invariant.

---

## 2. Display Timezone

**Rule TZ-DISPLAY-1 (User's Timezone):** All datetimes presented to the user
MUST be converted from UTC to the user's configured timezone before display.
The user's timezone is determined by the `timezone` field on the `users` table
(or the `x-timezone` request header, which takes precedence for the current
request). As of migration `20260626000000`, `users.timezone` is schema-level
NOT NULL — any existing row always carries a non-null IANA timezone value (see
TZ-SCHEMA-1).

**Rule TZ-DISPLAY-2 (Header Override):** The `x-timezone` HTTP header, when
present on a request, overrides the user's stored timezone for that request
only. This allows the frontend to send the browser's detected timezone without
persisting it.

**Rule TZ-DISPLAY-3 (Fallback):** If neither the user's stored timezone nor the
`x-timezone` header is available, the system defaults to `America/New_York`. As
of migration `20260626000000` (TZ-SCHEMA-1), a null `users.timezone` column
cannot occur for any existing row; this fallback now covers only: an absent user
row, or a missing `x-timezone` header. (Handling of an invalid stored IANA name
is not currently validated by the code and is tracked separately — see
TZ-ERR-1.)

**Rule TZ-DISPLAY-4 (IANA Names):** All timezone identifiers MUST be IANA
timezone names (e.g., `America/New_York`, `Europe/London`, `Asia/Tokyo`).
POSIX-style offsets, Windows timezone names, and three-letter abbreviations
(EST, PST) are NOT accepted.

**Rule TZ-DISPLAY-5 (scheduledAtUtc):** The scheduler emits a `scheduledAtUtc`
field on every placement, which is the UTC ISO string. The frontend converts
this to the user's timezone for display. This ensures timezone-independent
frontend hydration.

---

## 3. DST Boundaries

**Rule TZ-DST-1 (UTC Invariance):** DST transitions do not affect stored UTC
values. A task stored as `2026-03-08T07:00:00Z` remains that value regardless
of whether the user's timezone is in standard or daylight time.

**Rule TZ-DST-2 (Spring-Forward):** When a user's timezone springs forward
(clocks advance 1 hour), a task scheduled at a local time that does not exist
(e.g., 2:30 AM Eastern on the transition day) MUST be rounded to the nearest
existing local time. The scheduler places the task at the first available slot
after the transition.

**Rule TZ-DST-3 (Fall-Back):** When a user's timezone falls back (clocks
retreat 1 hour), a task scheduled at a local time that occurs twice (e.g.,
1:30 AM Eastern on the transition day) MUST be placed in the FIRST occurrence
(daylight time), not the second (standard time). The UTC value is unambiguous.

**Rule TZ-DST-4 (Duration Invariance):** Task durations are measured in
wall-clock minutes, not calendar minutes. A 60-minute task that spans a DST
transition is still 60 wall-clock minutes. The UTC start and end times reflect
the actual elapsed wall-clock time.

**Rule TZ-DST-5 (computeDurationMinutes):** The `computeDurationMinutes`
helper MUST compute duration as the difference between UTC end and UTC start
timestamps, which naturally handles DST boundaries correctly (no off-by-60
error).

---

## 4. Cross-Timezone Scheduling

**Rule TZ-CROSS-1 (UTC Scheduling):** The scheduler operates entirely in UTC.
All placement calculations use UTC timestamps. The user's timezone is used only
for:
- Determining the current "today" date boundary (for overdue detection)
- Converting display times
- Expanding recurring instances across day boundaries

**Rule TZ-CROSS-2 (Today Boundary):** The scheduler determines "today" by
converting the current UTC time to the user's timezone and extracting the date.
This means a user in UTC+14 sees "tomorrow" earlier than a user in UTC-12.

**Rule TZ-CROSS-3 (Day Window):** A task's scheduled day is determined by
converting its UTC placement time to the user's timezone and extracting the
date. A task placed at 2026-06-17T03:00:00Z for a user in America/New_York
(UTC-4 in EDT) appears on June 16 (local), not June 17.

**Rule TZ-CROSS-4 (Multi-Timezone Teams):** When a task is shared or assigned
across users in different timezones, each user sees the task's time converted
to their own timezone. The stored UTC value is the single source of truth.

---

## 5. Recurring Instances Across DST

**Rule TZ-RECUR-1 (Anchor Time):** Recurring tasks have an anchor time derived
from the first occurrence's local time. This anchor time is preserved across
DST transitions. For example, a weekly task first created at 10:00 AM Eastern
in January (EST, UTC-5) remains at 10:00 AM Eastern in July (EDT, UTC-4) —
the UTC time shifts from 15:00Z to 14:00Z, but the local display time is
stable.

**Rule TZ-RECUR-2 (Rolling Anchor — R33):** The rolling anchor mechanism
preserves the user's intended local time across DST boundaries. When a
recurring instance is generated, its UTC time is computed by converting the
anchor local time + date to UTC using the user's current timezone offset.

**Rule TZ-RECUR-3 (Day-Lock Placement):** Recurring instances are day-locked
to their cycle day in the user's timezone. A weekly task on "Monday" stays on
Monday in the user's timezone, even if the UTC date shifts by ±1 day across
DST boundaries.

**Rule TZ-RECUR-4 (Cycle Window):** A recurring instance's implied deadline is
the end of its cycle window (the moment the next occurrence begins). This
window is computed in the user's timezone to ensure no overlap across
occurrences.

**Rule TZ-RECUR-5 (Times-Per-Cycle):** When `timesPerCycle` is set, the
available day count is computed in the user's timezone. DST transitions that
add or remove an hour from a day do not change the day count — the calendar
day boundary is the unit, not the 24-hour period.

---

## 6. Calendar Sync Timezone Rules

**Rule TZ-SYNC-1 (UTC Push):** When pushing a juggler task to an external
calendar (GCal, MSFT, Apple), the event's start/end times are sent as UTC with
the user's IANA timezone as the event timezone. The external calendar provider
handles the local display conversion.

**Rule TZ-SYNC-2 (UTC Pull):** When pulling events from an external calendar,
all event times are converted to UTC before storage. The `ical.js` timezone-aware
conversion is used for Apple CalDAV (floating-time DTSTART with TZID). GCal and
MSFT events arrive with UTC times or explicit timezone offsets.

**Rule TZ-SYNC-3 (Floating Time Fix — BF-5):** Apple CalDAV events with
floating-time DTSTART (TZID present, no Z suffix) MUST be converted to UTC
using the TZID timezone before storage. The `parseVEvents` function uses
`ical.js` timezone-aware conversion to produce a UTC string with Z suffix.

**Rule TZ-SYNC-4 (Allday Events):** Allday events are stored as date-only
values (`date` field, no time). The date is the calendar date in the user's
timezone at the time of sync. UTC midnight conversion must not shift the date
for users in negative-offset timezones.

**Rule TZ-SYNC-5 (isoToJugglerDate):** The `isoToJugglerDate` helper converts
a UTC ISO string to the user's timezone and returns `{ time, date }`. This
conversion must be deterministic regardless of the server's timezone.

**Rule TZ-SYNC-6 (jugglerDateToISO):** The `jugglerDateToISO` helper converts
a date+time in the user's timezone to a UTC ISO string. For allday events in
UTC+12 or UTC-12 timezones, the date string must remain unchanged (no off-by-one
error).

---

## 7. API Contract

**Rule TZ-API-1 (Input):** The API accepts times in the user's local timezone
(as determined by `x-timezone` header or user profile). The server converts to
UTC before storage.

**Rule TZ-API-2 (Output):** The API returns times as UTC ISO strings with Z
suffix. The frontend is responsible for converting to the user's timezone for
display. The `scheduledAtUtc` field on placements is the canonical UTC value.

**Rule TZ-API-3 (x-timezone Header):** All schedule-related endpoints accept
the `x-timezone` header. Routes that use it:
- `POST /api/schedule/run` — reads `x-timezone` for scheduling context
- `GET /api/schedule/placements` — reads `x-timezone` for date boundary
- `POST /api/schedule/place` — reads `x-timezone` for placement context

---

## 8. Implementation Reference

| Component | File | TZ Rules Applied |
|-----------|------|-----------------|
| Scheduler session | `src/scheduler/schedulerSession.js` | TZ-DISPLAY-1, TZ-DISPLAY-3, TZ-CROSS-2 |
| Schedule runner | `src/scheduler/runSchedule.js` | TZ-STORAGE-1, TZ-CROSS-1, TZ-CROSS-2, TZ-DISPLAY-5 |
| Unified scheduler | `src/scheduler/unifiedScheduleV2.js` | TZ-CROSS-1, TZ-CROSS-3 |
| Schedule routes | `src/routes/schedule.routes.js` | TZ-DISPLAY-2, TZ-API-3 |
| Calendar sync helpers | `src/calendar/cal-sync-helpers.js` | TZ-SYNC-1 through TZ-SYNC-6 |
| Apple CalDAV parser | `src/calendar/apple-cal-api.js` | TZ-SYNC-3 (BF-5 fix) |
| User config schema | `src/schemas/config.schema.js` | TZ-DISPLAY-4 (timezoneOverride) |
| Schema migration | `src/db/migrations/20260626000000_users_timezone_not_null.js` | TZ-SCHEMA-1 |

---

## 9. Test Coverage

| Test File | TZ Rules Covered |
|-----------|-----------------|
| `tests/unit/cal-sync-helpers-tz.test.js` | TZ-SYNC-5, TZ-SYNC-6, TZ-DST-4, TZ-DST-5 |
| `tests/unit/apple-cal-parse.test.js` | TZ-SYNC-3 (BF-5) |
| `tests/unit/scheduler-core-gaps.test.js` | TZ-CROSS-1, TZ-CROSS-2 |
| `tests/unit/recurring-override.test.js` | TZ-RECUR-1, TZ-RECUR-2 |
| `tests/unit/tpc-budget-aware.test.js` | TZ-RECUR-5 |
| `tests/migrations/20260626000000_users_timezone_not_null.test.js` | TZ-SCHEMA-1 (NOT NULL enforcement + NULL backfill) |

---

## 10. Error Handling

**Rule TZ-ERR-1 (Invalid Timezone):** If a user's stored timezone or
`x-timezone` header contains an invalid IANA timezone name, the system MUST
fall back to `America/New_York` and log a warning. The request MUST NOT fail.

**Rule TZ-ERR-2 (Missing Timezone):** If no timezone is available (no user row,
or no `x-timezone` header), the system MUST use the default `America/New_York`
and proceed normally. The request MUST NOT fail. A null `users.timezone` column
is no longer a trigger for this fallback — TZ-SCHEMA-1 ensures the column is
non-null for any existing row; the remaining triggers are an absent user row or
a missing `x-timezone` header.

**Rule TZ-ERR-3 (Ambiguous Time):** During a fall-back DST transition, if a
local time is ambiguous (occurs twice), the system MUST use the first
occurrence (daylight time / UTC offset before the transition). This is
consistent with standard JavaScript `Date` behavior when converting from
local time to UTC.
