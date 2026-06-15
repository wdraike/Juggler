# Juggler Scheduler — Full Structured Test Specs
## Adversarial Review Gap Fixes: G-002, G-003, G-004, G-008, G-034

**Updated:** 2026-06-15
**Scope:** TS-314 through TS-334
**Audience:** Developers implementing test coverage for HIGH-severity gaps identified in ADVERSARIAL-REVIEW-GAPS.md

---

## Format Legend

Each test spec includes:
- **ID** — Test scenario identifier (TS-314 onward)
- **Domain** — Feature area
- **Title** — One-line description
- **Data Setup** — Preconditions, clock, master task config, existing instances
- **Action** — What triggers the behavior (scheduler run / status change / API call / unit test call)
- **Expected Outcome** — What must happen (placements, statuses, errors, fallthrough behavior)
- **Sub-scenarios** — Related edge cases that should also be covered

---

## G-002: FakeClockAdapter / Legacy Scheduler Incompatibility (HIGH)

**Context:** The legacy scheduler (`unifiedScheduleV2.js` via `runSchedule.js`) calls `new Date()` directly in `getNowInTimezone()` (runSchedule.js L183) and in cached-generatedAt paths (L2076, L2293). It reads MySQL's clock via `SELECT NOW(3)` inline for cache timestamps (L1737 via `_runScheduleCommand.dbNow`). While `runSchedule.js` does wire `_runScheduleCommand.clockNow()` for DB `updated_at` stamps (H6/W3), the entry points for `todayKey`/`nowMins` (L183) and cache generation (L2076, L2293) still use raw `new Date()` — **not** the injectable ClockPort. The `RunScheduleCommand` constructor accepts a `clock` override (L77), but `getNowInTimezone` never calls `clockNow()`; it calls `new Date()` directly.

The unifiedScheduleV2.js *pure core* avoids direct clock calls — it receives `todayKey`/`nowMins` as arguments — but the orchestrator (`runScheduleAndPersist`, `getSchedulePlacementsWithCache`) computes those values via `new Date()` before passing them in. A `FakeClockAdapter` injected into `_runScheduleCommand` **only** replaces `clockNow()` stamps (used for `updated_at`), **not** the `todayKey`/`nowMins` computation.

This means TS-273 through TS-288 (time-travel) and ALL scheduler tests relying on deterministic clock are blocked until two prerequisites are met: (1) `getNowInTimezone` accepts an optional clock override, and (2) `getSchedulePlacementsWithCache` cache paths use ClockPort instead of `Date.now()`.

---
### TS-314: Legacy scheduler reads `new Date()` directly — FakeClockAdapter injection has NO effect on todayKey/nowMins

**Domain:** Clock / Time-Travel / Orchestrator Wiring
**Title:** `getNowInTimezone` calls `new Date()` directly — injecting a FakeClockAdapter into RunScheduleCommand does NOT change todayKey/nowMins

**Data Setup:**
- Clock: real system clock (not controllable)
- RunScheduleCommand constructed with deps.clock = FakeClockAdapter (fast-forwarded to `2026-07-01T12:00:00Z`)
- User config: `timezone: 'America/New_York'`
- User has 1 task: `{ text: 'Morning task', dur: 30, pri: P3, when: 'morning' }`
- No existing instances

**Action:** Call `runSchedule.getNowInTimezone('America/New_York')` and inspect what it returns

**Expected Outcome:**
- `getNowInTimezone` returns `{ todayKey, nowMins }` based on **real system clock**, NOT the FakeClockAdapter's `2026-07-01T12:00:00Z`
- If real clock is `2026-06-15`, todayKey is `2026-06-15` regardless of FakeClockAdapter setting
- **Proof:** A spy on `Date` constructor shows `getNowInTimezone` calls `new Date()` directly (L183); it never calls `_runScheduleCommand.clockNow()`
- **This means injecting a FakeClockAdapter for time-travel tests has NO EFFECT on placement determinism**

**Sub-scenarios:**
- [SUB-314a] `getNowInTimezone` uses `Intl.DateTimeFormat.formatToParts` on raw `new Date()` — both the base clock read AND timezone formatting bypass the adapter
- [SUB-314b] The scheduler run that calls `getNowInTimezone` then passes `timeInfo.todayKey` to `unifiedScheduleV2` — the core is correct, but the input is system-clock-based, not adapted-clock-based
- [SUB-314c] Document all call sites of `getNowInTimezone` within `runScheduleAndPersist` and `getSchedulePlacementsWithCache`

---
### TS-315: Legacy scheduler reads `Date.now()` — FakeClockAdapter.dbNow() NOT called by cache paths

**Domain:** Clock / Cache / Placement Timestamps
**Title:** `getSchedulePlacementsWithCache` uses `Date.now()` and `new Date(cache.generatedAt)` directly — FakeClockAdapter.dbNow() NOT used

**Data Setup:**
- Clock: real system clock
- RunScheduleCommand constructed with deps.clock = FakeClockAdapter (fast-forwarded)
- Stale placement cache: `{ dayPlacements: {...}, generatedAt: '2026-06-01T08:00:00.000Z', timezone: 'America/New_York' }`
- User config: `timezone: 'America/New_York'`
- User has tasks

**Action:** Call `getSchedulePlacementsWithCache(userId)` and inspect cache staleness logic

**Expected Outcome:**
- Cache staleness check at L2076: `new Date(cache.generatedAt)` is parsed from cached ISO string — correct, uses cached clock
- Cache age computation at L2077: `Date.now() - genTime.getTime()` uses **real system `Date.now()`** — NOT FakeClockAdapter
- Cache `generatedAt` write at L1737: `_runScheduleCommand.dbNow(trx)` → **DOES** use adapter's `dbNow()` — this is the one correctly wired path
- Fresh cache write at L2293: `generatedAt: new Date().toISOString()` — uses **raw `new Date()`** — bypasses adapter
- **Broken wiring:** 3 of 4 cache-timestamp sites bypass the ClockPort; only `dbNow()` for cache-generatedAt at persist time (L1737) goes through the adapter

**Sub-scenarios:**
- [SUB-315a] Cache ageMs computed with `Date.now()` (system clock) but `generatedAt` stamped with `_runScheduleCommand.dbNow()` (MySQL clock/adapter clock) → potential skew between the two clocks
- [SUB-315b] After full ClockPort migration: all 4 sites go through the same clock adapter → deterministic cache staleness

---
### TS-316: (ROADMAP) Prerequisite — Refactor legacy scheduler to accept injected clock

**Domain:** Clock / Time-Travel / Prerequisites
**Title:** Blocked: All TS-273 to TS-288 blocked until getNowInTimezone and cache paths accept clock override

**Data Setup:**
- N/A (roadmap item, not executable test)

**Action:** N/A

**Expected Outcome:**
- **Minimum refactoring needed:**
  1. `getNowInTimezone(tz, clock?)` — add optional `clock` param; if provided, use `clock.now()` instead of `new Date()`
  2. `getSchedulePlacementsWithCache` stale-check path — use `clock.now()` or `clock.dbNow()` instead of `Date.now()`
  3. Cache write path (L2293) — use `clock.now()` instead of `new Date()`
  4. `injectTerminalPlacements` (L120-156) — does NOT use clock directly (reads DB rows with `scheduled_at`), so unaffected
- **After refactoring:** Pass `FakeClockAdapter` through `runSchedule.js` entry points → all clock reads are deterministic

**Dependency chain:**
- TS-316 (this refactor) → TS-273..TS-288 (time-travel) → TS-314/315 validation
- ALL weather tests (TS-142..TS-154x) also benefit: they get deterministic `nowMins` for weather hour alignment

**Sub-scenarios:**
- [SUB-316a] `getNowInTimezone` is called from `runScheduleAndPersist` (L384-ish, the `var timeInfo = getNowInTimezone(TIMEZONE)` before the trx) and from `getSchedulePlacementsWithCache` (L2022 `var timeInfo = getNowInTimezone(TIMEZONE)`). Both call sites must be updated.
- [SUB-316b] All 12 `new Date()` sites in `runSchedule.js` catalogued: L172, L175, L183, L328, L538, L553, L586, L587, L711, L1034, L2045, L2046, L2076, L2293. Of these, L172/175/328/538/553/711/1125/1141/1151 are date math from existing dates (not system clock reads). L183/586/587/1034/2045/2046/2076/2293 are system clock reads that must route through ClockPort.

---
### TS-317: After ClockPort wiring — FakeClockAdapter.skipDays(1) correctly changes todayKey

**Domain:** Clock / Time-Travel / Validation
**Title:** Post-refactor: FakeClockAdapter advances clock by 1 day → getNowInTimezone returns next day's todayKey

**Data Setup:**
- Clock: FakeClockAdapter fixed at `2026-06-15T08:00:00-04:00` (America/New_York EDT)
- User config: `timezone: 'America/New_York'`
- User has 1 task: `{ text: 'Morning task', dur: 30, pri: P3, when: 'morning' }`
- No existing instances

**Action:**
1. Run scheduler → records todayKey = `2026-06-15`
2. Clock adapter: `skipDays(1)` → now shows `2026-06-16T08:00:00-04:00`
3. Run scheduler again

**Expected Outcome:**
- First run: todayKey = `'2026-06-15'`, task placed on 6/15
- Second run: todayKey = `'2026-06-16'`, task already placed on 6/15 → no duplicate, second run may place nothing new
- **Verification:** `getNowInTimezone('America/New_York', fakeClock)` returns `{ todayKey: '2026-06-16', nowMins: 480 }`
- Cache staleness: computed against fakeClock.now() → ageMs is deterministic

**Sub-scenarios:**
- [SUB-317a] skipHours(6): todayKey stays same (same date), nowMins advances 360
- [SUB-317b] skipDays(-1): clock goes back to yesterday → todayKey is past date → scheduler marks past task as missed (past-placement logic)
- [SUB-317c] Weather data loaded for horizon starting at fakeClock todayKey → weather hours align with adapted clock, not system clock

---

## G-003: Weather Hour-Level Partial Fail-Open (HIGH)

**Context:** `weatherOk()` in unifiedScheduleV2.js (L753-787) has three fail-open points:
1. L755: `if (!weatherByDateHour || !weatherByDateHour[dateKey]) return true` — entire day missing → pass
2. L758: `if (!w) return true` — per-hour data missing → pass
3. L773-774: `if (temp != null)` — temp/humidity null checks → skip if missing

TS-150 tests case 1 (full missing). But case 2 (per-hour missing while other hours have data) is untested and creates a **worse** UX: the user sees weather filtering active for most hours, but a task slips into an hour with no weather data, bypassing the filter.

---
### TS-318: weatherByDateHour[dateKey] exists but [dateKey][hour] is missing for some hours — those hours pass weather check (fail-open)

**Domain:** Weather / Fail-Open / Hour-Level
**Title:** Partial hour data: hours 8-12 have valid weather showing >80% precip, hour 14 data is missing → task with dry_only placed in hour 14

**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00-04:00` (America/New_York)
- Timezone: `America/New_York`
- FakeWeatherProvider: setHourly('2026-06-15', {
    8:  { precipProb: 90, cloudcover: 80, temp: 72, humidity: 65 },
    9:  { precipProb: 85, cloudcover: 75, temp: 73, humidity: 68 },
    10: { precipProb: 95, cloudcover: 90, temp: 71, humidity: 70 },
    11: { precipProb: 80, cloudcover: 70, temp: 74, humidity: 60 },
    12: { precipProb: 20, cloudcover: 30, temp: 75, humidity: 45 },
    // 13: entirely missing from data
    14: { precipProb: 5,  cloudcover: 10, temp: 77, humidity: 40 }
  })
- Note: hour 13 has NO entry in the hourly data (data fetch returned partial array with gap)
- Task A: `{ text: 'High-priority dry_only', dur: 30, pri: P1, when: 'biz1,biz2,afternoon', weatherPrecip: 'dry_only' }`
- Task B: `{ text: 'Filler wet_ok', dur: 60, pri: P4, when: 'anytime' }`

**Action:** Run scheduler

**Expected Outcome:**
- Hours 8-11: precipProb > 80 → ALL fail the `dry_only` filter → task NOT placed in these hours
- Hour 12: precipProb = 20 → passes (≤ 20) → task could be placed here
- Hour 13: **data MISSING** → `weatherOk` at L758 returns `true` (fail-open) → **task could be placed in hour 13 with NO weather data**
- Hour 14: precipProb = 5 → passes
- **Specific placement depends on priority ordering and capacity, but the critical assertion is: hour 13 is treated as eligible even though no weather data exists for it**

**Sub-scenarios:**
- [SUB-318a] All hours except hour 13 have valid weather → hour 13 treated as eligible → task placed in hour 13 if slots available there and all other hours are blocked by weather
- [SUB-318b] Task placed at hour 17 (missing data) → later weather data arrives for hour 17 showing 100% precip → task is already placed, no re-check on subsequent runs (scheduler resets non-fixed tasks daily, so next day's run re-evaluates)
- [SUB-318c] Temperature/humidity also subject to the same fail-open: `w.temp != null` check at L774 means missing temp → temp constraint skipped → task placed in unknown-temperature hour

---
### TS-319: Task with weather_precip='dry_only' placed in hour with missing data — worse UX than full fail-open

**Domain:** Weather / Fail-Open / User Perception
**Title:** User sees weather filtering working (hour 8-12 blocked) but task placed in hour 13 (data gap) — fails silently

**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00-04:00` (America/New_York)
- Timezone: `America/New_York`
- FakeWeatherProvider: setHourly('2026-06-15', {
    8:  { precipProb: 90 },
    9:  { precipProb: 90 },
    10: { precipProb: 90 },
    11: { precipProb: 90 },
    12: { precipProb: 90 },
    // 13-14: completely missing (API outage for these hours)
    15: { precipProb: 90 },
    16: { precipProb: 5 },
    17: { precipProb: 5 }
  })
- Task: `{ text: 'Outdoor task', dur: 60, pri: P2, when: 'biz1,biz2,afternoon', weatherPrecip: 'dry_only' }`

**Action:** Run scheduler, then inspect placement

**Expected Outcome:**
- Hours 8-12: ALL fail weather check (precipProb > 20) → not placed
- Hours 13-14: **no weather data** → `weatherOk` returns `true` → **task placed in hour 13 or 14**
- Hours 15-16: fail weather check → not placed
- Hour 17: passes → potentially placed
- **The task lands in an hour where we have ZERO weather data** — the user's `dry_only` constraint was silently ignored for those hours
- **This is WORSE than full fail-open** (TS-150) because:
  - Full fail-open: user sees "weather data unavailable" or all tasks placed → they know filtering is off
  - Partial fail-open: user sees SOME hours blocked → thinks filtering works → doesn't notice hour 13-14 placements have no data
- **The task placed at hour 13 has no `_unplacedReason`** because it was placed, not unplaced — the user sees it on the schedule without any indication that weather data was missing for that hour

**Sub-scenarios:**
- [SUB-319a] Weather display in frontend: task at hour 13 shows no weather icon (no data) while hours 8-12 show heavy rain icons → visual inconsistency is the only clue
- [SUB-319b] Task placed at hour 13 → next scheduler run regenerates placements → if weather data now available for hour 13 showing 90% precip → task moves to hour 16 (if still dry) → user sees task jump to different hour without clear reason
- [SUB-319c] Audit trail enhancement (future): placement should log `_weatherFailOpenReason` when weatherOk returns true due to missing data, so the frontend can show "Placed in unknown weather — weather data not available for this hour"
- [SUB-319d] Cloud cover (weatherCloud=clear) has the same vulnerability: missing cloudcover data → passes → task placed in unknown-sky hour

---

## G-004: Missing Status Transitions (HIGH)

**Context:** The status matrix (TASK-STATE-MATRIX.md) lists statuses: `""`, `wip`, `done`, `skip`, `cancel`, `pause`, `missed`, `archived`, `restored`. Existing tests only cover: pending→done (TS-101), pending→skip (TS-102), pending→cancel (TS-103), system→missed (TS-104/107-110), pending→skip on delete (TS-105), template delete→archived (TS-106). Entirely untested: `archived→restored`, `restored→done`, `wip→done`, `wip→skip`, `wip→cancel`, `missed→restored`, `done→archived→restored→done` round-trip, and `pause→active`/`active→pause`.

The critical missing behavior: `restored` tasks must re-enter the scheduler queue and be placed on the next run. Without this test, a restored task might remain in limbo (not scheduled) or get placed at its original past date.

---
### TS-320: Archived → restored — task re-enters scheduler queue, placed on next run

**Domain:** State Machine / Status Transitions / Lifecycle
**Title:** Archived task restored via API → status='restored', re-enters scheduler queue, placed on next run

**Data Setup:**
- Clock: `2026-06-15T08:00:00-04:00` (America/New_York)
- Timezone: `America/New_York`
- User config: default time_blocks
- Task: `{ id: 1, text: 'Restored task', dur: 30, pri: P3, when: 'morning', status: 'archived', scheduled_at: '2026-06-10T09:00:00Z' }` (archived, past scheduled_at)
- No other tasks

**Action:**
1. Call PUT `/api/tasks/1` with `{ status: 'restored' }`
2. Run scheduler

**Expected Outcome:**
- After step 1: task status = `'restored'`, `completed_at` cleared, `scheduled_at` cleared or set to null (restored tasks lose their past placement)
- After step 2: scheduler picks up the `restored` task (treated as active/pending task)
- Task is placed at the earliest available morning slot on or after today (`2026-06-15`)
- Task appears in `dayPlacements['2026-06-15']`
- Task status remains `'restored'` until scheduler explicitly sets it to `''` (empty/pending) OR the task stays as `'restored'` with new `scheduled_at`

**Sub-scenarios:**
- [SUB-320a] Archived task restored with `date_pinned=true` → restored task stays pinned to its original date (if future) or gets placed at pinned time on today (if past)
- [SUB-320b] Archived recurring instance restored → restored instance re-enters queue, but template may have generated a new instance for the same occurrence date → duplicate avoidance needed
- [SUB-320c] Archived→restored on a task that was done in the past (completed_at is set) → `completed_at` must be cleared on restore
- [SUB-320d] Archived→restored on a task that was cancelled → restored status takes precedence, existing cancel metadata cleared
- [SUB-320e] Multiple archived tasks restored in batch → all re-enter queue, placed by priority
- [SUB-320f] Archived task has `timeFlex` and `time` (preferred-time habit) → restored task must compute flex window relative to *restored date*, not original date

---
### TS-321: Restored → done — completed normally, completed_at=now

**Domain:** State Machine / Status Transitions / Completion
**Title:** Restored task marked done → status='done', completed_at=now, appears in terminal placements

**Data Setup:**
- Clock: `2026-06-15T08:00:00-04:00` (America/New_York)
- Timezone: `America/New_York`
- Task: `{ id: 1, text: 'Restored and completed', dur: 30, pri: P3, when: 'morning', status: 'restored', scheduled_at: '2026-06-15T09:00:00Z' }`

**Action:**
1. Run scheduler → task placed at morning slot
2. Call PUT `/api/tasks/1` with `{ status: 'done' }`

**Expected Outcome:**
- After step 2: task status = `'done'`
- `completed_at` set to current clock time (2026-06-15T08:00:00-04:00 or similar)
- `scheduled_at` snapped to now (for terminal status snap, per SM-18/19 rules)
- Task appears in terminal placements list (via `injectTerminalPlacements`)
- If this was a one-off task: done → terminal, never re-scheduled
- If this was a recurring instance: done → terminal, next occurrence generated by template on next run

**Sub-scenarios:**
- [SUB-321a] Restored→done with time_remaining recorded (if task had wip before archival → restored has timeRemaining → done records actual time spent)
- [SUB-321b] Restored→done without scheduled_at (restored task with no placement yet) → done requires scheduled_at (SM-19), should return 400 if missing

---
### TS-322: WIP → done — time_remaining recorded at completion

**Domain:** State Machine / Status Transitions / Time Tracking
**Title:** WIP task marked done → status='done', time_remaining shows remaining duration, completed_at=now

**Data Setup:**
- Clock: `2026-06-15T08:00:00-04:00` (America/New_York)
- Timezone: `America/New_York`
- Task: `{ id: 1, text: 'In progress task', dur: 120, pri: P2, status: 'wip', scheduled_at: '2026-06-15T08:00:00Z', time_remaining: 45 }`
  - Task has 120 min duration, user started it at 8:00, worked 75 min so far, 45 min remaining

**Action:** Call PUT `/api/tasks/1` with `{ status: 'done' }`

**Expected Outcome:**
- Status: `'done'`
- `completed_at`: current clock time
- `time_remaining`: set to `null` or `0` (task is done, no remaining time)
- Original `dur` preserved (history of original estimate)
- If task is a recurring instance: done instance is terminal, next occurrence from template
- **Alternative tracking:** Some implementations record `actual_dur = orig_dur - time_remaining` for analytics

**Sub-scenarios:**
- [SUB-322a] WIP→done with time_remaining = 0 (user finished exactly on schedule) → completed_at = now, dur matches actual time
- [SUB-322b] WIP→done with time_remaining = null (time tracking not used) → completed_at = now, no duration adjustment
- [SUB-322c] WIP→done with time_remaining > original dur (error state, should not happen) → system clamps to 0 or rejects
- [SUB-322d] WIP→done → re-open (done→'' on terminal task is rejected per SM-25 by some tests; if allowed, completed_at is cleared)

---
### TS-323: WIP → skip — scheduled_at snaps to now, time_remaining discarded

**Domain:** State Machine / Status Transitions / Skip
**Title:** WIP task skipped → status='skip', scheduled_at snaps to now, time_remaining discarded

**Data Setup:**
- Clock: `2026-06-15T08:00:00-04:00` (America/New_York)
- Timezone: `America/New_York`
- Task: `{ id: 1, text: 'In progress but skipping', dur: 60, pri: P3, status: 'wip', scheduled_at: '2026-06-15T08:00:00Z', time_remaining: 30 }`

**Action:** Call PUT `/api/tasks/1` with `{ status: 'skip' }`

**Expected Outcome:**
- Status: `'skip'`
- `scheduled_at`: snapped to current clock time (L1034-ish in runSchedule.js uses `new Date().toISOString()`)
- `time_remaining`: set to `null` (discarded — skip means user is abandoning this instance)
- `completed_at`: set to now (terminal status)
- Task does NOT re-enter scheduler queue (skip is terminal per skip semantics)
- If recurring: skip counts as completed occurrence, next one generated

**Sub-scenarios:**
- [SUB-323a] WIP→skip on a chain-member task → chain successor checks dep status: skip is a terminal that satisfies the dependency (L734: `st === 'skip'` → `continue` in checkDeps)
- [SUB-323b] WIP→skip on a recurring instance → instance status=skip, master's rolling anchor advances, next occurrence on schedule
- [SUB-323c] WIP→skip with time_remaining=0 (just started) → same behavior, no special handling
- [SUB-323d] WIP→skip on fixed (when=fixed, non-recurring) → skip is allowed for any task, but fixed task's scheduled_at snaps to now which may violate fixed semantics → need to verify whether fixed+skip is accepted or blocked

---
### TS-324: WIP → cancel — scheduled_at snaps to now, rolling anchor NOT updated

**Domain:** State Machine / Status Transitions / Cancel
**Title:** WIP task cancelled → status='cancel', scheduled_at snaps to now, rolling anchor NOT updated

**Data Setup:**
- Clock: `2026-06-15T08:00:00-04:00` (America/New_York)
- Timezone: `America/New_York`
- Recurring instance: `{ id: 1, master_id: 100, text: 'Cancelled instance', dur: 30, pri: P3, status: 'wip', scheduled_at: '2026-06-15T10:00:00Z', time_remaining: 25 }`
- Recurring template master: `{ id: 100, text: 'Daily habit', dur: 30, recur: { type: 'daily' }, rolling_anchor: '2026-06-15' }`

**Action:** Call PUT `/api/tasks/1` with `{ status: 'cancel' }`

**Expected Outcome:**
- Instance status: `'cancel'`
- `scheduled_at`: snapped to current clock time
- `time_remaining`: discarded (set to null)
- `completed_at`: set to now
- **Rolling anchor on master (id=100): NOT updated** — cancel means the user abandoned this instance but doesn't count as a completed occurrence for anchor advancement
- On next scheduler run: template generates a new instance for the next day (anchor unchanged, so occurrence date calculated from original anchor)
- If cancel is the 3rd uncompleted instance in a row: no auto-rerun or special handling (cancel suppresses rerun per R44.x semantics)

**Sub-scenarios:**
- [SUB-324a] Cancel on a one-off (non-recurring) task → terminal status, no anchor to update, same scheduled_at snap
- [SUB-324b] Cancel on a recurring instance that was already marked done earlier in the day → should be rejected (terminal→terminal transitions idempotent per SM-25, but done→cancel is a different transition)
- [SUB-324c] Cancel vs Skip distinction for TPC: cancel counts toward fulfilled for TPC backfill (fills the slot), skip does NOT block spacing guard (G-001). Both are terminal but have different downstream effects.
- [SUB-324d] Cancel on a chain-member task → successor's dep check: cancel is a valid fulfilment (L734: `st === 'cancel'` → `continue`) — successor unblocked

---
### TS-325: Missed → restored — status='restored', eligible for re-placement

**Domain:** State Machine / Status Transitions / Recovery
**Title:** Missed task restored → status='restored', re-enters scheduler queue, eligible for placement on next run

**Data Setup:**
- Clock: `2026-06-15T08:00:00-04:00` (America/New_York)
- Timezone: `America/New_York`
- Task: `{ id: 1, text: 'Missed then restored', dur: 45, pri: P2, when: 'afternoon', status: 'missed', scheduled_at: '2026-06-14T14:00:00Z', completed_at: '2026-06-14T14:00:00Z' }` (yesterday's missed task)

**Action:**
1. Call PUT `/api/tasks/1` with `{ status: 'restored' }`
2. Run scheduler

**Expected Outcome:**
- After step 1: status = `'restored'`, `completed_at` cleared (or set to null), `scheduled_at` cleared or reset
- After step 2: scheduler places restored task at earliest eligible afternoon slot on today (`2026-06-15`)
- Task appears in `dayPlacements['2026-06-15']`
- `_placementReason` records "restored" or similar

**Sub-scenarios:**
- [SUB-325a] Missed→restored on a recurring instance → instance becomes active again, regenerating logic must avoid duplicate with next scheduled occurrence
- [SUB-325b] Missed→restored on a one-off with deadline in the past → deadline ignored (overdue task), placed at earliest available slot
- [SUB-325c] Missed→restored multiple times (missed→restored→missed→restored) → each restore re-enters queue, no degradation
- [SUB-325d] Missed→restored on a task with `date_pinned=true` → pinned date is in the past → conflict: pin to past date vs scheduler only processes [today, horizon] → must be resolved: pin is invalid for past date, should either clear pin or move to today

---
### TS-326: Paused → active (re-enabled) — template expansion resumes

**Domain:** State Machine / Pause / Recurring Templates
**Title:** Paused recurring template unpaused → new instances generated on next scheduler run

**Data Setup:**
- Clock: `2026-06-15T08:00:00-04:00` (America/New_York)
- Timezone: `America/New_York`
- Recurring template: `{ id: 100, text: 'Weekly report', dur: 60, pri: P3, when: 'morning', status: 'pause', recur: { type: 'weekly', days: ['Mon'] } }`
- Instances: none (template was paused, so no instances generated)

**Action:**
1. Call PUT `/api/tasks/100` with `{ status: '' }` (empty/pending — re-enable) or via a dedicated re-enable endpoint
2. Run scheduler

**Expected Outcome:**
- After step 1: status = `''` (pending/active)
- After step 2: scheduler's `expandRecurring` or reconcile logic generates instances for the template
- New instances created for upcoming Mondays starting from `2026-06-15` (today is Monday)
- Instances have status `''`, scheduled for morning slots
- Template's `rolling_anchor` updated if applicable

**Sub-scenarios:**
- [SUB-326a] Paused→active on a template that had pending instances before pause → those instances were deleted on pause → regenerated on unpause (no duplication)
- [SUB-326b] Paused→active on a template that had completed instances during pause period → completed instances preserved, new instances generated only for uncompleted dates
- [SUB-326c] Paused→active with `time_flex` and preferred time → instances generated with correct flex windows
- [SUB-326d] Paused→active when now is mid-cycle (e.g., weekly template paused on Wednesday, unpaused on Friday) → instances generated for remaining days in cycle + next cycle
- [SUB-326e] Paused→active via API: should this also enqueue an immediate scheduler run? (R44 trigger — depends on design decision)

---
### TS-327: Active → pause — template expansion suspended, pending instances preserved

**Domain:** State Machine / Pause / Suspension
**Title:** Active recurring template paused → future instances NOT generated, existing pending instances preserved

**Data Setup:**
- Clock: `2026-06-15T08:00:00-04:00` (America/New_York)
- Timezone: `America/New_York`
- Recurring template: `{ id: 100, text: 'Morning routine', dur: 30, pri: P3, when: 'morning', status: '', recur: { type: 'daily' } }`
- Existing instances:
  - `{ id: 1, master_id: 100, status: '', scheduled_at: '2026-06-15T07:00:00Z', date: '2026-06-15' }` (today's instance, pending)
  - `{ id: 2, master_id: 100, status: '', scheduled_at: '2026-06-16T07:00:00Z', date: '2026-06-16' }` (tomorrow's instance, pending)

**Action:**
1. Call PUT `/api/tasks/100` with `{ status: 'pause' }`
2. Run scheduler

**Expected Outcome:**
- After step 1: template status = `'pause'`
- After step 2: scheduler's `expandRecurring` SKIPS paused templates → no new instances generated
- Existing pending instances (id=1, id=2): **preserved** (not deleted on pause)
- Those instances remain on the schedule and can be completed/skipped/cancelled normally
- On subsequent scheduler runs: no new instances beyond the existing ones (instance 3 for 6/17 is NOT generated)
- If today's instance (id=1) is marked done: it's done, but no replacement instance generated because template is paused

**Sub-scenarios:**
- [SUB-327a] Active→pause when instances have been drag-pinned → pinned instances preserved (they're independent of template generation)
- [SUB-327b] Active→pause then later pause→active → instances generated from current date forward, existing ones from before pause retained
- [SUB-327c] Active→pause on a non-recurring task → pause is template-only, should be rejected for one-off tasks (SM-21 contracts this as template-only)
- [SUB-327d] Active→pause clears future unplaced instances but keeps today's and past instances — verify exactly which instances are deleted vs preserved

---
### TS-328: done → archived → restored → done — round-trip lifecycle

**Domain:** State Machine / Lifecycle / Round-Trip
**Title:** Full lifecycle: task done → archived → restored → done again, all transitions valid

**Data Setup:**
- Clock: `2026-06-15T08:00:00-04:00` (America/New_York)
- Timezone: `America/New_York`
- Task: `{ id: 1, text: 'Round-trip task', dur: 30, pri: P3, when: 'morning', status: 'done', scheduled_at: '2026-06-14T09:00:00Z', completed_at: '2026-06-14T09:30:00Z' }`

**Action:**
1. Call PUT `/api/tasks/1` with `{ status: 'archived' }`
2. Call PUT `/api/tasks/1` with `{ status: 'restored' }`
3. Run scheduler (task gets placed)
4. Call PUT `/api/tasks/1` with `{ status: 'done' }`

**Expected Outcome:**
- Step 1: status = `'archived'`, `completed_at` preserved? (archived done tasks keep completion metadata)
- Step 2: status = `'restored'`, `completed_at` cleared, `scheduled_at` cleared for re-placement
- Step 3: task placed on today (`2026-06-15`) at morning slot
- Step 4: status = `'done'`, `completed_at` = now (2026-06-15)
- Full round-trip completes without errors, all transitions valid (terminal→archived→restored→terminal)

**Sub-scenarios:**
- [SUB-328a] done→archived→restored multiple times (3+ full cycles) → no degradation, metadata resets correctly each time
- [SUB-328b] done→archived→restored with `time_remaining` → restored task clears time_remaining (fresh instance)
- [SUB-328c] done→archived→restored on a chain-member task → restored task re-enters dep chain, must satisfy predecessor dependencies again
- [SUB-328d] done→archived→restored on recurring instance → restored instance is independent of template; template may regenerate a NEW instance for the same occurrence date → conflict/duplicate — system must either delete the restored instance on regeneration or mark restored as terminal

---
### TS-329: Empty/wip/done/skip/cancel/missed — all pairwise transitions verified (transition matrix)

**Domain:** State Machine / Transition Matrix / Exhaustive
**Title:** All 9×9 pairwise status transitions verified — valid transitions succeed, invalid transitions return 400

**Data Setup:**
- Clock: fixed
- Timezone: `America/New_York`
- A test task per status: for each `fromStatus` in `['', 'wip', 'done', 'skip', 'cancel', 'missed', 'archived', 'restored', 'pause']`, create a task in that status
- `pause` used only for recurring templates; `archived`/`restored` only for non-template tasks

**Action:**
For each `(fromStatus, toStatus)` pair:
- Call PUT `/api/tasks/{id}` with `{ status: toStatus }`

**Expected Outcome (transition matrix):**

| from \ to | '' | wip | done | skip | cancel | missed | archived | restored | pause |
|-----------|:--:|:---:|:----:|:----:|:------:|:------:|:--------:|:---------:|:-----:|
| **''** | ✅ idem | ✅ | ✅ | ✅ | ✅ | ❌ sys | ✅ | ❌ | ✅ tmpl |
| **wip** | ✅ reopen | ✅ idem | ✅ | ✅ | ✅ | ❌ sys | ✅ | ❌ | ❌ |
| **done** | ❌ | ❌ | ✅ idem | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **skip** | ❌ | ❌ | ❌ | ✅ idem | ❌ | ❌ | ✅ | ❌ | ❌ |
| **cancel** | ❌ | ❌ | ❌ | ❌ | ✅ idem | ❌ | ✅ | ❌ | ❌ |
| **missed** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ idem | ✅ | ✅ | ❌ |
| **archived** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ idem | ✅ | ❌ |
| **restored** | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ sys | ✅ | ✅ idem | ❌ |
| **pause** | ✅ tmpl | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ idem |

Legend:
- `✅` = valid transition (200 OK)
- `✅ idem` = idempotent (setting same status, 200 OK, no change)
- `✅ tmpl` = valid only for recurring templates
- `❌` = invalid (400 Bad Request or 403 Forbidden)
- `❌ sys` = system-only (missed is set by scheduler, not user) → 403 Forbidden

**Detailed assertions:**
- [SUB-329a] `'' → ''`: idempotent, empty task stays empty
- [SUB-329b] `'' → wip`: starts task, `scheduled_at` unchanged
- [SUB-329c] `'' → done`: snaps `scheduled_at` to now, sets `completed_at`
- [SUB-329d] `'' → skip`: snaps to now, terminal
- [SUB-329e] `'' → cancel`: snaps to now, terminal
- [SUB-329f] `'' → missed`: user cannot set missed (system-only) → 403
- [SUB-329g] `'' → archived`: valid for non-template tasks
- [SUB-329h] `'' → pause`: valid only for recurring templates
- [SUB-329i] `done → done`: idempotent terminal (SM-25)
- [SUB-329j] `done → archived`: valid, preserves completion metadata
- [SUB-329k] `missed → restored`: valid, re-enters queue (TS-325)
- [SUB-329l] `archived → restored`: valid, re-enters queue (TS-320)
- [SUB-329m] `restored → done`: valid (TS-321)
- [SUB-329n] `restored → skip`: valid
- [SUB-329o] `restored → cancel`: valid
- [SUB-329p] All invalid pairs return 400/403 with error message

---

## G-008: Non-Existent TemplateId Crashes (HIGH)

**Context:** `resolveLocationId()` in `shared/scheduler/locationHelpers.js` resolves the effective location for a given (date, minute). It checks `cfg.locScheduleOverrides[dateStr]` → `cfg.locScheduleDefaults[dayName]` → `cfg.locSchedules[templateId]` → `block.loc` → `"home"`. If any step references a non-existent templateId (i.e., `cfg.locSchedules` does not have that key), the function must **gracefully fall through** to the next step without throwing.

The code at L60 already guards with `cfg.locSchedules && cfg.locSchedules[templateId]` — accessing `config[undefinedKey]` returns `undefined` in JS, not a TypeError. However, the concern is defensively verifying this behavior with explicit tests, because:
1. `cfg.locScheduleOverrides` and `cfg.locScheduleDefaults` are loaded from user_config JSON blobs — corrupted data could set them to unexpected types (e.g., a number instead of a string)
2. `cfg.locSchedules` might be `null` instead of `{}` if the user_config row has invalid JSON

---
### TS-330: locScheduleOverrides references non-existent templateId — resolveLocationId falls through to day-of-week blocks

**Domain:** Template Resolution / Location / Graceful Fallthrough
**Title:** locScheduleOverrides[dateStr] = 'nonexistent-template' → resolveLocationId does NOT throw, falls through to day-of-week block resolution

**Data Setup:**
- cfg: `{
    hourLocationOverrides: {},
    locScheduleOverrides: { '2026-06-15': 'nonexistent-template-id' },
    locScheduleDefaults: {},
    locSchedules: { 'valid-template': { hours: { 480: 'work' } } },
    scheduleTemplates: null
  }`
- blocks for 2026-06-15 (Monday): `[ { tag: 'morning', start: 360, end: 480, loc: 'home' }, { tag: 'biz', start: 480, end: 720, loc: 'work' } ]`
- dateStr: `'2026-06-15'`

**Action:** Call `resolveLocationId('2026-06-15', 540, cfg, blocks)` directly (unit test, no scheduler run)

**Expected Outcome:**
- `resolveLocationId` returns `'work'` (from biz block's loc field) — NOT `'nonexistent-template-id'`, NOT `undefined`, NOT a TypeError
- **Fallthrough path:** `cfg.locScheduleOverrides['2026-06-15']` = `'nonexistent-template-id'` → templateId set
- → `cfg.locSchedules['nonexistent-template-id']` evaluates to `undefined` → guard `cfg.locSchedules[templateId]` is false → skip
- → falls through to `block.loc` logic → `getBlockAtMinute(blocks, 540)` returns biz block → `block.loc = 'work'`
- → returns `'work'`
- No error thrown

**Sub-scenarios:**
- [SUB-330a] Non-existent templateId at minute 360 (morning block, no loc set) → falls to final `return "home"` → returns `'home'`
- [SUB-330b] Both locScheduleOverrides AND locScheduleDefaults reference non-existent templates → double fallthrough → block.loc → "home"
- [SUB-330c] locScheduleOverrides = `null` (corrupted config) → the `cfg.locScheduleOverrides[dateStr]` at L52 throws TypeError (cannot read property of null) → **this IS a crash risk** — the code assumes locScheduleOverrides is an object
- [SUB-330d] locScheduleOverrides = `{ '2026-06-15': null }` → templateId is null → L60 guard `templateId &&` short-circuits → clean fallthrough, no crash

---
### TS-331: locScheduleDefaults references non-existent templateId — falls through to block.loc field

**Domain:** Template Resolution / Location / Graceful Fallthrough
**Title:** locScheduleDefaults['Mon'] = 'nonexistent-template' → resolveLocationId falls through to block.loc

**Data Setup:**
- cfg: `{
    hourLocationOverrides: {},
    locScheduleOverrides: {},
    locScheduleDefaults: { 'Mon': 'nonexistent-template-id' },
    locSchedules: { 'another-valid': { hours: { 600: 'gym' } } },
    scheduleTemplates: null
  }`
- blocks for 2026-06-15 (Monday): `[ { tag: 'morning', start: 360, end: 480, loc: 'home' }, { tag: 'biz', start: 480, end: 720, loc: 'office' } ]`
- dateStr: `'2026-06-15'`

**Action:** Call `resolveLocationId('2026-06-15', 600, cfg, blocks)` directly

**Expected Outcome:**
- `resolveLocationId` returns `'office'` (from biz block's loc) — NOT `'gym'` (the valid template's hours), NOT `'nonexistent-template-id'`
- **Fallthrough path:**
  1. `cfg.locScheduleOverrides['2026-06-15']` → undefined → skip
  2. `cfg.locScheduleDefaults['Mon']` → `'nonexistent-template-id'` → templateId set
  3. `cfg.locSchedules['nonexistent-template-id']` → undefined → guard false → skip
  4. `blocks` → `getBlockAtMinute(blocks, 600)` → biz block at 480-720 → `block.loc = 'office'`
  5. Return `'office'`
- No error thrown

**Sub-scenarios:**
- [SUB-331a] locScheduleDefaults['Mon'] references non-existent template AND no loc on matching block → returns `'home'` (final default)
- [SUB-331b] locScheduleDefaults = `{ 'Mon': '' }` → empty string is falsy → templateId = `''` → L60 `'' &&` → false → fallthrough
- [SUB-331c] locScheduleDefaults = `null` → L54-57: `cfg.locScheduleDefaults && cfg.locScheduleDefaults[dn]` fails on L54? Let's check: L53 `cfg.locScheduleDefaults[dn]` — YES, this would throw if locScheduleDefaults is null. But loadConfig defaults it to `{}` (L242). If user config is corrupted... It's a soft crash risk.
- [SUB-331d] locScheduleDefaults missing `'Mon'` key → `cfg.locScheduleDefaults['Mon']` = undefined → templateId stays null → fallthrough to blocks

---
### TS-332: locSchedules references non-existent templateId — falls through to step 6 default "home"

**Domain:** Template Resolution / Location / Graceful Fallthrough
**Title:** locSchedules has no matching key for the resolved templateId → falls through to block.loc then default "home"

**Data Setup:**
- cfg: `{
    hourLocationOverrides: {},
    locScheduleOverrides: {},
    locScheduleDefaults: {},
    locSchedules: {},  // empty object — no templates at all
    scheduleTemplates: null
  }`
- blocks for 2026-06-15 (Monday): `[ { tag: 'morning', start: 360, end: 480 }, { tag: 'biz', start: 480, end: 720 } ]` — blocks without loc field
- dateStr: `'2026-06-15'`

**Action:** Call `resolveLocationId('2026-06-15', 420, cfg, blocks)` directly

**Expected Outcome:**
- `cfg.locScheduleOverrides['2026-06-15']` → undefined → skip
- `cfg.locScheduleDefaults['Mon']` → undefined → skip
- No templateId → skip
- blocks → `getBlockAtMinute(blocks, 420)` → morning block → `block.loc` is undefined → skip
- **Returns `'home'`** (final default at L72)
- No error, no undefined return

**Sub-scenarios:**
- [SUB-332a] locSchedules = `null` → L60 `cfg.locSchedules &&` short-circuits → false → fallthrough to blocks → "home". Safe.
- [SUB-332b] locSchedules = `{ 'valid-template': null }` → `cfg.locSchedules['valid-template']` → null → L60 false → fallthrough. Safe.
- [SUB-332c] locSchedules = `{ 'valid-template': { hours: null } }` → template found, `tmpl.hours` is null → L62 `null[undefined]` → **TypeError crash**. This is a latent crash path: a template with hours=null in the config data.
- [SUB-332d] locSchedules = `{ 'valid-template': { hours: {} } }` → empty hours object → L63 `{}[undefined]` → undefined → L64 `{}[hour]` → undefined → fallthrough to block.loc → "home". Safe.

---

## G-034: Missing Timezone in All Test Setups (HIGH)

**Context:** Every scheduler test that specifies a clock time (todayKey, nowMins) must also specify the user's timezone. Currently, no test explicitly sets timezone. The scheduler's `getNowInTimezone()` uses `DEFAULT_TIMEZONE` (L118: `var DEFAULT_TIMEZONE = constants.DEFAULT_TIMEZONE;`) when no timezone is provided. If CI runs in UTC and dev runs in America/New_York, the same `todayKey`/`nowMins` input produces different placements because:
1. `utcToLocal`/`localToUtc` conversions depend on timezone
2. Day boundary detection (`nowMins` at 00:00 vs 04:00) shifts tasks between days
3. Deadline comparisons (`deadlineDate` vs `todayKey`) are timezone-relative

---
### TS-333: Every test must specify user timezone — test fails if timezone not explicitly set

**Domain:** Timezone / Test Infrastructure / Mandatory Setup
**Title:** Test framework enforces explicit timezone requirement: any test without explicit timezone in Data Setup fails validation

**Data Setup:**
- Test harness: scheduler test framework with timezone validation middleware
- Test A: `{ clock: '2026-06-15T08:00:00Z', user: { config: {...} } }` — NO timezone specified
- Test B: `{ clock: '2026-06-15T08:00:00Z', user: { config: { timezone: 'America/New_York' }, ... } }` — timezone explicitly set

**Action:** Run test validation

**Expected Outcome:**
- Test A: **FAILS** — `Error: Timezone not specified. Every scheduler test must set the user's timezone explicitly.`
- Test B: **PASSES** — timezone is `America/New_York`, scheduler correctly interprets clock time

**Sub-scenarios:**
- [SUB-333a] Test uses `DEFAULT_TIMEZONE` constant without setting it → framework catches that the constant is being used rather than an explicit value → fails
- [SUB-333b] Migration path: add `timezone` field to every existing test Data Setup in: unifiedSchedule.test.js, schedulerScenarios.test.js, schedulerDeepCoverage.test.js, schedulerTimeSimulation.test.js, schedulerRules.test.js, all weather tests (TS-142..TS-154x), all placement-mode tests
- [SUB-333c] Test without clock time (pure algorithmic test): still needs timezone if it uses `todayKey`/`nowMins` — if the test passes `todayKey` directly without timezone dependency, it may be exempt

---
### TS-334: User in America/Los_Angeles (UTC-7) vs America/New_York (UTC-4) — different nowMins → different placement results

**Domain:** Timezone / Cross-TZ Placement / Determinism
**Title:** Same absolute clock time, different user timezone → different nowMins → different placement (task placed in morning in NY, evening in LA)

**Data Setup:**
- Absolute clock: `2026-06-15T12:00:00Z` (12:00 UTC, which is 08:00 EDT / 05:00 PDT)
- User A: `timezone: 'America/New_York'` → nowMins = 8*60 = 480 (8:00 AM EDT)
- User B: `timezone: 'America/Los_Angeles'` → nowMins = 5*60 = 300 (5:00 AM PDT)
- Both users have identical task: `{ text: 'Morning report', dur: 30, pri: P3, when: 'morning' }`
- Morning block: `360-480` (6:00 AM - 8:00 AM in local time)
- No existing instances

**Action:** Run scheduler for User A and User B at the same absolute clock time

**Expected Outcome:**
- **User A (NY):** nowMins = 480 (8:00 AM) → morning block (360-480) has already ended at 8:00 AM → task might be placed in next available block (biz 480-720) or left unplaced if morning was the only block
- **User B (LA):** nowMins = 300 (5:00 AM) → morning block (360-480) hasn't started yet → task placed at earliest morning slot (6:00 AM PDT = 360)
- **Same absolute clock, different timezone → different placement results**
- This demonstrates why every test MUST specify timezone for deterministic results

**Sub-scenarios:**
- [SUB-334a] User in UTC (no DST) vs user in America/Denver (UTC-6/UTC-7) → nowMins differs by 6-7 hours → day boundaries differ → task that is "today" for UTC is "yesterday" for Denver
- [SUB-334b] DST transition: `2026-03-08T07:00:00Z` (Spring forward in NY: UTC-5→UTC-4) → nowMins = 2*60=120 (2:00 AM EST) vs after transition: nowMins = 3*60=180 (3:00 AM EDT) — the clock advanced but absolute time is same
- [SUB-334c] Deadline test with tz: User in Tokyo (UTC+9) vs NY (UTC-4) → same task has deadline "2026-06-15" → in Tokyo, deadline is 15:00 UTC on 6/14; in NY, deadline is 04:00 UTC on 6/15 → different effective deadline windows
- [SUB-334d] Weather test with tz: Weather data is keyed by date+hour in LOCAL time → User in NY (UTC-4) has weather hour 8 = 12:00 UTC; User in LA (UTC-7) has weather hour 8 = 15:00 UTC → different weather data for "hour 8 morning" depending on timezone