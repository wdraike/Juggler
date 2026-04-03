# Scheduler Test Cases — Comprehensive Coverage

This document catalogs every use case the scheduler must handle correctly.
Each case maps to one or more automated tests.

**Legend:** UC = Use Case, `[UNIT]` = pure scheduler function test, `[INT]` = integration test (DB + scheduler), `[TIME]` = time-simulation test

---

## 1. Rigid Habit Placement

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-1.1 | Rigid habit with `when:"lunch"` — lunch block is free | Placed at lunch block start (720) | [UNIT] |
| UC-1.2 | Rigid habit with `when:"lunch"` — previously misplaced at 7am (feedback loop) | Corrected to lunch block start, not 7am | [UNIT] |
| UC-1.3 | Rigid habit with `when:"morning"` — morning is in the past | Placed at morning start (past-time overlay, locked) | [TIME] |
| UC-1.4 | Rigid habit with `when:"evening"` — evening is in the future | Placed at evening block start | [UNIT] |
| UC-1.5 | Rigid habit with `when:"lunch"` — lunch block occupied by fixed calendar event | Fallback scan within lunch window, then nearby windows | [UNIT] |
| UC-1.6 | Rigid habit with multi-tag `when:"morning,lunch"` — morning free | Placed at morning start (first matching window) | [UNIT] |
| UC-1.7 | Rigid habit with no `when` tag — defaults to "morning,lunch,afternoon,evening" | Placed at first available window | [UNIT] |
| UC-1.8 | Rigid habit `when:"lunch"` across multiple days — verify each day gets correct placement | Lunch block on each day | [UNIT] |
| UC-1.9 | Rigid habit with `timeFlex: 30` — placed ±30m from window start | Within flex range of lunch start | [UNIT] |
| UC-1.10 | Two rigid habits both `when:"lunch"` — only 30m block | First gets the slot, second scans nearby | [UNIT] |

## 2. Non-Rigid Habit Placement

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-2.1 | Non-rigid habit with `when:"morning,afternoon"` — both windows available | Placed in first matching window (morning) | [UNIT] |
| UC-2.2 | Non-rigid habit with flexWhen — all `when` windows full | Placed in any available slot (relaxed) | [UNIT] |
| UC-2.3 | Non-rigid habit with flexWhen:false — all `when` windows full | Stays unplaced | [UNIT] |
| UC-2.4 | Non-rigid P1 habit vs P1 deadline task competing for same slot | Deadline task gets priority (merged phase) | [UNIT] |
| UC-2.5 | Non-rigid habit on today — past time blocked, future available | Placed in future slot within when-window | [TIME] |
| UC-2.6 | Non-rigid habit with `dayReq:"weekday"` on a Saturday | Not placed on Saturday, placed on next weekday | [UNIT] |
| UC-2.7 | Daily habit generating instances for 7 days | 7 instances created, each on correct day | [UNIT] |
| UC-2.8 | Habit with `habitStart` in the future — scheduler runs today | No instance generated for today | [UNIT] |
| UC-2.9 | Habit with `habitEnd` in the past — scheduler runs today | No new instances generated | [UNIT] |

## 3. Deadline Task Placement

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-3.1 | P1 task due today — sufficient capacity | Placed on today | [UNIT] |
| UC-3.2 | P1 task due today — today full, tomorrow available | Placed on today (displaces lower-pri if needed) or deadline miss | [UNIT] |
| UC-3.3 | P1 task due in 5 days — plenty of capacity | Late-placed near due date (not pulled to today) | [UNIT] |
| UC-3.4 | P1 task due today vs P1 habit — capacity for only one | Deadline task wins (merged phase: deadlines before habits within same priority) | [UNIT] |
| UC-3.5 | P2 task due today vs P1 habit — capacity for both | Both placed (P1 habit first, P2 deadline second) | [UNIT] |
| UC-3.6 | Past deadline (due yesterday) — today available | Placed on today (Phase 1.5 fallback) | [UNIT] |
| UC-3.7 | Past deadline (due last week) — still unplaced | Placed on today with deadline miss penalty | [UNIT] |
| UC-3.8 | Deadline task with `startAfter` > `due` (impossible) | Warning issued, placed as best effort | [UNIT] |
| UC-3.9 | Deadline task with `dayReq:"weekday"` due on Sunday | Placed on Friday (last available weekday before due) | [UNIT] |

## 4. Priority Ordering

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-4.1 | P1, P2, P3 tasks — no deadlines — sufficient capacity | All placed, P1 earliest, P3 latest | [UNIT] |
| UC-4.2 | P3 task with deadline today vs P1 task no deadline | P3 deadline placed first (deadline governs) | [UNIT] |
| UC-4.3 | Today nearly full — P3/P4 tasks without deadlines | Deferred to tomorrow (today reserved for P1/P2) | [UNIT] |
| UC-4.4 | todayReserved threshold boundary — exactly 60% capacity demand | P3/P4 just barely deferred | [UNIT] |
| UC-4.5 | All same priority — placement order stable | Deterministic (by constraint narrowness) | [UNIT] |

## 5. Dependency Chains

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-5.1 | A depends on B — both on same day | B placed before A (earlier start time) | [UNIT] |
| UC-5.2 | A depends on B — B on day 1, A on day 2 | B on day 1, A on day 2 (deps met) | [UNIT] |
| UC-5.3 | Chain A→B→C — C has deadline | All placed in order, C near deadline | [UNIT] |
| UC-5.4 | Diamond: A→B, A→C, B→D, C→D | All placed respecting both paths | [UNIT] |
| UC-5.5 | Circular dependency: A→B→A | Detected, warning issued, one edge broken | [UNIT] |
| UC-5.6 | Backward dependency: A (pinned 3/20) depends on B (pinned 3/25) | Warning issued, constraint skipped | [UNIT] |
| UC-5.7 | Dependency on completed task | Dep treated as met (completed tasks are done) | [UNIT] |
| UC-5.8 | Deadline propagation: C due 3/20, B depends on C, A depends on B | A's effective ceiling ≈ 3/17-3/18 | [UNIT] |

## 6. Split Tasks

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-6.1 | 120m split task, two 60m gaps available | Split into two 60m chunks | [UNIT] |
| UC-6.2 | 90m split task, `splitMin:30` — three 30m gaps | Split into three 30m chunks | [UNIT] |
| UC-6.3 | 90m split task, `splitMin:60` — only one 60m gap | Only 60m placed, 30m unplaced (can't create runt) | [UNIT] |
| UC-6.4 | Split task with dependency — dep must finish before first chunk | First chunk after dep completion | [UNIT] |
| UC-6.5 | Split task across two days | Chunks on day 1 and day 2 | [UNIT] |
| UC-6.6 | Split task with location constraints — gap crosses location boundary | Chunks respect location at each minute | [UNIT] |

## 7. Location & Tool Constraints

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-7.1 | Task requires `personal_pc` — home location has it, work doesn't | Only placed during home blocks | [UNIT] |
| UC-7.2 | Task requires `printer` — only available at work and home | Placed in blocks where location is work or home | [UNIT] |
| UC-7.3 | Task with `location:["work"]` — day is all at home | Cannot be placed (location mismatch) | [UNIT] |
| UC-7.4 | Location schedule override (e.g., travel day) — all transit | Tasks requiring home tools cannot be placed | [UNIT] |
| UC-7.5 | Hour-level location override at noon — changes from home to work | Tasks at noon use work tools, not home | [UNIT] |
| UC-7.6 | Location resolution priority: hour override > template > time block > default | Correct cascade | [UNIT] |

## 8. Time-of-Day Simulation

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-8.1 | Scheduler runs at 6am — full day available | All tasks placed in morning/afternoon/evening | [TIME] |
| UC-8.2 | Scheduler runs at noon — morning past | Morning tasks stay (past overlay), afternoon+ available | [TIME] |
| UC-8.3 | Scheduler runs at 10pm — most of day past | Only night block available for new tasks | [TIME] |
| UC-8.4 | Scheduler runs at 11:59pm — day nearly over | Almost nothing available, most deferred to tomorrow | [TIME] |
| UC-8.5 | Scheduler runs at 6am, then again at noon — same day | Results consistent; tasks don't jump around | [TIME] |
| UC-8.6 | Scheduler runs at noon — rigid morning habit | Morning habit placed in past overlay (locked, not moved to afternoon) | [TIME] |
| UC-8.7 | Scheduler runs at 1pm — `when:"lunch"` habit, lunch is 12-1pm | Lunch habit placed at noon (past overlay, locked) | [TIME] |
| UC-8.8 | Scheduler runs Monday 8am, then Wednesday 8am — multi-day | Monday tasks stable, new tasks fill Wednesday | [TIME] |
| UC-8.9 | Full week simulation: run at 8am each day for 7 days | All habits placed correctly each day, no drift | [TIME] |
| UC-8.10 | Full month simulation: verify no feedback loops compound over 30 runs | Habits stay in their windows, no gradual drift | [TIME] |

## 9. Fixed Tasks & Calendar Events

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-9.1 | Fixed task at 2pm for 60m | Occupies 2-3pm exactly, other tasks work around it | [UNIT] |
| UC-9.2 | Two fixed tasks overlap (1-2pm and 1:30-2:30pm) | Both placed, overlap warning issued | [UNIT] |
| UC-9.3 | Fixed task with `travelBefore:30` | 30m before task is blocked from other placements | [UNIT] |
| UC-9.4 | Calendar event synced from Google — becomes fixed | Treated as immovable anchor | [UNIT] |
| UC-9.5 | Marker (non-blocking) at 10am | Other tasks can be placed at 10am | [UNIT] |
| UC-9.6 | Fixed task at midnight (00:00) | Not treated as "past" on current day | [UNIT] |

## 10. Recurring Task Expansion

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-10.1 | Daily habit — generate for 7 days | 7 instances with correct IDs (`rc_templateId_MMDDYYYY`) | [UNIT] |
| UC-10.2 | Weekly habit (M,W,F) — generate for 14 days | 6 instances (3 per week × 2 weeks) | [UNIT] |
| UC-10.3 | Biweekly habit — boundary check | Only every other week | [UNIT] |
| UC-10.4 | Monthly habit (1st and 15th) — February | 1st and 15th (not 28th/29th) | [UNIT] |
| UC-10.5 | Monthly habit (last day) — February vs March | Feb 28 (or 29), Mar 31 | [UNIT] |
| UC-10.6 | Dupe prevention — instance already exists in DB | Not re-created | [INT] |
| UC-10.7 | Habit paused — no new instances generated | Expansion skips paused templates | [UNIT] |
| UC-10.8 | Habit disabled — no new instances generated | Expansion skips disabled templates | [UNIT] |
| UC-10.9 | Instance marked done — not re-scheduled | Done status preserved across runs | [INT] |
| UC-10.10 | DST spring forward — habit near 2am boundary | Instance generated with correct date | [UNIT] |

## 11. Pull-Forward & Dampening

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-11.1 | Deadline task on day 10, days 1-9 mostly empty | With dampening: lands mid-range, not day 1 | [UNIT] |
| UC-11.2 | Dampening disabled | Task pulled all the way to earliest available day | [UNIT] |
| UC-11.3 | Deadline task with dependency — dep on day 5 | Task pulled forward but not before day 5 | [UNIT] |
| UC-11.4 | `startAfter` constraint — can't pull before that date | Respected even with pull-forward | [UNIT] |

## 12. Hill Climbing Optimization

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-12.1 | Hill climb disabled (0 iterations) | Score equals greedy-only score | [UNIT] |
| UC-12.2 | Hill climb enabled — score should not worsen | Score ≤ greedy score | [UNIT] |
| UC-12.3 | Swap doesn't violate dependencies | After swap, deps still met | [UNIT] |
| UC-12.4 | Cross-day swap respects priority ordering | Higher-pri never moved to later day | [UNIT] |
| UC-12.5 | Date-shift respects `startAfter` | Task not moved before startAfter | [UNIT] |

## 13. Scoring Correctness

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-13.1 | All tasks placed, no conflicts | Score = 0 (or near 0) | [UNIT] |
| UC-13.2 | One unplaced P1 task | Score penalty = 1000 × 4 (P1 multiplier) | [UNIT] |
| UC-13.3 | Deadline miss by 1 day, P2 | Score penalty = 500 × 3 × 1 | [UNIT] |
| UC-13.4 | Lower-pri task before higher-pri same day | Priority drift penalty | [UNIT] |
| UC-13.5 | Habit placed 2 hours from preferred time | Habit time drift penalty | [UNIT] |

## 14. Overflow & Relaxation

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-14.1 | Task can't fit on assigned day — overflow ±1 day | Placed on adjacent day | [UNIT] |
| UC-14.2 | Task can't fit ±2 days — stays unplaced | Unplaced with warning | [UNIT] |
| UC-14.3 | flexWhen task — `when` windows full | Placed in "anytime" window, marked `_whenRelaxed` | [UNIT] |
| UC-14.4 | Habit rescue — bump non-habit to make room | Habit placed, non-habit re-placed on another day | [UNIT] |
| UC-14.5 | Habit rescue fails — bumped task can't re-place | Entire bump reverted, habit stays unplaced | [UNIT] |

## 15. Persistence & Feedback Loop Prevention

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-15.1 | Scheduler runs twice — results identical (idempotent) | Same placements both runs | [INT] |
| UC-15.2 | `original_scheduled_at` reset before each run | Non-fixed tasks reset to original time | [INT] |
| UC-15.3 | Fixed task NOT reset | `when:"fixed"` tasks keep their scheduled_at | [INT] |
| UC-15.4 | Habit misplaced in run 1 — corrected in run 2 | `when`-window override fixes the placement | [INT] |
| UC-15.5 | Task edited by user between runs — new time honored | User edit persists, scheduler respects it | [INT] |
| UC-15.6 | Schedule cache invalidated on timezone change | Re-runs scheduler with new timezone | [INT] |
| UC-15.7 | Schedule cache invalidated on task update | Stale cache not served | [INT] |

## 16. Edge Cases & Boundary Conditions

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-16.1 | Zero tasks | Empty result, no errors | [UNIT] |
| UC-16.2 | One task, 30m, full day available | Placed at first available slot | [UNIT] |
| UC-16.3 | 100 tasks, day nearly full | As many placed as possible, rest unplaced | [UNIT] |
| UC-16.4 | Task with `dur:0` | Skipped (zero duration) | [UNIT] |
| UC-16.5 | Task with `dur:720` (12 hours) | Clamped to max, placed across available time | [UNIT] |
| UC-16.6 | Task with `dur:1440` (24 hours) | Clamped to 720, placed as much as possible | [UNIT] |
| UC-16.7 | Task at 10:30pm, 120m duration — extends past midnight | Clamped to grid end (11pm) | [UNIT] |
| UC-16.8 | All statuses excluded: done, cancel, skip, pause, disabled | None scheduled | [UNIT] |
| UC-16.9 | WIP status task with timeRemaining | Uses timeRemaining, not full dur | [UNIT] |
| UC-16.10 | Date crossing month boundary (3/31 → 4/1) | Correct date handling | [UNIT] |
| UC-16.11 | Orphaned when-tag (no matching time block) | Reassigned to anytime, warning issued | [UNIT] |
| UC-16.12 | Priority normalization: "2" → "P2", null → "P3" | Correct normalization | [UNIT] |
| UC-16.13 | No overlaps invariant — run 50 random scenarios | Zero overlaps in all cases | [UNIT] |

## 17. Timezone & DST

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-17.1 | UTC round-trip: local→UTC→local | Same date/time | [UNIT] |
| UC-17.2 | DST spring forward: 2am→3am (Mar 8 2026 US) | Correct handling, no lost hour | [UNIT] |
| UC-17.3 | DST fall back: 2am→1am (Nov 1 2026 US) | Correct handling, no duplicate hour | [UNIT] |
| UC-17.4 | Task scheduled at 2:30am during spring forward | Snapped to 3:00am (or 1:30am) | [UNIT] |
| UC-17.5 | Scheduler in US/Eastern, task created in US/Pacific | Correct conversion both ways | [UNIT] |
| UC-17.6 | todayKey/nowMins correct for different timezones | 8am EST = different todayKey than 8am PST | [UNIT] |

## 18. Integration: Full DB Pipeline

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-18.1 | Load tasks from DB → run scheduler → persist results | scheduled_at updated in DB | [INT] |
| UC-18.2 | Expand recurring → schedule → persist instances | Instances in DB with correct scheduled_at | [INT] |
| UC-18.3 | Run scheduler twice — DB state consistent | No duplicate instances, same placements | [INT] |
| UC-18.4 | Mark instance done → re-run → done instance untouched | Status preserved, not re-scheduled | [INT] |
| UC-18.5 | Delete habit template → instances orphaned | Orphaned instances not re-generated | [INT] |
| UC-18.6 | Change habit template `when` → instances updated | New instances use updated when-windows | [INT] |
| UC-18.7 | Config change (add time block) → re-run | New block available for scheduling | [INT] |
| UC-18.8 | Concurrent scheduler runs blocked by sync lock | Second run waits or fails gracefully | [INT] |

## 19. User's Real Config Scenarios

These mirror the actual Strive setup discovered in the investigation.

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-19.1 | Friday: Lunch habit `when:"lunch"`, blocks have lunch 720-780 at `loc:"work"`, but location template resolves to home | Lunch placed at 720 (noon), tool availability from home (not work) | [UNIT] |
| UC-19.2 | Thursday: `locScheduleDefaults.Thu = "weekend"`, weekend template all-home | All blocks resolve to home location | [UNIT] |
| UC-19.3 | P1 "File for Unemployment" due today + P1 habits — merged phase | Deadline task placed before habits within P1 tier | [UNIT] |
| UC-19.4 | "Apply for Jobs" (P1 habit, flexWhen) + "Resume Optimizer" (P1 habit) — afternoon | Both placed, flex habit can shift if needed | [UNIT] |
| UC-19.5 | Travel day override (3/31 → "car" template) — tasks requiring home tools | Tasks with `tools:["personal_pc"]` only in evening (home after transit) | [UNIT] |
| UC-19.6 | Dr. Nguyen telehealth (gcal, fixed) at 1pm blocks afternoon | Other tasks scheduled around it | [UNIT] |
| UC-19.7 | Morning prescriptions (rigid habit) + Eat Breakfast (rigid habit) + Lunch (rigid habit) | Each in their correct block, no interference | [UNIT] |
| UC-19.8 | "weekend" location template missing minutes 765-810 — fallback to time block loc | Minutes 765-780 resolve to time block's lunch loc | [UNIT] |

---

## Running the Tests

```bash
# Unit tests (no DB needed)
npm test -- tests/schedulerRules.test.js

# Integration tests (requires Docker MySQL)
docker compose -f docker-compose.test.yml up -d
npm test -- tests/schedulerIntegration.test.js

# Time simulation tests
npm test -- tests/schedulerTimeSimulation.test.js

# All scheduler tests
npm test -- tests/scheduler*.test.js
```
