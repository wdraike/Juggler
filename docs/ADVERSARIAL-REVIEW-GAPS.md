# Juggler Test Specs — Adversarial Review: Gaps, Contradictions & Missing Scenarios

**Reviewer:** Adversarial QA Agent  
**Date:** 2026-06-15  
**Inputs:** All structured test spec files across 440+ scenarios

---

## CRITICAL FINDING — Cross-Cutting Contradictions

### CONTRA-1: fixed + recurring ambiguity
| Source | Assertion | 
|--------|-----------|
| TASK-SETTINGS-TREE.md §2.1 | `fixed + recurring → ✗ (UI blocks, no server enforcement — GAP)` |
| TS-51 (PLACEMENT-MODE-TEST-SPECS.md L1163) | `Fixed recurring is allowed. Per R11.4: recurring is orthogonal to placement mode.` |
| TS-45 (PLACEMENT-MODE-TEST-SPECS.md L1031) | `Fixed recurring (rigid) — placed at preferred time` |

The master overview says it's invalid (GAP O7), but the detailed placement specs eagerly test it as valid behavior. This is a **self-contradiction in the spec itself** — either the backend enforces rejection (making TS-45/TS-51 wrong) or the master tree is wrong.

**Severity: HIGH** — A developer implementing from the master tree would block fixed+recurring; one implementing from TS-45 would allow it.

---

## GAPS BY SEVERITY

---

## HIGH SEVERITY GAPS

---
**GAP-ID: G-001**
Severity: HIGH
Domain(s): TPC / Fill Policy / Cancel semantics
Missing Test: TPC backfill policy — cancel vs. skip counting discrepancy
Why It Matters: TS-86 SUB-86b says "cancel counts as fulfilled in backfill" but TS-103 says "TPC backfill: counts toward fulfilled (backfill sees cancel as occupied)". TS-93 says "Cancel also does NOT block spacing" (same as skip). So cancel counts as fulfilled for TPC counting (blocks refill) but does NOT count for spacing history. This means TWO different "fulfilled" concepts exist with no test for the case where a cancel opens a refill slot but the spacing guard doesn't update — creating an impossible combination where a new TPC pick is generated but has no spacing constraint and could land adjacent to another instance.
Suggested Fix: Add test: "backfill policy, 1 cancel + 1 done → 1 slot opens (cancel doesn't count as fulfilled for TPC?), spacing guard NOT updated (cancel doesn't update lastByMaster) → new pick has NO spacing guard → placed adjacent to done instance."

---
**GAP-ID: G-002**
Severity: HIGH
Domain(s): Clock / Time-Travel / All Scheduler Tests
Missing Test: No test anywhere specifies that the legacy scheduler (`unifiedScheduleV2.js`, `runSchedule.js`) is NOT wired to ClockPort, so FakeClockAdapter won't actually work
Why It Matters: The time-travel section (TS-273 to TS-288) and all weather/time-dependent tests assume `FakeClockAdapter` controls what `new Date()` returns. But the spec itself states "The legacy scheduler does NOT use ClockPort. It calls `new Date()` directly." This means **ALL ~200 tests that depend on clock control are currently untestable** with the proposed FakeClockAdapter — it only works with the hexagonal core which isn't the main execution path.
Suggested Fix: Add explicit test: "Legacy scheduler reads `new Date()` directly — FakeClockAdapter injection has no effect. Requires refactoring legacy code to use ClockPort." Add a blocker/roadmap item before TS-273.

---
**GAP-ID: G-003**
Severity: HIGH
Domain(s): Weather / Fail-open / TS-150 / TS-151
Missing Test: Weather fail-open at the **hour level** within an otherwise-valid day is untested
Why It Matters: TS-148 tests missing weatherByDateHour entirely (all fail-open). But the per-hour check: `weatherByDateHour[dateKey][hour]` being missing returns true (fail-open). A task could be placed in hour 14 (data missing → pass) while hour 8-12 data exists and fails. The task would be placed in an hour with NO weather data while other hours have valid data. This is a subtle partial fail-open that's worse than full fail-open because the user thinks weather filtering is active for some hours.
Suggested Fix: Add test: "hour-level weather data missing for some hours, present for others → task placed in a data-missing hour despite that hour likely being unsuitable."

---
**GAP-ID: G-004**
Severity: HIGH
Domain(s): State Machine / Status Transitions
Missing Test: Complete status transition matrix is not tested
Why It Matters: The tree lists statuses: "", wip, done, skip, cancel, pause, missed, archived, restored. But the test specs only cover: pending→done (TS-101), pending→skip (TS-102), pending→cancel (TS-103), system→missed (TS-104/107-110), pending→skip on delete (TS-105), template delete→archived (TS-106). Tests are entirely missing for: done→archived→restored→wip (re-activation?), missed→restored, archived→restored→done, wip→done with time_remaining, wip→skip, wip→cancel, and especially restored→any (restored tasks should re-enter scheduling but no test covers this).
Suggested Fix: Add full transition matrix tests: TS-289 "Archived task restored → status='restored', re-enters scheduler queue on next run", TS-290 "WIP task cancelled → status='cancel', scheduled_at snaps to now, rolling anchor NOT updated", TS-291 "Missed task restored → status='restored', eligible for re-placement".

---
**GAP-ID: G-005**
Severity: HIGH
Domain(s): Split × Status / TS-126af-al / Split status propagation contradiction
Missing Test: TS-126 says marking one chunk done → "all chunks in same occurrence_ordinal get same status" BUT the code behavior for non-recurring splits with inline chunks is that chunks are independent rows. When does the propagation happen? During the status-change API call? Only for non-recurring? Only if pre-materialized? TS-126al explicitly acknowledges uncertainty: "If non-recurring inline → they get created and immediately marked done. If recurring pre-materialized → they already exist, get done status."
Why It Matters: The spec literally says "spec says" — it's speculating about implementation behavior rather than defining it. If propagation only happens on recurring pre-materialized chunks, then non-recurring inline chunk completion does NOT propagate, contradicting TS-126af.
Suggested Fix: Clarify the propagation rule AND add explicit tests for: TS-292 "Non-recurring split, mark one inline chunk done → do other inline chunks in same split_group propagate? (need decision)."

---
**GAP-ID: G-006**
Severity: HIGH
Domain(s): Recurrence / Day-lock / Past instances
Missing Test: TS-37 (time_blocks recurring) identifies a contradiction: past-drop logic at line 265 only applies to ANYTIME mode. So time_blocks and time_window recurring instances from yesterday are NOT dropped. They enter the queue but with `anchorDate < todayIsoKey`. What happens?
Why It Matters: This means weekly time_blocks tasks from last week's Tuesday would try to place on last Tuesday (not today), the scheduler only processes dates from today forward, so these instances silently hang in pending state forever, never marked missed. Users would see "pending" instances that can never be placed.
Suggested Fix: Add test: TS-293 "Past recurring time_blocks instance (anchorDate < today) → not dropped by ANYTIME filter → enters queue → day-locked to past date → scheduler only scans [today, horizon] → never placed → pending forever." This should be a known bug.

---
**GAP-ID: G-007**
Severity: HIGH
Domain(s): Instance Lifecycle / On-demand materialization / TS-99
Missing Test: On-demand materialization creates `rc_master-1_2026-06-15` but what if the date has an existing terminal instance? Does it overwrite? Create a duplicate? Fail?
Why It Matters: A user marks "done" on a rolling task's next due date. If that date already has a `missed` or `cancel` instance from a previous scheduler run, the on-demand materialization could clash. User gets no feedback and the system silently fails or creates a duplicate.
Suggested Fix: Add test: TS-294 "On-demand materialization on date with existing 'missed' instance → overwrites status to 'done' and updates rolling anchor, or creates duplicate? (need decision: UX says overwrite, data integrity says no)."

---
**GAP-ID: G-008**
Severity: HIGH
Domain(s): Template × Task / Non-existent references / TS-243 / TS-244
Missing Test: Non-existent templateId in locScheduleOverrides is said to "fall through gracefully" but is this actually tested in the code? The test expects graceful fallthrough but there's no unit test of the actual `resolveLocationId` function with an undefined template lookup.
Why It Matters: If the code throws (TypeError: Cannot read properties of undefined) on a missing template lookup, the entire scheduler run crashes for that user. All tasks go unplaced. This is a critical resilience failure.
Suggested Fix: Add explicit code-level unit test: "resolveLocationId with non-existent templateId in locScheduleDefaults → does NOT throw, falls through to step 5 (block.loc)."

---
**GAP-ID: G-009**
Severity: HIGH
Domain(s): Calendar Sync / Multi-Provider / TS-204
Missing Test: MISS_THRESHOLD per-provider test doesn't cover the Apple CDN delay vs GCal immediate behavior
Why It Matters: TS-198c introduces Apple CDN grace (120s window) but TS-204 tests per-provider miss counting without confirming CDN grace is *only* applied to Apple. If CDN grace accidentally also applies to GCal, GCal deletions would be delayed by 120s.
Suggested Fix: Add test: TS-295 "GCal MISS_THRESHOLD: event missing from GCal but within 120s of push → miss_count incremented (no CDN grace for GCal)."

---

## MEDIUM SEVERITY GAPS

---
**GAP-ID: G-010**
Severity: MEDIUM
Domain(s): Split / Travel / TS-126ae / TS-126ac
Missing Test: Intra-chunk travel when chunks are at same location but template changes location mid-day
Why It Matters: TS-126ac tests travel between chunks on same day at different locations. But what if the location is the same (both "work") but an hourLocationOverride changes the middle chunk's effective location?
Suggested Fix: Add test: "Same nominal location for all chunks, but hourLocationOverride at chunk 2's time → chunk 2 now at 'conference_room' → travel needed between chunk 1 (work→conference_room) and chunk 2→3 (conference_room→work)."

---
**GAP-ID: G-011**
Severity: MEDIUM
Domain(s): Deadline × Dependency / TS-135k-o
Missing Test: Chain deadline backpropagation — what happens when BOTH predecessor and successor have deadlines, but predecessor's deadline is LATER than successor's? Successor's faux deadline is earlier, so predecessor's real deadline doesn't help.
Why It Matters: Classic scheduling anti-pattern: Task A due Friday, depends on Task B due Wednesday. Backpropagation gives A a faux deadline of Wednesday, which is tighter than A's real deadline. But Task B also needs to share the capacity. No test covers this competing-deadline scenario.
Suggested Fix: Add test: "Chain A→B, A.deadline=Friday, B.deadline=Wednesday → A's faux deadline = min(B.deadline, A.deadline) = Wednesday → both scheduled before Wednesday. If capacity insufficient → A unplaced, B placed."

---
**GAP-ID: G-012**
Severity: MEDIUM
Domain(s): Weather × Dependency / TS-154m
Missing Test: Deadline backpropagation + weather + dependency — the triple interaction is acknowledged but not tested
Why It Matters: TS-154m says "If backprop not yet implemented (v2 known gap)" — this is a major caveat buried in a sub-scenario. Every test in the deadline-dependency-weather interaction space is conditioned on backprop being implemented, but backprop may not be. The spec should mark which tests are preconditioned on backprop.
Suggested Fix: Add TS-296: "Deadline backpropagation NOT yet implemented → deadline-relaxed pass (TS-170) is the only fallback for chain members with unmet deadlines."

---
**GAP-ID: G-013**
Severity: MEDIUM
Domain(s): TPC / Spacing Guard / TS-87 / Safety Valve / TS-88
Missing Test: Safety valve activation across cycle boundaries
Why It Matters: TS-88 tests safety valve within a single cycle (all candidates blocked). But what about the edge where the last eligible candidate in cycle N is blocked by minGap from cycle N-1's last placement, and cycle N+1 hasn't started? Does the safety valve activate across cycles or only within the current cycle?
Suggested Fix: Add test: "TPC spacing guard safety valve: last placement at end of cycle N → cycle N+1 first candidate is within minGap → if only 1 candidate day in cycle N+1, safety valve activates → placed (not unplaced)."

---
**GAP-ID: G-014**
Severity: MEDIUM
Domain(s): Rolling Recurrence / Stale Guard / TS-100
Missing Test: Stale guard with rollingAnchor set to a future date AND an instance completed on a past date — the stale guard returns null (correctly), but what if the instance was completed via on-demand materialization on a past date? The user marked "done" on what they thought was today's instance but the clock was wrong.
Why It Matters: On-demand materialization bypasses the stale guard check because it happens outside the scheduler run (in the status-change handler). The stale guard only protects during scheduler expansion. An out-of-order completion via on-demand materialization could set the anchor to a past date despite the guard.
Suggested Fix: Add test: "On-demand materialization: user marks 'done' on rc_instance dated 2026-06-10 when rollingAnchor=2026-06-15 → stale guard should fire but on-demand handler may not check it → anchor regresses to 2026-06-10."

---
**GAP-ID: G-015**
Severity: MEDIUM
Domain(s): Split × Recurring × Overflow / TS-124 / TS-126br
Missing Test: Overflow detection across template changes — what happens when an occurrence was previously overflowing, then a template change adds capacity, then scheduler re-runs?
Why It Matters: TS-126bm tests window shift (re-evaluation) but doesn't specifically test the transition from "recurring_split_overflow" to "fully placed" on a template change. The overflow flag might be a "sticky" flag that never gets cleared.
Suggested Fix: Add test: "Previously overflowing recurring split (recurring_split_overflow) → template adds blocks → scheduler re-run → overflow flag cleared, chunks fully placed."

---
**GAP-ID: G-016**
Severity: MEDIUM
Domain(s): Recurring Split / Drift Fix / TS-125
Missing Test: Drift fix at scheduler start can CORRECT chunk data, but what happens if a chunk's status is 'done' or 'wip' and drift fix tries to change its dur?
Why It Matters: If a chunk is in 'wip' status (time_remaining counting down) and drift fix changes its dur field from 60 to 45, the time_remaining progress becomes inconsistent. The user may have 20 min remaining on a chunk now marked as 45 total.
Suggested Fix: Add test: "Drift fix skips chunks with status='wip' or 'done' — only adjusts pending/empty status chunks."

---
**GAP-ID: G-017**
Severity: MEDIUM
Domain(s): Template / Config Change / TS-241 / TS-242
Missing Test: Config change that removes ALL blocks for all days but user's tasks are all 'anytime' with no when-tag
Why It Matters: TS-249 tests empty blocksMap but that's a startup state. What if the user had blocks, tasks got placed, then user deletes all blocks? Anytime tasks survive (synthetic window), but placed times may now be in weird positions.
Suggested Fix: Add test: "User deletes all time_blocks config after tasks placed → scheduler re-run → anytime tasks re-placed in synthetic [GRID_START, GRID_END] window, when-tag tasks become unplaced."

---
**GAP-ID: G-018**
Severity: MEDIUM
Domain(s): Reminder / TS-58
Missing Test: Reminder with dur=0 placed at earliest slot on a fully occupied day — but what if the earliest slot (GRID_START=360) is NOT free because a fixed task occupies it?
Why It Matters: TS-61 says "even with full occupancy, reminder can be placed (dur=0 → needs only 1 free minute)." But `isFreeWithTravel(occ, s, 0, 0, 0)` iterates from s to s (empty) — it checks no minutes! Actually the code checks `occ[start]` for zero duration. If minute 360 is occupied by a fixed task at 360, the reminder at 360 would conflict. So the "always placeable" claim is wrong.
Suggested Fix: TS-61 expected outcome corrected: "If exact minute 360 is occupied by a fixed task, reminder placed at next free minute (e.g. 361)." Add SUB-61d.

---
**GAP-ID: G-019**
Severity: MEDIUM
Domain(s): Dependency Chain / Circular dep detection
Missing Test: Circular dependency detection — what about indirect self-reference (A.dep→B, B.dep→C, C.dep→A)?
Why It Matters: TS-158 tests "Circular dependency — rejected on create/update" but doesn't test indirect cycles. The code may only check direct self-reference (A depends on A) and miss multi-link cycles.
Suggested Fix: Add test: TS-297 "Indirect circular dependency: A→B→C→A → rejected on create/update (cycle detection must traverse the full chain)."

---
**GAP-ID: G-020**
Severity: MEDIUM
Domain(s): Rollover / Scheduling Queue / Debounce / TS-194a
Missing Test: Rate limit exceeded — what happens to the 11th trigger? Is it silently dropped, queued for next window, or returns an error to the caller?
Why It Matters: TS-194a says "11th run is skipped" and "Next run allowed after rate window resets" but doesn't specify whether the trigger is lost entirely or deferred. If a user makes 11 rapid changes, the 11th change is silently lost — that task never gets scheduled.
Suggested Fix: Add test: "Rate limit exceeded: 11th enqueueScheduleRun call returns error to caller (or queues for next rate window), not silently dropped."

---

## LOW SEVERITY GAPS

---
**GAP-ID: G-021**
Severity: LOW
Domain(s): Time Blocks / TS-245
Missing Test: Overlapping blocks deduplication — what determines which overlapping block "wins" the shared capacity?
Why It Matters: TS-245 says "deduplicated windows" but overlapping blocks from different tags (morning=360-600, focus=480-720) mean minute 480-600 belongs to both tags. If a morning task and a focus task both exist, which one gets priority for the shared region? The spec doesn't define allocation.
Suggested Fix: Add test: "Overlapping blocks from different tags: minute 480-600 shared between 'morning' and 'focus' → each tag's window is full width (not deduplicated), but scheduler occupancy prevents double-booking → whichever task is placed first claims the slot."

---
**GAP-ID: G-022**
Severity: LOW
Domain(s): Travel / TS-18 / TS-19 / TS-126ab
Missing Test: travel_before + travel_after with deadline — the effective window shrinks by (travelBefore + travelAfter + dur) but no test checks that deadline is compared against the TOTAL occupancy, not just the dur.
Why It Matters: A task with dur=60, travelBefore=30, travelAfter=30, deadline=today must actually finish by end_of_day - 30 (travelAfter). If end_of_day=1380, deadline comparison should use `start + dur + travelAfter ≤ deadline_minutes_of_day`, not `start + dur ≤ deadline_minutes_of_day`.
Suggested Fix: Add test: "Task with travelAfter=30, deadline=today → latest possible start = deadline_minutes - dur - travelAfter, not deadline_minutes - dur."

---
**GAP-ID: G-023**
Severity: LOW
Domain(s): Weather / TS-146 / Temperature unit conversion
Missing Test: weather_temp_unit='C' vs user preference 'F' — conversion is mentioned in TS-212 but no weather-specific test verifies it.
Why It Matters: A task with weather_temp_min=0, weather_temp_unit='C' (freezing) whose user has temperatureUnit='F' requires conversion: 0°C = 32°F. If conversion is wrong, task is placed in 40°F weather thinking it's above 0°C (it's 4°C, fine) or rejected incorrectly.
Suggested Fix: Add test: "weather_temp_min=0, weather_temp_unit='C', user preference temperatureUnit='F' → converted to 32°F internally → checked against actual Fahrenheit temp."

---
**GAP-ID: G-024**
Severity: LOW
Domain(s): Calendar Sync / Split Sync / TS-203
Missing Test: Split chunks merged into single calendar event — what happens when one chunk's time changes but not the other's?
Why It Matters: After merging three contiguous 30-min chunks into one 90-min event, if chunk 2's scheduled_at changes (weather re-placement moves it from 08:30 to 09:30), the chunks are no longer contiguous. The merged event must be split back apart.
Suggested Fix: Add test: "Previously contiguous merged split chunks → chunk 2 re-placed to non-contiguous slot → unmerge: delete old merged event, create two separate events."

---
**GAP-ID: G-025**
Severity: LOW
Domain(s): Reschedule Triggers / TS-176 / TS-177
Missing Test: What fields are "scheduling-relevant"? The spec doesn't define the exact field list.
Why It Matters: TS-177 says "scheduling-relevant field (dur, when, deadline, priority, etc.)" but the "etc." is ambiguous. Is `text` scheduling-relevant? (Probably not). Is `project`? (No). Is `split`? (Yes). Is `split_min`? (Yes). A developer needs an exact list.
Suggested Fix: Add sub-test listing ALL scheduling-relevant fields explicitly: dur, pri, placementMode, when, deadline, startAfter, dayReq, split, split_min, travelBefore, travelAfter, location, tools, weather_*, and recur.*.

---
**GAP-ID: G-026**
Severity: LOW
Domain(s): Split × Mode / TS-126g
Missing Test: time_window + flex=0 + split: TS-126g says chunks extend beyond the "preferred time" but there's no flex window. What actually constrains placement? The chunks just start at preferred time and keep filling sequentially until done.
Why It Matters: If preferredTimeMins=540 (9am) with flex=0 and dur=120, split into 4x30 chunks, the chunks would occupy 09:00-11:00. But there IS an implicit flex: the window degenerates when flex=0 (per TS-24 code analysis), so `isWindowMode=false` and the task falls back to when-tag placement. The spec's expected outcome (sequential chunks starting at 9am) contradicts the actual code behavior (when-tag fallback).
Suggested Fix: Correct TS-126g expected outcome: "timeFlex=0 → degenerate window → isWindowMode = false → falls back to when-tag placement → chunk positions determined by block availability, not preferred time."

---
**GAP-ID: G-027**
Severity: LOW
Domain(s): Phase 2 / Retry / TS-165
Missing Test: Retry pass only runs once. What about deep chains (A→B→C→D→E) where only the first retry places some items but deeper dependencies still unmet?
Why It Matters: TS-165 itself notes "Only one retry pass (not iterative); pathological multi-level chains may still fail." A 5-level chain with worst-case slack ordering could leave leaf tasks unplaced through no fault of their own. This is a known scheduler limitation with no test coverage.
Suggested Fix: Add test: "Deep dependency chain (5+ levels) with reversed slack ordering → single retry pass insufficient → leaf tasks remain unplaced despite all deps eventually being satisfiable."

---
**GAP-ID: G-028**
Severity: LOW
Domain(s): Recurrence / Horizon / TS-83 / TS-84
Missing Test: RECUR_EXPAND_DAYS is stated as 14 but is it configurable? What if it changes?
Why It Matters: TS-83 SUB-83e says "CONFIG change to RECUR_EXPAND_DAYS (if configurable) → horizon adjusts" but no test covers the config change itself. If horizon changes from 14 to 30, instances beyond 14 but within 30 need to be generated. If horizon shrinks from 30 to 14, the grandfather clause (TS-84) should protect instances.
Suggested Fix: Add test: TS-298 "RECUR_EXPAND_DAYS increased from 14 to 30 → instances generated for days 15-30 on next scheduler run."

---
**GAP-ID: G-029**
Severity: LOW
Domain(s): Elasticity / TPC / TS-91
Missing Test: targetInterval = cycleDays / tpc — what if tpc=0? Division by zero.
Why It Matters: If timesPerCycle is accidentally set to 0 (invalid/malformed data), targetInterval computation divides by zero. This crashes the scheduler.
Suggested Fix: Add test: "timesPerCycle = 0 → targetInterval = Infinity or handled gracefully → no-op or fallback to tpc=1."

---

## GAPS BETWEEN DOMAINS (Missing Cross-Feature Interactions)

---
**GAP-ID: G-030**
Severity: HIGH
Domain(s): Cross-Domain: Rolling + TPC + fixed + split
Missing Test: Rolling recurrence + TPC + split + day-locked — a rolling split task with TPC=2 where each cycle generates 2 occurrences, each with multiple split chunks
Why It Matters: This is a real-world pattern: "Every 2 weeks I do 3 hours of yard work, split into morning/afternoon chunks, and it happens twice in the 2-week cycle." No single domain tests this combination — recurrence tests don't cover split+TPC; TPC tests don't cover rolling; split tests don't cover TPC across rolling cycles.
Suggested Fix: Add test: TS-299 "Rolling recurrence (intervalDays=14) + TPC=2 (fill 2 spots per 14-day cycle) + split (dur=180, split_min=60, 3 chunks) + isFlexibleTpc=true → chunks roam across selected days within each 14-day cycle."

---
**GAP-ID: G-031**
Severity: MEDIUM
Domain(s): Cross-Domain: Calendar Sync + Split + Status + Weather
Missing Test: Calendar-synced split task: weather changes causes one chunk to move → the merged calendar event breaks → orphan calendar events
Why It Matters: TS-203 tests split→calendar merging. TS-126y tests weather→split re-placement. But no test covers: weather causes chunk to move → merged 90-min calendar event now needs to be split into 60-min + 30-min events. The sync code may not handle partial re-merge properly.
Suggested Fix: Add test: "Calendar-synced split task (3 contiguous chunks merged to 1 event) → weather changes, chunk 2 moves → unmerge: 2 events created, old event deleted."

---
**GAP-ID: G-032**
Severity: MEDIUM
Domain(s): Cross-Domain: Template + Dependency + Weather + Rolling
Missing Test: A rolling task depends on another task whose template changes mid-week, AND weather changes simultaneously
Why It Matters: Real world: "Do laundry (recurring rolling every 7 days) depends on 'buy detergent' (one-off, template changed blocks, now constrained to afternoon). Weather says afternoon thunderstorms → predecessor placed in morning (weather passes) → dependent's window shifts." This 4-way interaction exercises Phase ordering, retry passes, weather checks, and anchor updates simultaneously.
Suggested Fix: Add test: TS-300 "Rolling task B depends on one-off task A → template change shifts A's available blocks → weather check rejects A's original slot → A re-placed to new slot → B's depReadyAbs changes → B re-placed."

---
**GAP-ID: G-033**
Severity: LOW
Domain(s): Cross-Domain: Time-Travel + Config Change + Missed Detection
Missing Test: Clock advances past a deadline AND simultaneously the user changes a template — both trigger scheduler runs; which runs first?
Why It Matters: If the template change run happens first, tasks may be placed in new blocks before the deadline-expiry missed detection marks them missed. If the missed-detection run happens first, tasks get marked missed even though the template change would have placed them in new blocks. The ordering of coalesced trigger sources matters.
Suggested Fix: Add test: "Deadline expiry trigger + template change trigger within debounce window → coalesced into single run → tasks evaluated with new blocks AND deadline expiry simultaneously → correct outcome: task placed in new blocks before deadline."

---

## MISSING DATA SETUPS

---
**GAP-ID: G-034**
Severity: HIGH
Domain(s): ALL scheduler tests
Missing Test: NO test specifies the user's timezone, yet scheduler behavior depends on `nowMins`, day boundaries, and deadline comparisons which are timezone-dependent.
Why It Matters: A user in `America/Los_Angeles` (UTC-7 in summer) has `nowMins` computed differently than a user in `America/New_York` (UTC-4). If a test uses `08:00:00-04:00` (EDT) but the scheduler reads user's timezone from config, the test might pass locally but fail in CI where timezone differs. TS-212 covers timezone preferences but no placement test actually specifies the user's timezone.
Suggested Fix: Every test Data Setup that specifies a clock time should also specify: `User timezone: America/New_York` (or whatever the test requires).

---
**GAP-ID: G-035**
Severity: MEDIUM
Domain(s): Weather tests (TS-142 to TS-154x)
Missing Test: NO weather test specifies the user's location (lat/lon), yet weather data is location-dependent.
Why It Matters: The FakeWeatherProvider returns weather data directly, but the scheduler must first resolve the user's location to determine which weather data to use. If location resolution fails (Chain B returns "home" but "home" has no lat/lon), weather data can't be fetched. The tests assume weather data magically appears.
Suggested Fix: Add to every Weather test Data Setup: `User locations: { home: { lat: 40.7128, lon: -74.0060 } }` and verify Chain B resolution.

---
**GAP-ID: G-036**
Severity: LOW
Domain(s): Recurrence tests (TS-72 to TS-84)
Missing Test: Template state is never specified in recurrence test data setups
Why It Matters: Recurring instances are day-locked and template-dependent. If the test doesn't specify template_overrides or time_blocks, the scheduler uses defaults which may differ between test environments (e.g., CI has different defaults than dev).
Suggested Fix: Add explicit `User config: default time_blocks (weekday: morning 360-480, biz1 480-720, ...)` to every recurrence test's Data Setup.

---

## Summary Statistics

Let me calculate the true total coverage from the table at the end of TASK-SETTINGS-TREE.md:

```
Placement Modes:      61  tests
Mode Transitions:     10
Recurrence Types:     13
TPC:                   9
Rolling Recurrence:    7
Instance Lifecycle:   11
Non-Recurring Splits:  9
Recurring Splits:      7
Split × Mode:          9
Split × Template:      7
Split × Location:      5
Split × Weather:       4
Split × Travel:        6
Split × Status:        7
Split × R×T:           6
Deadlines:             9
Deadline × Template:   6
Deadline × Split:      4
Deadline × Dep:        5
Deadline × Weather:    4
Deadline × Time:       5
Earliest-Start:        6
ES × Template:         6
ES × Split:            3
ES × Deadline:         5
ES × Time-Travel:      3
Weather:              13
W × Template:          5
W × Split:             4
W × Dep:               4
W × Recurrence:        5
W × Time-Travel:       6
Dependencies:          8
Dep × Template:       25
Scheduler Phases:     12
Reschedule Triggers:  19
Calendar Sync:        12
User Config:           8
Template × Task:      36
Edge Cases:           22
Time-Travel:          16
TOTAL:                440
```

But this is misleading — many of these are just one-liner references in the master tree, not full structured specs. The PRDs with full structured Data Setup/Action/Expected Outcome are:
- Placement Modes: ~71 (full spec)
- Recurrence/TPC/Split: ~99 (full spec)
- Weather/Deps/Deadlines: ~125 (full spec)
- Phases/Triggers/Sync: ~89 (full spec)
- User Config/Templates: ~44 (full spec)
- Edge Cases/Time-Travel: ~38 (listed but not structured)
**Total full structured specs: ~428**

---

## Final Verdict

Total gaps found: 36
HIGH severity: 10
MEDIUM severity: 10
LOW severity: 9
Cross-domain gaps: 4
Missing data setups: 3

**Most critical issues:**

1. **G-002 (HIGH):** The FakeClockAdapter is incompatible with the legacy scheduler — time-travel tests (TS-273 to TS-288) are fundamentally untestable without refactoring `new Date()` calls in `unifiedScheduleV2.js`. This affects ~200 tests, not just the time-travel section, because ALL scheduler tests depend on clock control for deterministic placement.

2. **G-001 (HIGH):** TPC fill policy has contradictory semantics between "cancel counts as fulfilled for TPC counting" and "cancel does NOT block spacing" — this asymmetry can produce instances with no spacing guard that violate the minGap constraint. 

3. **CONTRA-1 (HIGH):** The master overview declares fixed+recurring invalid but detailed specs eagerly test it as valid. This is a spec-level contradiction that guarantees implementation inconsistency.

4. **G-005 (HIGH):** The split status propagation rule is speculative ("spec says") — developers have no clear guidance on whether non-recurring inline split chunks propagate status to siblings.

5. **G-006 (HIGH):** Past recurring time_blocks instances are NOT dropped (only ANYTIME instances are) leading to permanently unplaceable pending instances — a likely bug the spec accidentally documents without flagging.

6. **G-030 (HIGH):** The cross-domain combinations (Rolling+TPC+Split, Calendar+Split+Weather, Template+Dep+Weather+Rolling) are entirely untested despite being the most common real-world usage patterns.

The test coverage is **comprehensive in breadth** (440 scenarios across 20 domains) but **shallow in depth** — most interaction domains have only 3-6 tests each, many are just documenting known bugs without resolution, and the fundamental infrastructure dependency (ClockPort injection into legacy code) is an unfilled prerequisite for the entire testing strategy.