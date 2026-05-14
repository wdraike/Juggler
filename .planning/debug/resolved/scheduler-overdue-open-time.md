---
slug: scheduler-overdue-open-time
status: resolved
trigger: juggler scheduler unusual behavior
created: 2026-05-14
updated: 2026-05-14
---

## Symptoms

- **Expected:** Tasks from yesterday should not be marked overdue; large open time blocks today should be used for scheduling
- **Actual:** Tasks incorrectly marked as overdue from yesterday; large open time slots today are not being used for scheduling
- **Errors:** None — silent failure
- **Timeline:** Started past few days
- **Reproduction:** Run the scheduler

## Current Focus

- hypothesis: RESOLVED — two root causes found and fixed
- test: schedulerScenarios S14, S25 — both now passing
- expecting: tasks placed near preferred time, not overdue
- next_action: done

## Evidence

- timestamp: 2026-05-14T00:00:00Z
  description: "S25 test fails: rowToTask returns '7:00 AM' instead of '12:00 PM' for recurring instance with stale scheduled_at"
  result: "Commit 9b8d4f7 added !row.scheduled_at guard to preferred_time_mins override in rowToTask — confirmed as regression"

- timestamp: 2026-05-14T00:01:00Z
  description: "Traced GCal builder change in 9b8d4f7 — builder now uses task.scheduledAt (UTC) not task.time for event time"
  result: "The rowToTask guard is redundant — cal-sync drift fix was already applied at builder level. Guard only causes scheduler regression."

- timestamp: 2026-05-14T00:02:00Z
  description: "S14 test fails: strict flexible recurring (no placementMode) with full blocks gets placed on future day instead of unplaced"
  result: "Commit a57c469 changed 'var recurring = !!t.recurring' to explicit placement_mode check. Tasks with recurring=true but no explicit placementMode lose isDayLocked semantics."

- timestamp: 2026-05-14T00:03:00Z
  description: "Confirmed S48/S49 are pre-existing unimplemented TDD tests for partial_split feature (plan file deleted). Not related to this bug report."
  result: "schedulerRules 6 failures also pre-existing. No regressions from fix."

## Eliminated

- Timezone offset causing wrong todayKey: eliminated — Intl.DateTimeFormat correctly computes timezone
- nowMins blocking all today slots: eliminated — only past minutes blocked
- when tag mismatch (biz not in ALL_WINDOWS): eliminated — afternoon aliased from biz blocks
- Cal-linked row exclusion from reconciler: eliminated — old rows deleted, not the issue
- getSchedulePlacements slow path: confirmed as secondary vector but primary issue is rowToTask

## Resolution

- root_cause: Two regressions introduced by post-May-9 changes. (1) Commit 9b8d4f7 added `!row.scheduled_at` guard to preferred_time_mins override in rowToTask (task.controller.js:345). Intent was preventing cal-sync drift between GCal (which used task.time) and MSFT/Apple (which used scheduled_at). But the same commit already fixed the GCal builder to use scheduledAt directly, making the rowToTask guard redundant AND harmful. With the guard, recurring instances with stale scheduled_at kept stale time values — causing overdue misclassification and silent drops. (2) Pre-existing: test tasks for S14/S47/S48/S49 (Tier 11) lacked `placementMode: 'recurring_flexible'`, which commit a57c469 made mandatory for recurring day-lock behavior.
- fix: Removed `&& !row.scheduled_at` from rowToTask preferred_time_mins condition (task.controller.js). Added `placementMode: 'recurring_flexible'` to S14, S47, S48, S49 test tasks. Updated comment explaining why guard was removed.
- verification: schedulerScenarios S14, S25, S49 now pass. schedulerRules + schedulerSupplyDemand unchanged (all pre-existing). S48 still fails — pre-existing unimplemented partial_split feature.
- files_changed: juggler-backend/src/controllers/task.controller.js, juggler-backend/tests/schedulerScenarios.test.js
