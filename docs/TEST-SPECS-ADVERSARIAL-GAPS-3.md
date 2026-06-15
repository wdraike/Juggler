# Juggler Scheduler — Full Structured Test Specs
## Adversarial Review Gap Fixes: G-010 through G-020, G-031 through G-033

**Updated:** 2026-06-15
**Scope:** TS-335 through TS-348
**Audience:** Developers implementing test coverage for MEDIUM-severity gaps and cross-domain gaps identified in ADVERSARIAL-REVIEW-GAPS.md

---

## Format Legend

Each test spec includes:
- **ID** — Test scenario identifier (TS-335 onward)
- **Domain** — Feature area
- **Title** — One-line description
- **Data Setup** — Preconditions, clock, master task config, existing instances
- **Action** — What triggers the behavior (scheduler run / status change / API call / MCP call)
- **Expected Outcome** — What must happen (instances generated, placements, statuses, errors)
- **Sub-scenarios** — Related edge cases that should also be covered

---

## G-010: Split travel + location template mid-day change (MEDIUM)

**Context:** TS-126ac tests travel between chunks at different locations on the same day. But what if the nominal location is the same for all chunks, yet an `hourLocationOverride` changes the effective location for a middle chunk? Travel between chunks must be computed using per-chunk *effective* location (after resolving `hourLocationOverride`, `locScheduleOverride`, and `block.loc`), not the task's base `location` field.

---

### TS-335: Same nominal location for all split chunks, hourLocationOverride changes chunk 2's effective location → travel needed between chunks

**Domain:** Split / Travel / Location Override
**Title:** Same task.location for all 3 split chunks, but hourLocationOverride moves chunk 2 to "conference_room" → travel time inserted between chunk1→chunk2 and chunk2→chunk3

**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User config: default time_blocks (weekday: morning 360-480, biz1 480-720, biz2 720-900, afternoon 900-1080)
- User timezone: `America/New_York`
- Template: `{ id: 'default', hours: { Mon: { 'morning': { loc: 'work' }, 'biz1': { loc: 'work' }, 'biz2': { loc: 'work' }, 'afternoon': { loc: 'work' } } } }`
- `hourLocationOverrides` for 2026-06-15: `{ 11: { loc: 'conference_room' } }` — overrides the biz2 block (11:00-12:00) to "conference_room"
- Travel matrix:
  - `work → conference_room`: 10 min
  - `conference_room → work`: 10 min
  - `work → work`: 0 min
- Master task: `{ id: 'task-1', text: 'Morning meeting prep', dur: 90, pri: P3, placementMode: 'time_blocks', when: 'morning,biz1,biz2,afternoon', location: ['work'], split: true, split_min: 30 }`
- No existing instances

**Action:** Run scheduler

**Expected Outcome:**
- 3 chunks generated: 3 × 30 min = 90 min total
- **Chunk 1** (ordinal 1): placed earliest in morning block (360-480). Effective location = "work" (morning block, no override).
- **Chunk 2** (ordinal 2): placed in biz2 block (720-900) BECAUSE hourLocationOverride at 11:00 is "conference_room" and the scheduler scans forward. OR placed at an earlier slot if the time falls within biz1 (480-720) at "work". Let's pin: Chunk 1 at 360-390 (work), Chunk 2 at 660-690 (biz1, work), Chunk 3 at 690-720 (biz1, work).
  - **BUT** the override zone is hour 11 (660-720). If Chunk 2 lands at 660-690 and the `hourLocationOverride[11]` applies globally to any block touching hour 11, then Chunk 2's effective location = "conference_room".
- **Travel between chunks:**
  - Chunk 1→Chunk 2: if chunk1 at 360-390 (work), chunk2 at 660 (conference_room) → travel of 10 min inserted? No — there's a gap between 390 and 660 (270 min). Travel buffer only applies when chunks are adjacent (minute N+1 after chunk N ends). Since there's a gap, no travel applies.
  - **Better setup:** Force chunks to be placed in consecutive blocks within same hour range. Set `when: 'biz1'` only, so all 3 × 30 min chunks must fit in the biz1 block (480-720).
- **Revised setup:** Biz1 block = 480-720 (240 min). hourLocationOverride at hour 11 (660-720) is "conference_room". Biz1 block spans hours 8-11, so the first 180 min (480-660) are "work" and the last 60 min (660-720) are "conference_room".
- **Corrected expected:**
  - Chunk 1 at 480-510 (work, travelBefore=0), Chunk 2 at 510-540 (work), Chunk 3 at 540-570 (work) — all in work zone, no travel. ❌ Not testing the override.
  - **Better:** Make chunks span the override boundary.
    - Chunk 1: 480-510 (work)
    - Chunk 2: 660-690 (conference_room via hourLocationOverride at 660)
    - Chunk 3: 690-720 (conference_room)
  - **Now travel applies:** Chunk 1 ends at 510 (work). Chunk 2 starts at 660 (conference_room). No adjacency (150 min gap) — no travel buffer applied between chunks.
  - **Tighten setup further:** Reduce biz1 block to 480-540 (only 60 min) and add biz2 block 540-600 (60 min, also "work" normally). hourLocationOverride on hour 9 (540-600) maps to "conference_room".
    - Chunk 1: 480-510 (biz1, work)
    - Chunk 2: 510-540 (biz1, work)  
    - Chunk 3: 540-570 (biz2, conference_room via hourLocationOverride)
    - Travel between chunk2 (510-540, work) and chunk3 (540, conference_room): chunk2 is NOT the last ordinal (chunk3 is). travelAfter on chunk2 = 0 (only correct). travelBefore on chunk3 = 10 min (work→conference_room). Chunk3's effective slot becomes 540 (with 10 min travelBefore → actually starts at 550).
    - Wait: `isFreeWithTravel` checks travel from previous placement's location to the candidate slot's location. The previous chunk (chunk2) was at "work". Chunk3's effective location is "conference_room" (via override). So travel = 10 min. Chunk3's `scheduled_at` = 540, but occupancy from 540-570 also includes travelBefore buffer = 10 min, so block must have 40 min free starting at 540.
    - If biz2 block is 540-600 (60 min), then 540-580 is used by chunk3 (30 min + 10 min travelBefore). Chunk3's `scheduled_at` = 540.
- **Final corrected:**
  - 3 chunks placed at 480-510 (work), 510-540 (work), 540-570 (conference_room)
  - Chunk 3 has `travelBefore=10` because effective location changed from "work" to "conference_room" between chunk2 and chunk3
  - Chunk 1 has `travelBefore=0` (first chunk, no previous location)
  - Chunk 3 has `travelAfter=0` (last chunk, no travel after)
  - All chunks placed successfully, no partial_split

**Sub-scenarios:**
- [SUB-335a] hourLocationOverride at chunk 1's time (earliest slot is conference_room) → travelBefore for chunk1 still 0 (no preceding chunk); chunk1 placed in conference_room
- [SUB-335b] hourLocationOverride changes ALL block zones to different locations for each chunk → travel between every adjacent pair
- [SUB-335c] hourLocationOverride changes chunk's effective location to the SAME as previous chunk (e.g. both "conference_room") → no travel needed (0 min)
- [SUB-335d] hourLocationOverride removed between scheduler runs → chunks re-evaluated, travel recalculated
- [SUB-335e] hourLocationOverride + locScheduleOverride at same hour → locScheduleOverride takes priority (per location resolution chain in SCHEDULER-RULES.md)
- [SUB-335f] LocScheduleOverride changes chunk's location but chunks are non-adjacent → no travel buffer (gaps absorb travel time)

---

## G-011: Chain deadline backpropagation — competing deadlines (MEDIUM)

**Context:** TS-135k-o tests deadline backpropagation where only the successor has a deadline. But when BOTH predecessor and successor have independent deadlines, the predecessor's faux deadline becomes `min(predecessor.deadline, successor.deadline)`. This is the correct backprop rule, but no test covers the case where the predecessor's deadline is *later* than the successor's, meaning the successor's deadline strictly tightens the predecessor's scheduling window.

---

### TS-336: Chain A→B, A.deadline=Friday, B.deadline=Wednesday → A's faux deadline = min(B.deadline, A.deadline) = Wednesday → both scheduled before Wednesday

**Domain:** Deadline × Dependency / Backpropagation
**Title:** Competing deadlines in a dependency chain — predecessor's real deadline is later than successor's, so backprop gives predecessor the tighter (successor's) deadline

**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User timezone: `America/New_York`
- User config: default time_blocks (weekday: morning 360-480, biz1 480-720, biz2 720-900, afternoon 900-1080)
- Task A: `{ id: 'A', text: 'Research task', dur: 120, pri: P3, placementMode: 'anytime', deadline: '2026-06-19' }` (Friday deadline)
- Task B: `{ id: 'B', text: 'Report writing', dependsOn: ['A'], dur: 60, pri: P3, placementMode: 'anytime', deadline: '2026-06-17' }` (Wednesday deadline)
- No existing instances
- Blocks capacity Mon-Wed: 360-1080 (720 min/day × 3 days = 2160 min) — more than enough for 180 min total

**Action:** Run scheduler

**Expected Outcome:**
- **Backprop computation (if implemented):** A's faux deadline = min(A.deadline '2026-06-19', B.deadline '2026-06-17') = '2026-06-17' (Wednesday)
- A's slack = Wed - A.dur = Wed 1080 - 120 = 960 (latest start A at 16:00 Wed)
- B's slack = Wed - B.dur = Wed 1080 - 60 = 1020 (latest start B at 17:00 Wed)
- Both A and B placed before Wednesday 18:00 (1080 = end of afternoon)
- A placed first (earlier in chain, or earlier in schedule order), then B placed after A
- Neither task is unplaced — both fit before Wednesday
- **If backprop NOT implemented:** A has no deadline (only B does) → A has infinite slack → A could be placed Thursday or Friday → B could still fit Wednesday → but A might be placed AFTER Wednesday if A is slotted late and B is waiting for A's completion. With infinite slack, A might land any day, possibly after Wednesday, causing B to miss its deadline.

**Sub-scenarios:**
- [SUB-336a] Competing deadlines with insufficient capacity: A=120min, B=60min, but Mon-Wed capacity only 150min → A placed (larger, earlier), B unplaced with `_unplacedReason='deadline'` or B placed (tighter deadline), A unplaced
- [SUB-336b] Three-chain competing deadlines: A.deadline=Sat, B.deadline=Fri, C.deadline=Wed → backprop chain: C's deadline propagates to B, B's min(B.deadline, C.deadline)=Wed propagates to A → all three placed before Wednesday
- [SUB-336c] Predecessor deadline already tighter than successor's: A.deadline=Mon, B.deadline=Wed → min(Mon, Wed)=Mon → A keeps Mon, B gets backprop deadline=Mon → both placed Monday
- [SUB-336d] Predecessor has NO deadline, successor has deadline → faux deadline = successor's deadline (standard backprop — already tested in TS-160)
- [SUB-336e] Chain with split task: A is split (3×40), deadline backprop applies to each chunk's group deadline, but individual chunks independently respect the faux deadline

---

## G-012: Deadline backprop not implemented as fallback (MEDIUM)

**Context:** TS-154m states "If backprop not yet implemented (v2 known gap)" — this precondition is critical because it affects whether tests in the deadline+weather+dependency space produce correct results. Without backprop, chain members with unmet faux deadlines rely solely on the Phase 7 deadline-relaxed fallback pass (TS-170/TS-161).

---

### TS-337: Deadline backpropagation NOT yet implemented → deadline-relaxed pass (Phase 7) is the only fallback for chain members with unmet faux deadlines

**Domain:** Deadline × Dependency / Fallback / Phase 7
**Title:** Without backprop, chain member B (successor) has deadline but predecessor A has none — A placed with infinite slack after B's deadline; fallback to deadline-relaxed pass to save B

**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User timezone: `America/New_York`
- User config: default time_blocks (weekday: morning 360-480, biz1 480-720, biz2 720-900, afternoon 900-1080)
- Task A: `{ id: 'A', text: 'Prep work', dur: 120, pri: P3, placementMode: 'anytime', deadline: null }` (NO deadline)
- Task B: `{ id: 'B', text: 'Final report', dependsOn: ['A'], dur: 60, pri: P3, placementMode: 'anytime', deadline: '2026-06-16' }` (Tuesday deadline)
- Capacity constraint: Monday is half-day (morning block only: 360-480 = 120 min), Tuesday is full day (360-1080)
- Backpropagation flag: `DEADLINE_BACKPROP_ENABLED = false` (simulating v2 gap)

**Action:** Run scheduler

**Expected Outcome:**
- **Without backprop:** A has no deadline → infinite slack → A placed first in schedule order (or by priority). Since A has infinitely high slack, it's placed earliest. A is placed Monday morning (360-480 = all of Monday's capacity).
- **Phase 1-4 (normal):** B's slack = Tue deadline (1080) - B.dur (60) = 1020. But A consumed ALL of Monday's capacity and B needs to be after A. On Tuesday, B can be placed at 360-420 (60 min). This fits before Tue deadline (1080). So B is placed Tuesday 360-420. **No fallback needed.**
- **Make it fail:** Reduce Tuesday capacity to make B fail initially.
  - **Revised:** Mon blocks: 360-480 (120 min). Tue blocks: 360-480 (120 min) — only morning block on Tue.
  - A (dur=120) placed Mon 360-480 (consumes all Mon capacity).
  - B (dur=60) needs Tue slot after A. Tue 360-420 free. B's deadline = Tue 1080. B fits: placed Tue 360-420. Still works.
  - **Make tighter:** A (dur=120), Mon blocks 360-480 only. Tue blocks 360-540 (180 min only). But A is 120 min → placed Mon. B needs to be after A, so B placed Tue 360-420. Still works.
  - **Actually need:** A dur large enough that A takes Tue capacity too.
  - A (dur=180), Mon 360-480 (120 min), Tue 360-540 (180 min). A placed Mon 360-480 (120 min) + Tue 360-420 (60 min) — A spans both days!
  - B (dur=60) needs to be after A finishes (Tue 420). Tue has 420-540 (120 min) free. B placed Tue 420-480. B's deadline = Tue 1080. Fits. Still works.
  - **Let me design a scenario where B truly needs fallback:**
  - Mon blocks: 360-480 (120 min). Tue blocks: 360-600 (240 min). Wed blocks: 360-600 (240 min).
  - A (dur=360) — 6 hour task fills: Mon 360-480 (120 min), Tue 360-600 (240 min, fills Tue) → still has 0 min left → spills to Wed 360-?. A = Mon 120 + Tue 240 = 360. Done.
  - B (dur=60, deadline=Wed) depends on A. A finishes Tue at 600. B needs slot Tue 600+ or Wed. Tue has no capacity after 600. Wed has 360-600 (240 min). B placed Wed 360-420. B's deadline=Wed 1080. Fits. Still works.
  - **Let's try** B.deadline=Tuesday 1080. A (dur=360) consumes Mon 120 + Tue 240 = 360. A finishes Tue 600. B needs slot after Tue 600 but before Tue 1080. Tue has no capacity after 600. B can't fit on Tue. **Now B needs fallback.**
  
**Corrected Data Setup:**
  - Mon blocks: 360-480 (120 min). Tue blocks: 360-600 (240 min). Wed blocks: 360-1080 (720 min).
  - A (id='A', dur=360, no deadline) — needs 360 min, gets Mon 120 + Tue 240 = 360. Finishes Tue at minute 600.
  - B (id='B', dependsOn=['A'], dur=60, deadline='2026-06-16' (Tue at 1080)) — needs 60 min after A finishes (Tue 600) but before Tue 1080. Tue has no remaining blocks after 600. B cannot be placed on Tuesday.
  - Backprop disabled: A has no faux deadline, so A gets infinite slack and is placed first (consuming all Mon+Tue capacity).
  
**Expected Outcome (corrected):**
  - Normal pass (Phase 1-4): A placed Mon 360-480 + Tue 360-600 (fills Mon+Tue capacity). B deferred (A not finished yet on Tue 600, no slot available on Tue before deadline).
  - Retry pass (Phase 5): A already placed. B still has no slot before Tue deadline on Tue.
  - Deadline-relaxed pass (Phase 7): B's deadline is relaxed → B considered for Wed placement. B placed Wed 360-420 (earliest Wed slot).
  - B's `_unplacedReason` NOT set (eventually placed), but `_reason` if logged shows "fallback: deadline_relaxed".
  - **Key insight:** Without backprop AND without Phase 7, B would be permanently unplaced despite capacity existing after the deadline.

**Sub-scenarios:**
- [SUB-337a] Backprop disabled + Phase 7 NOT implemented → B unplaced with `_unplacedReason='deadline'` (known scheduler limitation)
- [SUB-337b] Backprop enabled: A gets faux deadline = Tue → A placed Mon only (120 min) or spread Mon+Tue with slack tight enough to leave Tue space for B → B placed Tue before deadline → no fallback needed
- [SUB-337c] Backprop disabled, flag toggled at runtime → same scheduler behavior difference observable
- [SUB-337d] Weather constraint on B's fallback slot: Phase 7 must also check weather; if Wed 360 fails weather (precip>threshold), B tries next Wed slot; all Wed slots fail → B unplaced despite deadline relaxation
- [SUB-337e] All chain members with deadlines, backprop disabled → each member independently checked; slack computed ignoring predecessors' deadlines

---

## G-013: TPC safety valve across cycle boundaries (MEDIUM)

**Context:** TS-88 tests the TPC safety valve within a single cycle (all candidates blocked by minGap). But the safety valve must also activate when the *first* candidate of cycle N+1 is within minGap of the *last* placement from cycle N. Without cross-cycle safety valve activation, a recurring task with TPC could become permanently unplaceable at cycle boundaries.

---

### TS-338: TPC spacing guard safety valve across cycles — last placement at end of cycle N → cycle N+1 first candidate within minGap → safety valve activates → placed

**Domain:** TPC / Spacing Guard / Safety Valve / Cross-Cycle
**Title:** TPC spacing guard safety valve across cycle boundaries — last placement at end of cycle N, next cycle's only candidate day is within minGap, safety valve activates

**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User timezone: `America/New_York`
- User config: default time_blocks (weekday: all-day 360-1080)
- Master: `{ id: 'master-1', text: 'Biweekly report', dur: 30, pri: P3, placementMode: 'time_blocks', isFlexibleTpc: true, recurring: true, recur: { type: 'biweekly', days: 'MWF' }, timesPerCycle: 1, recurStart: '2026-06-15' }`
- cycleDays = 14 (biweekly), minGap = max(1, floor(14 * 0.5)) = 7
- recurringHistoryByMaster: `{ 'master-1': '2026-06-14' }` — last done on Sunday (day 0 of cycle)
- Cycle N (weeks 0-1): instances span 2026-06-15 to 2026-06-28
- FIRST candidate in cycle N+1 (2026-06-29 onwards): Monday 2026-06-29 is 15 days after 2026-06-14 → 15 >= 7 → passes minGap normally
- **Need tighter:** Make cycle N's last placement be at the very end of the cycle (e.g., 2026-06-28) and cycle N+1's first candidate be at 2026-06-29 (1 day apart, < 7 minGap).
  - Set recurringHistoryByMaster: `{ 'master-1': '2026-06-28' }` (Sunday, last done at end of cycle N)
  - Cycle N+1 starts 2026-06-29. First eligible day = 2026-06-29 (Monday, MWF pattern).
  - minGap = 7. 2026-06-29 - 2026-06-28 = 1 day. 1 < 7 → guard blocks Monday.
  - Other MWF days in cycle N+1: Wed 2026-07-01 (3 days from 6-28, < 7), Fri 2026-07-03 (5 days, < 7).
  - **ALL candidate days in cycle N+1 are within minGap of cycle N's last placement** → safety valve must activate

**Action:** Run scheduler (expandRecurring for cycle N+1)

**Expected Outcome:**
- Safety valve detection: `findEarliestSlot` in cycle N+1 scans Mon 6-29, Wed 7-1, Fri 7-3 — ALL blocked by spacing guard (minGap=7 from 6-28)
- Safety valve triggers: `let safetyValve = false; if (allBlocked) safetyValve = true`
- Instance placed at the earliest candidate (Mon 2026-06-29) despite spacing guard
- Instance NOT unplaced — safety valve prevents permanent unplaceability
- recurringHistoryByMaster updated to `'2026-06-29'` after placement

**Sub-scenarios:**
- [SUB-338a] Safety valve NOT triggered when at least 1 candidate within cycle N+1 passes minGap → guard enforced for blocked candidates
- [SUB-338b] Safety valve + multiple candidates all blocked → earliest candidate selected (greedy min)
- [SUB-338c] Safety valve + cycle N+1 has ZERO candidate days (no MWF match) → no instance generated for that cycle (not a safety valve issue)
- [SUB-338d] Safety valve across 3 cycles: cycle N last at 6-28, cycle N+1 all blocked → placed at 6-29. Cycle N+2 (starts 7-13): history now 6-29, 6-29 to 7-13 = 14 days ≥ 7 → passes normally
- [SUB-338e] minGap=1 (daily, tpc=1, cycleDays=1 → minGap=max(1, floor(1*0.5))=1): adjacent days always within minGap but safety valve never needed because at least tomorrow is >= 1 day from today
- [SUB-338f] Safety valve with incomplete cycle N (history from mid-cycle, not end): first candidate in cycle N+1 might be after minGap naturally — valve not needed

---

## G-014: Rolling stale guard bypassed by on-demand materialization (MEDIUM)

**Context:** The stale guard (R33.4) prevents the rolling anchor from regressing — it returns null when a terminal instance's date is < current anchor. However, on-demand materialization (triggered by user marking "done" via the status-change handler) happens *outside* the scheduler run and may not check the stale guard at all. This test verifies the stale guard is ALSO enforced in the on-demand status-change handler.

---

### TS-339: On-demand materialization: user marks 'done' on rc_instance dated 2026-06-10 when rollingAnchor=2026-06-15 → stale guard should fire but on-demand handler may not check it → anchor regresses

**Domain:** Rolling Recurrence / Stale Guard / On-Demand Materialization
**Title:** Stale guard not checked in on-demand materialization path → user marks "done" on a past instance date, rollingAnchor regresses

**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User timezone: `America/New_York`
- User config: default time_blocks (weekday: morning 360-480, biz1 480-720)
- Master: `{ id: 'master-1', text: 'Biweekly checkup', dur: 30, pri: P3, placementMode: 'anytime', recurring: true, recur: { type: 'rolling', intervalDays: 14 }, recurStart: '2026-06-01', rollingAnchor: '2026-06-15' }`
- Existing instances:
  - No instances in `rc_master` table for master-1 (fresh state)
- Scheduler run completes: generates instances for 2026-06-15 (today), 2026-06-29 (anchor+14), etc.
  - Instance `master-1_2026-06-15` created with status='' (pending, unplaced)
- **Action path:** User manually navigates to an old date (2026-06-10) and marks "done" on a hypothetical instance. The on-demand handler:
  1. Checks if an `rc_instance` exists for master-1 on 2026-06-10
  2. If not, creates it on-demand (materializes)
  3. Sets status='done'
  4. Calls `updateRollingAnchor(instance)` with date=2026-06-10

**Action:** User marks "done" on a non-existent instance for date 2026-06-10 via the status-change API (PATCH /api/tasks/:masterId/instances/2026-06-10 → body: { status: 'done' })

**Expected Outcome:**
- **If stale guard is checked in on-demand handler:**
  - Handler calls `updateRollingAnchor` or equivalent stale guard function
  - Guard computes: terminal_date (2026-06-10) < current rollingAnchor (2026-06-15) → returns `null`
  - rollingAnchor is NOT updated (stays 2026-06-15)
  - Instance row created with status='done' (historical record) but anchor unchanged
  - Console/trace logs: "Stale guard prevented anchor regression: 2026-06-10 < 2026-06-15"
- **If stale guard is NOT checked (the gap):**
  - Instance row created with status='done'
  - rollingAnchor updated to 2026-06-10 (regression! 5 days in the past)
  - Next scheduler run computes new anchor from 2026-06-10 + 14 = 2026-06-24
  - But 2026-06-15 instance already exists in pending state — dedup skips it
  - Rolled anchor from 2026-06-15 back to 2026-06-10 causes a 5-day scheduling gap
  - User misses the next instance on 2026-06-29 (should have been 2026-06-29, now 2026-06-24 but dedup blocks it)
- **Expected behavior for this test:** Document the current state (stale guard NOT checked in on-demand path → regression occurs) AND the desired state (stale guard checked → regression prevented)

**Sub-scenarios:**
- [SUB-339a] On-demand materialization date EQUALS rollingAnchor (2026-06-15 = 2026-06-15) → stale guard passes (≥ anchor) → anchor updated to 2026-06-15 (same, no regression)
- [SUB-339b] On-demand materialization date AFTER rollingAnchor (2026-06-20 > 2026-06-15) → stale guard passes → anchor updated forward correctly
- [SUB-339c] On-demand materialization for status 'skip' on past date → skip should NOT update anchor (skip → returns instance date, but stale guard still applies)
- [SUB-339d] Scheduler-run materialization: same scenario (past date 2026-06-10) but created via scheduler's `expandRecurring` path → stale guard IS checked (already tested in TS-100 SUB-100d) → guard prevents regress
- [SUB-339e] Multiple on-demand materializations: user marks done 2026-06-10 (regresses to 6-10), then marks done 2026-06-20 (advances to 6-20) → net effect: skipped from 6-15 to 6-20
- [SUB-339f] Fix implementation test: after stale guard is wired into on-demand handler, TS-339's regression scenario changes from "anchor regresses" to "anchor stays at 2026-06-15"

---

## G-015: Overflow detection across template changes (MEDIUM)

**Context:** When a recurring split task overflows (`_unplacedReason: "recurring_split_overflow"`), the overflow flag might be "sticky" — it persists across scheduler runs even after a template change adds capacity. The overflow flag must be cleared and chunks re-evaluated when blocks expand.

---

### TS-340: Previously overflowing recurring split (recurring_split_overflow) → template adds blocks → scheduler re-run → overflow flag cleared, chunks placed

**Domain:** Split × Recurring × Overflow / Template Expansion
**Title:** Recurring split overflow cleared after template adds capacity — overflow flag reset, chunks fully placed

**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User timezone: `America/New_York`
- Template: `{ id: 'default', hours: { Mon: { 'morning': { start: 360, end: 480 } } } }` — only 120 min on Monday
- Master: `{ id: 'master-1', text: 'Weekly deep work', dur: 300, pri: P3, placementMode: 'time_blocks', when: 'morning', split: true, split_min: 60, recurring: true, recur: { type: 'weekly', days: 'M' }, recurStart: '2026-06-15' }`
- **Run 1:** Template has Monday morning only (120 min). Task needs 300 min, split into 5×60 min chunks. Only 2 chunks fit (120 min). 3 chunks unplaced. `_unplacedReason = "recurring_split_overflow"` on the master or on the unplaced chunks.
- **Between runs:** Template expands: `{ Mon: { 'morning': { start: 360, end: 480 }, 'biz1': { start: 480, end: 720 }, 'afternoon': { start: 900, end: 1080 } } }` — now 540 min on Monday.
- **Run 2:** Scheduler re-runs (triggered by template change)

**Action:**
1. Scheduler Run 1 (template has 120 min morning only)
2. Template change adds biz1 (480-720) and afternoon (900-1080) blocks
3. Scheduler Run 2 (template now has 540 min)

**Expected Outcome:**
- **Run 1:** 5×60 min chunks generated, but only 2 placed (120 min). Overflow: 3 chunks unplaced with `_unplacedReason = "recurring_split_overflow"`. Master task or occurrence has overflow flag set.
- **Template change:** Chunks are re-evaluated (template blocks changed → scheduling-relevant change → triggers re-schedule)
- **Run 2:** Overflow flag cleared during re-evaluation. All 5 chunks reconsidered against new 540-min capacity. 5 chunks placed across morning (2), biz1 (2), afternoon (1). No overflow.
- Chunk scheduled_at values: e.g., chunk1 at 360-420, chunk2 at 420-480, chunk3 at 480-540, chunk4 at 540-600, chunk5 at 900-960
- No `_unplacedReason` set on any chunk
- `recurring_split_overflow` flag removed from master/occurrence record

**Sub-scenarios:**
- [SUB-340a] Template adds SOME capacity but still insufficient (120→240 min, needs 300) → overflow reduced from 3 to 1 chunk, but still partial overflow
- [SUB-340b] Template removes blocks (540→120 min) → previously placed chunks now overflow — chunks must be re-placed or overflow flag set anew
- [SUB-340c] Overflow flag is sticky (BUG): re-run with expanded template still shows overflow → chunks NOT re-placed → remaining capacity wasted. This is the behavior the test detects.
- [SUB-340d] Template change to a DIFFERENT day (adds Tuesday blocks) → recurring split for Monday: Tuesday blocks don't help Monday's overflow (day-locked). Overflow persists.
- [SUB-340e] Split + recurring + TPC: overflow for one TPC occurrence doesn't affect other occurrences in the same cycle
- [SUB-340f] Overflow cleared then capacity reduced again → overflow re-applied on next re-run

---

## G-016: Drift fix skips WIP/done chunks (MEDIUM)

**Context:** At scheduler start, a "drift fix" adjusts chunk data (e.g., `dur` field) to match the master task's current configuration. If a chunk has status='wip' (in-progress, `time_remaining` counting down) or 'done' (completed), changing its `dur` would corrupt the progress tracking. The drift fix must skip these chunks.

---

### TS-341: Drift fix at scheduler start — chunk with status='wip' or 'done' is SKIPPED, only pending/empty status chunks adjusted

**Domain:** Recurring Split / Drift Fix
**Title:** Drift fix at scheduler start skips chunks with status='wip' or 'done' — only pending/'' status chunks have dur/time adjusted

**Data Setup:**
- Clock: fixed at `2026-06-15T10:00:00Z` (Monday)
- User timezone: `America/New_York`
- User config: default time_blocks
- Master: `{ id: 'master-1', text: 'Deep work', dur: 120, pri: P3, placementMode: 'time_blocks', split: true, split_min: 30, recurring: true, recur: { type: 'weekly', days: 'M' }, recurStart: '2026-06-15' }`
- Existing chunks from previous scheduler run (master dur was 90, now changed to 120):
  - Chunk A: `{ master_id: 'master-1', date: '2026-06-15', split_ordinal: 1, split_total: 3, dur: 30, status: '' }` (pending)
  - Chunk B: `{ master_id: 'master-1', date: '2026-06-15', split_ordinal: 2, split_total: 3, dur: 30, status: 'wip', time_remaining: 15 }` (in progress)
  - Chunk C: `{ master_id: 'master-1', date: '2026-06-15', split_ordinal: 3, split_total: 3, dur: 30, status: 'done' }` (completed)
- New master dur=120, so total chunks should be 120/30 = 4 (changed from 90/30 = 3)
- Drift fix runs at scheduler start

**Action:** Run scheduler (trigger drift fix in pre-pass)

**Expected Outcome:**
- **Chunk A (pending, ''):** Drift fix adjusts: dur recalculated, chunk kept. Since master dur changed to 120, total chunks should be 4. Chunk A may be re-allocated or new chunks added.
- **Chunk B (wip):** Drift fix SKIPS. dur stays 30. time_remaining stays 15. No adjustment.
- **Chunk C (done):** Drift fix SKIPS. dur stays 30. No adjustment.
- **Net effect:** 3 existing chunks (1 pending adjusted, 1 wip skipped, 1 done skipped) + 1 new chunk created for the extra 30 min → total 4 chunks. The wip and done chunks retain their original dur values.
- If drift fix incorrectly adjusts wip/done chunks: chunk B's dur changes from 30 to match new chunk size (e.g., 40) while time_remaining stays 15 → inconsistency: 15 min remaining on a 40-min chunk (progress would appear as 62.5% instead of 50%). Worse: if dur changes to a smaller value while time_remaining > new dur → negative/zero remaining (logical corruption).

**Sub-scenarios:**
- [SUB-341a] Drift fix on 'skip' status chunk → skip acts like pending for rescheduling but status is terminal → drift fix SHOULD skip (skip is terminal, user intent to not do it; changing dur on skip is meaningless)
- [SUB-341b] Drift fix on 'cancel' status chunk → same reasoning as skip: terminal, skip
- [SUB-341c] Drift fix when ALL chunks are 'wip' or 'done' → no chunks adjusted, new chunks not created (split_total stays at old count). New master dur=120 but old chunks total 90 → underfill by 30 min. This is a known limitation: drift fix cannot retroactively add new chunks for in-progress or completed splits.
- [SUB-341d] Drift fix reduces dur (120→60) → pending chunk dur reduced from 30 to 15 (new split_min or new per-chunk dur). WIP/done chunks retain old dur 30.
- [SUB-341e] Drift fix with `split_min` changed (30→20) → recalculation: 120/20 = 6 chunks. Pending chunks adjusted to fit new split_min; wip/done chunks keep original min size.

---

## G-017: All blocks deleted after tasks placed (MEDIUM)

**Context:** TS-249 tests empty blocksMap at startup, but what about the scenario where the user had blocks, tasks were placed, then ALL blocks are deleted? Anytime tasks get a synthetic [GRID_START, GRID_END] window, but when-tag tasks lose their block anchor entirely.

---

### TS-342: User deletes all time_blocks config after tasks placed → scheduler re-run → anytime tasks re-placed in synthetic [GRID_START, GRID_END] window, when-tag tasks become unplaced

**Domain:** Template / Config Change / Block Loss
**Title:** All time_blocks deleted after tasks scheduled — no blocksMap at all; anytime tasks fall back to synthetic grid window, when-tag tasks become unplaceable

**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User timezone: `America/New_York`
- Initial user config: `time_blocks: { Mon: { morning: { start: 360, end: 480 }, biz1: { start: 480, end: 720 }, afternoon: { start: 900, end: 1080 } } }` (grid days with 3 blocks)
- Task A (anytime): `{ id: 'any-1', text: 'Check email', dur: 15, pri: P3, placementMode: 'anytime' }` — placed at 360 on Run 1
- Task B (when-tag): `{ id: 'when-1', text: 'Morning standup', dur: 30, pri: P3, placementMode: 'time_blocks', when: 'morning' }` — placed at 360-390 on Run 1
- Task C (when-tag): `{ id: 'when-2', text: 'Afternoon review', dur: 60, pri: P3, placementMode: 'time_blocks', when: 'afternoon' }` — placed at 900-960 on Run 1
- **Between runs:** User deletes ALL time_blocks entries → `time_blocks: {}` or entire `time_blocks` key removed

**Action:**
1. Run 1: scheduler places all 3 tasks using time_blocks config
2. User deletes all time_blocks
3. Run 2: scheduler re-runs (triggered by config change)

**Expected Outcome:**
- **Task A (anytime):** Falls back to synthetic `[GRID_START=360, GRID_END=1380]` window (per scheduler rules). Re-placed at earliest free slot in synthetic window. Placed at 360 (earliest, 15 min fits).
- **Task B (when-tag 'morning'):** No blocks exist → `getBlocksForWhen('morning', blocksMap)` returns empty/null. In Phase 1 (window mode), `isWindowMode=false` → falls to Phase 2 (when-tag fallback). In Phase 2, `emptyBlockSlots` returns [/] (no windows). In Phase 3-4, when-tag is relaxed but still no blocks. **Result: Task B unplaced** with `_unplacedReason` (likely 'no_blocks' or generic no-slot). If no explicit reason, logged in unplacedTasks array.
- **Task C (when-tag 'afternoon'):** Same as B. Unplaced.
- **Key behavioral difference:** Anytime tasks survive block loss (synthetic window), but when-tag tasks become permanently unplaceable until blocks are restored.

**Sub-scenarios:**
- [SUB-342a] Only SOME blocks deleted (morning block removed, biz1+afternoon remain) → when-tag 'morning' tasks unplaced; 'afternoon' tasks still placed
- [SUB-342b] All blocks deleted for Monday but Tuesday blocks exist → Monday tasks unplaced, Tuesday tasks placed normally
- [SUB-342c] All blocks globally deleted (no blocks for any day) → all when-tag tasks unplaced every day; anytime tasks re-placed each day in synthetic 360-1380
- [SUB-342d] Anytime task placed at 360 on Run 1 → block deletion + re-run → still placed at 360 (same synthetic window) → consistent, no thrash
- [SUB-342e] Fixed tasks (placementMode='fixed') are NOT affected by block deletion → placed at their fixed time regardless of blocks
- [SUB-342f] All-day tasks: NOT affected by block deletion (bypass grid entirely)
- [SUB-342g] Reminder tasks (dur=0): placed at synthetic GRID_START regardless of blocks → unaffected

---

## G-018: Reminder with full occupancy — not always placeable (MEDIUM)

**Context:** TS-61 says "even with full occupancy, reminder can be placed (dur=0 → needs only 1 free minute)." But the actual code checks `occ[start]` for zero duration. If minute GRID_START=360 is occupied by a fixed task, the reminder at 360 conflicts. The "always placeable" claim is wrong.

---

### TS-343: Reminder (dur=0) placed at earliest slot — if minute GRID_START=360 is occupied by fixed task, reminder placed at next free minute (361), not GRID_START

**Domain:** Reminder / Placement / Occupancy Conflict
**Title:** Reminder with dur=0 at GRID_START=360 when that minute is occupied by a fixed task → reminder placed at next free minute (e.g. 361), NOT at 360

**Data Setup:**
- Clock: fixed at `2026-06-15T05:00:00Z` — nowMins corresponds to 5:00 AM in America/New_York (UTC-4) = 5*60=300
- User timezone: `America/New_York`
- User config: default time_blocks (weekday: morning 360-480, biz1 480-720)
- Fixed task: `{ id: 'fixed-1', text: '6 AM alarm task', dur: 30, placementMode: 'fixed', time: '6:00 AM' }` — placed at 360-390, occupying minute 360
- Reminder: `{ id: 'remind-1', text: 'Take vitamins', dur: 0, pri: P3, placementMode: 'reminder' }` — marker task
- No other tasks

**Action:** Run scheduler

**Expected Outcome:**
- Fixed task placed at 360-390 (Phase 0 placement, rigid)
- Reminder tries earliest slot scanning from 360
- `isFreeWithTravel(occ, 360, 0, 0, 0)`: code checks `occ[360]` is occupied by fixed-1 → NOT free
- Scanner advances to 361: `occ[361]` is free (fixed task only occupies 360-390, minute 360 occupied but 361 is within fixed task's range? Actually occupancy is [360, 390), so occ[360]=true, occ[361]=true... occ[389]=true, occ[390]=false. So 361 is ALSO occupied.
- Scanner continues: 390 is first free minute → reminder placed at 390
- Reminder's `scheduled_at` = 390 (06:30 AM), not 360 (06:00 AM)
- **Assertion:** Reminder is NOT at GRID_START. It's at the first free minute after GRID_START.
- If ALL minutes in the day are occupied (impossible in practice but theoretically): reminder placed at the first free minute, or if no free minute exists, placed at end_of_day (1380) as a last resort

**Sub-scenarios:**
- [SUB-343a] GRID_START minute free but next minute (361) occupied by another fixed task → reminder placed at 360 (one free minute is enough)
- [SUB-343b] Entire GRID_START to GRID_END fully occupied (all 1020 minutes filled by fixed/all-day tasks) → reminder has NO free minute → this is the edge case where reminder truly is NOT placeable → should be marked unplaced or placed at 1380 (grid_end) as fallback
- [SUB-343c] Multiple reminders: 2 reminders and only 1 free minute at 360 → first reminder gets 360, second goes to 361 (or next free)
- [SUB-343d] Reminder with `when: 'morning'` → block-restricted reminder: only scanned within morning block (360-480). If morning fully occupied, scanned to afternoon or falls back.
- [SUB-343e] Reminder placed at next free minute cross-block boundary: 360-480 occupied → scans to 480 (biz1 start) → placed at 480
- [SUB-343f] Reminder + travel constraint: reminder has no duration but still has travelBefore/travelAfter if set (unusual but possible). Travel buffer checks: `isFreeWithTravel(occ, 360, 0, 0, travelBefore=10)` → checks minutes 350-360. If minute 350 is free → reminder at 360 ok. If minute 350 occupied → not free at 360.

---

## G-019: Indirect circular dependency detection (MEDIUM)

**Context:** TS-158 tests "Circular dependency — rejected on create/update" but only tests direct self-reference (A depends on A). The cycle detection must traverse the full chain: A→B→C→A must also be rejected. Without full traversal, multi-link cycles can silently persist.

---

### TS-344: Indirect circular dependency: A→B→C→A → rejected on create/update (cycle detection must traverse full chain)

**Domain:** Dependency Chain / Circular Detection
**Title:** Three-link indirect circular dependency detected and rejected — cycle detection traverses full dependency chain depth-first

**Data Setup:**
- Clock: `2026-06-15T08:00:00Z`
- User timezone: `America/New_York`
- User config: default time_blocks
- Existing tasks (no deps yet):
  - Task A: `{ id: 'A', text: 'Prep', dur: 30, pri: P3 }`
  - Task B: `{ id: 'B', text: 'Execute', dur: 30, pri: P3 }`
  - Task C: `{ id: 'C', text: 'Review', dur: 30, pri: P3 }`
- **Step 1:** Set B.dependsOn=['A'] → valid (no cycle)
- **Step 2:** Set C.dependsOn=['B'] → valid (A→B→C, linear)

**Action:** Step 3: API call to set A.dependsOn=['C'] — would create A→B→C→A (indirect cycle)

**Expected Outcome:**
- **Cycle detection algorithm:** Must traverse full chain starting from A:
  1. Check A depends on C
  2. Check C depends on B
  3. Check B depends on A → A already visited → **CYCLE DETECTED**
- API returns HTTP 400 (Bad Request) or HTTP 409 (Conflict)
- Response body includes: `{ error: 'Circular dependency detected', cycle: ['A', 'B', 'C', 'A'] }` or similar descriptive message
- Database transaction ROLLED BACK — no change to A's dependencies
- A.dependsOn remains empty/null (or whatever it was before the failed update)
- Tasks B and C unchanged

**Sub-scenarios:**
- [SUB-344a] 4-link indirect cycle: A→B→C→D→A → detected after 4 hops
- [SUB-344b] 5-link indirect cycle: A→B→C→D→E→A → detected
- [SUB-344c] Self-loop through single intermediate: A→B→A → detected (2 hops)
- [SUB-344d] Deep cycle with branching: X→Y, X→Z, Y→A, Z→A, A→X → cycle detected (two paths to A, both lead back to X)
- [SUB-344e] Adding dependency that creates cycle in existing chain: B→C already exists, adding A→B is fine until adding C→A creates cycle. The update to C triggers cycle check that finds the loop.
- [SUB-344f] Cycle detection with list of dependsOn: A.dependsOn=['B','C'], B.dependsOn=['D'], D.dependsOn=['A'] → cycle detected via B→D→A path
- [SUB-344g] Cycle detection performance: deep chains (10+ links) → algorithm should still complete within reasonable time (O(n) or O(n²) worst case, not exponential)
- [SUB-344h] Cycle detection MUST NOT false-positive on diamond dependencies: A→B, A→C, B→D, C→D (no cycle, just convergent)
- [SUB-344i] Update that removes a cycle: A→B→C→A exists, remove C→A → no cycle → update accepted (this should also be tested: cycle allowed to be removed, not just prevented)
- [SUB-344j] Batch update creates cycle: atomic update to A.dependsOn and C.dependsOn simultaneously → both changes in one transaction → cycle detection must check the combined state, not intermediate states

---

## G-020: Rate limit exceeded — 11th trigger behavior (MEDIUM)

**Context:** TS-194a says the 11th scheduler run is "skipped" but doesn't specify what happens to the trigger. Is the trigger silently dropped (the 11th change is lost forever), deferred to the next rate window, or does an error propagate to the caller? The scheduler must NOT silently lose user actions.

---

### TS-345: Rate limit exceeded: 11th enqueueScheduleRun call in 1-minute window — returns error to caller (NOT silently dropped)

**Domain:** Reschedule Triggers / Rate Limit / Error Handling
**Title:** 11th enqueueScheduleRun call returns an error to the caller — the trigger is NOT silently dropped or deferred; caller receives feedback

**Data Setup:**
- Clock: fake clock advancing in 1-second increments
- User timezone: `America/New_York`
- Mock rate limiter: configured to 10 runs/min/user
- Rate limit counter: already at 10 (10 enqueueScheduleRun calls in the last 59 seconds)
- 11th trigger source: `api:updateTask` from user editing a task's `dur` field

**Action:** Call `enqueueScheduleRun(userId, 'api:updateTask')` for the 11th time within the 1-minute window

**Expected Outcome:**
- Rate limit check: `rateLimiter.check('scheduler:user:' + userId)` returns `{ allowed: false, retryAfter: 45 }` (or similar)
- `enqueueScheduleRun` does NOT silently drop the call — it returns a result indicating rejection
- **Return value/behavior:** The function throws or returns an error object:
  - Option A (preferred): `enqueueScheduleRun` returns `{ success: false, error: 'rate_limit_exceeded', retryAfter: 45 }` — the caller (API handler) can forward this to the client
  - Option B (acceptable): `enqueueScheduleRun` throws `new RateLimitError('Rate limit exceeded: 10 runs/min. Retry in 45s.')` — caught by caller, translated to HTTP 429
  - Option C (NOT acceptable, the gap): Call returns `undefined` or `{ success: true }` but no scheduler run happens — the trigger is silently lost
- **Caller action:** The API handler calling `enqueueScheduleRun` receives the error and returns HTTP 429 Too Many Requests to the client with body: `{ error: 'rate_limit_exceeded', message: 'Too many scheduling requests. Try again in 45 seconds.', retryAfter: 45 }`
- The client (frontend) shows a toast or notification: "Scheduling temporarily paused — too many changes. Try again in 45 seconds."
- **Crucially:** The 11th mutation (task dur change) IS persisted to the database — only the SCHEDULER RUN is deferred. The task's `dur` value is updated correctly. The scheduler simply won't re-run for this user until the rate window resets.
- After rate window resets (60 seconds from first run), the next call succeeds normally
- Count of runs should be reset or window advanced

**Sub-scenarios:**
- [SUB-345a] Rate limit counter at 9 → 10th call succeeds (still under limit)
- [SUB-345b] Rate limit counter at 10 → 11th call returns error → 12th call (within same window) also returns error
- [SUB-345c] Rate limit counter at 10 → wait 60s from first call → 11th call succeeds (window advanced, counter reset)
- [SUB-345d] Rate limit counter at 0 → 10 rapid calls in 30 seconds → all succeed → 11th at 31s → succeeds if window is sliding (oldest expired) or fails if fixed window (still within minute)
- [SUB-345e] Two different trigger sources: 5 from `api:createTask` + 5 from `api:updateTask` → combined = 10 → 11th (from `template:save`) → rate limited
- [SUB-345f] Multiple users: User A at 10 runs, User B at 0 → User B's call succeeds (per-user rate limit)
- [SUB-345g] Error propagation to HTTP caller: client receives 429 → frontend shows "Too many changes" message → user waits → retries → 200 OK
- [SUB-345h] Error propagation to MCP caller: MCP receives 429 → returns error to calling agent → agent can retry after delay
- [SUB-345i] Debounce vs rate limit interaction: 11 triggers fired within 200ms (debounce window) → all coalesced into 1 run → only 1 rate counter consumed → all 11 coalesced triggers succeed (this is correct behavior: debounce first, rate limit second)

---

## G-031: Calendar sync + split + weather — merged event breakage (MEDIUM cross-domain)

**Context:** TS-203 tests split→calendar merging (3 contiguous chunks → 1 event). TS-126y tests weather→split re-placement. But when weather causes one chunk to move, the previously merged event breaks apart. The sync code must delete the old merged event and create separate events for the now-discontiguous chunks.

---

### TS-346: Calendar-synced split task (3 contiguous chunks merged to 1 event) → weather changes, chunk 2 moves → unmerge: 2 events created, old event deleted

**Domain:** Calendar Sync / Split Sync / Weather Re-Placement
**Title:** Weather-driven re-placement breaks merged event — calendar sync unmerges: delete old merged event, create separate events for each chunk group

**Data Setup:**
- Clock: fixed at `2026-06-15T07:00:00Z` (Monday, before task time)
- User timezone: `America/New_York`
- User config: default time_blocks (weekday: morning 360-480, biz1 480-720, biz2 720-900, afternoon 900-1080)
- Calendar sync: GCal connected with full push sync enabled
- User locations: `{ home: { lat: 40.7128, lon: -74.0060 } }`
- FakeWeatherProvider: initially dry all day (precipProb=0 all hours)
- Master task: `{ id: 'task-1', text: 'Yard project', dur: 90, pri: P3, placementMode: 'time_blocks', when: 'morning', split: true, split_min: 30, location: ['home'], weatherPrecip: 'dry_only' }`
- **Run 1 — Initial placement and merge:**
  - All weather passes (precipProb=0)
  - 3 chunks: 360-390, 390-420, 420-450 (contiguous)
  - Calendar sync detects contiguous → merges to 1 event: "Yard project" 360-450 (90 min)
  - GCal: 1 event created, external event ID stored in ledger
- **Weather change:** FakeWeatherProvider updated for 2026-06-15:
  - Hour 6 (360-420): precipProb=0 (still dry)
  - Hour 7 (420-480): precipProb=85 (rain!)
  - Chunk 3 (420-450) now fails weather (precipProb=85 > 20 for dry_only)
- **Run 2 — Re-placement due to weather change:**
  - Chunk 1 (360-390): stays (passes weather)
  - Chunk 2 (390-420): stays (passes weather)
  - Chunk 3 (420-450): fails weather → must move. Re-placed at next available dry slot → biz1 block at 480-510 (precipProb=0 at hour 8)
  - Chunks now: 360-390, 390-420, 480-510 — NOT contiguous (gap from 420 to 480)

**Action:**
1. Run 1: scheduler places chunks, calendar sync merges
2. Weather update triggers scheduler Run 2
3. Calendar sync after Run 2 (triggered by scheduler completion)

**Expected Outcome:**
- **Scheduler Run 2:**
  - Chunk 1: 360-390 (stays)
  - Chunk 2: 390-420 (stays)
  - Chunk 3: 480-510 (re-placed from 420-450)
  - No partial_split — all chunks placed
  - Chunks are non-contiguous (gap 420-480)
- **Calendar sync:**
  - Sync code reads all 3 chunks' `scheduled_at` fields from DB
  - Merge detection: chunks 1-2 are contiguous (360-390, 390-420), chunk 3 is separate (480-510)
  - **Unmerge action:** Old merged event (360-450, 90 min) is DELETED from GCal
  - **New events created:**
    - Event 1: "Yard project (part 1)" 360-420 (chunks 1+2 merged into 60-min event since they're contiguous)
    - Event 2: "Yard project (part 2)" 480-510 (chunk 3 as 30-min standalone event)
  - OR sync code could create 3 separate events (one per chunk) — depends on merge tolerance. **Acceptable outcome:** either 2 events (60+30) or 3 events (30+30+30), but NOT 1 event (old merged event must be deleted).
  - No orphan events remain on GCal
  - Old event's external ID is removed from the sync ledger
  - New event external IDs are stored in the ledger

**Sub-scenarios:**
- [SUB-346a] Weather causes chunk 2 AND chunk 3 to move → all 3 chunks non-contiguous → 3 separate events or 1+1+1
- [SUB-346b] Weather causes chunk 1 to move to 480-510, chunk 2 stays at 390-420, chunk 3 stays at 420-450 → chunks 2+3 are contiguous (390-450), chunk 1 separate → 2 events: 60-min (390-450) + 30-min (480-510)
- [SUB-346c] Weather causes chunk 2 to move adjacent to chunk 3's new position → chunks 2+3 become contiguous at different location → merge into 1 event; chunk 1 stays separate → 2 events total
- [SUB-346d] Weather causes chunk to move to NEXT DAY (cross-day) → chunks now on different days → each day gets its own event(s); old merged event deleted
- [SUB-346e] Calendar sync conflict: GCal already has a manually created event at chunk 3's new time (480-510) → sync must handle event creation failure: retry or skip with warning (DO NOT delete user's manual event)
- [SUB-346f] Merge→unmerge→re-merge cycle (weather oscillates between runs) → event thrashing. Protection needed: debounce or min interval between merge state changes (e.g., don't re-merge if last merge was < 5 minutes ago)

---

## G-032: Template + dependency + weather + rolling — 4-way interaction (MEDIUM cross-domain)

**Context:** Real-world scenario: a rolling task B depends on one-off task A. A template change shifts A's available blocks. Weather rejects A's original slot. A is re-placed, which shifts B's dependency window, and B must be re-placed. This exercises Phase ordering, retry passes, weather checks, and rolling anchor computation simultaneously.

---

### TS-347: Rolling task B depends on one-off task A → template change shifts A's available blocks → weather rejects A's original slot → A re-placed → B's window shifts → B re-placed

**Domain:** Template / Dependency / Weather / Rolling Recurrence — 4-Way Interaction
**Title:** Four-way interaction: template change + weather reject + dependency cascade across rolling task

**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User timezone: `America/New_York`
- User config: default time_blocks initially (weekday: morning 360-480, biz1 480-720, biz2 720-900, afternoon 900-1080)
- User locations: `{ home: { lat: 40.7128, lon: -74.0060 } }`
- FakeWeatherProvider: 2026-06-15
  - Hour 8 (480-540): precipProb=5 (dry) — morning block
  - Hour 9 (540-600): precipProb=5 (dry) — biz1 block
  - Hour 10 (600-660): precipProb=90 (rain!) — biz1 block
  - Hour 11 (660-720): precipProb=90 (rain!) — biz2 block
  - Hour 12 (720-780): precipProb=5 (dry) — afternoon block
- Task A (one-off): `{ id: 'A', text: 'Buy detergent', dur: 60, pri: P3, placementMode: 'time_blocks', when: 'biz1,afternoon', weatherPrecip: 'dry_only', location: ['home'] }`
- Task B (rolling, depends on A): `{ id: 'B', text: 'Do laundry', dur: 30, pri: P3, placementMode: 'time_blocks', when: 'afternoon', recurring: true, recur: { type: 'rolling', intervalDays: 7 }, recurStart: '2026-06-15', rollingAnchor: '2026-06-15' }`
- **Initial Template:** morning 360-480, biz1 480-720, biz2 720-900, afternoon 900-1080
  - A placed at earliest biz1 slot: 480-540 (precipProb=5, passes weather). Actually wait — biz1 is 480-720, hour 8 (480-540) is dry, so A placed at 480-540.
  - B depends on A. B's rolling anchor = 2026-06-15. B's window: placed after A finishes. If A finishes at 540, B placed at earliest afternoon slot 900-930 (or could be 540-570 if afternoon means 900+ only). With `when: 'afternoon'`, B placed at 900-930.
  - Both placed in Run 1.

**Template change (between runs):**
- New template: biz1 block REMOVED (480-720 no longer exists). Morning 360-480, afternoon 900-1080 only.
- This is scheduling-relevant → triggers scheduler Run 2

**Action:**
1. Run 1: A placed at 480-540 (biz1), B placed at 900-930 (afternoon, after A)
2. Template change removes biz1 block
3. Weather data unchanged (hour 8 dry, hour 10 rainy)
4. Run 2: scheduler re-evaluates

**Expected Outcome:**
- **A's re-evaluation:** A's previous slot (480-540) is in the removed biz1 block → A must be re-placed. New available slots: morning 360-480 with hour 6 (360-420) dry and hour 7 (420-480) dry. Or afternoon 900-1080 with hour 15 (900-960) dry.
  - Earliest eligible: 360-420 (morning, dry) → A re-placed to 360-420
  - Weather check: precipProb=5 at hour 6 → passes
- **B's re-evaluation:** B depends on A. A now finishes at 420 (was 540). B's `depReadyAbs` shifts earlier. B's rolling anchor = 2026-06-15. B needs to be placed after A finishes (420) in afternoon block (900-1080).
  - B re-placed: earliest afternoon slot 900-930
  - OR — is B's scheduled_at still 900-930? If B's depReadyAbs is now 420 instead of 540, B could be placed in a non-afternoon slot? No — B's `when: 'afternoon'` constrains to afternoon block only. So B stays at 900-930.
  - **BUT** what if afternoon capacity changed? Let's make the test more interesting.
  
- **Make B actually shift:** Reduce afternoon block to just 900-960 (60 min). And A re-placed to afternoon too (e.g., if morning is also removed).
  - **Revised:** New template: morning removed, biz1 removed, afternoon 900-960 (only 60 min). 
  - A (dur=60) re-placed: only option is afternoon 900-960 → A takes 900-960.
  - B (dur=30) depends on A, `when: 'afternoon'` → needs slot after A finishes at 960 but within afternoon block (900-960 already consumed). No capacity remaining.
  - **Phase 1-4 (normal):** A placed at 900-960. B deferred (A not finished yet at dependency check). Retry: A already placed, B needs slot after 960 in afternoon — no afternoon capacity left.
  - **Phase 5-7:** B's afternoon tag is relaxed → B considered for other blocks. If no other blocks exist → B unplaced.
  
  **Hmm, B getting unplaced is dramatic but valid.** Let me show a cleaner cascade where B successfully shifts:

- **Revised cleaner:** New template: biz1 removed (480-720 gone), but afternoon increased to 900-1080 (same as before).
  - A (dur=60): Options now: morning 360-480 or afternoon 900-1080. Earliest: morning 360-420.
  - A re-placed to 360-420 (weather passes at hour 6, precipProb=5).
  - A finishes at 420 (was 540).
  - B (dur=30): depends on A. A now finishes at 420. B's effective availability shifts 120 min earlier (was 540 → now 420). B still placed at 900-930 (afternoon constraint unchanged). 
  
  **Make B's window shift actually change its placement:**
  - Make the afternoon block have limited capacity where earlier dependency completion matters.
  - Tuesday: morning 360-480, afternoon 900-960 (only 60 min).
  - Another task C (one-off, dur=30, `when: 'afternoon'`) already placed at 900-930.
  - B (dur=30, `when: 'afternoon'`) depends on A. With A's old finish at 540, B couldn't squeeze into the 30-min remaining afternoon slot (930-960 is too close to A's finish). **Wait, B just needs to be after A finishes, and there's 930-960 free. If A finishes at 540, can B be placed at 930-960? Yes — B just needs any afternoon slot after A finishes. So B placed at 930-960 even with A at 540.**
  
  **Let me try a different approach:** Make the afteroon block size and the timing such that B's placement materially changes.
  
- **Simpler approach:** Just show that B's `depReadyAbs` changes. Don't need B to change time slot.
  
- **Final expected:**
  - A re-placed from 480-540 (biz1, removed) to 360-420 (morning, existing, weather passes)
  - B's `depReadyAbs` changes from 540 to 420 (A finishes 120 min earlier)
  - B's scheduled_at stays at 900-930 (afternoon constraint) — but the scheduler did re-evaluate B (not skipped)
  - All items placed, no unplaced items
  - **This demonstrates the cascade:** template change → A re-placed → B's dependency window shifts → B re-evaluated (even if B's time doesn't change)

**Sub-scenarios:**
- [SUB-347a] Template change + weather rejection both cause A to move to a DIFFERENT day → B's `depReadyAbs` shifts to next day → B's rolling anchor adavnces → B placed on next day instead of same day
- [SUB-347b] Template change gives A MORE capacity → A placed earlier → B's window opens earlier → B keeps its slot (no conflict) → B's scheduled_at unchanged
- [SUB-347c] Template change + weather rejection leave A with NO eligible slots → A unplaced with `_unplacedReason='weather'` → B has unmet dependency → B deferred → retry pass: A still unplaced → B's rolling anchor NOT updated (B was never completed) → B remains pending with `dependsOn: ['A']`
- [SUB-347d] 5-way: Template + A/B dep + weather + rolling + deadline: B has deadline '2026-06-15 18:00' → A's re-placement to morning gives B more afternoon capacity → B placed earlier in afternoon, comfortably before deadline
- [SUB-347e] Template change + weather + rolling + TPC: B has tpc=2 → template change affects B's available placement days within the rolling cycle → cascade from A's dependency shift compounds

---

## G-033: Time-travel + config change + missed detection — trigger ordering (LOW cross-domain)

**Context:** When clock advances past a deadline AND the user changes a template simultaneously, both trigger scheduler runs. If these triggers fire within the debounce window (2000ms), they are coalesced into a single run. The ordering of trigger source processing within the coalesced run determines whether tasks are placed in new blocks before being marked missed, or vice versa.

---

### TS-348: Deadline expiry trigger + template change trigger within debounce window → coalesced into single run → tasks evaluated with new blocks AND deadline expiry simultaneously

**Domain:** Reschedule Triggers / Coalescing / Time-Travel / Config Change
**Title:** Coalesced trigger sources: deadline expiry and template change fire within same debounce window — single scheduler run evaluates both new blocks AND deadline expiry

**Data Setup:**
- Clock: initially `2026-06-15T08:00:00Z` (Monday)
- User timezone: `America/New_York`
- User config: default time_blocks (weekday: morning 360-480, biz1 480-720, biz2 720-900, afternoon 900-1080)
- Template: `{ id: 'default', hours: { Mon: { 'morning': { start: 360, end: 480 } } } }` — only morning block on Monday (120 min capacity)
- Task X: `{ id: 'X', text: 'Expiring task', dur: 60, pri: P3, placementMode: 'time_blocks', when: 'morning', deadline: '2026-06-15' }` — deadline is today
- Template change (between trigger fires and scheduler run): template adds biz1 block 480-720 on Monday → capacity increases from 120 to 360 min

**Action sequence (simulated in time):**
1. **T=0:** Clock = 2026-06-15 10:00 (nowMins=600). Task X was NOT placed yet (scheduler hasn't run with new blocks). Deadline = today 23:59 (1380).
2. **T=0:** User saves template change (adds biz1 block) → `enqueueScheduleRun(userId, 'template:save')` called → debounce timer starts (2000ms)
3. **T=500ms:** Clock fast-forward mechanism (or cron-based missed-detection) detects that X's deadline is approaching and triggers missed-detection check → `enqueueScheduleRun(userId, 'cron:missedDetection')` called → debounce timer resets (new 2000ms window from now)
4. **T=2000ms:** Debounce window expires. Rate limit check passes. Single scheduler run begins.

**Key question:** What does the coalesced run see?

**Expected Outcome:**
- The coalesced scheduler run receives the trigger (combining both sources) and sees:
  1. Updated template with biz1 block (480-720) — because the template change was persisted to DB before the scheduler run started
  2. Current clock (nowMins=600) — task X's deadline (1380) is still in the future
- **Run execution:**
  - X's deadline is 1380 (not yet expired). X considered for placement.
  - Morning block (360-480): has 120 min capacity. X needs 60 min. BUT morning block time has passed (nowMins=600 > 480). Morning block is in the past.
  - Biz1 block (480-720): newly added by template change. Current time is 600, so biz1 from 600-720 is available (60 min remaining). X placed at 600-660 in biz1 block.
  - X is placed correctly — deadline NOT missed because biz1 block was added by the template change.
- **If deadline expiry had been processed FIRST (before template change was visible):**
  - X would be marked missed at 10:00 (nowMins=600) because morning block (360-480) has passed
  - X gets `status='missed'`, `_unplacedReason='missed'`
  - Template change arrives after X is marked missed → X is already terminal → template change can't resurrect it
  - **This is the wrong outcome** — the deadline expiry trigger arrived after the template change trigger in real time, but if the scheduler processes triggers in the wrong order within the coalesced run, the bad outcome occurs
- **Correct outcome:** The coalesced run must see the latest state from ALL trigger sources simultaneously. Deadline expiry check must consider the new blocks. Since biz1 exists and has capacity at 600-660, X is placed there, NOT marked missed.

**Sub-scenarios:**
- [SUB-348a] Deadline expiry trigger arrives FIRST (T=0), template change trigger arrives SECOND (T=500ms) → same coalesced run, same expected outcome (order of triggers within debounce window doesn't matter — the run evaluates current DB state)
- [SUB-348b] Triggers arrive OUTSIDE debounce window (spaced > 2000ms apart) → TWO separate runs:
  - Run 1: deadline expiry trigger fires → X missed because morning block past, no biz1 yet
  - Run 2: template change trigger fires → X already missed (terminal status) → template change does NOT resurrect X → X stays missed despite new blocks
  - **This is a known scheduler limitation:** order-dependent, but correct because triggers are separate events
- [SUB-348c] Deadline expiry trigger actually fires BEFORE the template change was persisted (template change event hasn't been written to DB yet when deadline run starts) → deadline run sees old template → X missed → template change persisted after → X stays missed. This is a race condition to document.
- [SUB-348d] Three coalesced triggers: template change + deadline expiry + weather update within debounce window → single run evaluates all three simultaneously → X placed in biz1 (via template change), weather checks biz1 (passes), deadline not expired (1380 > 600) → all good
- [SUB-348e] Reverse scenario: template change REMOVES blocks → deadline expiry trigger coalesced → X's only available block removed, deadline approaching → single run: X has no slots, deadline not yet expired → X unplaced with slack-based reason (not missed). If template removal and deadline expiry were processed separately: Run 1 (template removal) → X unplaced but pending. Run 2 (deadline expiry) → X still unplaced → marked missed. **Coalesced run produces a DIFFERENT (arguably better) outcome:** X stays pending because the scheduler can evaluate deadline relaxation in the same run.

---

## Summary of New Tests

| ID | Domain | Title |
|----|--------|-------|
| TS-335 | Split × Travel × Location | Same location all chunks, hourLocationOverride changes chunk 2 → travel needed |
| TS-336 | Deadline × Dependency | Competing deadlines: A.deadline=Fri, B.deadline=Wed → A gets faux deadline=Wed |
| TS-337 | Deadline × Dependency / Fallback | Backprop NOT implemented → Phase 7 is only fallback for unmet faux deadlines |
| TS-338 | TPC / Spacing Guard / Cross-Cycle | Safety valve across cycle boundaries — all candidates within minGap |
| TS-339 | Rolling / Stale Guard / On-Demand | On-demand materialization bypasses stale guard → anchor regresses |
| TS-340 | Split × Recurring × Overflow / Template | Overflow cleared when template adds capacity |
| TS-341 | Recurring Split / Drift Fix | Drift fix skips wip/done chunks |
| TS-342 | Template / Config Change / Block Loss | All blocks deleted → anytime synthetic window, when-tag tasks unplaced |
| TS-343 | Reminder / Occupancy | Reminder placed at GRID_START+1 if GRID_START occupied |
| TS-344 | Dependency / Circular Detection | Indirect 3-link cycle A→B→C→A detected and rejected |
| TS-345 | Reschedule Triggers / Rate Limit | 11th enqueueScheduleRun returns error to caller (HTTP 429) |
| TS-346 | Cross: Calendar × Split × Weather | Merged event splits on weather-driven re-placement |
| TS-347 | Cross: Template × Dep × Weather × Rolling | 4-way cascade: template change + weather reject + dependency shift across rolling |
| TS-348 | Cross: Time-Travel × Config × Missed | Coalesced triggers: deadline expiry + template change evaluated simultaneously |