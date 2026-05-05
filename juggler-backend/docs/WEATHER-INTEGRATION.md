# Weather Integration — Design Spec

Juggler surfaces weather context in all calendar views and optionally constrains task scheduling to user-defined weather conditions (temperature range, precipitation tolerance, sky cover).

---

## 1. Overview

### Goals
- Show per-day and per-hour weather (temperature, precipitation chance, cloud cover) in every calendar view header
- Allow tasks and recurring templates to declare weather conditions that must be met before the scheduler will place them
- Keep the feature non-intrusive: default `any` on all conditions means existing tasks are unaffected

### Weather API: Open-Meteo
- Free, no API key required, CORS-enabled
- Hourly data up to 14 days: `temperature_2m`, `precipitation_probability`, `precipitation`, `cloudcover`, `weathercode`
- Separate geocoding API: city/state/country or lat/lon → coordinates
- **Non-commercial free tier (10K calls/day). Commercial use requires $29/month plan — required once Juggler has paying subscribers.**

### Backend-Proxied Fetch
All weather fetches go through a backend endpoint (`GET /api/weather`). The backend caches results in the `weather_cache` table keyed by rounded coordinates + date. This gives the scheduler direct access to forecast data without additional round trips.

---

## 2. Location Configuration

### Per-Location Coordinates
Each user location (home, work, gym, etc.) gains optional lat/lon fields. The user can populate them via:
- **"Locate me"** button — browser `navigator.geolocation`, sent to backend and stored
- **City/State/Country or ZIP lookup** — frontend calls `/api/weather/geocode?q=...` which proxies Open-Meteo's geocoding API and returns coordinates

If a location has no coordinates:
- **Browser location** is used as fallback (requested once, cached per session)
- If the user denies browser geolocation and no locations have coordinates → weather feature is silently disabled (no error, just no weather shown)

### Location Used for Scheduler Weather Check
When evaluating a candidate time slot for a weather-constrained task, the scheduler uses the coordinates of the **location active for that day** (resolved via `getLocationForDate(dateKey, schedCfg)`). If that location has no coordinates, the task's weather constraint is skipped for that slot (treated as `any`).

---

## 3. Weather Cache

### Table: `weather_cache`

```sql
CREATE TABLE weather_cache (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lat_grid     DECIMAL(5,2) NOT NULL,   -- rounded to 0.1° (~10km grid)
  lon_grid     DECIMAL(5,2) NOT NULL,
  fetched_at   DATETIME NOT NULL,
  expires_at   DATETIME NOT NULL,
  forecast_json MEDIUMTEXT NOT NULL,    -- raw Open-Meteo hourly response
  INDEX idx_weather_cache_coords_exp (lat_grid, lon_grid, expires_at)
) COLLATE utf8mb4_unicode_ci;
```

### Cache Key
Coordinates are rounded to 1 decimal place (≈10 km grid) before lookup. `lat_grid = ROUND(lat, 1)`, `lon_grid = ROUND(lon, 1)`.

### TTL
1 hour. On cache hit (any row with `expires_at > NOW()` for the same grid cell), the cached JSON is returned. On miss, Open-Meteo is queried for 14 days of hourly data, result stored, `expires_at = NOW() + 1 HOUR`.

### API Endpoint
```
GET /api/weather?lat=40.71&lon=-74.01
```
Returns:
```json
{
  "hourly": {
    "time":                    ["2026-05-05T00:00", ...],
    "temperature_2m":          [18.4, ...],
    "precipitation_probability":[5, ...],
    "precipitation":           [0.0, ...],
    "cloudcover":              [12, ...],
    "weathercode":             [1, ...]
  },
  "hourly_units": {
    "temperature_2m": "°C",
    "precipitation_probability": "%",
    "precipitation": "mm",
    "cloudcover": "%"
  },
  "cachedAt": "2026-05-05T14:00:00Z",
  "expiresAt": "2026-05-05T15:00:00Z"
}
```

Temperature unit (`°C` / `°F`) is controlled by a user setting stored in `user_config` (`temperature_unit: 'C' | 'F'`), passed as a query param to Open-Meteo.

### Geocoding Endpoint
```
GET /api/weather/geocode?q=Brooklyn+NY+USA
GET /api/weather/geocode?q=11201
```
Proxies Open-Meteo's geocoding API. Returns `{ lat, lon, displayName }`. No caching needed (called only during location setup).

---

## 4. Weather Condition Enumerations

### Precipitation Tolerance (task field: `weather_precip`)
Applied against the hourly `precipitation_probability` for the task's candidate time slot.

| Value | Label (UI) | Condition passes when |
|---|---|---|
| `any` | Any weather (default) | Always passes — no constraint |
| `wet_ok` | Rain/snow OK | Always passes — any precipitation level |
| `light_ok` | Light rain OK | `precipitation_probability ≤ 50%` |
| `dry_only` | Dry only | `precipitation_probability ≤ 20%` |

Note: `wet_ok` and `any` both always pass for precipitation — `wet_ok` signals intent ("this is an outdoor task, just one that can get wet") and may be used in future nudge logic, but the scheduler treats it identically to `any` for placement.

### Sky Cover (task field: `weather_cloud`)
Applied against the hourly `cloudcover` percentage.

| Value | Label (UI) | Condition passes when |
|---|---|---|
| `any` | Any sky (default) | Always passes |
| `overcast_ok` | Overcast OK | Always passes |
| `partly_ok` | Partly cloudy OK | `cloudcover ≤ 60%` |
| `clear` | Clear sky only | `cloudcover ≤ 25%` |

### Temperature Range (task fields: `weather_temp_min`, `weather_temp_max`)
- Both nullable integers. If both null → no temperature constraint.
- Unit stored in the task's native unit (°C or °F, matching `user_config.temperature_unit` at time of creation; stored in `weather_temp_unit` on the task so display converts correctly if the user later changes their unit preference).
- Condition passes when: `temperature_2m >= weather_temp_min` AND `temperature_2m <= weather_temp_max` (null bounds = open-ended).

---

## 5. Task & Template Schema Changes

### New columns on `task_masters`

```sql
ALTER TABLE task_masters
  ADD COLUMN weather_precip   ENUM('any','wet_ok','light_ok','dry_only') NOT NULL DEFAULT 'any',
  ADD COLUMN weather_cloud    ENUM('any','overcast_ok','partly_ok','clear') NOT NULL DEFAULT 'any',
  ADD COLUMN weather_temp_min SMALLINT NULL,
  ADD COLUMN weather_temp_max SMALLINT NULL,
  ADD COLUMN weather_temp_unit CHAR(1) NULL;  -- 'C' or 'F'; null = inherited from user setting
```

These columns live on `task_masters` (templates + one-off masters). Recurring instances inherit them via the existing template-merge in `rowToTask`. The `tasks_v` view must expose them.

### Frontend task shape additions
```js
weatherPrecip:   'any' | 'wet_ok' | 'light_ok' | 'dry_only'   // default 'any'
weatherCloud:    'any' | 'overcast_ok' | 'partly_ok' | 'clear' // default 'any'
weatherTempMin:  number | null
weatherTempMax:  number | null
weatherTempUnit: 'C' | 'F' | null
```

---

## 6. Scheduler Integration

### Weather as a Hard Constraint
Weather conditions are **hard constraints** in the same tier as `when` time-block tags and `location`/`tools`. A task with `weather_precip: 'dry_only'` will **never** be placed in a slot where `precipitation_probability > 20%`. If no qualifying slot exists within the scheduling horizon, the task goes **unscheduled** (same as any other capacity failure).

### Scheduler Changes

**Load phase:** Before the main scheduling loop, load weather data for all dates in the horizon from `weather_cache` (backend DB). Build a lookup structure:
```
weatherByDateHour[dateKey][hourOfDay] = { temp, precipProb, cloudcover }
```

**Slot qualification:** In `findEarliestSlot` (and the Phase 0 immovable pass), add a `weatherOk(item, dateKey, startMin)` check:
1. If all of task's weather fields are `any`/null → return true immediately (no overhead for the common case)
2. Look up `weatherByDateHour[dateKey][floor(startMin/60)]`
3. If no weather data for that slot (location has no coordinates, or cache miss) → return true (fail-open)
4. Check `precipProb`, `cloudcover`, `temp` against task's bounds → return false if any fail

**Unscheduled handling:** Same as capacity failure — task lands in `unplaced` array with `reason: 'weather'` (new reason code alongside existing `'capacity'`).

### Weather Data Loading in `runSchedule.js`
```js
// After loading tasks, before building the scheduler queue:
var weatherByDateHour = {};
if (hasWeatherConstrainedTasks(allTasks)) {
  var locationCoords = resolveLocationCoords(schedCfg, userLocations);
  weatherByDateHour = await loadWeatherForHorizon(dates, locationCoords, db);
}
```

`loadWeatherForHorizon` queries `weather_cache` for all relevant (lat_grid, lon_grid) entries covering the scheduling horizon. If a location's cache is stale, it triggers a fresh Open-Meteo fetch inline (acceptable at schedule-run time; adds ~200ms per location on cache miss).

---

## 7. Cache Refresh & Reschedule Trigger

When weather cache expires, user weather may shift (e.g., a forecast that was 15% rain becomes 60%). Tasks that were placed in now-unsuitable slots need rescheduling; tasks that were unscheduled due to weather may now have valid slots.

### Refresh Mechanism
A lightweight background check runs when the user loads the app or when the schedule view mounts:
1. Frontend requests `/api/weather?lat=X&lon=Y` for the user's primary location
2. Backend checks `expires_at`. If expired: fetches fresh data, updates `weather_cache`, returns updated forecast
3. If data was stale (cache was refreshed), backend responds with `{ refreshed: true }`
4. Frontend SSE path: on `refreshed: true`, enqueue a scheduler run via the existing `scheduleQueue` mechanism with reason `'weather_refresh'`

This piggybacks on the existing scheduler event queue — no new infrastructure needed.

---

## 8. Calendar View Display

### Data Flow
`AppLayout` fetches weather on mount via `/api/weather` for the user's primary location coordinates (stored in `user_config.primary_lat/lon`). Weather data is stored in state as `weatherByDate` and passed as a prop to all schedule views.

### Per-View Weather Rendering

| View | Weather placement | Data shown |
|---|---|---|
| **DayView** | Fixed day header, after location name | Condition icon + high/low temp + precip % if ≥ 30% |
| **WeekView** | Each day column header | Condition icon + high temp + precip % if ≥ 30% |
| **ThreeDayView** | Each day column header | Same as WeekView |
| **MonthView** | Each day cell (space-constrained) | Condition icon + high temp only |
| **DailyView** | Day header area | Same as DayView |
| **ListView** | Inline date group header | Condition icon + high/low |
| **CalendarView** | Per-day header row | Condition icon + high temp |

Clock/countdown views: no weather display (not date-anchored).

### Condition Icons
Mapped from Open-Meteo `weathercode` (WMO standard):
- 0 = ☀ Clear sky
- 1–3 = ⛅ Partly cloudy
- 45–48 = 🌫 Fog
- 51–67 = 🌧 Rain (various intensities)
- 71–77 = ❄ Snow
- 80–82 = 🌦 Showers
- 85–86 = 🌨 Snow showers
- 95–99 = ⛈ Thunderstorm

### Display Format
```
[⛅ 72° / 54°]           — day with high/low, no rain callout
[🌧 68° / 55° · 65%]    — rain probable, show percentage
[❄ 28° / 18° · 80%]    — snow
```

Temperature unit follows `user_config.temperature_unit` ('C' or 'F'). Default: °F.

---

## 9. Task Detail UI

A new **Weather Conditions** collapsible section in the task edit/detail view (below the scheduling section). Only shown when the task has an active location with coordinates, or browser location is available. Can be expanded by any task.

```
Weather Conditions
─────────────────────────────────────────────────────
Precipitation    [Any weather ▾]   Sky cover   [Any sky ▾]

Temperature      Min [    ] °F     Max [    ] °F
                 (leave blank = no restriction)
─────────────────────────────────────────────────────
```

Dropdowns use the label column from Section 4 (e.g. "Dry only", "Light rain OK").

For recurring templates, conditions apply to all instances via template inheritance. Individual instances cannot override weather conditions (same rule as all other template fields).

---

## 10. Location Config UI Changes

In the location editor (currently shows id, name, icon):

```
Location Name   [Home            ]
Icon            [🏠              ]
Coordinates     [                ]  [Locate me]
                  City, State, Country  or  ZIP code
```

The coordinates field accepts free text (city/state, ZIP). On blur or Enter, calls `/api/weather/geocode` and auto-fills. "Locate me" triggers `navigator.geolocation.getCurrentPosition()` and stores the result. The resolved `displayName` is shown below the field as confirmation.

Stored in `user_config` as part of the existing `locations` array:
```json
{ "id": "home", "name": "Home", "icon": "🏠", "lat": 40.71, "lon": -74.01 }
```

---

## 11. Implementation Phases

### Phase 1 — Foundation (no visible user change)
- `weather_cache` DB table migration
- `weather_precip`, `weather_cloud`, `weather_temp_min/max/unit` columns on `task_masters` (+ tasks_v view update)
- `/api/weather` backend endpoint (fetch, cache, return)
- `/api/weather/geocode` backend endpoint (proxy Open-Meteo geocoding)
- `temperature_unit` user setting in `user_config` (C/F toggle)
- Location config: add lat/lon fields to location objects in user_config schema

### Phase 2 — Display
- `useWeather` hook in frontend (fetch `/api/weather`, parse by date+hour)
- Weather badge component (icon + temp + precip %)
- Wire into DayView, WeekView, ThreeDayView day headers
- Wire into MonthView day cells
- Wire into DailyView, ListView, CalendarView
- Location settings UI: geocode input + "Locate me" button

### Phase 3 — Scheduler Integration
- `loadWeatherForHorizon()` helper in `runSchedule.js`
- `weatherOk()` slot qualifier in `unifiedScheduleV2.js`
- Pass `weatherByDateHour` through scheduler context
- New `reason: 'weather'` in unplaced output
- Handle fail-open (no weather data → don't block placement)

### Phase 4 — Task Detail UI
- Weather Conditions section in task detail/edit view
- Dropdowns + number inputs
- Save to task_masters via existing task write path
- Display in task cards (small weather badge if constraints set)

### Phase 5 — Refresh & Reschedule
- On weather cache refresh (`refreshed: true` from `/api/weather`), enqueue scheduler run
- Unscheduled reason `'weather'` surfaces in unplaced panel with hint: "No suitable weather window found in the next 14 days"

---

## 12. Open Questions / Future Work
- **Multi-location weather:** Currently uses primary/active location for the day. Future: show per-time-block weather if user has multiple locations in one day.
- **Weather alerts:** NWS/Open-Meteo can return active alerts. Surface as a banner in day view.
- **Outdoor task tagging:** A future `outdoor: true` tag could auto-default `weather_precip: 'light_ok'` and generate nudges when placed in rain windows.
- **Commercial license:** Open-Meteo requires $29/month paid plan at first paying Juggler subscriber.
