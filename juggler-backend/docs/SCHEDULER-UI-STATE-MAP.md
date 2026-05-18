# Scheduler UI → State Map

Maps every UI control in the task editor (WhenSection) to the fields written to the DB
and the resulting scheduler behavior. Verified against `WhenSection.jsx`, `TaskEditForm.jsx`,
and `task.controller.js`.

---

## Full pipeline: UI → scheduler

```
WhenSection.jsx / TaskEditForm.jsx
  │
  │  camelCase API body
  │  { when, preferredTimeMins, timeFlex, rigid, recurring, ... }
  ▼
task.controller.js  taskToRow(fields, userId, tz, existingDbRow)
  │
  │  • maps camelCase → snake_case DB columns
  │  • calls derivePlacementMode() if any PLACEMENT_TRIGGER_FIELD present
  │  • ⚠️  existingDbRow MUST be passed so recurring/preferredTimeMins
  │         read from cur fall back to the correct snake_case columns
  │         (cur.preferredTimeMins → cur.preferred_time_mins)
  ▼
task_masters  (DB table — template / one-off fields)
  when, placement_mode, preferred_time_mins, time_flex, rigid*, recurring
  * rigid is a derived view column; not stored — inferred from placement_mode

task_instances  (DB table — per-occurrence fields)
  scheduled_at, date_pinned, dur, status
  │
  ▼
tasks_v  (DB view — merges master + instance)
  exposes all above columns to application code
  │
  ▼
unifiedScheduleV2.js  →  runSchedule.js
  reads tasks_v per user, calls buildItems() / placeTask() per task
  see "Scheduler reads" table below
```

**Internal MCP path** (`src/mcp/tools/tasks.js` `update_task`):
Same `taskToRow` call, but `existing` is fetched first from `tasks_with_sync_v` and
**must be passed as 4th arg** — see fix in commit `40e7329`.

---

## Scheduler reads per placement_mode

Fields consumed by `runSchedule.js` / `unifiedScheduleV2.js` when placing each task:

| placement_mode     | Fields read from tasks_v                                         |
|--------------------|------------------------------------------------------------------|
| `FLEXIBLE`         | `when` (block windows), `time_flex` / `flex_when`, `day_req`    |
| `RECURRING_FLEXIBLE`| `when` (block windows), `time_flex` / `flex_when`, `recur`     |
| `RECURRING_WINDOW` | `preferred_time_mins`, `time_flex` (as ±window), `recur`        |
| `RECURRING_RIGID`  | `preferred_time_mins` (exact minute), `recur`                   |
| `FIXED`            | `scheduled_at` (exact, immovable), `date_pinned`                |
| `MARKER`           | nothing — task is display-only, skipped by slot logic           |

`when` is **ignored** in RECURRING_WINDOW and RECURRING_RIGID modes.
`preferred_time_mins` is **ignored** in FLEXIBLE and RECURRING_FLEXIBLE modes.

---

## Two orthogonal lock axes

Before the mode trees, understand the two separate "lock" fields:

| Field | Column | What it locks | Who sets it |
|-------|--------|--------------|-------------|
| `rigid` | `rigid` | **Time** — task's minute is immovable | Float/Fixed toggle (UI); ± Window "exact" for recurring Time Window |
| `datePinned` | `date_pinned` | **Date** — scheduler won't move the task to a different day | Backend: auto-set when any task is created with an explicit date; drag-pin; calendar sync |

`rigid=true` on a non-recurring task triggers `derivePlacementMode → FIXED`.
`datePinned=true` maps to `item.isPinned` in the scheduler → clamps `earliestIdx=latestIdx=anchorDate` in `findEarliestSlot`, but the task still floats within that day's eligible slots (it is NOT FIXED mode on its own).

Calendar-synced tasks get both `when='fixed'` AND `datePinned=true` — the `when='fixed'` tag is what triggers FIXED in `derivePlacementMode`; `datePinned` additionally grays out the scheduling-mode controls in the UI so the user knows the calendar owns the time.

---

## How `placement_mode` is derived

`derivePlacementMode()` runs on every write that touches a placement-trigger field
(`marker`, `rigid`, `when`, `recurring`, `preferredTimeMins`, `placementMode`).
First match wins:

```
marker = true                                     → MARKER
when includes 'fixed'                             → FIXED
rigid = true  AND  recurring = false              → FIXED
recurring AND rigid AND preferredTimeMins != null → RECURRING_RIGID
recurring AND preferredTimeMins != null           → RECURRING_WINDOW
recurring                                         → RECURRING_FLEXIBLE
(default)                                         → FLEXIBLE
```

⚠️ The derive only re-runs when a trigger field is **written in that save**. A task whose
`preferred_time_mins` was set via a direct DB write (or an older API path) may retain a
stale `placement_mode` that does not match the current field values. See the "stale
placement_mode" section at the bottom.

---

## Non-recurring tasks

Rendered when `!isRecurring && !marker`. All controls below are grayed out and
non-interactive when `isFixed` (`datePinned = true` OR `when` includes `'fixed'`).

```
Non-recurring When section
│
├── 🔀 Float / 📌 Fixed  toggle  (always visible, outside isFixed gate)
│     rigid=false → float (default)
│     rigid=true  → FIXED placement mode (time immovable)
│
└── Scheduling mode  ← grayed out when isFixed
    │
    ├── 🔄 Anytime ─────────────────────────────────────────────────────────────
    │     Action: when='', datePinned=false
    │     → placementMode = FLEXIBLE
    │     Scheduler: any free slot across all blocks; floats within the
    │       planning horizon if not date-pinned
    │
    ├── ☀️ All Day ──────────────────────────────────────────────────────────────
    │     Action: when='allday', split=false, travel=0, datePinned=false
    │     → placementMode = FLEXIBLE  (derive sees no special trigger)
    │     Scheduler: SKIPS the task entirely — `if (allday) return` in
    │       buildItems. The task is NOT placed in any time slot.
    │     Display: should appear as a full-day reminder banner in each
    │       calendar view (holiday / birthday style). See JUG-MED-10.
    │
    └── Preferred time windows  (block-tag buttons: Morning / Biz / Lunch / …)
          Action: each button adds/removes a tag from when
          when='morning'              (single block)
          when='morning,evening'      (multiple blocks)
          → placementMode = FLEXIBLE
          Scheduler: slot must fall inside one of the selected named blocks
          │
          ├── Strict  (default, flexWhen=false)
          │     Scheduler: hard constraint — only placed inside selected
          │     blocks; goes to unplaced if all matching windows are full
          │
          └── ~ Flex toggle ON  (flexWhen=true)
                Scheduler: tries selected blocks first; falls back to any
                available slot if all named windows are full
```

**Day requirement** (non-recurring, only when `!isFixed`):

| UI | `dayReq` value | Scheduler effect |
|----|---------------|-----------------|
| Any   | `'any'`     | any day          |
| Wkday | `'weekday'` | Mon–Fri only     |
| Wkend | `'weekend'` | Sat–Sun only     |
| Su/Mo/… | `'Su,M,…'` | specific days   |

---

## Recurring tasks

Rendered when `recurring && !marker`. A **three-way mutually exclusive** mode picker
replaces the non-recurring section. Clicking any mode button clears the other mode's
fields via `buildFields`.

```
Recurring task scheduling modes
│
├── 🔄 Anytime ─────────────────────────────────────────────────────────────────
│     Action:
│       hasPreferredTime=false, when='', time='', rigid=false
│     Writes:
│       preferredTimeMins=null, timeFlex=null, when=''
│     → derivePlacementMode: RECURRING_FLEXIBLE
│
│     Scheduler:
│       • searches all time blocks on the anchor date
│       • day-locked to anchor date (no roll-forward)
│       • if the task's scheduled time has already passed today:
│           placed at the latest available slot for end-of-day completion
│
├── ⏰ Time Window ──────────────────────────────────────────────────────────────
│     Action:
│       hasPreferredTime=true
│       if activeTags.length ≠ 1 → also sets when='morning' (default tag)
│     User inputs: Time (HH:MM), ± Window select
│     Writes:
│       preferredTimeMins = HH*60+MM
│       timeFlex = N  (from ± Window select)
│       when = single_tag  (leftover; ignored by scheduler in this mode — see ⚠️ below)
│
│     ⚠️  `when` IS written but IS IGNORED by the scheduler in RECURRING_WINDOW
│         and RECURRING_RIGID modes. Slot selection uses ONLY preferredTimeMins
│         and timeFlex. The stored tag ('morning' by default) is vestigial; it
│         must not be relied on to indicate the task's actual scheduled period.
│
│     ± Window select → controls rigid and therefore derivePlacementMode:
│     │
│     ├── exact  (sets rigid=true, timeFlex=0)
│     │     → derivePlacementMode: RECURRING_RIGID
│     │     Scheduler:
│     │       • placed at exact preferredTimeMins minute
│     │       • day-locked to anchor date
│     │       • if the minute has passed today → unplaced, reason='missed'
│     │
│     └── ±15m / ±30m / ±1hr / ±1.5hr / ±2hr  (rigid=false, timeFlex=N)
│           → derivePlacementMode: RECURRING_WINDOW
│           Scheduler:
│             windowLo = max(DAY_START, preferredTimeMins - timeFlex)
│             windowHi = min(DAY_END,   preferredTimeMins + timeFlex)
│             • earliest free slot in [windowLo, windowHi]
│             • day-locked to anchor date
│             • if windowHi ≤ nowMins (today) → unplaced, reason='missed'
│             • if window is entirely outside schedulable day (inverted) →
│                 falls back to when-tag placement as a safety net
│
│     Note: buildFields forces rigid=false when in Time Window mode with a
│     time set. The ± Window "exact" option is the correct way to make a
│     recurring task rigid — not the Float/Fixed button.
│
└── 📅 Time Blocks ──────────────────────────────────────────────────────────────
      Action:
        hasPreferredTime=false, time='', rigid=false
        if activeTags.length ≤ 1 → sets when='morning,lunch,afternoon,evening,night'
      Writes:
        preferredTimeMins=null, timeFlex=null
        when = the selected block tags  (comma-separated)
      → derivePlacementMode: RECURRING_FLEXIBLE

      Scheduler:
        • slot must fall within one of the selected named blocks
        • day-locked to anchor date
        • if the task's scheduled time has passed today:
            placed at the latest available slot for end-of-day completion

      Block tag buttons toggle which blocks are eligible. Multi-select is
      allowed; any combination of blocks can be chosen.
```

---

## `placement_mode` → scheduler behavior quick reference

| placement_mode       | Slot selection driver              | Day-locked | If window/time passed today |
|----------------------|------------------------------------|------------|----------------------------|
| `FLEXIBLE`           | `when` block tags                  | if datePinned=true, else floats | reschedule forward |
| `FIXED`              | `scheduledAt` (exact, immovable)   | yes        | stays pinned               |
| `MARKER`             | none — display only                | yes        | n/a                        |
| `RECURRING_FLEXIBLE` | `when` block tags                  | yes        | placed at latest slot      |
| `RECURRING_WINDOW`   | `preferredTimeMins ± timeFlex`     | yes        | unplaced (reason='missed') |
| `RECURRING_RIGID`    | `preferredTimeMins` (exact)        | yes        | unplaced (reason='missed') |

---

## `when` field semantics by mode

| placement_mode       | `when` role                                        |
|----------------------|----------------------------------------------------|
| `FLEXIBLE`           | **authoritative** — drives block-window list       |
| `RECURRING_FLEXIBLE` | **authoritative** — drives block-window list       |
| `RECURRING_WINDOW`   | **vestigial** — written by UI, ignored by scheduler|
| `RECURRING_RIGID`    | **vestigial** — written by UI, ignored by scheduler|
| `FIXED`              | carries `'fixed'` tag — triggers FIXED in derive   |
| `MARKER`             | carries `'allday'` or similar                      |

---

## Known data hazard: stale `placement_mode`

`placement_mode` is re-derived only when a PLACEMENT_TRIGGER_FIELD is present in the
save payload. A task whose `preferred_time_mins` was written via a direct DB write (or
a legacy API path) may retain a stale `placement_mode` that does not reflect its
current fields.

**Symptom:** `recurring=true`, `preferred_time_mins=1140`, `when='evening'`,
`placement_mode='flexible'` → scheduler uses block-window logic instead of the 7 PM window.

**Root cause (fixed 2026-05-18, commit 40e7329):**
`mcp/tools/tasks.js` `update_task` was calling `taskToRow(fields, userId, tz)` without
passing the fetched `existing` row as `currentTask`. With `cur={}`, `cur.recurring` is
`undefined`, so `derivePlacementMode` always fell through to `FLEXIBLE`. Every internal
MCP update that touched a placement-trigger field silently clobbered `placement_mode`.

**Detection:**
```sql
SELECT id, text, `when`, preferred_time_mins, placement_mode
FROM tasks_v
WHERE recurring = 1
  AND preferred_time_mins IS NOT NULL
  AND placement_mode IN ('flexible', 'recurring_flexible');
```

**Fix (DB patch):**
```sql
UPDATE task_masters
SET placement_mode = 'recurring_window', updated_at = NOW()
WHERE recurring = 1
  AND preferred_time_mins IS NOT NULL
  AND placement_mode IN ('flexible', 'recurring_flexible');
```

Alternatively: re-save the task from the UI — any field change re-triggers derivePlacementMode.

**Guard:** if adding any new code path that calls `taskToRow` for an update,
always pass the pre-fetched existing row as the 4th argument.
