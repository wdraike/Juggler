# Juggler Scheduler — Full Structured Test Specs
## Adversarial Review Gap Fixes: CONTRA-1, G-001, G-005, G-006, G-030

**Updated:** 2026-06-15
**Scope:** TS-301 through TS-313
**Audience:** Developers implementing test coverage for HIGH-severity gaps identified in ADVERSARIAL-REVIEW-GAPS.md

---

## Format Legend

Each test spec includes:
- **ID** — Test scenario identifier (TS-301 onward)
- **Domain** — Feature area
- **Title** — One-line description
- **Data Setup** — Preconditions, clock, master task config, existing instances
- **Action** — What triggers the behavior (scheduler run / status change / API call / MCP call)
- **Expected Outcome** — What must happen (instances generated, placements, statuses, errors)
- **Sub-scenarios** — Related edge cases that should also be covered

---

## CONTRA-1: Fixed + Recurring Contradiction

**Context:** The master tree (TASK-SETTINGS-TREE.md §2.4) declares `fixed + recurring` invalid — UI blocks, no server enforcement (GAP O7). However, placement mode specs TS-45 and TS-51 eagerly test it as valid behavior. Per R11.4, recurrence is *orthogonal* to placement mode, and the backend code already has `isRigid` logic that handles fixed recurring. The resolution — documented here — is to cover BOTH current state (UI-only block, no backend enforcement) AND desired state (backend 400 rejection after GAP O7 fix).

---

### TS-301: Fixed + recurring via UI — UI blocks, returns error before API call

**Domain:** Placement Modes / Fixed / Recurring / UI Enforcement
**Title:** UI blocks fixed+recurring combination at selection time, never reaches API

**Data Setup:**
- Clock: `2026-06-15T08:00:00Z` (Monday)
- User config: default time_blocks (weekday: morning 360-480, biz1 480-720, biz2 720-900, afternoon 900-1080)
- Task creation form: user selects `placementMode: 'fixed'` and sets time `7:00 AM`
- Task recurrence toggle: user switches `recurring: true`
- **OR** user first sets `recurring: true`, then tries to change `placementMode` to `'fixed'`
- Frontend state: both `recurring=true` and `placementMode='fixed'` would be simultaneously active

**Action:** User attempts to save the task with both `recurring: true` AND `placementMode: 'fixed'`

**Expected Outcome:**
- UI shows inline validation error: "Fixed mode not available for recurring tasks"
- Submit button disabled or save returns frontend-side error
- No API call is made to the backend
- The task is NOT created (remains in unsaved draft state)
- Console or toast message explains the combination is invalid

**Sub-scenarios:**
- [SUB-301a] User sets `fixed` first, then enables `recurring` → toggle rebound: recurring toggle shows warning, reverted to non-recurring or blocks the toggle
- [SUB-301b] User sets `recurring` first, then selects `fixed` → dropdown shows `fixed` as disabled/greyed-out option; selecting it blocked
- [SUB-301c] User edits existing non-recurring fixed task, enables `recurring` → save blocked, error shown
- [SUB-301d] User edits existing recurring anytime task, changes to `fixed` → save blocked, error shown
- [SUB-301e] Bulk import / CSV import with fixed+recurring → row-level validation rejects on frontend, error reported per row

---

### TS-302: Fixed + recurring via API (bypassing UI) — currently accepted by backend (no server enforcement — GAP O7)

**Domain:** Placement Modes / Fixed / Recurring / Backend Enforcement
**Title:** Direct API create/update with fixed+recurring succeeds (current known gap)

**Data Setup:**
- Clock: `2026-06-15T08:00:00Z` (Monday)
- User config: default time_blocks, default tool_matrix
- User token with write access
- No existing instances

**Action:** Call POST `/api/tasks` or PUT `/api/tasks/:id` directly (e.g. via curl, Postman, or MCP bypassing the UI) with payload:
```json
{
  "text": "Fixed recurring task",
  "dur": 30,
  "pri": "P3",
  "placementMode": "fixed",
  "time": "7:00 AM",
  "recurring": true,
  "recur": { "type": "daily" },
  "recurStart": "2026-06-15"
}
```

**Expected Outcome (current, pre-fix):**
- Task is CREATED successfully — HTTP 201/200, no error
- `placementMode` stored as `'fixed'`, `recurring` stored as `true`
- Backend validation does NOT reject the combination
- The task appears in the scheduler queue as a recurring fixed task
- Per code: `isRigid=true` (line 430), `isFixedWhen=false` (line 272: `fixed = pm === PLACEMENT_MODES.FIXED && !t.recurring`)
- Scheduler run: instances generated with `isRigid=true`, each day-locked, each placed at 7:00 AM with `_conflict=true` if slot occupied
- **This is the current accepted behavior that GAP O7 identifies as needing a fix**

**Sub-scenarios:**
- [SUB-302a] API create with `fixed + recurring + time = 7:00 AM` → task created, scheduler places at 7 AM on each occurrence date
- [SUB-302b] API create with `fixed + recurring + no time specified` → falls back to anytime per TS-46 logic; task created
- [SUB-302c] API update: change existing recurring task's `placementMode` to `'fixed'` via PUT → accepted, task now fixed+recurring
- [SUB-302d] API update: change existing fixed task's `recurring` to `true` via PUT → accepted, task now fixed+recurring
- [SUB-302e] MCP `tasks.create` with fixed+recurring → accepted (via API, same path as direct HTTP) — see also TS-303
- [SUB-302f] Batch import API with fixed+recurring row → accepted for each row

---

### TS-303: Fixed + recurring via MCP — currently accepted (same lack of enforcement)

**Domain:** MCP / Placement Modes / Fixed / Recurring
**Title:** MCP `tasks.create` or `tasks.update` with fixed+recurring succeeds (same GAP O7 gap)

**Data Setup:**
- Clock: `2026-06-15T08:00:00Z` (Monday)
- User config: default time_blocks, default tool_matrix
- MCP session authenticated with user token

**Action:** MCP client calls `tasks.create` or `tasks.update` with:
```
{
  "text": "MCP fixed recurring",
  "dur": 45,
  "placementMode": "fixed",
  "time": "9:00 AM",
  "recurring": true,
  "recur": { "type": "weekly", "days": "MWF" },
  "recurStart": "2026-06-15"
}
```

**Expected Outcome (current, pre-fix):**
- MCP returns success — task created/updated
- No validation error returned by MCP server
- MCP calls the same backend API endpoint (no additional validation layer)
- Task stored with `placementMode='fixed'`, `recurring=true`
- Scheduler behavior identical to TS-302
- **This is the same GAP O7 gap exposed through MCP interface**

**Sub-scenarios:**
- [SUB-303a] MCP `tasks.update` on existing task: set `placementMode='fixed'` on recurring task → succeeds
- [SUB-303b] MCP `tasks.update` on existing task: set `recurring=true` on fixed task → succeeds
- [SUB-303c] MCP bulk operation with mixed valid+invalid modes → all accepted, no rejections
- [SUB-303d] MCP creates task without specifying `time` → `time` defaults to null → anchorMin=null → fallback to anytime placement per TS-46 (still accepted, just behaves differently)

---

### TS-304: Fixed + recurring — after backend validation fix → 400 rejected via all paths

**Domain:** Placement Modes / Fixed / Recurring / Backend Enforcement
**Title:** After GAP O7 fix, all paths (API/MCP/UI) reject fixed+recurring with 400

**Data Setup:**
- Clock: `2026-06-15T08:00:00Z` (Monday)
- User config: default time_blocks, default tool_matrix
- **Prerequisite:** Backend validation fix applied — server now rejects `placementMode='fixed'` with `recurring=true` at the validation layer
- User token with write access

**Action:** Attempt to create/update a task with both `placementMode='fixed'` AND `recurring=true` via:
1. **POST** `/api/tasks` (direct API call)
2. **MCP** `tasks.create`
3. **UI** submit (even if UI somehow doesn't block — e.g. legacy frontend or bypass)

**Expected Outcome (post-fix):**
- All paths return HTTP 400 (or equivalent error)
- Response body includes:
  ```json
  {
    "error": "invalid_combination",
    "message": "Fixed placement mode is not compatible with recurring tasks",
    "fields": ["placementMode", "recurring"]
  }
  ```
- Task is NOT created or updated — no side effects
- Backend validation runs BEFORE any DB write
- Validation is at the Zod/schema layer or equivalent early guard
- Existing fixed+recurring tasks (created before fix) remain unchanged — migration or separate cleanup handles pre-existing data

**Sub-scenarios:**
- [SUB-304a] POST create with fixed+recurring → 400, task not created
- [SUB-304b] PUT update: change existing recurring task's `placementMode` to `'fixed'` → 400, unchanged
- [SUB-304c] PUT update: change existing fixed task's `recurring` to `true` → 400, unchanged
- [SUB-304d] MCP create/update with fixed+recurring → MCP returns error propagated from backend 400
- [SUB-304e] Batch import: one row has fixed+recurring → that row rejected with 400, other rows processed independently
- [SUB-304f] Pre-existing fixed+recurring task (created before fix) → still exists, not auto-deleted; next edit triggers validation
- [SUB-304g] UI attempts submit via API (if frontend guard fails) → backend 400 backstops; error displayed to user

---

## G-001: TPC Fill Policy — Cancel/Skip Discrepancy

**Context:** TS-86 SUB-86b says "cancel counts as fulfilled in backfill" but TS-93 says "cancel does NOT block spacing." This means cancel counts as *fulfilled* for TPC counting (blocking refill under backfill) but does NOT update spacing history. These are TWO different "fulfilled" concepts. The confirmed behavior from brain fact 59971: "The TPC backfill policy DOES open a slot (skip counts as unfulfilled)." Cancel semantics for TPC counting need explicit definition.

---

### TS-305: TPC backfill, 1 cancel + 1 done → cancel opens slot? Need definition

**Domain:** TPC / Fill Policy / Cancel
**Title:** TPC backfill: cancel does NOT count as fulfilled → slot opens (defined behavior)

**Data Setup:**
- Clock: `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'TPC cancel test', dur: 30, pri: P3, placementMode: 'anytime', recurring: true, recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 3 }, recurStart: '2026-06-15', fillPolicy: 'backfill' }`
- Existing: one cancelled instance on 2026-06-15 (Mon, status='cancel'), one done on 2026-06-16 (Tue, status='done')
- No other existing instances
- cycleDays=7, tpc=3

**Action:** Run expandRecurring with pendingBookedByDate and fillPolicy='backfill'

**Expected Outcome:**
- `totalFulfilled` count: 1 (done only; cancel does NOT count as fulfilled for TPC counting)
- `neededPicks` = tpc - totalFulfilled = 3 - 1 = 2
- The cancelled slot on 2026-06-15 OPENS — a new pick is generated for that day or another available day
- Two new instances emitted: one fills the cancel-opened slot, one fills the third (never-booked) slot
- Total instances after run: 1 existing done + 2 new picks = 3 total (tpc=3 satisfied)

**NOTE:** This test establishes the DEFINED behavior: cancel does NOT count as fulfilled for TPC counting under backfill policy. This resolves the ambiguity in TS-86 SUB-86b.

**Sub-scenarios:**
- [SUB-305a] Backfill: 2 cancel + 1 done → 3 slots to fill (tpc=3, 0 fulfilled, 3 needed) → 3 new picks
- [SUB-305b] Backfill: 3 cancel + 0 done → 3 slots to fill (all cancelled, none count as fulfilled) → 3 new picks
- [SUB-305c] Backfill: 1 cancel + 2 done → 0 slots to fill (tpc=3 - 2 done = 1? No, tpc=3 - 2 = 1 needed) → 1 new pick (cancel doesn't count, but 2 done count)
- [SUB-305d] Backfill: 3 done + 0 cancel → 0 new picks (cycle full)
- [SUB-305e] Backfill: all cancel + all took their scheduled_at already → the cancel-opened slots' target dates may have passed → scheduler must pick new dates within the cycle

---

### TS-306: TPC cancel does NOT update spacing history → new pick may violate minGap

**Domain:** TPC / Spacing History / Cancel
**Title:** Cancel does NOT seed `lastByMaster` — new flexible TPC pick can land adjacent to done instance

**Data Setup:**
- Clock: `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Cancel spacing hole', dur: 30, pri: P3, placementMode: 'time_blocks', isFlexibleTpc: true, recurring: true, recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 2 }, recurStart: '2026-06-15', fillPolicy: 'backfill' }`
- recurringHistoryByMaster (last done): `{ 'master-1': '2026-06-17' }` — done on Wednesday
- Existing cancelled instance on 2026-06-15 (Mon) — cancelled, unrelated to spacing
- minGap = max(1, floor(7*0.5)) = 3
- Today = 2026-06-15 (Mon) — scheduler generating for 14-day horizon

**Action:** Run scheduler (findEarliestSlot for flexible TPC item with backfill generating a new pick)

**Expected Outcome:**
- `lastByMaster` = `'2026-06-17'` (Wed) — only done instances count; cancel does NOT update spacing history
- Spacing guard blocks days adjacent to 2026-06-17: Thu 6/18, Fri 6/19, Sat 6/20 are within 3 days of last done
- First eligible day after spacing guard: 2026-06-20+ = 2026-06-21 (Sun) — or earlier if safety valve activates
- The cancel-opened slot on 2026-06-15 (Mon) IS eligible for the new pick — it's 2 days BEFORE the last done (2026-06-17) and the spacing guard only checks forward (lastDone + minGap = 2026-06-20)
- **New pick COULD land on 2026-06-15** (the cancelled date) if that day has available blocks — this is ADJACENT to the done instance at 2026-06-17 with no spacing violation since the guard only blocks FORWARD from last done
- The spacing guard does NOT prevent backward placement relative to lastByMaster

**Sub-scenarios:**
- [SUB-306a] Cancel on 2026-06-15, done on 2026-06-16 → new pick on 2026-06-15 (cancel-opened) is adjacent to done at 2026-06-16 — minGap=3 but only forward check, so Tuesday-adjacent Monday is allowed
- [SUB-306b] Cancel on 2026-06-19 (Fri), done on 2026-06-15 (Mon) → new pick on 2026-06-19 (cancel-opened) is 4 days after last done — passes spacing guard (4 ≥ 3)
- [SUB-306c] Cancel + done on same day → cancel doesn't affect spacing, done on same day does
- [SUB-306d] Multiple cancels, one done → only done seeds spacing history
- [SUB-306e] Cancel on same day as last done → cancel doesn't update spacing, lastByMaster unchanged

---

### TS-307: TPC skip does NOT count as fulfilled (keep policy) → no new pick; skip does NOT update spacing

**Domain:** TPC / Fill Policy / Skip / Keep
**Title:** Keep policy: skip counts as kept-slot (no new pick), does NOT update spacing history

**Data Setup:**
- Clock: `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Keep skip test', dur: 30, pri: P3, placementMode: 'anytime', recurring: true, recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 3 }, recurStart: '2026-06-15', fillPolicy: 'keep' }`
- Existing: one skipped instance on 2026-06-15 (Mon), one done on 2026-06-16 (Tue)
- cycleDays=7, tpc=3

**Action:** Run expandRecurring with pendingBookedByDate and fillPolicy='keep'

**Expected Outcome:**
- `totalFulfilled` count: 1 (done only — keep policy treats skip as "we kept the slot, user opted out")
- `neededPicks` = tpc - totalFulfilled = 3 - 1 = 2
- BUT under keep policy, skip preserves the slot — the skipped date 2026-06-15 is NOT refilled
- Only 1 new pick generated (for the third slot that was never filled)
- Total instances: 1 existing done + 1 existing skip (kept) + 1 new pick = 3
- Spacing history: only the done at 2026-06-16 counts; skip does NOT seed `lastByMaster`

**Sub-scenarios:**
- [SUB-307a] Keep: 2 skip + 1 done → 0 new picks (all 3 slots kept/fulfilled)
- [SUB-307b] Keep: 3 skip + 0 done → 0 new picks (all slots preserved, none counted as fulfilled for generation)
- [SUB-307c] Keep: 0 skip, 1 done, 2 pending (from previous expansion) → pending emitted, no new picks
- [SUB-307d] Keep: skip on date already pending in pendingBookedByDate → pending wins (already materialized)
- [SUB-307e] Keep: all skip across 3 cycles → week 1: 3 skip (0 done), week 2: still 3 skip → no new picks ever, but still 3 instances per cycle

---

### TS-308: TPC skip opens slot (backfill policy) → new pick generated, no spacing guard from skip

**Domain:** TPC / Fill Policy / Skip / Backfill
**Title:** Backfill policy: skip opens slot → new pick generated; skip does NOT update spacing history

**Data Setup:**
- Clock: `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Backfill skip test', dur: 30, pri: P3, placementMode: 'anytime', isFlexibleTpc: true, recurring: true, recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 3 }, recurStart: '2026-06-15', fillPolicy: 'backfill' }`
- Existing: one skipped instance on 2026-06-15 (Mon), one done on 2026-06-16 (Tue; lastByMaster = '2026-06-16')
- minGap = 3
- cycleDays=7, tpc=3

**Action:** Run expandRecurring with backfill and pendingBookedByDate

**Expected Outcome:**
- `totalFulfilled` = 1 (done only — backfill policy: skip does NOT count as fulfilled)
- `neededPicks` = tpc - totalFulfilled = 3 - 1 = 2
- Skip-opened slot on 2026-06-15 → backfill generates a new pick
- Total 2 new picks generated (one for skip-opened slot, one for third slot)
- Spacing: lastByMaster = '2026-06-16' (Tue) — only done counts
- New pick could land on 2026-06-15 (Mon, the skip date) since spacing guard only blocks forward from 2026-06-16
- If new pick lands on 2026-06-15 and another on 2026-06-18 (Thu, 2 days after done), both are placed — the cancel/skip doesn't guard, only done guards

**Sub-scenarios:**
- [SUB-308a] Backfill: 3 skip → 3 new picks generated, none guided by spacing history (no done exists)
- [SUB-308b] Backfill: 1 skip + 2 done → 0 new picks (tpc=3 - 2 done = 1 needed; skip opened slot but this is within the 1 needed; actually: totalFulfilled=2 (done), neededPicks=1 → only 1 new pick. The skip doesn't add an extra pick beyond the needed 1)
- [SUB-308c] Backfill: skip on last day of cycle → new pick roams to any eligible day (flexible TPC)
- [SUB-308d] Backfill: skip on day that is also pending in pendingBookedByDate → pending overrides, no new pick (pending preserves existing scheduled_at)
- [SUB-308e] Backfill skip + isFlexibleTpc=false → new pick day-locked to skip's original occurrence date (rigid) → if that day is past, unplaced

---

## G-005: Split Status Propagation — Speculative Rule Clarification

**Context:** TS-126af asserts marking one chunk done propagates to all chunks in the same occurrence_ordinal. TS-126al acknowledges uncertainty about non-recurring inline chunks vs recurring pre-materialized chunks. The code path difference needs explicit documentation and tests.

---

### TS-309: Recurring split, mark one chunk done → all chunks in same occurrence_ordinal get done (confirmed behavior for pre-materialized chunks)

**Domain:** Split × Status / Recurring
**Title:** Recurring pre-materialized split: marking one chunk done propagates to all sibling chunks in same occurrence

**Data Setup:**
- Clock: `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Recurring split done propagation', dur: 120, split: true, split_min: 30, recurring: true, recur: { type: 'daily' }, recurStart: '2026-06-15' }`
- Occurrence on 2026-06-15 (ordinal=1): 4 pre-materialized chunks (all pending, all with `split_group='master-1-2026-06-15'` and `occurrence_ordinal=1`)
  - Chunk 1: ordinal=1, scheduled_at=08:00-08:30, status=''
  - Chunk 2: ordinal=2, scheduled_at=08:30-09:00, status=''
  - Chunk 3: ordinal=3, scheduled_at=09:00-09:30, status=''
  - Chunk 4: ordinal=4, scheduled_at=09:30-10:00, status=''
- Occurrence on 2026-06-16 (ordinal=2): separate 4 chunks (should NOT be affected)

**Action:** User marks Chunk 1 (ordinal=1 of occurrence 1) status as 'done' via API or UI

**Expected Outcome:**
- Chunk 1: status='done'
- Chunk 2: status='done' (propagated — same split_group, same occurrence_ordinal)
- Chunk 3: status='done' (propagated)
- Chunk 4: status='done' (propagated)
- Occurrence 2 (2026-06-16): all chunks unchanged (still 'pending')
- Propagation occurs via the status-change API handler: the handler finds all rows with matching `split_group` and `occurrence_ordinal` and updates them atomically
- Rolling anchor (if applicable): updated to instanceDate
- The DB transaction is atomic — all 4 updates succeed or none do

**Sub-scenarios:**
- [SUB-309a] Mark middle chunk (ordinal=2) done → all 4 propagate (same behavior regardless of which chunk is marked)
- [SUB-309b] Mark last chunk (ordinal=4) done → all 4 propagate
- [SUB-309c] Mark chunk done when one sibling already done → all remaining get done (idempotent; the already-done sibling unchanged)
- [SUB-309d] Mark chunk done with `time_remaining` set → time_remaining overrides dur for that chunk only; propagation still sets all to done (time_remaining irrelevant on terminal status)
- [SUB-309e] Occurrence 1 done, Occurrence 2 remains pending → cross-occurrence independence confirmed

---

### TS-310: Non-recurring inline split, mark one chunk done → does NOT propagate (inline chunks are independent)

**Domain:** Split × Status / Non-Recurring / Inline
**Title:** Non-recurring inline split: marking one chunk done does NOT propagate to sibling chunks

**Data Setup:**
- Clock: `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Non-recurring inline split', dur: 120, split: true, split_min: 30, recurring: false }`
- Chunks created inline (not pre-materialized; each chunk is a separate DB row created on-the-fly during split)
  - Chunk 1: ordinal=1, scheduled_at=08:00-08:30, status='', split_group='master-1'
  - Chunk 2: ordinal=2, scheduled_at=08:30-09:00, status='', split_group='master-1'
  - Chunk 3: ordinal=3, scheduled_at=09:00-09:30, status='', split_group='master-1'
  - Chunk 4: ordinal=4, scheduled_at=09:30-10:00, status='', split_group='master-1'
- **Important:** Non-recurring inline chunks are INDEPENDENT rows not bound by occurrence_ordinal propagation rules

**Action:** User marks Chunk 1 status as 'done'

**Expected Outcome:**
- Chunk 1: status='done'
- Chunk 2: status='' (unchanged — still pending)
- Chunk 3: status='' (unchanged)
- Chunk 4: status='' (unchanged)
- **No propagation** — inline split chunks are independent; the status-change API handler only updates the specific chunk ID
- The status-change handler does NOT look up sibling chunks by split_group for non-recurring tasks
- All chunks remain in the scheduler queue; uncompleted chunks still occupy their slots
- If user wants all chunks done, they must mark each individually (or the system marks remaining on eventual completion)

**Sub-scenarios:**
- [SUB-310a] Mark chunk 2 done → only chunk 2 changed, rest unaffected
- [SUB-310b] Mark all 4 chunks done individually → all become done (independent updates)
- [SUB-310c] Mark chunk 1 done, then run scheduler → chunk 1 done, chunks 2-4 still pending and occupy slots; scheduler sees chunks 2-4 as still scheduled
- [SUB-310d] Mark chunk 1 done, user sets time_remaining on chunk 2 → both independent operations, no interference
- [SUB-310e] Mark chunk 1 done, then delete chunk 2 → deletion independent, chunk 1 stays done

---

### TS-311: Split chunk marked WIP → time_remaining affects that chunk only, others unaffected

**Domain:** Split × Status / WIP / Time Remaining
**Title:** WIP marking on one chunk affects only that chunk's time_remaining; sibling chunks unchanged

**Data Setup:**
- Clock: `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'WIP time remaining test', dur: 180, split: true, split_min: 30, recurring: false }`
- Chunks:
  - Chunk 1: ordinal=1, scheduled_at=08:00-08:30, dur=30, status=''
  - Chunk 2: ordinal=2, scheduled_at=08:30-09:00, dur=30, status=''
  - Chunk 3: ordinal=3, scheduled_at=09:00-09:30, dur=30, status=''
  - Chunk 4: ordinal=4, scheduled_at=09:30-10:00, dur=30, status=''
  - Chunk 5: ordinal=5, scheduled_at=10:00-10:30, dur=30, status=''
  - Chunk 6: ordinal=6, scheduled_at=10:30-11:00, dur=30, status=''

**Action:** User marks Chunk 3 as 'wip' and sets `time_remaining=15` (15 minutes of work left of the original 30)

**Expected Outcome:**
- Chunk 3: status='wip', `time_remaining=15` — effective remaining duration = 15 min
- Chunk 1: status='' (unchanged), no time_remaining
- Chunk 2: status='' (unchanged), no time_remaining
- Chunk 4: status='' (unchanged), no time_remaining
- Chunk 5: status='' (unchanged), no time_remaining
- Chunk 6: status='' (unchanged), no time_remaining
- Total effective duration remaining for the task: 30 + 30 + 15 + 30 + 30 + 30 = 165 min (chunk 3's effective dur reduced to 15)
- On next scheduler run: chunk 3's slot may shrink from 30 min to 15 min — freeing 15 min in the 09:00-09:30 block for other tasks
- The scheduler reads `time_remaining` per-chunk and adjusts occupancy calculations independently

**Sub-scenarios:**
- [SUB-311a] WIP + time_remaining=0 on chunk 3 → chunk 3 effectively done (0 remaining); sibling chunks unchanged
- [SUB-311b] WIP on multiple chunks with different time_remaining values → each independently tracked
- [SUB-311c] WIP + time_remaining > dur → capped at original dur (chunk can't have more remaining than total)
- [SUB-311d] WIP on recurring split chunk → time_remaining affects that occurrence's chunk only; other occurrences unaffected
- [SUB-311e] WIP → done transition (time_remaining reaches 0 → auto 'done') → if non-recurring, no propagation (per TS-310); if recurring, propagation occurs (per TS-309)

---

### TS-312: Split chunk marked done before all chunks placed → remaining chunks still placed

**Domain:** Split × Status / Early Completion
**Title:** Marking a split chunk done before all chunks materialized → remaining chunks still created and placed

**Data Setup:**
- Clock: `2026-06-15T08:00:00Z` (Monday), horizon = 14 days
- Master: `{ id: 'master-1', text: 'Early completion split', dur: 180, split: true, split_min: 30, recurring: true, recur: { type: 'daily' }, recurStart: '2026-06-15' }`
- Chunks for occurrence 1 (2026-06-15): 4 of 6 chunks materialized (scheduler expanded partial set due to initial slot constraints)
  - Chunk 1: ordinal=1, scheduled_at=08:00-08:30, status=''
  - Chunk 2: ordinal=2, scheduled_at=08:30-09:00, status=''
  - Chunk 3: ordinal=3, scheduled_at=09:00-09:30, status=''
  - Chunk 4: ordinal=4, scheduled_at=09:30-10:00, status=''
  - Chunks 5-6: NOT YET MATERIALIZED (not enough blocks on initial pass)

**Action:** User marks Chunk 1 as 'done'. Then scheduler re-run occurs (status change triggers enqueueScheduleRun).

**Expected Outcome:**
- **Immediate (status change handler):**
  - Chunk 1: status='done'
  - If recurring pre-materialized (TS-309 rule): Chunks 2, 3, 4 also get 'done' (propagated within occurrence 1)
  - Chunks 5-6: don't exist yet, so nothing to propagate to
- **Scheduler re-run:**
  - Occurrence 1 is now fully done (all materialized chunks = done)
  - BUT: Could the scheduler still attempt to materialize chunks 5-6 for occurrence 1? 
    - **Desired behavior:** If the entire occurrence is done, no new chunks should be generated. The scheduler should skip instances already marked 'done' for that occurrence.
  - Occurrence 2 (2026-06-16): 6 chunks generated fresh, placed normally
  - Remaining days continue on schedule

**Sub-scenarios:**
- [SUB-312a] Non-recurring inline: chunk 1 done, chunks 2-4 still pending, chunks 5-6 not materialized → scheduler re-run materializes chunks 5-6 as new pending rows (in addition to 2-4 still pending)
- [SUB-312b] Recurring with some chunks done and some pending on re-run → how does the scheduler treat partially-done occurrences? (Definition needed: partially-done occurrence is either treated as done for all TPC/fulfillment purposes, or remaining chunks are still eligible for placement)
- [SUB-312c] Chunk done via time_remaining=0 auto-transition → same propagation rules apply
- [SUB-312d] Chunk done before any scheduler run (manual creation of chunk with status='done') → other chunks never materialized → occurrence effectively zero-length

---

## G-006: Past Recurring Time_Blocks — Bug Documentation

**Context:** The anytime-only drop filter at line 265 (`if (t.recurring && pm === PLACEMENT_MODES.ANYTIME && t.date && toKey(t.date) < todayIsoKey) return;`) only drops past instances in ANYTIME mode. Time_blocks and time_window recurring instances from past dates are NOT dropped, creating permanently unplaceable instances. This is a KNOWN BUG.

---

### TS-293: Past recurring time_blocks instance — never placed, pending forever (KNOWN BUG)

**Domain:** Recurrence / Time Blocks / Past Instances / Bug
**Title:** Past recurring time_blocks instance (anchorDate < today) not dropped by ANYTIME filter → day-locked to past date → scheduler [today, horizon] scan never reaches it → pending forever

**Data Setup:**
- Clock: `2026-06-17T10:00:00Z` (Wednesday — today is 2026-06-17)
- User config: default time_blocks (weekday: morning 360-480, biz1 480-720, ...)
- Master: `{ id: 'master-1', text: 'Weekly time blocks meeting', dur: 60, pri: P3, placementMode: 'time_blocks', when: 'morning', recurring: true, recur: { type: 'weekly', days: 'T' }, recurStart: '2026-06-08' }`
- **Key detail:** recurStart='2026-06-08' means first occurrence should be 2026-06-09 (Tuesday of last week)
- No existing instances

**Action:** Run scheduler (expandRecurring → unifiedScheduleV2)

**Expected Outcome (current buggy behavior):**
- expandRecurring generates instances for the 14-day horizon: 2026-06-08 (Mon, skip), 2026-06-09 (Tue, first occurrence), 2026-06-16 (Tue, second occurrence)
- Instance for 2026-06-09 (last Tuesday) — `date='2026-06-09'`, `anchorDate='2026-06-09'`
- Line 265 check: `pm === PLACEMENT_MODES.ANYTIME` → FALSE (it's 'time_blocks') → NOT dropped
- Instance enters the placement queue with `isDayLocked=true`, `anchorDate='2026-06-09'`
- Scheduler iterates dates from `todayIsoKey` (2026-06-17) to horizon (2026-06-28)
- The past instance (anchorDate=2026-06-09) falls OUTSIDE the scan range [2026-06-17, 2026-06-28]
- The instance is NEVER placed — it sits in the DB with `status=''` (pending) forever
- Instance for 2026-06-16 (this Tuesday): placed normally in today's blocks
- No error is raised; no `missed` status is assigned
- **This is a known bug — the past-dropping logic is incorrectly scoped to ANYTIME only**

**Expected Outcome (desired post-fix):**
After fix applied (extend past-drop logic to all placement modes, or add a separate past-instance handler):
- Instance with `date='2026-06-09'` and `anchorDate < todayIsoKey` is dropped by the past-instance filter
- **OR** is re-assigned to `date=todayIsoKey` with `_unplacedReason='past_recurring_instance_reassigned'`
- **OR** is auto-marked as 'missed' and a new instance generated for tomorrow
- (Specific fix TBD — this test documents the bug, not the fix)

**Sub-scenarios:**
- [SUB-293a] Past recurring time_window instance → same bug (NOT ANYTIME → not dropped)
- [SUB-293b] Past recurring fixed instance → same bug (NOT ANYTIME → not dropped; anchorMin set but day-locked to past)
- [SUB-293c] Past recurring with isFlexibleTpc=true → flexible but still day-locked to past date → same bug
- [SUB-293d] Past recurring instance that is ALSO the first recurrence → same bug, permanent pending
- [SUB-293e] Multiple past instances (weekly for 3 past weeks) → all 3 pending forever
- [SUB-293f] Past recurring instance with existing 'done' status on that date → dedup ID-reuse: the done instance exists, the pending past instance doesn't get re-created; the done one is fine. Only the NEWLY expanded past instance is buggy
- [SUB-293g] Past instance from 30+ days ago (older than any horizon) → still not dropped → permanent pending

---

## G-030: Cross-Domain Combinations (HIGH Severity)

**Context:** Real-world usage patterns span multiple feature domains simultaneously (e.g., rolling + TPC + split, or dependency + template + weather + rolling). No single-domain test covers these interactions.

---

### TS-299: Rolling recurrence + TPC + split + flex — chunks roam across days within each cycle

**Domain:** Cross-Domain: Rolling × TPC × Split × Flexible
**Title:** Rolling recurrence (intervalDays=14) + TPC=2 + split (dur=180, split_min=60) + isFlexibleTpc=true → chunks roam across selected days within each 14-day cycle

**Data Setup:**
- Clock: `2026-06-15T08:00:00Z` (Monday)

- **User config:** default time_blocks with generous weekday blocks (morning 360-540, biz1 540-720, biz2 720-900, afternoon 900-1080) and weekend blocks (morning 480-600, afternoon 600-720)
- **Tasks:**
  - Master: `{ id: 'master-1', text: 'Biweekly yard project', dur: 180, pri: P3, placementMode: 'time_blocks', when: 'biz1,biz2,afternoon', split: true, split_min: 60, recurring: true, recur: { type: 'rolling', intervalDays: 14, days: 'MTWRFSU', timesPerCycle: 2 }, fillPolicy: 'backfill', isFlexibleTpc: true, recurStart: '2026-06-01', rollingAnchor: '2026-06-01' }`
  - cycleDays = 14, tpc = 2, targetInterval = 14/2 = 7 days
  - minGap = max(1, floor(14*0.5)) = 7
  - Each instance: dur=180, split into 3 chunks of split_min=60 each
- **Existing instances:** None (fresh start at anchor 2026-06-01)

**Action:** Run scheduler (expandRecurring → unifiedScheduleV2) — first-ever run at 2026-06-15

**Expected Outcome:**
- **Step 1 — Recurrence expansion:**
  - horizon = 2026-06-15 to 2026-06-28 (14 days)
  - rollingAnchor = 2026-06-01, so first cycle: 2026-06-01 to 2026-06-14
  - Second cycle starts at 2026-06-15
  - TPC picks 2 target dates within the second cycle (2026-06-15 to 2026-06-28), spaced by ~7 days
  - Target pick 1: ~2026-06-17 (Wed), Target pick 2: ~2026-06-24 (Wed)

- **Step 2 — Placement per target pick:**
  - **Instance 1 (target ~2026-06-17):** 3 split chunks (60 min each)
    - Since `isFlexibleTpc=true` and day-locked? Actually line 415: `isDayLocked = recurring && (pm === PLACEMENT_MODES.FIXED || !isFlexibleTpc)`. Since `pm='time_blocks'` and `isFlexibleTpc=true`, `isDayLocked = false`.
    - Chunks are NOT day-locked — they can roam within the cycle window [cycleStart, cycleStart+cycleDays-1]
    - Chunk 1: placed in first available biz1 block (e.g. 540-600 on 2026-06-17)
    - Chunk 2: placed adjacent or in next available block (e.g. 600-660 on 2026-06-17)
    - Chunk 3: if 2026-06-17 has only 120 min of biz1+biz2 available, chunk 3 roams to next day (2026-06-18) or to afternoon block on same day
    - **Key:** split chunks of a single instance can CROSS DAYS within the cycle window because isDayLocked=false

  - **Instance 2 (target ~2026-06-24):** 3 split chunks
    - Same roaming behavior within the second cycle window
    - minGap=7 from Instance 1 placement ensures Instance 2 doesn't land too close to Instance 1
    - If Instance 1 placed on 2026-06-17, Instance 2 cannot be placed before 2026-06-24 (17+7=24)

- **Step 3 — Rolling anchor update:**
  - After instances placed, anchor remains at 2026-06-01 until user marks 'done'
  - On first 'done' marking, anchor advances to that instanceDate

- Total: 6 chunks (2 instances × 3 chunks), placed across the 14-day cycle with flexible roaming

**Sub-scenarios:**
- [SUB-299a] First cycle (2026-06-01 to 2026-06-14) has no space → second cycle (2026-06-15+) gets both TPC picks
- [SUB-299b] isFlexibleTpc=false → chunks day-locked to target date; if target date lacks capacity for all 3 chunks → partial_split with recurring_split_overflow
- [SUB-299c] fillPolicy=keep + skip on first TPC pick → that slot kept (no new pick), second pick still placed
- [SUB-299d] fillPolicy=backfill + skip on first TPC pick → new pick generated, roams to available day
- [SUB-299e] Weather constraint added: `weather_precip='dry_only'` + rain on 2026-06-17 → chunks roam to next dry day
- [SUB-299f] Rolling anchor advances mid-cycle (user marks done on first instance) → second instance's cycle boundary adjusts dynamically
- [SUB-299g] TPC picks both cluster in same week (e.g. 6/17 and 6/19) → chunks for both instances compete for same blocks

---

### TS-300: Rolling task depends on one-off task → template + weather shift affects dep chain

**Domain:** Cross-Domain: Dependency × Template × Weather × Rolling
**Title:** Rolling task B depends on one-off task A → template change shifts A's available blocks → weather rejects A's original slot → A re-placed → B's depReadyAbs changes → B re-placed

**Data Setup:**
- Clock: `2026-06-15T08:00:00Z` (Monday), simulating a dry morning
- **User config:**
  - Default template: morning block 360-480, biz1 480-720, afternoon 720-960
  - Template change at T+1: morning block shifts to 480-600 (starts later)
- **Weather:** Simulated weather provider for user's home location
  - Morning (06:00-08:00): 80% precip (wet)
  - Biz1 (08:00-10:00): 10% precip (dry)
  - Biz2 (10:00-12:00): 60% precip (wet)
  - Afternoon (12:00-16:00): 15% precip (dry)
- **Tasks:**
  - **Task A** (one-off): `{ id: 'task-A', text: 'Buy supplies', dur: 60, pri: P2, placementMode: 'time_blocks', when: 'morning,biz1', weather_precip: 'dry_only' }`
  - **Task B** (rolling): `{ id: 'task-B', text: 'Use supplies', dur: 90, pri: P2, placementMode: 'anytime', recurring: true, recur: { type: 'rolling', intervalDays: 7 }, dependsOn: 'task-A', rollingAnchor: '2026-06-08' }`
- **Existing instances:** None

**Action — Step 1:** Run scheduler with initial template (morning 360-480)
**Action — Step 2:** Apply template change (morning shifts to 480-600) + weather data → scheduler re-run

**Expected Outcome — Step 1 (initial run):**
- Task A (one-off) enters Phase 3 (deadline slack) or Phase 1 (slack sort)
- Scheduler evaluates A's available windows with weather:
  - Morning (360-480): 80% precip → FAIL (weather blocks)
  - Biz1 (480-720): 10% precip → PASS → A placed at first biz1 slot (480-540)
- Task A placed: 480-540, depReadyAbs = 480 + 60 = 540
- Task B (rolling) checks dependsOn → depends on task-A
- B's depReadyAbs = task-A's scheduled end = 540
- B cannot start before 540 (9:00 AM) — earliest start = 540
- B placed in afternoon block (720+) or later biz1/biz2 — but biz2 starts at 720, so first available slot at or after 540: 540 or later
- B placed: e.g. 540-630 (biz1 block continues)

**Expected Outcome — Step 2 (template change + weather re-run):**
- Template change: morning block shifts from 360-480 to 480-600
- Scheduler re-run triggered by template change (enqueueScheduleRun)
- **Task A re-placement:**
  - New morning block: 480-600 (previously 360-480)
  - Weather re-checked: 480-600 is in biz1 block (10% precip) → PASS
  - But the new morning block (480-600) is the same as biz1 — consolidated
  - Actually morning block was REMOVED (shifted to 480, overlapping with biz1 start). Let's say morning=480-600, biz1=480-720 — blocks merged/deduplicated
  - Task A still placed at earliest available slot passing weather AND template constraints: 480-540
  - **Same slot** — no change if blocks still have 480 free

- **To force re-placement**, add: template change also REMOVES biz1 block (480-720 becomes unavailable) and adds afternoon-only blocks (720-960). Then:
  - Task A's original slot (480-540) is no longer a template block
  - Task A must move: only afternoon block (720-840) passes weather (15% precip)
  - A re-placed to 720-780
  - depReadyAbs for B changes from 540 to 780

- **Task B re-placement:**
  - B's depReadyAbs moved from 540 to 780 (A's new end time)
  - B's earliest start shifted 4 hours later
  - If B can still find a slot starting at 780+: placed at 780-870
  - If B's interval (7 days) means today is the only available day and 780-870 is beyond available blocks → B unplaced (dependency cascade)

**Sub-scenarios:**
- [SUB-300a] Weather block on ALL available slots for A → A unplaced → B also unplaced (dependency cascade)
- [SUB-300b] Template change adds MORE blocks → A moves to optimal earlier slot → B also moves earlier
- [SUB-300c] Template change + weather change in opposite directions → A blocked on its new template but freed by weather on old template → complex re-placement
- [SUB-300d] B is also rolling with stale guard → A's re-placement delays B past its interval → B's stale guard fires → B unplaced with _unplacedReason='stale_guard'
- [SUB-300e] B depends on A which depends on C (3-level chain) → template+weather cascading through all 3 levels
- [SUB-300f] Template change occurs during B's placement phase (mid-scheduler-run) → not possible; scheduler runs atomically; template change triggers NEW run
- [SUB-300g] A is also rolling recurring → both rolling tasks in a dependency chain → anchor updates cascade

---

### TS-313: Calendar-synced split task + weather → chunk moves → merged event breaks

**Domain:** Cross-Domain: Calendar Sync × Split × Weather
**Title:** Calendar-synced split task (3 contiguous chunks merged to 1 event) → weather changes, chunk 2 moves → unmerge: new events created, old event deleted

**Data Setup:**
- Clock: `2026-06-15T08:00:00Z` (Monday)
- **User config:** default time_blocks (biz1 480-720, biz2 720-900, afternoon 900-1080); calendar sync enabled (GCal or MSFT)
- **Weather (initial):**
  - 08:00-10:00: 10% precip (dry)
  - 10:00-12:00: 10% precip (dry)
  - 12:00-14:00: 10% precip (dry)
- **Weather (updated):**
  - 08:00-10:00: 10% precip (dry)
  - 10:00-12:00: 90% precip (rain — FAILS dry_only)
  - 12:00-14:00: 10% precip (dry)
- **Tasks:**
  - Master: `{ id: 'master-1', text: 'Yard project', dur: 90, pri: P3, placementMode: 'anytime', split: true, split_min: 30, weather_precip: 'dry_only', calendarSync: true }`
  - calendarSync=true means task is pushed as external calendar event
- **Initial scheduler run (weather dry all morning):**
  - 3 chunks created, all contiguous:
    - Chunk 1: 08:00-08:30 (ordinal 1)
    - Chunk 2: 08:30-09:00 (ordinal 2)
    - Chunk 3: 09:00-09:30 (ordinal 3)
  - Calendar sync: 3 contiguous chunks detected → MERGED into a single calendar event at 08:00-09:30 (90 min)
  - External calendar has 1 event: "Yard project" at 08:00-09:30

**Action:** Weather changes (10:00-12:00 becomes 90% precip). Scheduler re-run triggered.

**Expected Outcome:**
- **Step 1 — Weather re-evaluation:**
  - Chunk 1 (08:00-08:30): 10% precip → PASS (stays)
  - Chunk 2 (08:30-09:00): 10% precip → PASS (stays) — wait, chunk 2 is at 08:30-09:00, weather at 08:00-10:00 is still 10% precip
  - Let me adjust: the rain hits at 09:30. Actually, let's make chunk 2 in the rainy period.
  
- **Revised setup for clearer result:**
  - Chunk 1: 08:00-08:30 (biz1, dry 10%)
  - Chunk 2: 10:30-11:00 (biz2, now 90% rain — FAILS)
  - Chunk 3: 11:00-11:30 (biz2, 90% rain — FAILS)
  
  Wait, chunks are initially contiguous at 08:00-09:30. Let me work with that.

  **Better setup:** Weather changes such that the EXISTING slot for chunk 2 or 3 becomes weather-failed, forcing re-placement. Use `weather_precip='dry_only'` (threshold 20%).

  Initial weather: all hours 10% → all pass
  Changed weather: 
    - 08:00-08:30: 10% (pass)
    - 08:30-09:00: 10% (pass)
    - 09:00-09:30: 10% (pass)
    - 09:30-10:00: 90% (fail)
    - 10:00-10:30: 90% (fail)

  Hmm, if all 3 chunks pass, no re-placement needed. Let me make chunk 2's time slot weather-fail.

  **Better:**
  - Initial placement: Chunks 1-3 at 08:00-09:30 (contiguous)
  - Weather update: 08:00-08:30 dry, 08:30-10:00 wet (80%), 10:00+ dry
  - Chunk 2 (08:30-09:00) now fails weather
  - Chunk 3 (09:00-09:30) also fails
  
  **Or simpler:** The weather change happens at a very specific hour boundary covering only chunk 2.
  - Weather update: 08:30 hour goes from 10% to 90% precip
  - Chunk 2 (08:30-09:00) now fails
  - Chunk 1 (08:00-08:30) passes
  - Chunk 3 (09:00-09:30) passes
  - Chunk 2 must move to a new slot (e.g., 10:00-10:30, which is dry)

- **Step 2 — Chunk re-placement:**
  - Chunk 2 re-placed from 08:30-09:00 to e.g. 10:00-10:30
  - Chunks are now: 08:00-08:30, 10:00-10:30, 09:00-09:30
  - **Not contiguous** — Chunk 3 (09:00-09:30) is still between 1 and 2 in time but at a different location (stays contiguous with 1 but not with 2)
  - Actually the chunks are now in order: [1 (08:00-08:30), 3 (09:00-09:30), 2 (10:00-10:30)] — no longer all contiguous

- **Step 3 — Calendar sync unmerge:**
  - Sync code detects: the 3 chunks were previously merged as 1 event, but are now non-contiguous
  - **Old event deleted:** The single 90-min event "Yard project" at 08:00-09:30 is deleted from external calendar
  - **New events created:** 3 separate events created, one per chunk, at their new times
    - Event 1: "Yard project (part 1)" at 08:00-08:30
    - Event 2: "Yard project (part 2)" at 09:00-09:30 (this was chunk 3, now a standalone event)
    - Event 3: "Yard project (part 3)" at 10:00-10:30
  - External calendar correctly shows 3 separate events instead of 1 merged event
  - No orphan calendar events remain (the old merged event is fully removed)

**Sub-scenarios:**
- [SUB-313a] Weather change causes chunk 2 AND chunk 3 to move → all 3 chunks non-contiguous → 3 separate events
- [SUB-313b] Weather change causes chunk 2 to move but chunk 3 also happens to move into the slot adjacent to chunk 2 → chunks 2 and 3 are now contiguous → merge into 1 event; chunk 1 stays separate → total 2 events
- [SUB-313c] Weather change causes ONLY chunk 1 to change (move to 08:30-09:00) → all 3 chunks still contiguous at different times → old event deleted, new merged event created for new times
- [SUB-313d] Weather change + chunk 2 moves to next day (cross-day) → now chunks are on different days → each chunk becomes a separate day-specific event
- [SUB-313e] One chunk 'done' status (via TS-309/310) while other chunks move → calendar must reflect partial completion (e.g., done chunk event deleted or marked completed)
- [SUB-313f] Calendar sync conflict: external calendar already has a manually created event at chunk 2's new time → sync code must handle event creation failure (retry or skip with warning)
- [SUB-313g] Merge→unmerge→re-merge cycle (weather oscillates) → calendar event thrashing protection needed (debounce or min interval between merges/splits)

---

## Summary of New Tests

| ID | Domain | Title |
|----|--------|-------|
| TS-301 | Fixed+Recurring / UI | UI blocks fixed+recurring at selection time |
| TS-302 | Fixed+Recurring / API | Direct API accepts fixed+recurring (current gap) |
| TS-303 | Fixed+Recurring / MCP | MCP accepts fixed+recurring (current gap) |
| TS-304 | Fixed+Recurring / Validation | After fix: 400 rejected via all paths |
| TS-305 | TPC / Backfill / Cancel | Cancel opens slot (defined: cancel not fulfilled) |
| TS-306 | TPC / Spacing / Cancel | Cancel doesn't update spacing → adj. placement possible |
| TS-307 | TPC / Keep / Skip | Keep policy: skip counts as kept, no spacing update |
| TS-308 | TPC / Backfill / Skip | Backfill: skip opens slot, no spacing guard from skip |
| TS-309 | Split×Status / Recurring | Recurring pre-materialized: done propagates |
| TS-310 | Split×Status / Non-Recurring | Non-recurring inline: done does NOT propagate |
| TS-311 | Split×Status / WIP | WIP+time_remaining affects only that chunk |
| TS-312 | Split×Status / Early Done | Done before all chunks placed → remaining still placed |
| TS-293 | Recurrence×TimeBlocks / Past | Past recurring time_blocks instance → pending forever (BUG) |
| TS-299 | Cross: Rolling×TPC×Split | Rolling + TPC=2 + split + flex → roam across cycle |
| TS-300 | Cross: Dep×Template×Weather | A→B chain, template+weather shift → cascade re-place |
| TS-313 | Cross: Calendar×Split×Weather | Merged event splits on weather-driven re-placement |