# Task Properties — Scheduler Reference

How every property on a task object affects scheduling.

## Scheduling Modes

A task's mode is determined by its properties. The scheduler processes them in this order:

| Mode | Trigger | Phase | Behavior |
|------|---------|-------|----------|
| **Fixed** | `when` contains `'fixed'` | 0 | Anchored at exact time. Immovable. Blocks the slot. |
| **Marker** | `marker = true` | 0 | Shown on calendar but **no time occupancy**. Never moved. |
| **Pinned** | `datePinned = true` + has time | 0 | User-locked date+time. Treated as fixed. First evicted during pile-ups. |
| **Rigid Recurring** | `recurring + rigid` | 0 | Force-placed at `preferredTimeMins` within `when`-window. |
| **Non-Rigid Recurring** | `recurring + !rigid` | 1 | Placed by slack (constrained-first), within `when`-windows on occurrence day. |
| **Deadline Constrained** | has `deadline` or chain member | 2 | Slack-sorted left-to-right. Chain rollback if capacity-constrained. |
| **Unconstrained** | no deadline, not recurring | 3 | Priority-sorted forward fill. |
| **FlexWhen Retry** | `flexWhen = true` + unplaced | 4 | Retry with "anytime" windows (all time blocks). |
| **Recurring Rescue** | recurring + unplaced after Phase 4 | 5 | Bump lower-priority non-deadline tasks to make room. |

## Status Effects

| Status | Enters Pool? | Scheduled? | Other Effects |
|--------|-------------|-----------|---------------|
| `""` (empty) | Yes | Yes | Normal scheduling |
| `wip` | Yes | Yes | Uses `timeRemaining` instead of `dur` |
| `done` | No | No | Frozen. Dependencies on this task are considered met. |
| `cancel` | No | No | Frozen. Dependencies considered met. |
| `skip` | No | No | Frozen. Auto-set for past recurring outside flex window. |
| `pause` | No | No | Frozen. Template-level only (recurring master paused). |
| `disabled` | No | No | Frozen. Set by system (e.g., plan limits). |

## Properties by Category

### Identity (not used in placement logic)

| Property | DB | JS | Type | Set By |
|----------|-----|-----|------|--------|
| ID | `id` | `id` | string | System |
| Text | `text` | `text` | string | User |
| Project | `project` | `project` | string | User |
| Section | `section` | `section` | string | User |
| Notes | `notes` | `notes` | text | User |
| Task Type | `task_type` | `taskType` | `task`, `recurring_template`, `recurring_instance` | System |

### Duration & Effective Time

| Property | DB | JS | Type | Set By | Scheduler Effect |
|----------|-----|-----|------|--------|-----------------|
| Duration | `dur` | `dur` | int (minutes) | User | Capped at 720m. How much time the task occupies. |
| Time Remaining | `time_remaining` | `timeRemaining` | int or null | User | If set (WIP tasks), overrides `dur`. `effectiveDur = timeRemaining ?? dur`. |
| Split | `split` | `split` | bool | User | If true + `splitMin > 0`, task can be broken into chunks across slots. |
| Split Min | `split_min` | `splitMin` | int (minutes) | User | Minimum chunk size for in-scheduler splitting. |
| Split Ordinal | `split_ordinal` | `splitOrdinal` | int | System | Which chunk this is (1..N). Pre-chunked rows won't be re-split. |
| Split Total | `split_total` | `splitTotal` | int | System | Total chunks in this occurrence. |
| Split Group | `split_group` | `splitGroup` | string or null | System | Links chunks of the same occurrence for merge-back. |

### When & Where (placement constraints)

| Property | DB | JS | Type | Set By | Scheduler Effect |
|----------|-----|-----|------|--------|-----------------|
| When | `when` | `when` | string | User | Comma-separated time block tags: `morning`, `lunch`, `afternoon`, `evening`, `night`, `fixed`, `allday`. Empty = all windows. `allday` = excluded from grid. |
| Day Req | `day_req` | `dayReq` | string | User | `any`, `weekday`, `weekend`, or comma-separated days (`M,W,F`). Checked via `canPlaceOnDate()`. |
| Rigid | `rigid` | `rigid` | bool | User | Forces placement at exact `preferredTimeMins`. Phase 0 only. |
| Flex When | `flex_when` | `flexWhen` | bool | User | If true and unplaced after Phase 3, retries with "anytime" windows. |
| Time Flex | `time_flex` | `timeFlex` | int (minutes) | User | ± window around `preferredTimeMins` for recurring. Default 60m. Also controls past-recurring flex window for auto-skip. |
| Preferred Time | `preferred_time_mins` | `preferredTimeMins` | int (mins from midnight) | User | Anchor time for rigid and time-window recurring. 420 = 7:00 AM. |
| Location | `location` | `location` | JSON array | User | Task can only place in slots where location supports its requirements. |
| Tools | `tools` | `tools` | JSON array | User | Location must have all required tools available. |
| Travel Before | `travel_before` | `travelBefore` | int (minutes) | User | Reserved buffer before task start. Only first chunk of a split. |
| Travel After | `travel_after` | `travelAfter` | int (minutes) | User | Reserved buffer after task end. Only last chunk of a split. |

### Deadlines & Floors

| Property | DB | JS | Type | Set By | Scheduler Effect |
|----------|-----|-----|------|--------|-----------------|
| Deadline | `deadline` | `deadline` | date | User | Hard upper bound. Tasks with deadline enter constrained pool (Phase 2). Slack computed against this. Past-due = placed ASAP with P1 boost. |
| Start After | `start_after_at` | `startAfter` | date | User | Hard lower bound. Task won't place before this date. |
| Depends On | `depends_on` | `dependsOn` | JSON array of IDs | User | Task waits until all deps are placed. Done/cancelled deps are considered met. Circular deps auto-broken. |

### Pinning & Anchoring

| Property | DB | JS | Type | Set By | Scheduler Effect |
|----------|-----|-----|------|--------|-----------------|
| Date Pinned | `date_pinned` | `datePinned` | bool | User | If true + has time → immovable (Phase 0). Cleared by scheduler when it places the task. First evicted during pile-ups. |
| Date (cached) | `date` | `date` | string (M/D) | Scheduler | Derived from `scheduled_at`. Non-anchored tasks get date reset to today each run. |
| Day (cached) | `day` | `day` | string | Scheduler | Derived from `scheduled_at`. |
| Time (cached) | `time` | `time` | string (h:mm AM) | Scheduler | Derived from `scheduled_at`. |
| Scheduled At | `scheduled_at` | `scheduledAt` | datetime UTC | Scheduler | THE source of truth for placement. Written by scheduler, read by frontend. |
| Unscheduled | `unscheduled` | `unscheduled` | bool | Scheduler | Set when task can't be placed. Preserves last `scheduled_at` for "was supposed to be at" display. |

### Recurrence

| Property | DB | JS | Type | Set By | Scheduler Effect |
|----------|-----|-----|------|--------|-----------------|
| Recurring | `recurring` | `recurring` | bool | User | Routes to Phase 0/1 instead of Phase 2/3. Instances get floor+ceiling on occurrence day. |
| Recur Config | `recur` | `recur` | JSON | User | `{type, days, every, timesPerCycle, monthDays}`. Drives `expandRecurring` instance generation and flex window computation. |
| Recur Start | `recur_start` | `recurStart` | date | User | Earliest date for instance generation. |
| Recur End | `recur_end` | `recurEnd` | date | User | Latest date for instance generation. |
| Source ID | `source_id` | `sourceId` | string | System | For instances: points to master. Used for field inheritance and chunk grouping. |
| Generated | `generated` | `generated` | bool | System | Instance was scheduler-generated. Treated as user-anchored (date preserved). |
| Occurrence Ordinal | `occurrence_ordinal` | `occurrenceOrdinal` | int | System | Which occurrence of the recurring task (1..N). |
| Marker | `marker` | `marker` | bool | User | Non-blocking reminder. Shown on calendar, doesn't consume time. |

### Priority

| Property | DB | JS | Type | Set By | Scheduler Effect |
|----------|-----|-----|------|--------|-----------------|
| Priority | `pri` | `pri` | string | User | `P1` (highest) through `P4` (lowest). Default `P3`. Tiebreaker in all phases — never the primary sort. Past-due tasks get boosted to P1. |

### Scheduler-Set Flags (transient, per-run)

| Property | Type | When Set |
|----------|------|----------|
| `_pastDue` | bool | Task whose deadline has passed |
| `_originalDue` | string | Original deadline date before past-due remap |
| `_unplacedReason` | string | Why task couldn't be placed: `missed`, `capacity_conflict`, `past_due_no_capacity`, `impossible_window`, `partial_split`, `spacing` |
| `_unplacedDetail` | string | Human-readable explanation |
| `_suggestions` | array | Suggested fixes for the user |
| `_conflict` | bool | Rigid recurring force-placed over another task |
| `_whenRelaxed` | bool | Placed via flexWhen fallback (Phase 4) |
| `_placementReason` | string | Why task landed where it did |
| `_fauxDeadline` | string | Inherited deadline from dependency chain |
| `_candidateDate` | string | Target date from expandRecurring (for ordinal IDs) |
