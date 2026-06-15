# Juggler Test Specs: Weather, Dependencies, Deadlines, Earliest-Start

Generated from codebase analysis — `unifiedScheduleV2.js`, `runSchedule.js`, `dependencyHelpers.js`, `WeatherConstraint.js`, `WeatherProviderPort` (scheduler + weather slice), `ClockPort`, `InMemoryScheduleRepository`, `MockWeatherProvider`.

---

## WEATHER (TS-142 to TS-154x)

### Data shape (from `runSchedule.js` `loadWeatherForHorizon`):
```
weatherByDateHour = {
  '2026-06-15': {
    8:  { temp: 72, precipProb: 5,  cloudcover: 30, humidity: 45 },
    14: { temp: 85, precipProb: 80, cloudcover: 70, humidity: 65 },
    ...
  }
}
```
- `precipProb` defaults to `0` when missing (via `|| 0`)
- `cloudcover` defaults to `0` when missing
- `temp` defaults to `null` when missing (ternary `? : null`)
- `humidity` defaults to `null` when missing

### `weatherOk()` logic (unifiedScheduleV2.js L753-787):
- **Precipitation**: `dry_only` → precipProb must be ≤ 20; `light_ok` → ≤ 50; `wet_ok`/`any` → always pass
- **Cloud cover**: `clear` → cloudcover ≤ 25; `partly_ok` → ≤ 60; `overcast_ok`/`any` → always pass
- **Temperature**: `weatherTempMin`/`weatherTempMax` → only checked if `w.temp != null`
- **Humidity**: `weatherHumidityMin`/`weatherHumidityMax` → only checked if `w.humidity != null`
- **Fail-open**: missing `weatherByDateHour` OR missing `[dateKey]` OR missing `[hour]` → returns `true` (pass)

---

```
---
ID: TS-142
Domain: Weather / Precipitation — dry_only
Title: weather_precip=dry_only — task placed only in hours with precipProb ≤ 20%
Data Setup:
  - Clock: fixed at '2026-06-15T08:00:00Z'
  - FakeWeatherProvider: setHourly('2026-06-15', {
      8:  { precipProb: 5,  cloudcover: 10, temp: 70, humidity: 40 },
      9:  { precipProb: 10, cloudcover: 15, temp: 71, humidity: 42 },
      10: { precipProb: 20, cloudcover: 20, temp: 72, humidity: 44 },  // boundary
      11: { precipProb: 21, cloudcover: 25, temp: 73, humidity: 46 },  // just over
      12: { precipProb: 80, cloudcover: 60, temp: 74, humidity: 50 },
      13: { precipProb: 90, cloudcover: 70, temp: 75, humidity: 55 },
      14: { precipProb: 5,  cloudcover: 10, temp: 76, humidity: 40 }   // afternoon ok
    })
  - Task: { text: 'Outdoor morning task', dur: 45, pri: P3, placementMode: 'anytime',
      when: 'morning,biz,lunch,afternoon', weatherPrecip: 'dry_only' }
Action: Run scheduler
Expected Outcome:
  - Task placed at earliest eligible slot (8:00, 9:00, or 10:00) where precipProb ≤ 20
  - Task NOT placed at 11:00 or 12:00 (precipProb > 20)
  - If all morning slots taken, considered for 14:00 (precipProb=5, passes)
Sub-scenarios:
  - [SUB-142a] precipProb = 20 boundary → placed (≤ 20)
  - [SUB-142b] precipProb = 21 boundary → not placed (> 20)
  - [SUB-142c] Dynamic: precipProb drops from 80% at 12:00 to 15% at 14:00 → eligible again after 14:00
  - [SUB-142d] ALL hours precipProb > 20 → task unplaced with _unplacedReason='weather'
  - [SUB-142e] Some hours have null precipProb → treated as 0 (|| 0 default) → eligible
  - [SUB-142f] precipProb data missing entirely for some hours (w is null) → fail-open true → eligible
  - [SUB-142g] Weekday vs weekend: precip varies but same constraint logic applies
---
```
```
---
ID: TS-143
Domain: Weather / Precipitation — light_ok
Title: weather_precip=light_ok — task placed when precipProb ≤ 50%
Data Setup:
  - Clock: fixed at '2026-06-15T08:00:00Z'
  - FakeWeatherProvider: setHourly('2026-06-15', {
      8:  { precipProb: 20 }, 9: { precipProb: 50 }, 10: { precipProb: 51 },
      11: { precipProb: 100 }, 12: { precipProb: 0 }
    })
  - Task: { text: 'Light rain ok task', dur: 30, weatherPrecip: 'light_ok' }
Action: Run scheduler
Expected Outcome:
  - Placed at 8:00 (20 ≤ 50) or 9:00 (50 ≤ 50)
  - NOT placed at 10:00 (51 > 50) or 11:00 (100 > 50)
  - 12:00 eligible (0 ≤ 50)
Sub-scenarios:
  - [SUB-143a] precipProb = 50 boundary → placed
  - [SUB-143b] precipProb = 51 boundary → not placed
  - [SUB-143c] Light_ok + deadline approaching → placed in any light_ok slot before deadline
  - [SUB-143d] All precipProb values ≤ 50 → treated like any (no restriction)
---
```
```
---
ID: TS-144
Domain: Weather / Cloud cover — clear
Title: weather_cloud=clear — task placed only when cloudcover ≤ 25%
Data Setup:
  - FakeWeatherProvider: setHourly('2026-06-15', {
      8: { cloudcover: 0 },  9: { cloudcover: 25 }, 10: { cloudcover: 26 },
      11: { cloudcover: 50 }, 12: { cloudcover: 100 }
    })
  - Task: { text: 'Clear sky needed', dur: 30, weatherCloud: 'clear' }
Action: Run scheduler
Expected Outcome:
  - Placed at 8:00 (0 ≤ 25) or 9:00 (25 ≤ 25)
  - NOT placed at 10:00 (26 > 25), 11:00, 12:00
Sub-scenarios:
  - [SUB-144a] cloudcover = 25 boundary → placed
  - [SUB-144b] cloudcover = 26 boundary → not placed
  - [SUB-144c] cloudcover null (|| 0 default) → 0 ≤ 25 → eligible
---
```
```
---
ID: TS-145
Domain: Weather / Cloud cover — partly_ok
Title: weather_cloud=partly_ok — placed when cloudcover ≤ 60%
Data Setup:
  - FakeWeatherProvider: 8:00(0), 9:00(60), 10:00(61), 11:00(100)
  - Task: { dur: 30, weatherCloud: 'partly_ok' }
Action: Run scheduler
Expected Outcome:
  - Eligible at 8:00, 9:00 (≤ 60); NOT at 10:00, 11:00
Sub-scenarios:
  - [SUB-145a] cloudcover = 60 boundary → placed
  - [SUB-145b] cloudcover = 61 boundary → not placed
  - [SUB-145c] overcast_ok (any cloudcover passes) → placed at 11:00
---
```
```
---
ID: TS-146
Domain: Weather / Temperature — min and max
Title: weatherTempMin / weatherTempMax — placed only in temperature range
Data Setup:
  - FakeWeatherProvider: setHourly('2026-06-15', {
      8:  { temp: 50 },  9:  { temp: 60 },  10: { temp: 65 },
      11: { temp: 70 },  12: { temp: 75 },  13: { temp: 80 },
      14: { temp: 85 },  15: { temp: 90 }
    })
  - Task: { text: 'Moderate temp task', dur: 30, weatherTempMin: 60, weatherTempMax: 80 }
Action: Run scheduler
Expected Outcome:
  - Placed at 9:00 (60), 10:00 (65), 11:00 (70), 12:00 (75)
  - NOT placed at 8:00 (50 < 60), 13:00 (80 ≤ 80, ok), 14:00 (85 > 80), 15:00 (90 > 80)
Sub-scenarios:
  - [SUB-146a] temp = weatherTempMin exactly → placed
  - [SUB-146b] temp = weatherTempMax exactly → placed
  - [SUB-146c] temp is null (missing data) → skipped (humidity check skipped) → placed (other checks pass)
  - [SUB-146d] Only weatherTempMin set, no max → all temps ≥ min eligible
  - [SUB-146e] Only weatherTempMax set, no min → all temps ≤ max eligible
  - [SUB-146f] weatherTempMin = weatherTempMax = exact value → only that exact temp eligible
  - [SUB-146g] Temperature range + deadline forces narrower window
---
```
```
---
ID: TS-147
Domain: Weather / Humidity — min and max
Title: weatherHumidityMin / weatherHumidityMax — placed only in humidity range
Data Setup:
  - FakeWeatherProvider: setHourly('2026-06-15', {
      8:  { humidity: 20 },  9:  { humidity: 40 },  10: { humidity: 50 },
      11: { humidity: 60 },  12: { humidity: 70 },  13: { humidity: 80 }
    })
  - Task: { text: 'Low humidity task', dur: 30, weatherHumidityMin: 30, weatherHumidityMax: 60 }
Action: Run scheduler
Expected Outcome:
  - Placed at 9:00 (40), 10:00 (50), 11:00 (60)
  - NOT placed at 8:00 (20 < 30), 12:00 (70 > 60), 13:00 (80 > 60)
Sub-scenarios:
  - [SUB-147a] humidity = weatherHumidityMin exactly → placed
  - [SUB-147b] humidity = weatherHumidityMax exactly → placed
  - [SUB-147c] humidity is null → check skipped → placed
  - [SUB-147d] Only humidityMin set → all humidity ≥ min eligible
  - [SUB-147e] Only humidityMax set → all humidity ≤ max eligible
  - [SUB-147f] All weather constraints combined (precip + cloud + temp + humidity)
---
```
```
---
ID: TS-148
Domain: Weather / Fail-open behavior (BUG R38.1)
Title: weather_fail_open — missing weather data causes all constraints to pass
Data Setup:
  - No weather provider configured, cfg.weatherByDateHour = {}
  - Tasks with various weather constraints: dry_only, clear, tempMin=60, humidityMax=50
Action: Run scheduler
Expected Outcome:
  - All weather-constrained tasks placed WITHOUT weather filtering
  - weatherByDateHour empty → weatherOk returns true at L755 (!weatherByDateHour[dateKey])
  - No error thrown
Sub-scenarios:
  - [SUB-148a] No locations configured → loadWeatherForHorizon returns {} → fail-open
  - [SUB-148b] locations exist but no coords → fail-open
  - [SUB-148c] cache row exists but forecast_json unparseable → fail-open
  - [SUB-148d] cache row exists but hourly.time is null/missing → fail-open
  - [SUB-148e] hourly data exists but specific hour is missing from map → fail-open (w is null → true)
  - [SUB-148f] Partial data: some hours present, some missing → present hours checked, missing hours pass
  - [SUB-148g] weatherByDateHour is null/undefined → fail-open at L755
---
```
```
---
ID: TS-149
Domain: Weather / API down
Title: weather_api_down — weather provider throws error, scheduler continues with fail-open
Data Setup:
  - MockWeatherProvider configured to throw on fetchForecast
  - cfg.weatherByDateHour never populated (remains {} from initial load failure)
  - Task: { weatherPrecip: 'dry_only' }
Action: Run scheduler (catch the provider error, log it, continue)
Expected Outcome:
  - Scheduler does NOT crash
  - Weather-constrained tasks placed without weather filtering
  - Error is logged
Sub-scenarios:
  - [SUB-149a] Network timeout on weather fetch → fail-open
  - [SUB-149b] API returns 500 → fail-open
  - [SUB-149c] API rate limit exceeded → fail-open
  - [SUB-149d] DNS resolution failure → fail-open
---
```
```
---
ID: TS-150
Domain: Weather / Cache refresh
Title: weather_cache_refresh — stale weather cache is refreshed before scheduling
Data Setup:
  - Weather cache row exists with fetched_at 2 days ago, expires_at 1 day ago
  - New forecast data available from provider
  - Task: { weatherPrecip: 'dry_only', dur: 60 }
Action:
  1. Run scheduler
  2. Scheduler checks cache staleness
  3. If stale, fetches new forecast from provider
  4. Uses new data for placement
Expected Outcome:
  - Fresh forecast used for weatherOk checks
  - Cache row updated with new forecast_json and fetched_at
Sub-scenarios:
  - [SUB-150a] Cache still fresh (fetched < 6h ago) → no network request (cache hit)
  - [SUB-150b] Cache expired → refresh triggered
  - [SUB-150c] Force refresh via cache-busting flag
  - [SUB-150d] Refresh fails → use stale data (fail-open on update, use existing)
  - [SUB-150e] No cache row exists → fetch from provider on first scheduler run
---
```
```
---
ID: TS-151
Domain: Weather / hasWeatherConstraint parity
Title: hasWeatherConstraint — correctly identifies tasks with any weather constraint
Data Setup:
  - Tasks: { weatherPrecip: 'dry_only' } | { weatherCloud: 'clear' } | { weatherTempMin: 60 }
    | { weatherTempMax: 90 } | { weatherHumidityMin: 30 } | { weatherHumidityMax: 70 }
    | { weatherPrecip: 'any' } | { weatherCloud: 'any' } | no weather fields
  - All weather-related fields: weatherPrecip, weatherCloud, weatherTempMin, weatherTempMax,
    weatherHumidityMin, weatherHumidityMax
Action: Call hasWeatherConstraint(task) for each
Expected Outcome:
  - Any non-'any' precip/cloud OR non-null temp/humidity min/max → true
  - weatherPrecip='any' or weatherCloud='any' → false (constraint is no-op)
  - No weather fields → false
Sub-scenarios:
  - [SUB-151a] weatherPrecip='any' → false (no active constraint)
  - [SUB-151b] weatherPrecip='wet_ok' → true (non-'any', always passes but still a constraint)
  - [SUB-151c] weatherCloud='overcast_ok' → true (same logic)
  - [SUB-151d] All fields null/undefined → false
  - [SUB-151e] Task object is null/undefined → false
---
```
```
---
ID: TS-152
Domain: Weather / Combined constraints
Title: weather_combined — multiple weather dimensions all must pass simultaneously
Data Setup:
  - FakeWeatherProvider: 8:00(precip=80,cloud=90,temp=85,humid=70),
    9:00(precip=5,cloud=10,temp=70,humid=40), 10:00(precip=40,cloud=50,temp=75,humid=55)
  - Task: { weatherPrecip: 'dry_only', weatherCloud: 'clear', weatherTempMax: 75, weatherHumidityMax: 50 }
Action: Run scheduler
Expected Outcome:
  - 8:00 fails all (precip 80>20, cloud 90>25, temp 85>75, humid 70>50)
  - 9:00 passes all (precip 5≤20, cloud 10≤25, temp 70≤75, humid 40≤50)
  - 10:00 fails (precip 40>20, cloud 50>25, but temp 75≤75, humidity 55>50)
  - Task placed at 9:00
Sub-scenarios:
  - [SUB-152a] Precip passes but cloud fails → not placed
  - [SUB-152b] Cloud and temp pass but humidity fails → not placed
  - [SUB-152c] Only 1 check passes, others fail → not placed
  - [SUB-152d] All pass → placed at earliest satisfying slot
---
```
```
---
ID: TS-153
Domain: Weather / Multi-day horizon
Title: weather_multi_day — weather check spans multiple days
Data Setup:
  - Today: '2026-06-15'
  - FakeWeatherProvider: setRange('2026-06-15', 3, (dk, h) => {
      '2026-06-15': { 8: {precip:80}, 9:{precip:5} },
      '2026-06-16': { 8: {precip:10}, 9:{precip:90} },
      '2026-06-17': { 8: {precip:5}, 9:{precip:5} }
    })
  - Task: { weatherPrecip: 'dry_only', dur: 60, deadline: '2026-06-17' }
Action: Run scheduler
Expected Outcome:
  - Task placed at earliest eligible slot:
    - 6/15 9:00 (precip=5 ≤20) or
    - 6/17 8:00 or 9:00 (both 5 ≤20)
  - NOT at 6/15 8:00 (80>20) or 6/16 9:00 (90>20)
Sub-scenarios:
  - [SUB-153a] Weather varies day-by-day, some days all hours fail → skip those days
  - [SUB-153b] Weather improves over horizon → placed on later day
  - [SUB-153c] Weather deteriorates over horizon → placed on earlier day
  - [SUB-153d] Weekend weather patterns differ from weekday
  - [SUB-153e] Location has no weather data on some days → fail-open pass for those days
---
```
```
---
ID: TS-154
Domain: Weather / Task placement mode interactions
Title: weather_placement_modes — weather works with all placement modes
Data Setup:
  - Tasks with different placementModes: 'anytime', 'time_window', 'fixed', 'flexible'
  - All have weatherPrecip: 'dry_only'
  - Weather data: morning dry, afternoon rainy
Action: Run scheduler
Expected Outcome:
  - 'anytime': placed in first dry slot (morning)
  - 'time_window': placed in first window's dry slot
  - 'fixed': pinned time overrides weather constraint (pinned tasks place regardless)
  - 'flexible': respects both flexibility AND weather
Sub-scenarios:
  - [SUB-154a] pinned/fixed task with weather constraint → weather ignored (pinned wins)
  - [SUB-154b] marker/reminder with weather constraint → weather ignored
  - [SUB-154c] rigid recurring with weather → placed at anchor time even if weather fails
---
```

### Weather × Template (TS-154a–e)

```
---
ID: TS-154a
Domain: Weather × Template
Title: weather_template_location_change — changing template location changes weather data
Data Setup:
  - Template task: { weatherPrecip: 'dry_only', location: 'home' }
  - Home location: lat=40.0, lon=-74.0 (sunny weather)
  - User changes template location to 'downtown' (lat=40.1, lon=-74.1, different forecast)
  - MockWeatherProvider: returns different precip data per grid cell
Action: Run scheduler after location change
Expected Outcome:
  - New instances use weather data for downtown grid (40.1, -74.1)
  - Old/scheduled instances keep home weather data
Sub-scenarios:
  - [SUB-154a1] Location change → different precip probabilities → different placement eligibility
  - [SUB-154a2] Location change → coords not rounded to same grid → different weather data
  - [SUB-154a3] Location change to place without weather cache → fail-open
  - [SUB-154a4] Multiple templates with different locations → each uses its own location's weather
---
```
```
---
ID: TS-154b
Domain: Weather × Template — Remote day
Title: weather_template_remote_day — remote day location's weather used
Data Setup:
  - Template with remote_day: { dayOfWeek: 'Wed', location: 'downtown' }
  - Template task: { weatherPrecip: 'dry_only' }
  - Wednesday weather at downtown: rainy morning, clear afternoon
  - Other days at home: clear all day
Action: Run scheduler
Expected Outcome:
  - Wednesday instances use downtown weather data
  - Non-Wednesday instances use home weather data
  - Wednesday instance placed in afternoon (passes dry_only) not morning
---
```
```
---
ID: TS-154c
Domain: Weather × Template — Hour overrides
Title: weather_template_hour_overrides — hour override combined with weather
Data Setup:
  - Template with hourOverrides mapping afternoon→evening
  - Task: { weatherPrecip: 'dry_only' }
  - Afternoon: precip=80 (rainy), Evening: precip=5 (dry)
Action: Run scheduler
Expected Outcome:
  - Without override: task placed in morning (first dry slot)
  - With override mapping afternoon block to evening: task re-evaluated for evening weather
Sub-scenarios:
  - [SUB-154c1] Override shifts to dryer block → more eligible slots
  - [SUB-154c2] Override shifts to wetter block → fewer eligible slots
  - [SUB-154c3] Override removes weather constraints (if block has no location→weather)
---
```
```
---
ID: TS-154d
Domain: Weather × Template — Tool matrix filter
Title: weather_template_tool_matrix — tool+weather combined filter
Data Setup:
  - Template task: requires 'car' tool, weatherPrecip: 'dry_only'
  - Tool matrix: car available at home, not at work
  - Weather: morning at home (passes both), afternoon at work (passes weather, no car)
Action: Run scheduler
Expected Outcome:
  - Task placed at morning (home): passes both tool + weather
  - Afternoon (work) skipped: tool constraint fails
  - Evening (home) skipped: weather fails if rainy
Sub-scenarios:
  - [SUB-154d1] weather passes, tool fails → not placed at that slot
  - [SUB-154d2] tool passes, weather fails → not placed
  - [SUB-154d3] both pass → placed
  - [SUB-154d4] Both fail across ALL slots → unplaced with _unplacedReason='weather' (heuristic)
---
```
```
---
ID: TS-154e
Domain: Weather × Template — No blocks
Title: weather_template_no_blocks_remove — template with no eligible blocks
Data Setup:
  - Template: blocks removed leaving only one block with specific tag
  - Task: { weatherPrecip: 'dry_only', when: 'biz' }
  - Biz block: weather too rainy for dry_only
Action: Run scheduler
Expected Outcome:
  - If block removed entirely → no eligible slots → unplaced
  - If block present but weather fails → unplaced with _unplacedReason='weather'
---
```

### Weather × Split (TS-154f–i)

```
---
ID: TS-154f
Domain: Weather × Split
Title: weather_split_per_chunk — each split chunk validated against weather independently
Data Setup:
  - Task: { text: 'Long outdoor task', dur: 180, split: true, splitMin: 60, weatherPrecip: 'dry_only' }
  - Weather: 8-10am (precip=5, dry), 10-12pm (precip=80, rain)
Action: Run scheduler
Expected Outcome:
  - Chunk 1 placed at 8:00-9:00 (precip=5, passes)
  - Chunk 2 placed at 9:00-10:00 (precip=5, passes)
  - 10-12pm skipped (precip=80, fails)
  - Chunk 3 placed in afternoon if precip drops below 20
Sub-scenarios:
  - [SUB-154f1] All chunks in dry weather → fully placed
  - [SUB-154f2] Some chunks assigned to rainy hours → those chunks not placed
  - [SUB-154f3] Partial placement due to weather → remaining=partial_split
  - [SUB-154f4] SplitMin=60, only 30min dry slots exist → can't place chunks
---
```
```
---
ID: TS-154g
Domain: Weather × Split — Changing weather
Title: weather_split_changing_weather — weather changes mid-scheduling affect remaining chunks
Data Setup:
  - Same as TS-154f but weather data changes after first chunk placed
  - After placing chunk 1 at 8:00, weather forecast updates: 9:00 now precip=90
Action: Run scheduler (re-run with updated weather)
Expected Outcome:
  - Chunk 1 stays at 8:00 (already placed)
  - Chunk 2 moves to afternoon where precip ≤ 20
  - Scheduler reacts to updated forecast
---
```
```
---
ID: TS-154h
Domain: Weather × Split — Re-placement on fail
Title: weather_split_reroute_on_weather_fail — chunk fails weather, re-routed
Data Setup:
  - Task: split with 3 chunks
  - Chunk 1 placed at 8:00 OK, Chunk 2 candidate at 9:00 fails weather
Action: Run scheduler
Expected Outcome:
  - Scheduler searches next available slot after 9:00 that passes weather
  - Chunk 2 placed at next dry slot (e.g. 14:00 when precip drops)
  - No double-counting of capacity
---
```
```
---
ID: TS-154i
Domain: Weather × Split — Refresh
Title: weather_split_refresh — weather data refresh mid-split
Data Setup:
  - Split task partially placed
  - Weather cache refresh changes forecast (previously rainy now clear)
Action: Run scheduler
Expected Outcome:
  - Remaining chunks reconsidered with new data
  - Previously failed weather slots now eligible
  - Remaining chunks placed in newly eligible slots
---
```

### Weather × Dependency (TS-154j–m)

```
---
ID: TS-154j
Domain: Weather × Dependency
Title: weather_dep_predecessor_fails — predecessor fails weather and is unplaced
Data Setup:
  - Task B depends on Task A
  - Task A: { weatherPrecip: 'dry_only', dur: 30 }
  - Task B: { dur: 30 }
  - All hours have precip > 20 (Task A unplaced)
Action: Run scheduler
Expected Outcome:
  - Task A is unplaced with _unplacedReason='weather'
  - Task B cannot be placed (dependency unsatisfied)
  - Task B unplaced with _unplacedReason='dependency'
Sub-scenarios:
  - [SUB-154j1] Task A partially placed (split+weather) → B waits for remaining chunks
  - [SUB-154j2] Task A placed, weather changes after placement → A stays, B placed
  - [SUB-154j3] Chain: A→B→C, A fails weather → B and C unplaced
---
```
```
---
ID: TS-154k
Domain: Weather × Dependency — Asymmetric fail-open
Title: weather_dep_asymmetric_failopen — predecessor has weather, successor doesn't
Data Setup:
  - Task B depends on Task A
  - Task A: { weatherPrecip: 'dry_only', dur: 30 }
  - Task B: { dur: 30, weatherPrecip: 'wet_ok' } — different weather constraint
  - Weather: morning dry, afternoon wet
Action: Run scheduler
Expected Outcome:
  - Task A placed in morning (dry_only satisfied)
  - Task B placed after A completes (in morning or afternoon depending on A's end time)
  - B's wet_ok constraint checked independently
Sub-scenarios:
  - [SUB-154k1] A weather constraint less restrictive than B → both check independently
  - [SUB-154k2] No weather data → both fail-open → placed anywhere
---
```
```
---
ID: TS-154l
Domain: Weather × Dependency — Weather moves predecessor
Title: weather_dep_moves_predecessor — weather moves predecessor, affecting chain
Data Setup:
  - B depends on A
  - A: { weatherPrecip: 'dry_only' }, B: { dur: 30 }
  - Forecast update: morning now rainy, afternoon clear
Action: Re-run scheduler
Expected Outcome:
  - A moves from morning (previously placed) to afternoon
  - B moves to slots after A's new placement
  - Chain ordering preserved
---
```
```
---
ID: TS-154m
Domain: Weather × Dependency — Chain deadline backprop + weather
Title: weather_dep_backprop_deadline — deadline backpropagated through chain with weather
Data Setup:
  - A→B→C chain (A before B before C)
  - C: { deadline: '2026-06-17', weatherPrecip: 'dry_only' }
  - B: { weatherPrecip: 'dry_only' }
  - A: { weatherPrecip: 'dry_only' }
  - Weather: only limited dry slots across the horizon
Action: Run scheduler
Expected Outcome:
  - C's deadline backpropagates to B and A (if backprop is implemented)
  - All three need dry slots before C's deadline
  - Slack computed with deadline + weather constraints
Sub-scenarios:
  - [SUB-154m1] Backprop not yet implemented (v2 known gap) → each uses user-specified deadline only
  - [SUB-154m2] Backprop + weather → narrower placement window than either alone
---
```

### Weather × Recurrence (TS-154n–r)

```
---
ID: TS-154n
Domain: Weather × Recurrence
Title: weather_recurring_per_instance — each recurring instance checked against its day's weather
Data Setup:
  - Recurring task: { type: 'daily', weatherPrecip: 'dry_only', dur: 30 }
  - Weather varies day by day:
    6/15: all hours rainy, 6/16: morning dry, 6/17: all hours dry, 6/18: rainy
Action: Run scheduler
Expected Outcome:
  - 6/15 instance: unplaced (no dry slot)
  - 6/16 instance: placed in morning
  - 6/17 instance: placed (any slot)
  - 6/18 instance: unplaced
Sub-scenarios:
  - [SUB-154n1] Some instances placed, some unplaced due to weather
  - [SUB-154n2] Day-locked recurring instances use their day's weather only
  - [SUB-154n3] Flexible recurring (tpc) instances search across cycle for weather-compatible slots
---
```
```
---
ID: TS-154o
Domain: Weather × Recurrence — Different weather across days
Title: weather_recurring_across_days — weather varies across recurrence days
Data Setup:
  - Weekly recurring task: { type: 'weekly', weatherPrecip: 'dry_only', dur: 60 }
  - Week 1 Mon: all rainy, Thu: dry
  - Week 2 Tue: dry, Fri: rainy
Action: Run scheduler
Expected Outcome:
  - Week 1: placed Thursday (only dry day in that week)
  - Week 2: placed Tuesday (only dry day)
  - Each week's instance evaluated independently
---
```
```
---
ID: TS-154p
Domain: Weather × Recurrence — TPC + weather
Title: weather_recurring_tpc — timesPerCycle recurring with weather constraints
Data Setup:
  - Recurring: { type: 'weekly', timesPerCycle: 2, weatherPrecip: 'dry_only', dur: 60 }
  - Week: Mon(dry), Tue(rainy), Wed(rainy), Thu(dry), Fri(rainy)
Action: Run scheduler
Expected Outcome:
  - Placed 2 times in the week: Mon and Thu (only dry days)
  - No placement on Tue/Wed/Fri (weather fails)
Sub-scenarios:
  - [SUB-154p1] TPC=3 but only 2 dry days → placed 2 times, remaining 1 not placed
  - [SUB-154p2] TPC=1, many dry days → placed once at earliest
  - [SUB-154p3] TPC completed before weather constraint matters → TPC satisfied
---
```
```
---
ID: TS-154q
Domain: Weather × Recurrence — Mixed data
Title: weather_recurring_mixed_constraints — some instances have weather, some don't
Data Setup:
  - Template has weather constraint, existing instances don't (or vice versa)
Action: Run scheduler
Expected Outcome:
  - New instances inherit template's weather constraint
  - Existing instances without weather constraint placed as-is
  - Template change (adding weather) affects new instances only
---
```
```
---
ID: TS-154r
Domain: Weather × Recurrence — Weather fails for all instances
Title: weather_recurring_all_fail — all recurring instances fail weather
Data Setup:
  - Recurring: { weatherPrecip: 'dry_only', dur: 60 }
  - All days in horizon: all hours precip > 20
Action: Run scheduler
Expected Outcome:
  - No instances placed
  - Each instance sets _unplacedReason='weather' (or is simply skipped)
---
```

### Weather × Time-Travel (TS-154s–x)

```
---
ID: TS-154s
Domain: Weather × Time-Travel — Deteriorating forecast
Title: weather_tt_deteriorating — forecast worsens over time
Data Setup:
  - Today: 6/15
  - Day 3 forecast (6/18): morning dry, afternoon rainy
  - After running once (6/15→6/18 considered), advance clock to 6/17
  - Updated forecast: 6/18 now all-day rain
Action: Run scheduler
Expected Outcome:
  - On 6/15: task placed at 6/18 morning (dry only)
  - On 6/17: forecast updated, 6/18 can no longer accommodate weather constraint
  - Already-placed task stays (weather at placement time is what matters)
Sub-scenarios:
  - [SUB-154s1] Already-placed task in deteriorating forecast → placement is locked, not re-evaluated
  - [SUB-154s2] Unplaced task in deteriorating forecast → fewer eligible slots
  - [SUB-154s3] Deteriorating forecast forces task into earlier slot
---
```
```
---
ID: TS-154t
Domain: Weather × Time-Travel — Improving forecast
Title: weather_tt_improving — forecast improves over time
Data Setup:
  - Today: 6/15, forecast: 6/18 all-day rain
  - Advance to 6/17, updated forecast: 6/18 now morning dry
Action: Run scheduler
Expected Outcome:
  - 6/15: task not placed at 6/18 (rain)
  - 6/17: task now eligible at 6/18 morning (dry)
  - Unplaced task moves into newly eligible slot
---
```
```
---
ID: TS-154u
Domain: Weather × Time-Travel — Horizon expiry
Title: weather_tt_horizon_expiry — weather horizon shrinks as time passes
Data Setup:
  - Today: 6/15, forecast covers 6/15–6/28
  - Advance to 6/20: earliest forecast data is 6/20, oldest data expires
  - Task: { deadline: '2026-06-21', weatherPrecip: 'dry_only' }
Action: Run scheduler
Expected Outcome:
  - Old forecast data (6/15–6/19) no longer in weatherByDateHour
  - Only 6/20+ data available
  - Task placed in 6/20 or 6/21 dry slots based on remaining forecast
Sub-scenarios:
  - [SUB-154u1] Horizon shrinks → data gaps → fail-open (missing days pass)
  - [SUB-154u2] Horizon extends → new forecast data available for additional days
---
```
```
---
ID: TS-154v
Domain: Weather × Time-Travel — Cache refresh
Title: weather_tt_cache_refresh — cache refresh changes past forecast
Data Setup:
  - Day 1: forecast says 6/18 is rainy
  - Advance to 6/18 morning: refreshed forecast says 6/18 is now clear
  - Task placed at morning (old forecast blocked it)
  - Re-run scheduler on 6/18
Action: Run scheduler on 6/18
Expected Outcome:
  - New forecast used for today's remaining slots
  - Already-placed tasks not re-evaluated (their scheduled_at persists)
  - New/unplaced tasks use new forecast
---
```
```
---
ID: TS-154w
Domain: Weather × Time-Travel — Seasonal simulation
Title: weather_tt_seasonal — summer vs winter temperature constraints
Data Setup:
  - Task: { weatherTempMin: 60, weatherTempMax: 85 }
  - Summer forecast (July): temps 65-95°F
  - Advance clock to December: temps 20-40°F
Action: Run scheduler in December
Expected Outcome:
  - Summer: placed in cooler morning slots (65-85)
  - December: fails entirely (all temps < 60°F) → unplaced
Sub-scenarios:
  - [SUB-154w1] Seasonal change makes previously good slots bad
  - [SUB-154w2] Seasonal change makes previously bad slots good
  - [SUB-154w3] Marginal season (spring/fall) → boundary temps
---
```
```
---
ID: TS-154x
Domain: Weather × Time-Travel — Cache staleness across time
Title: weather_tt_stale_cache_over_time — cache gradually becomes stale
Data Setup:
  - Clock advances day by day for 14 days
  - Weather cache not refreshed after day 1
Action: Run scheduler each day
Expected Outcome:
  - Day 2–14: weather data for past days still available (but stale)
  - Fail-open: stale data still present → still used
  - After cache TTL: refetch triggered
Sub-scenarios:
  - [SUB-154x1] 14-day forecast, day 15: earliest data starts to expire
  - [SUB-154x2] Cache never refreshed → eventually all data covers past dates only
  - [SUB-154x3] Future forecast data (beyond original horizon) missing → fail-open
---
```

---

## DEPENDENCIES (TS-155 to TS-162y)

### Dependency primitives (dependencyHelpers.js):
- `getTaskDeps(task)`: returns array of dependency IDs
- `getDepsStatus(task, allTasks, statuses)`: { satisfied, pending, done, missing }
- `topoSortTasks(tasks)`: topological sort with cycle detection
- `getDependents(taskId, allTasks)`: tasks that depend on taskId

### Scheduler dependency logic (unifiedScheduleV2.js):
- `computeDepReadyAbs()`: computes absolute ready time = max predecessor end times
- `checkDeps`: gates slot placement (candidate slot must be ≥ depReadyAbs)
- `depNames`: human-readable dep chain names
- `relaxDeps` option: skip dep checking (used in retry pass)

```
---
ID: TS-155
Domain: Dependencies / A→B placement
Title: dep_simple_a_to_b — B placed after A completes
Data Setup:
  - Task A: { text: 'Prep work', dur: 60 }
  - Task B: { text: 'Main work', dur: 30, dependsOn: ['A'] }
  - Clock: fixed, ample capacity
Action: Run scheduler
Expected Outcome:
  - A placed at earliest slot
  - B placed at earliest slot AFTER A's end (start ≥ A.start + A.dur)
  - B's _placementReason: "After 'Prep work'"
Sub-scenarios:
  - [SUB-155a] B placed immediately after A (same day, adjacent slots)
  - [SUB-155b] A placed at end of day, B placed next day (cross-day chain)
  - [SUB-155c] A placed, then A moved → B moves to stay after A
  - [SUB-155d] Multiple predecessors: B depends on A1 AND A2 → B placed after latest finishes
---
```
```
---
ID: TS-156
Domain: Dependencies / 3+ chain
Title: dep_chain_three_plus — multi-level chain A→B→C placed in order
Data Setup:
  - Task A: { dur: 30 }
  - Task B: { dur: 45, dependsOn: ['A'] }
  - Task C: { dur: 60, dependsOn: ['B'] }
Action: Run scheduler
Expected Outcome:
  - A placed first
  - B placed after A completes
  - C placed after B completes
  - Order: A.start < B.start < C.start (within dependency constraints)
Sub-scenarios:
  - [SUB-156a] 5-task chain: A→B→C→D→E → all placed sequentially
  - [SUB-156b] Chain spans multiple days (A day1, B day2, C day3)
  - [SUB-156c] Chain with varying durations: short→long→short
  - [SUB-156d] Chain where B has earlier deadline than A → A still placed before B
---
```
```
---
ID: TS-157
Domain: Dependencies / Unmet deferred
Title: dep_unmet_deferred — task deferred when dependency not yet placed
Data Setup:
  - Task A: { dur: 60, pri: P4 } (low priority, placed late)
  - Task B: { dur: 30, pri: P1, dependsOn: ['A'] } (high priority, but needs A)
  - Slack sort: B might sort before A (P1 before P4)
Action: Run scheduler
Expected Outcome:
  - If B encountered before A: B deferred (dep not placed yet)
  - A placed later in its pass
  - Retry pass (L1556): B re-checked, now A is placed → B placed
  - B gets _deferred flag cleared
Sub-scenarios:
  - [SUB-157a] Diamond DAG: A→B, A→C, B+D→E → retry pass resolves ordering
  - [SUB-157b] Deferred task still can't place after retry → unplaced with _unplacedReason='dependency'
  - [SUB-157c] Multiple items deferred, resolved in order of slack after retry
  - [SUB-157d] Retry pass: B placed, C (dependent on B) still deferred → no third pass → unplaced
---
```
```
---
ID: TS-158
Domain: Dependencies / Circular rejected
Title: dep_circular_rejected — circular dependency detected and rejected
Data Setup:
  - Task A: { dependsOn: ['B'] }
  - Task B: { dependsOn: ['C'] }
  - Task C: { dependsOn: ['A'] }  // A→B→C→A cycle
Action:
  1. Call topoSortTasks([A,B,C])
  2. Run scheduler
Expected Outcome:
  - topoSortTasks: either throws or detects cycle and breaks it (current impl visits without error)
  - Scheduler: circular deps → no valid ordering → tasks may partially place
  - No crash from infinite loop
Sub-scenarios:
  - [SUB-158a] Self-dependency: A dependsOn: ['A'] → rejected at validation
  - [SUB-158b] Two-task cycle: A→B, B→A → topoSort handles gracefully
  - [SUB-158c] Cycle in large task graph → only cycle tasks affected, others OK
  - [SUB-158d] Cycle + valid chain in same graph → cycle detected, valid chain placed
---
```
```
---
ID: TS-159
Domain: Dependencies / Recurring rejected
Title: dep_recurring_rejected — recurring tasks cannot have dependencies
Data Setup:
  - Task A (one-off): { dur: 30 }
  - Task B (recurring): { type: 'daily', dependsOn: ['A'] }
Action:
  1. Validate task creation
  2. Run scheduler
Expected Outcome:
  - Validation rejects recurring task with dependsOn (or scheduler ignores deps for recurring)
  - B placed without dependency consideration
  - OR B left unplaced with relevant reason
Sub-scenarios:
  - [SUB-159a] Recurring template with dependsOn → validation error
  - [SUB-159b] Recurring instance inherits dep from template → dep ignored at placement
---
```
```
---
ID: TS-160
Domain: Dependencies / Chain deadline backprop
Title: dep_chain_deadline_backprop — predecessor inherits consumer's deadline
Data Setup:
  - Task A: { dur: 60 }
  - Task B: { depdensOn: ['A'], dur: 30, deadline: '2026-06-17' }
Action: Run scheduler
Expected Outcome:
  - If backprop implemented: A gets deadline = B.deadline - B.dur (or B.deadline)
  - A placed before deadline, B placed after A
  - If backprop NOT implemented (v2 known gap): A has no deadline → infinite slack → placed anywhere
Sub-scenarios:
  - [SUB-160a] 3-chain backprop: A→B→C, C deadline→B deadline→A deadline
  - [SUB-160b] Backprop + own deadline: A already has deadline, B's deadline is later → keep A's earlier
  - [SUB-160c] Backprop across very long chain → appropriate slack for each predecessor
---
```
```
---
ID: TS-161
Domain: Dependencies / Deadline-relaxed pass
Title: dep_deadline_relaxed_pass — chain members in fallback ladder
Data Setup:
  - A→B, B has tight deadline, A has no deadline
  - Normal pass: A placed late (infinite slack), B can't fit before deadline
Action: Run scheduler (tryPlaceQueued fallback)
Expected Outcome:
  - Normal pass: B deferred (A not placed yet)
  - Retry pass: A placed (if found slot)
  - Or fallback ladder: if B slack < 0, B placed with ignoreDeadline after A
Sub-scenarios:
  - [SUB-161a] Both A and B can't fit before deadline → both placed via ignoreDeadline
  - [SUB-161b] A placed normally, B uses flexWhen to fit
  - [SUB-161c] Chain + overdue + weather all at once → worst-case fallback
---
```
```
---
ID: TS-162
Domain: Dependencies / Dependency removed
Title: dep_removed — removing dependency causes re-placement
Data Setup:
  - Task A: { dur: 30 }
  - Task B: { dependsOn: ['A'], dur: 30 }
  - Initially: A placed, B placed after A
  - Then: B.dependsOn = [] (dependency removed)
Action: Run scheduler
Expected Outcome:
  - B re-placed without A constraint
  - B may move to earlier slot (before A)
  - A unchanged
Sub-scenarios:
  - [SUB-162a] Remove dep → B moves to earlier slot
  - [SUB-162b] Remove dep → B stays (was earliest slot anyway)
  - [SUB-162c] Remove dep from mid-chain → chain partially collapses
  - [SUB-162d] Add dep → task moves later
---
```

### Dependency × Template (TS-162a–y)

```
---
ID: TS-162a
Domain: Dependency × Template — Change → dep satisfaction
Title: dep_template_change_satisfaction — template change creates/removes dep satisfaction
Data Setup:
  - Template A: { dur: 30 }
  - Template B: { dependsOn: ['template-A-instance'], dur: 30 }
  - A template change (duration increase) delays A
Action: Run scheduler
Expected Outcome:
  - B's placement shifts to accommodate A's new end time
  - B's slack recomputed
Sub-scenarios:
  - [SUB-162a1] Template A removed → B loses dependency target → B's dep missing → placed as one-off
  - [SUB-162a2] Template A changes location → B unaffected (dependency by ID)
  - [SUB-162a3] Template A's pri changes → A placed differently → B shifts
---
```
```
---
ID: TS-162b
Domain: Dependency × Template — Location
Title: dep_template_location — template location affects dependency chain
Data Setup:
  - Template A at home, Template B depends on A at work
  - A placed at home, B placed at work (different blocks)
  - Travel time between home and work
Action: Run scheduler
Expected Outcome:
  - B placed after A's end + travel time from home to work
  - Travel buffer accounted for in depReadyAbs calculation
Sub-scenarios:
  - [SUB-162b1] A at home, B at work → travel between
  - [SUB-162b2] Both same location → no travel buffer between chain members
  - [SUB-162b3] Location change in template → travel time recalculated for successors
---
```
```
---
ID: TS-162c
Domain: Dependency × Template — Recurring dep
Title: dep_template_recurring — recurring template with dependency
Data Setup:
  - Template A (one-off): { dur: 30 }
  - Template B (recurring daily): { dependsOn: ['A'], dur: 30 }
Action: Validate / schedule
Expected Outcome:
  - Validation rejects recurring with dep (if implemented)
  - Or each instance of B depends on A → all instances placed after A
Sub-scenarios:
  - [SUB-162c1] Daily recurring B depends on one-off A → only first B-instance after A
  - [SUB-162c2] Recurring A + recurring B with dep → complex ordering
---
```
```
---
ID: TS-162d
Domain: Dependency × Template — Deadline
Title: dep_template_deadline — template deadline backprop through chain
Data Setup:
  - Template A (predecessor), Template B (successor with deadline)
  - B's deadline backpropagates to A
Action: Run scheduler
Expected Outcome:
  - A's effective deadline = B's deadline (or earlier)
  - Both placed before deadline
---
```
```
---
ID: TS-162e
Domain: Dependency × Template — Split
Title: dep_template_split — split task with dependency
Data Setup:
  - Template A: { dur: 120, split: true, splitMin: 60 }
  - Template B: { dependsOn: ['A'], dur: 30 }
Action: Run scheduler
Expected Outcome:
  - B placed after all of A's chunks complete (after last chunk end time)
  - Not after first chunk
Sub-scenarios:
  - [SUB-162e1] Chunks spread across multiple days → B placed after last chunk
  - [SUB-162e2] Chunks total < A's original dur → B still waits for split completion
---
```
```
---
ID: TS-162f
Domain: Dependency × Template — Weather
Title: dep_template_weather — weather constraint on chain member
Data Setup:
  - Template A: { weatherPrecip: 'dry_only' }
  - Template B: { dependsOn: ['A'] }
Action: Run scheduler
Expected Outcome:
  - A placed in weather-appropriate slot, B placed after A
  - Weather only affects A, not B (unless B also has weather constraints)
---
```
```
---
ID: TS-162g
Domain: Dependency × Template — Mode transitions
Title: dep_template_mode_transitions — task moves between modes in chain
Data Setup:
  - Chain: A→B→C
  - A moves from 'anytime' to 'time_window'
  - B stays 'anytime', C stays 'anytime'
Action: Run scheduler
Expected Outcome:
  - A now constrained to specific window → may shift
  - B and C shift to follow A's new placement
  - Chain ordering preserved
Sub-scenarios:
  - [SUB-162g1] A moves from 'anytime' to 'fixed' → pinned, B/C adapt
  - [SUB-162g2] A moves from 'fixed' to 'anytime' → more placement freedom
  - [SUB-162g3] Mode transitions cascade through chain
---
```
```
---
ID: TS-162h-y
Domain: Dependency × Template — Various combinations
Title: dep_template_various — additional dep+template combinations
Sub-scenarios:
  - [SUB-162h] Template dayReq change → predecessor still eligible on new days
  - [SUB-162i] Template hourOverrides that shift predecessor/successor relative timing
  - [SUB-162j] Template remote_day affects one chain member → successor's travel time changes
  - [SUB-162k] Template pri change → predecessor/successor sort order changes
  - [SUB-162l] Multiple templates in chain with different owner conflicts
  - [SUB-162m] Template with dependsOn deleted → successor's dependency missing → unplaced
  - [SUB-162n] Template chain + holiday → all members shifted
  - [SUB-162o] Template dependency on completed task → dep immediately satisfied
  - [SUB-162p] Template dependency on task in different project
  - [SUB-162q] Template chain with intersection (A→B, A→C) → B and C both after A
  - [SUB-162r] Template: dependency removed from one instance, not others
  - [SUB-162s] Template: add dependency to existing placed instances → re-schedule
  - [SUB-162t] Template chain with varying durations (A:10min, B:480min) → B spans blocks
  - [SUB-162u] Template dep on marker/reminder → marker has no dur → depReadyAbs = marker's start
  - [SUB-162v] Template dep across different timezones
  - [SUB-162w] Template: successor has earlier deadline than predecessor → impossible → unplaced
  - [SUB-162x] Template chain with travelBefore/travelAfter accumulating
  - [SUB-162y] Template: dependency on self through chain (A→B, B→A) → cycle detected
---
```

---

## DEADLINES (TS-127 to TS-135x)

### Deadline data model (`unifiedScheduleV2.js`):
- `deadlineDate` = key from `t.deadline` (user-specified)
- Recurring instances: `deadlineDate = deadlineDate || anchorDate` (L301)
- `computeSlack()`: if no deadlineDate → Infinity; otherwise capacity(earliestIdx→deadlineIdx) - dur
- Fallback ladder (`tryPlaceQueued`): Normal → ignoreDeadline (slack<0) → relaxWhen → both
- `findEarliestSlot()`: respects deadline unless `ignoreDeadline=true`
- `findLatestSlot()`: also respects deadline unless `ignoreDeadline=true`

```
---
ID: TS-127
Domain: Deadlines / Hard bound
Title: deadline_hard_bound — task placed before deadline
Data Setup:
  - Today: 2026-06-15
  - Task: { text: 'Deadline task', dur: 60, deadline: '2026-06-17', pri: P3 }
  - Capacity: available slots on 6/15, 6/16, 6/17
Action: Run scheduler
Expected Outcome:
  - Task placed between today and 6/17 (inclusive)
  - NOT placed on 6/18 or later
  - _placementReason includes "deadline due 2026-06-17"
Sub-scenarios:
  - [SUB-127a] Task placed exactly on deadline day → valid
  - [SUB-127b] Task placed before deadline → earliest eligible slot
  - [SUB-127c] Task placed on today if slack allows
  - [SUB-127d] preferLatestSlot=true → placed on deadline day (latest possible)
---
```
```
---
ID: TS-128
Domain: Deadlines / No deadline = Infinity
Title: deadline_no_deadline_infinity — no deadline → infinite slack, placed last
Data Setup:
  - Task A: { dur: 30, deadline: '2026-06-16' }
  - Task B: { dur: 30 }  // no deadline
  - Task C: { dur: 30, deadline: '2026-06-17' }
Action: Run scheduler
Expected Outcome:
  - computeSlack(B) returns Infinity (L544)
  - B sorts after both A and C in queue (Infinity to end)
  - A and C placed before B (they have finite slack)
  - B placed after them at earliest available slot
Sub-scenarios:
  - [SUB-128a] All tasks no deadline → all Infinity → placed in pri order
  - [SUB-128b] No-deadline task with P1 → sorts after deadline task with P4 (Infinity is last section)
---
```
```
---
ID: TS-129
Domain: Deadlines / Past-due P1 boost
Title: deadline_past_due_p1_boost — past-deadline P1 tasks get priority
Data Setup:
  - Today: 2026-06-17
  - Task A: { deadline: '2026-06-15', pri: P1, dur: 60 }  // 2 days overdue
  - Task B: { deadline: '2026-06-16', pri: P2, dur: 60 }  // 1 day overdue
  - Task C: { deadline: '2026-06-18', pri: P3, dur: 60 }  // not yet due
Action: Run scheduler
Expected Outcome:
  - computeSlack(A): deadlineIdx = 6/15, today = 6/17, deadline < today → negative slack
  - Same for B
  - A placed first (most negative slack = most constrained)
  - B placed second
  - C placed third (positive slack)
Sub-scenarios:
  - [SUB-129a] Slack < 0 triggers ignoreDeadline in fallback → still placed (overdue)
  - [SUB-129b] P1 overdue vs P4 not-due → overdue placed first
  - [SUB-129c] Multiple overdue tasks sorted by slack (most negative first)
  - [SUB-129d] 0 slack (deadline = today, full capacity) → constrained but not overdue
---
```
```
---
ID: TS-130
Domain: Deadlines / ignoreDeadline mode
Title: deadline_ignore_deadline_mode — fallback pass ignores deadline ceiling
Data Setup:
  - Task: { deadline: '2026-06-15', dur: 60 }
  - Today: 2026-06-17
  - No available slots on 6/15 (past)
Action: Run scheduler
Expected Outcome:
  - Normal pass: findEarliestSlot respects deadline 6/15 → no slot found (deadline passed)
  - Fallback (ignoreDeadline slot < 0): findEarliestSlot with ignoreDeadline=true → searches full horizon
  - Task placed at earliest available slot (6/17 or later)
  - entry._overdue = true
Sub-scenarios:
  - [SUB-130a] ignoreDeadline finds slot → overdue placed
  - [SUB-130b] ignoreDeadline still can't find slot → unplaced
  - [SUB-130c] ignoreDeadline + relaxWhen combined → last resort
  - [SUB-130d] ignoreDeadline NOT triggered for tasks with slack ≥ 0
---
```
```
---
ID: TS-131
Domain: Deadlines / Fixed task exempt
Title: deadline_fixed_exempt — fixed/pinned tasks ignore deadlines
Data Setup:
  - Task A pinned: { placementMode: 'fixed', startAfter: '2026-06-15T10:00', deadline: '2026-06-14' }
  - Task B: { placementMode: 'anytime', deadline: '2026-06-16' }
Action: Run scheduler
Expected Outcome:
  - A placed at pinned time regardless of deadline
  - B respects deadline
  - Pinned tasks bypass deadline check entirely
Sub-scenarios:
  - [SUB-131a] Fixed task with past deadline → still placed at fixed time
  - [SUB-131b] Marker/reminder with deadline → marker ignores deadline
  - [SUB-131c] Rigid recurring with deadline → placed at anchor time
---
```
```
---
ID: TS-132
Domain: Deadlines / Slack computation
Title: deadline_slack_computation — slack = capacity - duration between startAfter and deadline
Data Setup:
  - Task: { startAfter: '2026-06-15', deadline: '2026-06-17', dur: 120 }
  - Capacity: 480 min/day × 3 days = 1440 min (if full day blocks)
  - But after other tasks consume some capacity
Action: Run scheduler
Expected Outcome:
  - computeSlack: earliestIdx = 6/15, deadlineIdx = 6/17
  - capacity = total free minutes in eligible windows 6/15-6/17
  - slack = capacity - 120
  - As other tasks placed, slack decremented via overlapWithEligibleWindows (L562-574)
Sub-scenarios:
  - [SUB-132a] Slack = 0 → exactly enough capacity
  - [SUB-132b] Slack < 0 → not enough capacity before deadline
  - [SUB-132c] Slack > 0 → room to spare
  - [SUB-132d] Slack computed only within eligible when-windows, not full day
---
```
```
---
ID: TS-133
Domain: Deadlines / Chain backprop
Title: deadline_chain_backprop — predecessor gets successor's deadline
Data Setup:
  - A→B→C (A before B before C)
  - C: { deadline: '2026-06-17', dur: 30 }
  - B: { dur: 60 }
  - A: { dur: 30 }
Action: Run scheduler
Expected Outcome:
  - If backprop implemented: A deadline = B deadline = C deadline (or offset by dur)
  - A and B computed with earlier effective deadlines
  - All three placed before 6/17
  - If backprop NOT implemented (known v2 gap): only C has deadline, A and B have infinite slack
Sub-scenarios:
  - [SUB-133a] A already has deadline earlier than C → keep A's (more constrained)
  - [SUB-133b] Chain + recurring → backprop to recurring member
  - [SUB-133c] Backprop across 5-level chain → all deadlines set
  - [SUB-133d] Diamond DAG backprop (A→B, A→C, B+C→D) → D's deadline to B and C only
---
```
```
---
ID: TS-134
Domain: Deadlines / Auto-deadline brackets
Title: deadline_auto_brackets — auto-generated deadline brackets from placement mode
Data Setup:
  - Template with auto-deadline: generates custom deadline bracket
  - Task in bracket "This Week" → deadline = end of week
  - Task in bracket "This Month" → deadline = end of month
Action: Run scheduler
Expected Outcome:
  - Tasks placed before their auto-deadline
  - Auto-deadline treated same as user-specified deadline
Sub-scenarios:
  - [SUB-134a] "Today" bracket → deadline = today → tightest constraint
  - [SUB-134b] "This Week" → deadline = next Sunday
  - [SUB-134c] "This Month" → deadline = month end
  - [SUB-134d] Auto-deadline + user-specified → user's wins (more specific)
---
```
```
---
ID: TS-135
Domain: Deadlines / deadlineMisses dead code
Title: deadline_dead_code_paths — verify unused deadline code paths
Data Setup:
  - Various deadline scenarios
Action:
  1. Run scheduler
  2. Check code coverage for deadline-related branches
Expected Outcome:
  - Ensure all deadline branches are exercised in tests:
    - computeSlack with various startAfter+deadline combos
    - findEarliestSlot deadline ceiling
    - findLatestSlot deadline ceiling
    - ignoreDeadline fallback
    - relaxWhen fallback
    - Both combined fallback
Sub-scenarios:
  - [SUB-135a] deadline before today → negative slack
  - [SUB-135b] deadline = today → slack = today's remaining capacity - dur
  - [SUB-135c] deadline far future → large slack
  - [SUB-135d] deadline with startAfter = same day → slack = that day's capacity - dur
  - [SUB-135e] deadline with no eligible windows before it → slack = 0, not placed
---
```

### Deadline × Template (TS-135a–f)

```
---
ID: TS-135a
Domain: Deadline × Template — Blocks removed/added
Title: deadline_template_blocks_change — template block changes affect deadline placement
Data Setup:
  - Template: blocks removed (e.g., afternoon removed)
  - Task: { deadline: '2026-06-16', dur: 60 }
  - Before block removal: adequate capacity
  - After block removal: less capacity before deadline
Action: Run scheduler
Expected Outcome:
  - Slack reduced (less capacity → tighter slack)
  - If slack becomes negative → ignoreDeadline fallback
  - Task may still place if slots exist in remaining blocks before deadline
Sub-scenarios:
  - [SUB-135a1] Block added → more capacity → slack increases
  - [SUB-135a2] Block removed entirely → capacity too low → unplaced or overdue
  - [SUB-135a3] Block split (shorter hours) → reduced capacity → tighter deadline
---
```
```
---
ID: TS-135b
Domain: Deadline × Template — Holiday
Title: deadline_template_holiday — holiday removes blocks, shrinks deadline capacity
Data Setup:
  - Template: holiday on 6/17 removes all blocks
  - Task: { deadline: '2026-06-18', dur: 240 }
  - Normal: 6/15, 6/16, 6/17, 6/18 all available
  - With holiday: 6/17 has 0 capacity
Action: Run scheduler
Expected Outcome:
  - capacityInRange excludes 6/17 (no windows)
  - Slack reduced by 480 min (typical daily capacity)
  - If task fits in remaining days → placed
  - If too tight → ignoreDeadline fallback places after deadline
Sub-scenarios:
  - [SUB-135b1] Holiday on deadline day → deadline effectively 1 day earlier
  - [SUB-135b2] Multiple holidays in deadline range → cumulative capacity loss
  - [SUB-135b3] Holiday only removes some blocks → partial capacity loss
---
```
```
---
ID: TS-135c
Domain: Deadline × Template — Location change
Title: deadline_template_location_change — location change affects blocks available
Data Setup:
  - Template location changes from 'home' to 'downtown'
  - Different blocks available at each location
  - Task: { deadline: '2026-06-17', dur: 60 }
Action: Run scheduler
Expected Outcome:
  - New location may have more/fewer blocks → capacity changes
  - Slack recalculated
  - Task placed in new location's blocks before deadline
---
```
```
---
ID: TS-135d
Domain: Deadline × Template — Remote day
Title: deadline_template_remote_day — remote day changes available blocks/timing
Data Setup:
  - Template with remote_day on Wednesday: different blocks
  - Task: { deadline: '2026-06-17' (Wednesday), dur: 120 }
  - Normal Wednesday blocks: 8am-5pm
  - Remote day Wednesday: 8am-12pm (reduced)
Action: Run scheduler
Expected Outcome:
  - Wednesday's capacity reduced due to remote day schedule
  - Task may need to use earlier days if Wednesday insufficient
---
```
```
---
ID: TS-135e
Domain: Deadline × Template — Hour overrides
Title: deadline_template_hour_overrides — overrides shift eligible hours
Data Setup:
  - Template with hourOverrides: afternoon→evening
  - Task: { deadline: '2026-06-17', dur: 60, when: 'afternoon' }
  - Without override: afternoon block 12pm-5pm
  - With override: afternoon→evening block 5pm-9pm
Action: Run scheduler
Expected Outcome:
  - Task's eligible windows shift to evening
  - Evening slots may or may not exist before deadline
  - If no evening slots before deadline → unplaced or overdue
---
```
```
---
ID: TS-135f
Domain: Deadline × Template — No blocks
Title: deadline_template_no_blocks_before_deadline — zero eligible blocks before deadline
Data Setup:
  - Template removes ALL blocks before deadline
  - Task: { deadline: '2026-06-17', dur: 30 }
Action: Run scheduler
Expected Outcome:
  - No capacity before deadline → slack = -dur (negative)
  - ignoreDeadline fallback: places after deadline in available blocks
  - entry._overdue = true
---
```

### Deadline × Split (TS-135g–j)

```
---
ID: TS-135g
Domain: Deadline × Split — All chunks before deadline
Title: deadline_split_all_before — all split chunks placed before deadline
Data Setup:
  - Task: { dur: 180, split: true, splitMin: 60, deadline: '2026-06-17' }
  - Capacity before deadline: enough for 3 chunks
Action: Run scheduler
Expected Outcome:
  - Chunks 1, 2, 3 all placed before deadline
  - No chunk placed after deadline
---
```
```
---
ID: TS-135h
Domain: Deadline × Split — Tight deadline → partial
Title: deadline_split_tight_partial — not all chunks fit before deadline
Data Setup:
  - Task: { dur: 300, split: true, splitMin: 60, deadline: '2026-06-16' }
  - Capacity before deadline: only enough for 2 chunks (120 min)
Action: Run scheduler
Expected Outcome:
  - Chunks 1 and 2 placed before deadline
  - Chunk 3 (remaining) → partial_split
  - Remaining chunks may be placed via ignoreDeadline if slack < 0
Sub-scenarios:
  - [SUB-135h1] Partial split + ignoreDeadline → remaining chunks placed after deadline
  - [SUB-135h2] Partial split, no fallback → remaining not placed
  - [SUB-135h3] SplitMin = 120, only 90min free before deadline → no chunk fits → all unplaced
---
```
```
---
ID: TS-135i
Domain: Deadline × Split — Boundary edge
Title: deadline_split_boundary — chunk exactly ends at deadline boundary
Data Setup:
  - Task: { dur: 120, split: true, splitMin: 60, deadline: '2026-06-15T12:00' }
  - Available: slot 10:00-11:00, slot 11:00-12:00 (chunk2 ends exactly at deadline)
Action: Run scheduler
Expected Outcome:
  - Chunk 1 placed 10:00-11:00
  - Chunk 2 placed 11:00-12:00 (ends exactly at deadline, allowed)
  - No chunk placed starting after deadline
---
```
```
---
ID: TS-135j
Domain: Deadline × Split — Recurring + auto-bracket
Title: deadline_split_recurring_auto — recurring split with auto-deadline
Data Setup:
  - Recurring template: { type: 'daily', split: true, splitMin: 30, dur: 90 }
  - Auto-deadline: end of day (anchorDate)
Action: Run scheduler
Expected Outcome:
  - Chunks placed within anchor day (day-locked recurring → latestIdx = anchorIdx)
  - All chunks before day's end
  - No chunks spill to next day
---
```

### Deadline × Dependency (TS-135k–o)

```
---
ID: TS-135k
Domain: Deadline × Dependency — 3-chain backprop
Title: deadline_dep_3chain_backprop — deadline backpropagates through 3-task chain
Data Setup:
  - A→B→C
  - C: { deadline: '2026-06-17', dur: 30 }
  - B: { dur: 60 }
  - A: { dur: 30 }
  - Total chain duration: 120 min
Action: Run scheduler
Expected Outcome:
  - C's deadline backpropagates to B and A (if implemented)
  - All three placed such that A.start + 30 + 60 + 30 ≤ deadline end
  - Slack computed for each with their effective deadline
---
```
```
---
ID: TS-135l
Domain: Deadline × Dependency — Predecessor misses → faux expired
Title: deadline_dep_predecessor_misses — predecessor unplaced, successor gets faux-expired
Data Setup:
  - A (unplaced, no room), B depends on A
  - B: { deadline: '2026-06-16', dur: 30 }
Action: Run scheduler
Expected Outcome:
  - A unplaced (capacity or weather)
  - B depends on A → B's dep unsatisfied → B deferred
  - Retry pass: A still unplaced → B can't place → B unplaced with _unplacedReason='dependency'
  - B's deadline becomes irrelevant (dep unsatisfied trumps deadline)
---
```
```
---
ID: TS-135m
Domain: Deadline × Dependency — Dependent earlier deadline
Title: deadline_dep_earlier_deadline — dependent has earlier deadline than predecessor
Data Setup:
  - A→B
  - A: { dur: 120, deadline: '2026-06-18' }
  - B: { dur: 30, deadline: '2026-06-16' }
Action: Run scheduler
Expected Outcome:
  - B's deadline (6/16) is earlier than A's (6/18)
  - B must start after A ends AND before 6/16
  - Since A ends at A.start+120, and B needs 30min after that before 6/16
  - If A can't finish early enough → impossible → B unplaced (or A gets tighter deadline via backprop)
Sub-scenarios:
  - [SUB-135m1] Valid: A placed early enough → B fits before 6/16
  - [SUB-135m2] Impossible: A can't finish before B's deadline → B unplaced
---
```
```
---
ID: TS-135n
Domain: Deadline × Dependency — Mixed chain
Title: deadline_dep_mixed_chain — some chain members have deadlines, some don't
Data Setup:
  - A→B→C
  - A: { dur: 30 } (no deadline)
  - B: { dur: 45, deadline: '2026-06-17' }
  - C: { dur: 30 } (no deadline)
Action: Run scheduler
Expected Outcome:
  - B has deadline, A and C don't
  - B placed before deadline
  - A placed before B (no deadline → infinite slack, but dep constraint A before B)
  - C placed after B (infinite slack, but dep constraint C after B)
---
```
```
---
ID: TS-135o
Domain: Deadline × Dependency — Split predecessor
Title: deadline_dep_split_predecessor — predecessor is a split task with deadline
Data Setup:
  - A (split): { dur: 180, split: true, splitMin: 60, deadline: '2026-06-17' }
  - B: { dependsOn: ['A'], dur: 30, deadline: '2026-06-18' }
Action: Run scheduler
Expected Outcome:
  - A placed in chunks before 6/17
  - B placed after last A chunk completes
  - B before 6/18 deadline
---
```

### Deadline × Weather (TS-135p–s)

```
---
ID: TS-135p
Domain: Deadline × Weather — Intersection
Title: deadline_weather_intersection — deadline AND weather both narrow placement window
Data Setup:
  - Task: { deadline: '2026-06-17', weatherPrecip: 'dry_only', dur: 60 }
  - Only dry slots on 6/15 morning and 6/16 afternoon
Action: Run scheduler
Expected Outcome:
  - Task placed at 6/15 morning (first dry slot before deadline)
  - NOT at 6/16 morning (rainy)
  - 6/16 afternoon (dry) also eligible, but earliest is 6/15 morning
Sub-scenarios:
  - [SUB-135p1] Dry slots after deadline → not eligible (deadline blocks)
  - [SUB-135p2] Dry slots before deadline → eligible
  - [SUB-135p3] No dry slots before deadline → fail both → unplaced
---
```
```
---
ID: TS-135q
Domain: Deadline × Weather — Missing data + deadline
Title: deadline_weather_missing_data — missing weather data tightens deadline capacity
Data Setup:
  - Task: { deadline: '2026-06-17', weatherPrecip: 'dry_only', dur: 60 }
  - Weather data missing for 6/16 → fail-open → 6/16 all hours "weather OK"
Action: Run scheduler
Expected Outcome:
  - 6/16 passes weather check (fail-open)
  - All slots on 6/16 eligible
  - More capacity available than if weather data existed and showed rain
---
```
```
---
ID: TS-135r
Domain: Deadline × Weather — API down
Title: deadline_weather_api_down — weather API down, deadline still respected
Data Setup:
  - Task: { deadline: '2026-06-17', weatherPrecip: 'dry_only', dur: 60 }
  - Weather API returns 500 error
Action: Run scheduler
Expected Outcome:
  - loadWeatherForHorizon fails → weatherByDateHour = {} → fail-open
  - Deadline still enforced: task placed before 6/17
  - Weather constraint effectively ignored (fail-open)
---
```
```
---
ID: TS-135s
Domain: Deadline × Weather — Refresh shrinks slots
Title: deadline_weather_refresh_shrinks — cache refresh removes previously eligible slots
Data Setup:
  - Initial forecast: 6/16 all dry → eligible
  - Task placed at 6/16
  - Refreshed forecast: 6/16 now all rainy
Action: Re-run scheduler
Expected Outcome:
  - Already-placed task stays (doesn't re-check weather after placement)
  - New/unplaced tasks use new restrictive data
  - Deadline still enforced for new tasks
---
```

### Deadline × Time-Travel (TS-135t–x)

```
---
ID: TS-135t
Domain: Deadline × Time-Travel — Clock past deadline
Title: deadline_tt_clock_past — clock advances past deadline
Data Setup:
  - Today: 2026-06-10
  - Task: { deadline: '2026-06-12', dur: 30 }
  - Task placed on 6/11
  - Advance clock to 6/13 (past deadline)
Action: Run scheduler (re-run)
Expected Outcome:
  - Already-placed task stays (scheduled_at unchanged)
  - If re-scheduled: deadline 6/12 < today 6/13 → negative slack → ignoreDeadline path
  - New tasks with same deadline get ignoreDeadline treatment
---
```
```
---
ID: TS-135u
Domain: Deadline × Time-Travel — Day-by-day slack decrease
Title: deadline_tt_slack_decrease — slack decreases as days pass
Data Setup:
  - Today: 2026-06-15
  - Task: { deadline: '2026-06-18', dur: 120 }
  - Run each day 6/15, 6/16, 6/17, 6/18
Action: Run scheduler each day
Expected Outcome:
  - 6/15: slack = capacity(6/15-6/18) - 120
  - 6/16: slack = capacity(6/16-6/18) - 120 (decreased)
  - 6/17: slack = capacity(6/17-6/18) - 120 (further decreased)
  - 6/18: slack = capacity(6/18 only) - 120 (tight)
  - After each day passes, remaining capacity shrinks → slack decreases
---
```
```
---
ID: TS-135v
Domain: Deadline × Time-Travel — Already-past creation
Title: deadline_tt_already_past — task created with deadline in the past
Data Setup:
  - Today: 2026-06-15
  - New task: { deadline: '2026-06-10', dur: 30 } (5 days past)
Action: Run scheduler
Expected Outcome:
  - computeSlack: deadlineIdx < 0 (not in date range) → deadlineIdx = dates.length-1
  - Or computeSlack: deadline before earliest date → negative capacity?
  - Slack < 0 → ignoreDeadline fallback
  - Task placed at earliest slot (no deadline ceiling)
  - entry._overdue = true
Sub-scenarios:
  - [SUB-135v1] deadline = yesterday → negative slack → ignoreDeadline
  - [SUB-135v2] deadline = 6 months ago → very negative slack → still placed via ignoreDeadline
---
```
```
---
ID: TS-135w
Domain: Deadline × Time-Travel — Midnight crossing
Title: deadline_tt_midnight — deadline at midnight boundary
Data Setup:
  - Task: { deadline: '2026-06-16', dur: 60 }
  - Deadline day: 6/16
  - Available slots: 6/15 10pm-11pm, 6/15 11pm-12am (crosses midnight)
Action: Run scheduler
Expected Outcome:
  - 6/15 10pm slot: ends 11pm → before midnight → before deadline
  - 6/15 11pm slot: ends 12am → technically 6/16 → on deadline day
  - Both placed before deadline
Sub-scenarios:
  - [SUB-135w1] Task placed at 11:30pm-12:30am (crosses midnight) → deadline check uses dateKey
---
```
```
---
ID: TS-135x
Domain: Deadline × Time-Travel — Weekend deadline
Title: deadline_tt_weekend_deadline — deadline falls on weekend with reduced blocks
Data Setup:
  - Task: { deadline: '2026-06-20' (Saturday), dur: 120 }
  - Saturday: reduced blocks (start later, end earlier)
Action: Run scheduler
Expected Outcome:
  - deadline day (Saturday) has fewer eligible hours than weekday
  - Capacity before deadline may be reduced
  - Task placed in weekday slots before Saturday if weekend insufficient
---
```

---

## EARLIEST-START (TS-136 to TS-141q)

### Earliest-start data model (`unifiedScheduleV2.js`):
- `startAfterDate` = key from `t.startAfter` (stored as `start_after_at` in DB)
- `computeSlack()`: earliestIdx adjusted for startAfterDate (L547-549)
- `findEarliestSlot()`: skips dates before startAfterDate (L798-801)
- `findLatestSlot()`: also respects startAfterDate (L970-973)
- Validation: `startAfter > deadline` → 400 error on task creation

```
---
ID: TS-136
Domain: Earliest-Start / Hard lower bound
Title: earliest_start_hard_bound — task not placed before startAfter date
Data Setup:
  - Today: 2026-06-15
  - Task: { startAfter: '2026-06-17', dur: 60 }
  - Available: 6/15, 6/16, 6/17
Action: Run scheduler
Expected Outcome:
  - Task NOT placed on 6/15 or 6/16
  - Placed on 6/17 (earliest eligible day)
Sub-scenarios:
  - [SUB-136a] startAfter = today → placed today (allowed)
  - [SUB-136b] startAfter = tomorrow → placed tomorrow
  - [SUB-136c] startAfter = far future → placed on that date
  - [SUB-136d] startAfter = past date → treated as today (no restriction, dates list starts at today)
---
```
```
---
ID: TS-137
Domain: Earliest-Start / Slack effect
Title: earliest_start_slack_effect — startAfter reduces available days for slack calculation
Data Setup:
  - Task A: { startAfter: '2026-06-17', deadline: '2026-06-20', dur: 120 }
  - Task B: { startAfter: '2026-06-15', deadline: '2026-06-20', dur: 120 }
  - Both same deadline, same duration
Action: Run scheduler
Expected Outcome:
  - A: capacity computed from 6/17 to 6/20 (4 days) → specific slack value
  - B: capacity computed from 6/15 to 6/20 (6 days) → larger slack
  - A sorts before B (less slack = more constrained)
Sub-scenarios:
  - [SUB-137a] startAfter + deadline on same day → slack = that day's capacity - dur
  - [SUB-137b] startAfter after deadline → impossible (validation should catch)
  - [SUB-137c] startAfter far before deadline → slack = almost full deadline capacity
---
```
```
---
ID: TS-138
Domain: Earliest-Start / Recurring auto-set
Title: earliest_start_recurring_auto — recurring instances auto-set startAfter
Data Setup:
  - Recurring task: { type: 'daily', startAfter: '2026-06-17' }
  - Today: 2026-06-15
Action: Run scheduler
Expected Outcome:
  - Instances before 6/17 are NOT placed (startAfter blocks)
  - Instance on 6/17 placed (if eligible)
  - Instance on 6/18 placed
  - Each instance respects startAfter independently (if day-locked, startAfter may be before anchor date)
Sub-scenarios:
  - [SUB-138a] startAfter before recurring expansion horizon → some instances blocked
  - [SUB-138b] startAfter after horizon → no instances placed
  - [SUB-138c] startAfter removed → all instances eligible from today
---
```
```
---
ID: TS-139
Domain: Earliest-Start / Split respects
Title: earliest_start_split_respects — split chunks respect startAfter
Data Setup:
  - Task: { dur: 180, split: true, splitMin: 60, startAfter: '2026-06-17' }
  - Available: 6/15, 6/16, 6/17, 6/18
Action: Run scheduler
Expected Outcome:
  - placeSplitInline: earliestIdx = indexOfDate(6/17) (L1110-1112)
  - No chunks on 6/15 or 6/16
  - Chunks placed on 6/17 and 6/18
---
```
```
---
ID: TS-140
Domain: Earliest-Start / startAfter > deadline → unplaced
Title: earliest_start_after_deadline_unplaced — startAfter after deadline → no eligible slot
Data Setup:
  - Task: { startAfter: '2026-06-20', deadline: '2026-06-18', dur: 30 }
Action: Run scheduler
Expected Outcome:
  - computeSlack: earliestIdx > deadlineIdx → capacity = 0 → slack = -dur
  - findEarliestSlot: startAfter > deadline AND no ignoreDeadline → no slot found
  - If ignoreDeadline: still finds slot after startAfter (deadline ignored)
  - If startAfter strictly after deadline without fallback → unplaced
Sub-scenarios:
  - [SUB-140a] startAfter = deadline + 1 → impossible under normal mode → unplaced
  - [SUB-140b] startAfter = deadline → same day → technically one day of overlap
  - [SUB-140c] startAfter > deadline but ignoreDeadline → placed after startAfter
---
```
```
---
ID: TS-141
Domain: Earliest-Start / Validation 400
Title: earliest_start_validation_400 — startAfter > deadline returns 400
Data Setup:
  - API request to create/update task: { startAfter: '2026-06-20', deadline: '2026-06-18' }
Action: POST /api/tasks
Expected Outcome:
  - Server returns 400 Bad Request
  - Error message: startAfter must be before or on deadline (or equivalent)
  - Task NOT created
Sub-scenarios:
  - [SUB-141a] startAfter = deadline → valid (allowed, same day)
  - [SUB-141b] startAfter < deadline → valid
  - [SUB-141c] No deadline, startAfter set → valid (no conflict)
  - [SUB-141d] No startAfter, deadline set → valid
  - [SUB-141e] Both null → valid (free task)
---
```

### Earliest-Start × Template (TS-141a–f)

```
---
ID: TS-141a
Domain: Earliest-Start × Template — Blocks removed before/after
Title: earliest_start_template_blocks_removed — block removal combined with startAfter
Data Setup:
  - Template: blocks removed before startAfter date (blocks after startAfter remain)
  - Task: { startAfter: '2026-06-17', dur: 60 }
  - 6/17 blocks exist, 6/18 blocks exist
Action: Run scheduler
Expected Outcome:
  - Eligibility normal after startAfter (block removal only affects past days)
  - Task placed at 6/17 earliest slot regardless of which blocks were removed before
Sub-scenarios:
  - [SUB-141a1] Blocks removed ON startAfter date → reduced capacity on first eligible day
  - [SUB-141a2] All blocks after startAfter removed → no eligible windows → unplaced
---
```
```
---
ID: TS-141b
Domain: Earliest-Start × Template — Holiday on start
Title: earliest_start_template_holiday — holiday coincides with startAfter date
Data Setup:
  - Template: holiday on 6/17 (no blocks)
  - Task: { startAfter: '2026-06-17', dur: 60 }
  - 6/18 has normal blocks
Action: Run scheduler
Expected Outcome:
  - startAfter = 6/17, but 6/17 has no blocks (holiday)
  - Earliest eligible day = 6/18 (first day with blocks after startAfter)
  - Task placed on 6/18
---
```
```
---
ID: TS-141c
Domain: Earliest-Start × Template — Location
Title: earliest_start_template_location — location change affects earliest slots after startAfter
Data Setup:
  - Template: location changes on 6/17 from home to work
  - Task: { startAfter: '2026-06-17', dur: 60 }
  - Home blocks (before 6/17) vs work blocks (6/17+)
Action: Run scheduler
Expected Outcome:
  - Task placed in work blocks starting 6/17 (earliest eligible)
  - Home blocks before 6/17 are blocked by startAfter
---
```
```
---
ID: TS-141d
Domain: Earliest-Start × Template — locScheduleOverrides
Title: earliest_start_template_locschedule_overrides — location schedule overrides interact with startAfter
Data Setup:
  - Template: locScheduleOverrides for specific location
  - Task: { startAfter: '2026-06-17', location: 'downtown' }
  - Downtown schedule: reduced hours on weekdays
Action: Run scheduler
Expected Outcome:
  - Task's eligible windows after startAfter use downtown's overridden schedule
  - Earliest slot determined by overridden schedule on 6/17+
---
```
```
---
ID: TS-141e
Domain: Earliest-Start × Template — hourOverrides
Title: earliest_start_template_houroverrides — hour overrides shift eligible hours after startAfter
Data Setup:
  - Template: hourOverrides mapping afternoon→evening, effective starting 6/16
  - Task: { startAfter: '2026-06-17', dur: 60, when: 'afternoon' }
Action: Run scheduler
Expected Outcome:
  - Without override: afternoon = 12pm-5pm
  - With override: afternoon = 5pm-9pm
  - Task placed in first overridden afternoon slot on 6/17+
---
```
```
---
ID: TS-141f
Domain: Earliest-Start × Template — Holiday overlaps startAfter
Title: earliest_start_template_holiday_overlap — multiple holidays after startAfter
Data Setup:
  - Template: holidays on 6/17, 6/18, 6/19
  - Task: { startAfter: '2026-06-17', dur: 60 }
  - Next available block day: 6/22
Action: Run scheduler
Expected Outcome:
  - Earliest eligible day = 6/22 (first non-holiday after startAfter)
  - Task placed on 6/22
---
```

### Earliest-Start × Split (TS-141g–i)

```
---
ID: TS-141g
Domain: Earliest-Start × Split — First chunk bounded
Title: earliest_start_split_first_chunk — first chunk bounded by startAfter
Data Setup:
  - Task: { dur: 180, split: true, splitMin: 60, startAfter: '2026-06-17' }
Action: Run scheduler
Expected Outcome:
  - First chunk placed at earliest slot on 6/17+
  - Subsequent chunks placed after first chunk
  - No chunks placed before 6/17
---
```
```
---
ID: TS-141h
Domain: Earliest-Start × Split — Future start + cross-day
Title: earliest_start_split_future_crossday — startAfter causes chunks to span multiple days
Data Setup:
  - Task: { dur: 300, split: true, splitMin: 60, startAfter: '2026-06-17' }
  - 6/17 has limited capacity (only 120min free)
Action: Run scheduler
Expected Outcome:
  - Chunks 1-2 placed on 6/17
  - Chunks 3-5 placed on 6/18+
  - All chunks ≥ splitMin
  - Remaining after 6/17 capacity exhausted cross to next day
---
```
```
---
ID: TS-141i
Domain: Earliest-Start × Split — Both + deadline
Title: earliest_start_split_deadline — startAfter + deadline + split combined
Data Setup:
  - Task: { dur: 300, split: true, splitMin: 60, startAfter: '2026-06-17', deadline: '2026-06-19' }
Action: Run scheduler
Expected Outcome:
  - Chunks placed in [6/17, 6/19] range only
  - earliestIdx = 6/17, latestIdx = 6/19 (via deadline check in placeSplitInline L1114-1116)
  - If insufficient capacity → partial_split or ignoreDeadline
---
```

### Earliest-Start × Deadline (TS-141j–n)

```
---
ID: TS-141j
Domain: Earliest-Start × Deadline — Valid window
Title: earliest_start_deadline_valid_window — task has valid window from startAfter to deadline
Data Setup:
  - Task: { startAfter: '2026-06-17', deadline: '2026-06-20', dur: 60 }
Action: Run scheduler
Expected Outcome:
  - computeSlack: earliestIdx=6/17, deadlineIdx=6/20
  - task placed between 6/17 and 6/20
  - Respects both bounds
---
```
```
---
ID: TS-141k
Domain: Earliest-Start × Deadline — Single-day
Title: earliest_start_deadline_single_day — startAfter = deadline, single day window
Data Setup:
  - Task: { startAfter: '2026-06-17', deadline: '2026-06-17', dur: 60 }
Action: Run scheduler
Expected Outcome:
  - Only 6/17 is eligible
  - computeSlack: earliestIdx=deadlineIdx=6/17 → capacity = 6/17's capacity
  - If 6/17 has enough capacity → placed
  - If not enough → unplaced (or ignoreDeadline if slack<0)
---
```
```
---
ID: TS-141l
Domain: Earliest-Start × Deadline — Validation error
Title: earliest_start_deadline_validation — startAfter > deadline rejected at API
Data Setup:
  - API request: { startAfter: '2026-06-20', deadline: '2026-06-18' }
Action: POST /api/tasks or PUT /api/tasks/:id
Expected Outcome:
  - 400 Bad Request
  - Error message indicates startAfter must be before or on deadline
Sub-scenarios:
  - [SUB-141l1] startAfter = deadline + 1 day → error
  - [SUB-141l2] startAfter = deadline + 1 month → error
  - [SUB-141l3] startAfter = deadline - 1 day → valid
---
```
```
---
ID: TS-141m
Domain: Earliest-Start × Deadline — Legacy silent
Title: earliest_start_deadline_legacy_silent — legacy tasks with startAfter > deadline handled silently
Data Setup:
  - Task exists in DB with startAfter > deadline (created before validation added)
  - No API call, direct scheduler run
Action: Run scheduler
Expected Outcome:
  - Scheduler handles gracefully (does not crash)
  - findEarliestSlot: startAfter > deadline, no ignoreDeadline → no slot → unplaced
  - OR if slack < 0 → ignoreDeadline fallback places it after startAfter
---
```
```
---
ID: TS-141n
Domain: Earliest-Start × Deadline — Template shift
Title: earliest_start_deadline_template_shift — template changes shift window
Data Setup:
  - Task: { startAfter: '2026-06-17', deadline: '2026-06-20', dur: 60 }
  - Template changes: blocks removed on 6/19 (holiday)
Action: Run scheduler
Expected Outcome:
  - Eligible dates: 6/17, 6/18, 6/20 (6/19 holiday)
  - Capacity reduced (6/19 has 0)
  - Slack recalculated
  - Task placed in remaining eligible days before deadline
---
```

### Earliest-Start × Time-Travel (TS-141o–q)

```
---
ID: TS-141o
Domain: Earliest-Start × Time-Travel — Tomorrow → advance
Title: earliest_start_tt_tomorrow_advance — clock advances to startAfter
Data Setup:
  - Today: 2026-06-15
  - Task: { startAfter: '2026-06-17', dur: 60 }
  - Task unplaced (waiting for 6/17)
  - Advance clock to 6/17
Action: Run scheduler
Expected Outcome:
  - 6/15: task not placed (startAfter in future)
  - 6/17: task placed on 6/17 (startAfter reached)
---
```
```
---
ID: TS-141p
Domain: Earliest-Start × Time-Travel — Today
Title: earliest_start_tt_today — startAfter = today, placed immediately
Data Setup:
  - Today: 2026-06-15
  - Task: { startAfter: '2026-06-15', dur: 60 }
Action: Run scheduler
Expected Outcome:
  - Task placed on 6/15 (today)
  - startAfter = today → first eligible day = today
---
```
```
---
ID: TS-141q
Domain: Earliest-Start × Time-Travel — Past
Title: earliest_start_tt_past — startAfter in past, treated as no restriction
Data Setup:
  - Today: 2026-06-17
  - Task: { startAfter: '2026-06-10', dur: 60 }
Action: Run scheduler
Expected Outcome:
  - startAfter (6/10) < today (6/17)
  - indexOfDate(dates, '2026-06-10') = -1 (not in date list starting from today)
  - earliestIdx stays 0 (today) → no restriction
  - Task placed at earliest slot from today
Sub-scenarios:
  - [SUB-141q1] startAfter = yesterday → treated as today, no restriction
  - [SUB-141q2] startAfter = 6 months ago → no restriction, earliest slot from today
  - [SUB-141q3] startAfter = today - 1 but today is in date list → indexOfDate returns -1 if before dates[0]
---
```