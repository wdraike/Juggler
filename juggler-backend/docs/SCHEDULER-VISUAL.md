# Scheduler Visual Documentation (999.008)

> **Last Updated:** 2026-06-17
> **Service:** Juggler
> **Status:** Active

This document provides a visual walkthrough of the Juggler v2 scheduler — the 7 phases, 4-level fallback ladder, 6 placement modes, and the slack-sorted single-pass algorithm. It complements the canonical design doc (`SCHEDULER.md`) and rules reference (`SCHEDULER-RULES.md`).

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [7 Scheduler Phases](#2-7-scheduler-phases)
3. [4-Level Fallback Ladder](#3-4-level-fallback-ladder)
4. [6 Placement Modes](#4-6-placement-modes)
5. [Slack-Sorted Single-Pass Algorithm](#5-slack-sorted-single-pass-algorithm)
6. [Phase Interaction Diagram](#6-phase-interaction-diagram)
7. [Glossary](#7-glossary)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SCHEDULER RUN (per user)                          │
│                                                                     │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────────────────┐   │
│  │  LOAD    │───→│  CLASSIFY    │───→│  PLACE (7 phases)        │   │
│  │  Phase   │    │  Phase       │    │  ┌─────────────────────┐  │   │
│  │          │    │              │    │  │ Phase 0: Immovables │  │   │
│  │ • tasks  │    │ • fixed      │    │  ├─────────────────────┤  │   │
│  │ • recur  │    │ • markers    │    │  │ Phase 1: Recurring  │  │   │
│  │ • config │    │ • recurring  │    │  │   (slack-sorted)    │  │   │
│  │ • weather│    │ • deadline   │    │  ├─────────────────────┤  │   │
│  │          │    │ • free       │    │  │ Phase 2: Deadline   │  │   │
│  └──────────┘    └──────────────┘    │  │   (slack-sorted)    │  │   │
│                                       │  ├─────────────────────┤  │   │
│  ┌──────────┐    ┌──────────────┐    │  │ Phase 3: Priority  │  │   │
│  │  PERSIST │←───│  NOTIFY      │    │  │   Fill             │  │   │
│  │  Phase   │    │  Phase       │    │  ├─────────────────────┤  │   │
│  │          │    │              │    │  │ Phase 4: FlexWhen  │  │   │
│  │ • batch  │    │ • SSE event  │    │  │   Relaxation       │  │   │
│  │   update │    │   schedule:  │    │  ├─────────────────────┤  │   │
│  │ • insert │    │   changed    │    │  │ Phase 5: Recurring │  │   │
│  │ • delete │    │              │    │  │   Rescue           │  │   │
│  └──────────┘    └──────────────┘    │  ├─────────────────────┤  │   │
│                                       │  │ Phase 6: Rigid    │  │   │
│                                       │  │   Forced           │  │   │
│                                       │  ├─────────────────────┤  │   │
│                                       │  │ Phase 7: Deadline  │  │   │
│                                       │  │   Relaxed          │  │   │
│                                       │  └─────────────────────┘  │   │
│                                       └───────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 7 Scheduler Phases

The v2 scheduler runs 7 logical phases in sequence. Each phase places items into an occupancy grid (`dayOcc`) that accumulates across phases — later phases fill gaps left by earlier ones.

### Phase 0 — Immovables

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 0: IMMOVABLES                                             │
│                                                                 │
│ Items: fixed tasks, rigid-recurring with anchor, markers        │
│ Method: tryPlaceAtTime(exactTime)                               │
│ Reset: NEVER (exempt from reset)                                │
│                                                                 │
│  Day Grid Before:  [░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]   │
│  Day Grid After:   [██▓▓▓▓██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]   │
│                     ↑fixed  ↑marker                              │
│                                                                 │
│ These slots are LOCKED — no later phase can displace them.       │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 1 — Recurring (Slack-Sorted)

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 1: RECURRING INSTANCES (slack-sorted)                    │
│                                                                 │
│ Items: All recurring instances (daily, weekly, monthly, etc.)  │
│ Sort: (slack ASC, pri ASC, dur DESC, id ASC)                   │
│ Method: tryPlaceQueued → fallback ladder                        │
│ Reset: YES (unless drag-pinned)                                 │
│                                                                 │
│  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐                            │
│  │ T1  │  │ T2  │  │ T3  │  │ T4  │  ← recurring instances     │
│  │slack│  │slack│  │slack│  │slack│    sorted by slack         │
│  │ 120 │  │ 240 │  │ 480 │  │  ∞  │    (narrowest window first)│
│  └──┬──┘  └──┬──┘  └──┬──┘  └──┬──┘                            │
│     ↓        ↓        ↓        ↓                                │
│  ┌──────────────────────────────────────────┐                  │
│  │  Occupancy Grid (after Phase 0 + Phase 1) │                  │
│  │  [██▓▓▓▓██░░░░██░░░░░░██░░░░░░██░░░░░░░] │                  │
│  │   ↑fixed  ↑T1    ↑T2    ↑T3    ↑T4       │                  │
│  └──────────────────────────────────────────┘                  │
│                                                                 │
│ Recurring instances are day-locked to their occurrence date.    │
│ If they can't fit on their assigned day, they go to Phase 5.    │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 2 — Deadline Work (Slack-Sorted)

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 2: DEADLINE WORK (slack-sorted)                          │
│                                                                 │
│ Items: Solo anchors + chain members with deadlines             │
│ Sort: (slack ASC, pri ASC, dur DESC, id ASC)                   │
│ Method: tryPlaceQueued → fallback ladder                        │
│ Reset: YES (unless drag-pinned)                                 │
│                                                                 │
│  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐                            │
│  │ C1  │  │ C2  │  │ C3  │  │ C4  │  ← chain members           │
│  │slack│  │slack│  │slack│  │slack│    interleaved across       │
│  │  0  │  │ 60  │  │ 180 │  │ 300 │    all chains by slack      │
│  └──┬──┘  └──┬──┘  └──┬──┘  └──┬──┘                            │
│     ↓        ↓        ↓        ↓                                │
│  ┌──────────────────────────────────────────┐                  │
│  │  Occupancy Grid (after Phase 0+1+2)      │                  │
│  │  [██▓▓▓▓██░░██▓▓▓▓██▓▓▓▓▓▓██░░░░░░░░░] │                  │
│  │   ↑fixed  ↑T1  ↑C1  ↑C2  ↑C3  ↑T4       │                  │
│  └──────────────────────────────────────────┘                  │
│                                                                 │
│ Chain rollback: If a deadline tail can't fit but its           │
│ predecessors consumed capacity, unplace the chain and          │
│ re-place in reverse-topo order (tail first).                    │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 3 — Priority Fill

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 3: PRIORITY FILL                                          │
│                                                                 │
│ Items: Free tasks (no deadline, no chain membership)            │
│ Sort: Priority tier (P1→P2→P3→P4), then when-width tie-break    │
│ Method: findEarliestSlot (respects when, dayReq, startAfter)    │
│ Reset: YES (unless drag-pinned)                                 │
│                                                                 │
│  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐                            │
│  │ P1  │  │ P2  │  │ P3  │  │ P4  │  ← free tasks by priority  │
│  └──┬──┘  └──┬──┘  └──┬──┘  └──┬──┘                            │
│     ↓        ↓        ↓        ↓                                │
│  ┌──────────────────────────────────────────┐                  │
│  │  Occupancy Grid (after Phase 0+1+2+3)    │                  │
│  │  [██▓▓▓▓██▓▓██▓▓▓▓██▓▓▓▓▓▓██▓▓▓▓▓▓▓▓▓] │                  │
│  │   ↑fixed  ↑T1  ↑P1 ↑C2  ↑C3  ↑P2  ↑P3   │                  │
│  └──────────────────────────────────────────┘                  │
│                                                                 │
│ Free tasks fill remaining gaps left-to-right within their       │
│ when-windows. No deadline constraints — earliest slot wins.     │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 4 — FlexWhen Relaxation

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 4: FLEXWHEN RELAXATION                                    │
│                                                                 │
│ Items: Tasks with flexWhen=true that didn't place in Phase 3   │
│ Method: findEarliestSlot (relaxWhen=true — ignores when tags)   │
│ Reset: N/A (retry pass)                                         │
│                                                                 │
│  Before: Task with when="morning" can't fit in morning block    │
│          [morning: ████████] [afternoon: ░░░░] [evening: ░░░░]  │
│                                                                 │
│  After:  when relaxed to "anytime" — task placed in afternoon   │
│          [morning: ████████] [afternoon: ██░░] [evening: ░░░░]  │
│                                                                 │
│ Only tasks with flexWhen=true participate. Tasks with           │
│ flexWhen=false that can't fit their when-window go unplaced.    │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 5 — Recurring Rescue

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 5: RECURRING RESCUE                                       │
│                                                                 │
│ Items: Recurring instances that didn't place in Phase 1         │
│ Method:                                                         │
│   1. Try any remaining gap in valid window (ignore when pref)   │
│   2. Try bumping lower-priority non-recurring task off the day  │
│   3. If still can't fit → mark unscheduled=1, missedRecurring   │
│                                                                 │
│  ┌──────────────────────────────────────────┐                  │
│  │  Day Grid (full)                         │                  │
│  │  [████████████████████████████████████]   │                  │
│  │                                           │                  │
│  │  Step 1: No gap found                     │                  │
│  │  Step 2: Bump P3 free task → free slot    │                  │
│  │  Step 3: Place recurring in freed slot   │                  │
│  └──────────────────────────────────────────┘                  │
│                                                                 │
│ KEY RULE: Recurring instances do NOT roll forward. If they      │
│ can't fit on their assigned day, they stay unscheduled.         │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 6 — Rigid Forced

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 6: RIGID FORCED                                           │
│                                                                 │
│ Items: Still-unplaced fixed/rigid items                         │
│ Method: Force-placed at anchor with _conflict=true, locked=true │
│                                                                 │
│  ┌──────────────────────────────────────────┐                  │
│  │  Day Grid (full)                          │                  │
│  │  [████████████████████████████████████]   │                  │
│  │                                           │                  │
│  │  Force-place rigid recurring at 9:00 AM   │                  │
│  │  [██████████████████▓▓████████████████]   │                  │
│  │                     ↑rigid (overlap)      │                  │
│  │  Flag: _conflict=true, locked=true        │                  │
│  └──────────────────────────────────────────┘                  │
│                                                                 │
│ This is a last resort — the task overlaps existing occupancy.   │
│ The frontend shows these with a conflict indicator.             │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 7 — Deadline Relaxed

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 7: DEADLINE RELAXED                                       │
│                                                                 │
│ Items: Deadline ≤ today + unmet deps that still can't place    │
│ Method: Place ignoring deps + deadline as absolute last resort  │
│                                                                 │
│  ┌──────────────────────────────────────────┐                  │
│  │  Before: Task due yesterday, deps unmet  │                  │
│  │  → Can't place (deps not ready)          │                  │
│  │                                           │                  │
│  │  After: Ignore deps, ignore deadline      │                  │
│  │  → Place at earliest free slot            │                  │
│  │  Flag: _overdue=true, _unplacedReason=none│                  │
│  └──────────────────────────────────────────┘                  │
│                                                                 │
│ This is the absolute last resort. If this fails, the task       │
│ is marked unscheduled with an appropriate _unplacedReason.      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 4-Level Fallback Ladder

Every item in the main queue (Phases 1–2) goes through `tryPlaceQueued()`, which implements a 4-level fallback ladder:

```
                    ┌─────────────────────┐
                    │  ITEM TO PLACE      │
                    │  (slack-sorted)      │
                    └─────────┬───────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
     ┌────────▼────────┐                     │
     │ PASS 1: NORMAL  │                     │
     │                 │                     │
     │ Respect:        │                     │
     │ • deadline      │                     │
     │ • when windows  │                     │
     │ • day-locks     │                     │
     │ • dayReq        │                     │
     │ • travel        │                     │
     │ • deps          │                     │
     │ • spacing       │                     │
     └────────┬────────┘                     │
              │                               │
         PLACED? ──Yes──→ ✓ Done              │
              │                               │
              No                               │
              │                               │
     ┌────────▼────────┐                     │
     │ PASS 2: OVERDUE │  ← Only if slack<0  │
     │                 │                     │
     │ Drop deadline   │                     │
     │ ceiling         │                     │
     │ Flag: _overdue  │                     │
     └────────┬────────┘                     │
              │                               │
         PLACED? ──Yes──→ ✓ Done              │
              │                               │
              No                               │
              │                               │
     ┌────────▼────────┐                     │
     │ PASS 3: RELAX   │  ← Only if flexWhen │
     │ WHEN            │                     │
     │                 │                     │
     │ Relax when to   │                     │
     │ "anytime"       │                     │
     │ Flag: _whenRelax│                     │
     └────────┬────────┘                     │
              │                               │
         PLACED? ──Yes──→ ✓ Done              │
              │                               │
              No                               │
              │                               │
     ┌────────▼────────┐                     │
     │ PASS 4: BOTH    │  ← Only if slack<0  │
     │                 │     AND flexWhen     │
     │ Drop deadline   │                     │
     │ + relax when    │                     │
     │ Flags: _overdue │                     │
     │ + _whenRelaxed  │                     │
     └────────┬────────┘                     │
              │                               │
         PLACED? ──Yes──→ ✓ Done              │
              │                               │
              No                               │
              │                               │
     ┌────────▼────────┐                     │
     │  UNPLACED       │                     │
     │                 │                     │
     │ Set:            │                     │
     │ unscheduled=1   │                     │
     │ _unplacedReason │                     │
     │ _unplacedDetail │                     │
     └─────────────────┘                     │
                                              │
     ┌────────────────────────────────────────┘
     │
     ▼
  Post-loop: Phase 5 (recurring rescue),
             Phase 6 (rigid forced),
             Phase 7 (deadline relaxed)
```

### Ladder Entry Conditions

| Pass | Condition | What Changes | Flag |
|------|-----------|-------------|------|
| **1** | Always (all items) | Full constraint set | — |
| **2** | `slack < 0` (past-due or tight) | `ignoreDeadline=true` | `_overdue` |
| **3** | `flexWhen === true` | `relaxWhen=true` | `_whenRelaxed` |
| **4** | `slack < 0 && flexWhen === true` | Both relaxations | `_overdue` + `_whenRelaxed` |

### Post-Ladder Rescue Phases

If all 4 ladder passes fail, the item enters the rescue phases:

```
  ┌─────────────────────────────────────────────────────────────┐
  │                    POST-LADDER RESCUE                       │
  │                                                             │
  │  ┌─────────────────────────────────────────────────────┐   │
  │  │ Phase 5: Recurring Rescue (recurring items only)    │   │
  │  │   → Try bumping lower-priority tasks                │   │
  │  │   → If still fails → unscheduled=1, missedRecurring │   │
  │  └─────────────────────────────────────────────────────┘   │
  │                                                             │
  │  ┌─────────────────────────────────────────────────────┐   │
  │  │ Phase 6: Rigid Forced (fixed/rigid items only)      │   │
  │  │   → Force-place at anchor with _conflict=true       │   │
  │  └─────────────────────────────────────────────────────┘   │
  │                                                             │
  │  ┌─────────────────────────────────────────────────────┐   │
  │  │ Phase 7: Deadline Relaxed (deadline items only)     │   │
  │  │   → Place ignoring deps + deadline                  │   │
  │  └─────────────────────────────────────────────────────┘   │
  │                                                             │
  │  If ALL rescue phases fail:                                 │
  │    unscheduled=1, _unplacedReason=<reason>                  │
  └─────────────────────────────────────────────────────────────┘
```

---

## 4. 6 Placement Modes

Each task has exactly one `placement_mode`. The mode determines how the scheduler treats the task.

### Mode Comparison

```
                    ┌──────────────────────────────────────────────────────────────────────────────┐
                    │                    PLACEMENT MODE COMPARISON                                  │
                    ├────────────┬──────────┬──────────┬────────┬──────────┬──────────┬────────────┤
                    │   MODE     │ Requires │ Requires │ Occupies│ Scheduler│ Recurring│ DB Value  │
                    │            │  Date?   │  Time?   │  Grid?  │ Can Move?│ Allowed? │           │
                    ├────────────┼──────────┼──────────┼────────┼──────────┼──────────┼────────────┤
                    │  Anytime   │    No    │    No    │  Yes   │   Yes    │   Yes    │ 'anytime'  │
                    ├────────────┼──────────┼──────────┼────────┼──────────┼──────────┼────────────┤
                    │Time Window │   Yes    │   Yes    │  Yes   │  Within  │   Yes    │'time_window'│
                    │            │          │          │        │  ±flex   │          │            │
                    ├────────────┼──────────┼──────────┼────────┼──────────┼──────────┼────────────┤
                    │Time Blocks │    No    │    No    │  Yes   │   Yes    │   Yes    │'time_blocks'│
                    ├────────────┼──────────┼──────────┼────────┼──────────┼──────────┼────────────┤
                    │   Fixed    │   Yes    │   Yes    │  Yes   │  Never   │   No*    │  'fixed'   │
                    ├────────────┼──────────┼──────────┼────────┼──────────┼──────────┼────────────┤
                    │  All Day   │   Yes    │    No    │   No   │   Yes    │   Yes    │ 'all_day'   │
                    ├────────────┼──────────┼──────────┼────────┼──────────┼──────────┼────────────┤
                    │  Reminder  │    No    │    No    │   No   │   Yes    │   Yes    │ 'reminder'  │
                    └────────────┴──────────┴──────────┴────────┴──────────┴──────────┴────────────┘
                    * UI blocks fixed+recurring combination
```

### Mode Behavior in the Scheduler

```
MODE: ANYTIME
┌─────────────────────────────────────────────────────────────────┐
│  No time constraint. Placed wherever fits by priority/slack.   │
│                                                                 │
│  ┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐ │
│  │ 6a │ 7a │ 8a │ 9a │10a │11a │12p │ 1p │ 2p │ 3p │ 4p │ 5p │ │
│  ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤ │
│  │    │    │    │ ██ │ ██ │    │    │    │    │    │    │    │ │
│  └────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘ │
│                    ↑ Placed at earliest free slot                │
└─────────────────────────────────────────────────────────────────┘

MODE: TIME WINDOW
┌─────────────────────────────────────────────────────────────────┐
│  Placed at or after preferredTimeMins, within ±timeFlex.        │
│                                                                 │
│  preferredTimeMins = 540 (9:00 AM), timeFlex = 30               │
│  Window: [510, 570] = [8:30 AM, 9:30 AM]                       │
│                                                                 │
│  ┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐ │
│  │ 6a │ 7a │ 8a │ 9a │10a │11a │12p │ 1p │ 2p │ 3p │ 4p │ 5p │ │
│  ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤ │
│  │    │    │ ░░ │ ██ │ ░░ │    │    │    │    │    │    │    │ │
│  └────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘ │
│             ↑winStart ↑placed  ↑winEnd                          │
│             8:30      9:00     9:30                              │
└─────────────────────────────────────────────────────────────────┘

MODE: TIME BLOCKS
┌─────────────────────────────────────────────────────────────────┐
│  Constrained to user-defined when-tag blocks.                   │
│                                                                 │
│  when = "morning,lunch"                                         │
│  Morning block: [360, 660] = [6:00 AM, 11:00 AM]                │
│  Lunch block:   [660, 780] = [11:00 AM, 1:00 PM]               │
│                                                                 │
│  ┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐ │
│  │ 6a │ 7a │ 8a │ 9a │10a │11a │12p │ 1p │ 2p │ 3p │ 4p │ 5p │ │
│  ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤ │
│  │ ██ │ ██ │ ██ │ ██ │ ██ │ ██ │ ██ │ ██ │    │    │    │    │ │
│  └────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘ │
│       ↑────── morning ──────↑↑──── lunch ────↑                  │
│                                                                 │
│  Task placed at earliest free slot within morning block.        │
└─────────────────────────────────────────────────────────────────┘

MODE: FIXED
┌─────────────────────────────────────────────────────────────────┐
│  Anchored at exact time. NEVER moved by scheduler.              │
│                                                                 │
│  time = "9:00 AM" → scheduled_at = 9:00 AM                      │
│                                                                 │
│  ┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐ │
│  │ 6a │ 7a │ 8a │ 9a │10a │11a │12p │ 1p │ 2p │ 3p │ 4p │ 5p │ │
│  ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤ │
│  │    │    │    │ ▓▓ │    │    │    │    │    │    │    │    │ │
│  └────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘ │
│                    ↑ LOCKED — immovable                          │
│  isFixedWhen=true, exempt from reset                            │
└─────────────────────────────────────────────────────────────────┘

MODE: ALL DAY
┌─────────────────────────────────────────────────────────────────┐
│  Banner on calendar header. Does NOT consume minute-level       │
│  capacity. Excluded from time grid entirely.                    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  ALL DAY: 📋 Project Review (no time slot needed)           ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │  9:00 AM │ ██ Task A ██ │                                   ││
│  │ 10:00 AM │ ██ Task B ██ │                                   ││
│  └──────────┴──────────────────────────────────────────────────┘│
│                                                                 │
│  dur=0, no occupancy. Day can float if not pinned.              │
└─────────────────────────────────────────────────────────────────┘

MODE: REMINDER
┌─────────────────────────────────────────────────────────────────┐
│  Marker at a time. dur=0, no occupancy. Multiple reminders      │
│  at the same minute do not conflict.                            │
│                                                                 │
│  ┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐ │
│  │ 6a │ 7a │ 8a │ 9a │10a │11a │12p │ 1p │ 2p │ 3p │ 4p │ 5p │ │
│  ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤ │
│  │    │    │    │ 🔔 │    │    │    │    │    │    │    │    │ │
│  └────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘ │
│                    ↑ No occupancy — other tasks can share       │
│  Reminders with anchor time are placed via immovable path.      │
│  Reminders without anchor time fall to slack-sorted queue.      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Slack-Sorted Single-Pass Algorithm

The core innovation of v2: instead of v1's multi-pass approach, all constrained items are sorted into a single queue by **slack** and placed in one forward pass.

### Slack Computation

```
Slack = Available Capacity - Task Duration

Where:
  Available Capacity = sum of free minutes across eligible days
                       within [earliestStart, deadline] range,
                       respecting when-windows and existing occupancy

  For past-due tasks: slack = 0 (most urgent)
  For no-deadline:   slack = Infinity (handled in Phase 3/4)
```

### Sort Order

```
queue.sort(compareItems)

Comparator (in order):
  1. slack ASC          ← Most urgent first (lowest slack)
  2. pri ASC            ← P1 before P2 before P3 before P4 (tie-break)
  3. dur DESC           ← Longer tasks first (harder to fit)
  4. id ASC             ← Deterministic final tie-break
```

### Visual: Slack Sort in Action

```
Chain A (due tomorrow):  A1(60min) → A2(30min) → A3(45min) [deadline: tomorrow]
Chain B (due Friday):    B1(30min) → B2(60min)              [deadline: Friday]

Slack computation:
  A3 (tail):  slack = capacity(today..tomorrow) - 45min = 195min
  A2:         slack = capacity(today..A3.start) - 30min = 165min
  A1:         slack = capacity(today..A2.start) - 60min = 105min
  B2 (tail):  slack = capacity(today..Friday) - 60min = 540min
  B1:         slack = capacity(today..B2.start) - 30min = 510min

Sorted queue:
  ┌──────┬──────┬──────┬──────┬──────┐
  │  A1  │  A2  │  A3  │  B1  │  B2  │
  │slack │slack │slack │slack │slack │
  │ 105  │ 165  │ 195  │ 510  │ 540  │
  └──┬───┴──┬───┴──┬───┴──┬───┴──┬───┘
     │      │      │      │      │
     ▼      ▼      ▼      ▼      ▼
  ┌──────────────────────────────────────────────┐
  │  Day Grid (today)                             │
  │  [A1][A2][A3][B1][░░░░░░░░░░░░░░░░░░░░░░░]   │
  │   ↑Chain A placed first (tighter deadline)    │
  │                                               │
  │  Day Grid (tomorrow)                          │
  │  [░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]   │
  │                                               │
  │  Day Grid (Wednesday)                         │
  │  [B2][░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]   │
  │   ↑B2 placed on Wednesday (before Friday)     │
  └──────────────────────────────────────────────┘
```

### Chain Rollback Visual

```
Scenario: Chain A→B→C, C due today, insufficient capacity

Forward pass (slack order):
  A (slack=60)  → placed
  B (slack=120) → placed
  C (slack=180) → CAN'T FIT (capacity consumed by A and B)

Chain rollback:
  1. Unplace A, B, C
  2. Re-place in reverse-topo order: C first, then B, then A

  ┌──────────────────────────────────────────────┐
  │  After rollback:                              │
  │  [C][B][░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]   │
  │   ↑C (deadline tail) gets first pick          │
  │   ↑B fills remaining                          │
  │   A → unplaced (no room left)                 │
  └──────────────────────────────────────────────┘

  Result: Deadline task (C) is placed. Predecessor (A)
  is sacrificed. This is correct — the deadline is
  more important than the prerequisites.
```

---

## 6. Phase Interaction Diagram

```
                    ┌─────────────────────────────────────┐
                    │         OCCUPANCY GRID              │
                    │  (shared state across all phases)   │
                    └─────────────────────────────────────┘
                                ▲
                                │ accumulates
                                │
  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
  │ Phase 0  │───→│ Phase 1  │───→│ Phase 2  │───→│ Phase 3  │
  │Immovable │    │Recurring │    │Deadline  │    │Priority  │
  │          │    │          │    │          │    │Fill      │
  │ Locks    │    │ Fills    │    │ Fills    │    │ Fills    │
  │ slots at │    │ around   │    │ around   │    │ remaining│
  │ exact    │    │ Phase 0  │    │ Phase 0+1│    │ gaps     │
  │ times    │    │          │    │          │    │          │
  └──────────┘    └──────────┘    └──────────┘    └──────────┘
       │               │               │               │
       ▼               ▼               ▼               ▼
  ┌───────────────────────────────────────────────────────────┐
  │                    OCCUPANCY GRID STATE                    │
  │                                                           │
  │ After P0: [▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]  │
  │ After P1: [▓▓░░██░░██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]  │
  │ After P2: [▓▓░░██░░██▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░]  │
  │ After P3: [▓▓░░██░░██▓▓▓▓▓▓██▓▓▓▓░░░░░░░░░░░░░░░░░░░░░]  │
  └───────────────────────────────────────────────────────────┘
                                │
                                ▼
  ┌──────────┐    ┌──────────┐    ┌──────────┐
  │ Phase 4  │    │ Phase 5  │    │ Phase 6  │
  │ FlexWhen │    │Recurring │    │  + 7     │
  │Relaxation│    │ Rescue   │    │Rescue    │
  │          │    │          │    │          │
  │ Retries  │    │ Bumps    │    │ Force-   │
  │ flex     │    │ lower-pri│    │ place /  │
  │ tasks    │    │ tasks    │    │ relax    │
  └──────────┘    └──────────┘    └──────────┘
       │               │               │
       ▼               ▼               ▼
  ┌───────────────────────────────────────────┐
  │  FINAL OCCUPANCY GRID                      │
  │  [▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░]   │
  │   ↑ Placed tasks              ↑ Unplaced   │
  └───────────────────────────────────────────┘
```

### Reset Rules Per Phase

```
                    ┌─────────────────────────────────────────────┐
                    │         RESET RULES                         │
                    │                                             │
                    │  On each scheduler run, items are either    │
                    │  reset (re-evaluated) or preserved:          │
                    │                                             │
                    │  ┌──────────────────────┬─────────┬────────┐│
                    │  │ Type                 │ Reset?  │ Why    ││
                    │  ├──────────────────────┼─────────┼────────┤│
                    │  │ fixed (non-recurring)│ Never   │ User-  ││
                    │  │                      │         │ set    ││
                    │  │                      │         │ immov- ││
                    │  │                      │         │ able   ││
                    │  ├──────────────────────┼─────────┼────────┤│
                    │  │ fixed (recurring)    │ Never   │ Rigid  ││
                    │  │                      │         │ anchor ││
                    │  ├──────────────────────┼─────────┼────────┤│
                    │  │ Drag-pinned (fixed)   │ Never   │ User   ││
                    │  │                      │         │ intent ││
                    │  ├──────────────────────┼─────────┼────────┤│
                    │  │ Non-fixed recurring   │ Yes     │ Re-    ││
                    │  │                      │         │ evalu- ││
                    │  │                      │         │ ate    ││
                    │  ├──────────────────────┼─────────┼────────┤│
                    │  │ Non-fixed regular     │ Yes     │ Re-    ││
                    │  │                      │         │ evalu- ││
                    │  │                      │         │ ate    ││
                    │  └──────────────────────┴─────────┴────────┘│
                    └─────────────────────────────────────────────┘
```

---

## 7. Glossary

| Term | Definition |
|------|-----------|
| **Slack** | Available capacity (free minutes) between earliest start and deadline, minus task duration. Lower = more urgent. |
| **Occupancy Grid** | Per-day, per-minute map of booked slots. Accumulates across phases. |
| **Chain** | A deadline task + all its transitive prerequisites via `depends_on`. |
| **Chain Tail** | The task with the explicit deadline (end of the dependency chain). |
| **Solo Anchor** | A chain of size 1 — a deadline task with no prerequisites. |
| **Faux Deadline** | An inherited deadline propagated backward from a chain tail to its predecessors. |
| **Chain Rollback** | When a deadline tail can't fit because predecessors consumed capacity: unplace the chain, re-place tail-first. |
| **Day-Locked** | A recurring instance that must place on its assigned occurrence date (cannot roam). |
| **FlexWhen** | A task flag allowing the scheduler to relax `when`-window constraints as a fallback. |
| **TPC** | Times-Per-Cycle — a recurring overlay where N occurrences must fit within M eligible days (e.g., 3× per week). |
| **`_overdue`** | Flag set when a task is placed past its deadline (slack < 0, deadline ceiling dropped). |
| **`_whenRelaxed`** | Flag set when a task's when-window was relaxed to "anytime" during fallback. |
| **`_conflict`** | Flag set when a rigid/fixed task is force-placed overlapping existing occupancy. |
| **`_unplacedReason`** | Machine-readable reason string for tasks that couldn't be placed. |
| **`_unplacedDetail`** | Human-readable explanation for unplaced tasks, surfaced in the UI. |
| **`isFixedWhen`** | Boolean — true for non-recurring fixed tasks (never reset, never moved). |
| **`isRigid`** | Boolean — true for recurring fixed tasks (placed at anchor, can be force-placed with `_conflict`). |
| **`preferLatestSlot`** | Flag for recurring tasks whose anchor time has passed — places at end-of-day instead of earliest. |
| **`ignoreDeadline`** | Fallback flag that removes the deadline ceiling, allowing placement past the deadline. |
| **`relaxWhen`** | Fallback flag that ignores when-window constraints, searching all time blocks. |
| **`tryPlaceAtTime`** | Method used by Phase 0 to place items at exact times (no search). |
| **`tryPlaceQueued`** | Method used by Phases 1–2 with the 4-level fallback ladder. |
| **`findEarliestSlot`** | Forward search: earliest free slot within constraints. |
| **`findLatestSlot`** | Backward search: latest free slot (for past-anchored recurring tasks). |
| **`placeSplitInline`** | Inline split placement for non-recurring split tasks (creates chunks on demand). |
| **`dayOcc`** | The occupancy grid data structure — `{ [dateKey]: { [minute]: true } }`. |
| **`GRID_START`** | 6 (6:00 AM) — earliest minute in the scheduling grid. |
| **`GRID_END`** | 22 (10:00 PM) — latest minute in the scheduling grid. |
| **`RECUR_EXPAND_DAYS`** | 14 — how many days ahead recurring instances are expanded. |
| **`DEBOUNCE_MS`** | 2000 — debounce window for the schedule queue poller. |

---

*This document is maintained alongside `SCHEDULER.md` (design) and `SCHEDULER-RULES.md` (canonical rules). For implementation details, see `src/scheduler/unifiedScheduleV2.js` and `src/slices/scheduler/domain/`.*
