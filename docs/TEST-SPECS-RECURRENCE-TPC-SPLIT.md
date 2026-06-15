# Juggler Scheduler — Full Structured Test Specs
## Recurrence Types | TPC | Rolling Recurrence | Instance Lifecycle | Split Tasks

**Updated:** 2026-06-15  
**Scope:** TS-72 through TS-126br  

---

## Format Legend

Each test spec includes:
- **ID** — Test scenario identifier
- **Domain** — Feature area
- **Title** — One-line description
- **Data Setup** — Preconditions, clock, master task config, existing instances
- **Action** — What triggers the behavior (scheduler run / status change / cron)
- **Expected Outcome** — What must happen (instances generated, placements, statuses)
- **Sub-scenarios** — Related edge cases that should also be covered

---

# 1. Recurrence Types (TS-72 to TS-84)

---
**ID:** TS-72  
**Domain:** Recurrence / Daily  
**Title:** Daily recurrence — instances generated every day for 14 days  
**Data Setup:**
- User config: default time_blocks, default tool_matrix
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master task: `{ id: 'master-1', text: 'Daily task', dur: 30, pri: P3, placementMode: 'anytime', recurring: true, recur: { type: 'daily' }, recurStart: '2026-06-15' }`
- No existing instances
**Action:** Run scheduler (expandRecurring → unifiedScheduleV2)
**Expected Outcome:**
- 14 instances generated: master-1-1 through master-1-14
- Instance dates: 2026-06-15 through 2026-06-28
- Each instance has `source_id='master-1'` and `occurrence_ordinal=1..14`
- Each instance is placed by scheduler (day-locked to occurrence date)
- Source date (2026-06-15) is skipped (no duplicate instance for recurStart day)
**Sub-scenarios:**
- [SUB-72a] Daily with dur=480 (max single-task fit) → still generates daily instances, scheduler places what fits each day
- [SUB-72b] Daily + deadline → each instance gets auto-deadline = occurrence date (same-day only)
- [SUB-72c] Daily + weather constraint → each instance independently weather-checked each day
- [SUB-72d] Daily across DST transition → times adjust correctly (spring forward / fall back)
- [SUB-72e] Daily + time_blocks mode → each instance placed within same-day blocks
- [SUB-72f] Daily + time_window mode → each instance placed within its preferred time ± flex window (day-locked)
- [SUB-72g] Daily + all_day mode → instances as banners on each occurrence date
- [SUB-72h] Daily + reminder mode → instances as markers on each occurrence date
- [SUB-72i] Daily with multiple masters → each generates independently
- [SUB-72j] Daily + existing terminal instances on some dates → deduplication skips those dates
- [SUB-72k] Daily + existing pending instances on some dates → dedup preserves via ID-reuse

---
**ID:** TS-73  
**Domain:** Recurrence / Weekly  
**Title:** Weekly recurrence — instances on specified days (e.g. MWF)  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Weekly task', dur: 30, pri: P3, placementMode: 'anytime', recurring: true, recur: { type: 'weekly', days: 'MWF' }, recurStart: '2026-06-15' }`
- No existing instances
**Action:** Run scheduler
**Expected Outcome:**
- Instances on: 2026-06-17 (Wed), 2026-06-19 (Fri), 2026-06-22 (Mon), 2026-06-24 (Wed), 2026-06-26 (Fri), etc. — up to 14-day horizon
- No instances on Tue, Thu, Sat, Sun
- Source date (2026-06-15, Mon) is skipped
- Total instances: (MWF × 2-week horizon minus source) = ~5-6 instances
**Sub-scenarios:**
- [SUB-73a] Weekly with no `days` specified → defaults to MTWRF (weekdays)
- [SUB-73b] Weekly with `days: 'SS'` (weekends only) → instances on Sat, Sun
- [SUB-73c] Weekly with `days: 'MTWRFSS'` (all 7 days) → daily-like within weekly structure
- [SUB-73d] Weekly with `days: 'M'` (single day) → instance every Monday
- [SUB-73e] Weekly spanning a month boundary → correct day selection
- [SUB-73f] Weekly + time_blocks → each instance placed within blocks on its day
- [SUB-73g] Weekly + existing instances → dedup correctly matches by date

---
**ID:** TS-74  
**Domain:** Recurrence / Biweekly  
**Title:** Biweekly recurrence — instances every 2 weeks, parity-dependent  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday, even week)
- Master: `{ id: 'master-1', text: 'Biweekly task', dur: 30, pri: P3, placementMode: 'anytime', recurring: true, recur: { type: 'biweekly', days: 'M' }, recurStart: '2026-06-15' }`
- No existing instances
**Action:** Run scheduler
**Expected Outcome:**
- Instances on: 2026-06-15 (Week 0, source skipped), Week 1 (odd, skip), 2026-06-29 (Week 2, even) — correct biweekly cadence
- No instances in odd weeks (e.g. 2026-06-22)
- Each instance has correct ordinal numbering
**Sub-scenarios:**
- [SUB-74a] Biweekly parity computed from `recurStart`, not `src.date` (anchor fallback)
- [SUB-74b] Biweekly with `recurStart` on odd week → instances in odd weeks only
- [SUB-74c] Biweekly with no `recurStart` → falls back to `src.date` for parity anchor
- [SUB-74d] Biweekly with multiple day codes ('MWF') → each selected day follows biweekly pattern
- [SUB-74e] Biweekly across month/year boundary → parity preserved
- [SUB-74f] Biweekly + existing instances → dedup prevents re-creation
- [SUB-74g] Biweekly + TPC → TPC overlay works within 14-day cycles

---
**ID:** TS-75  
**Domain:** Recurrence / Monthly  
**Title:** Monthly recurrence — instances on specified month days  
**Data Setup:**
- Clock: fixed at `2026-06-01T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Monthly task', dur: 30, pri: P3, placementMode: 'anytime', recurring: true, recur: { type: 'monthly', monthDays: [1, 15] }, recurStart: '2026-06-01' }`
- No existing instances
**Action:** Run scheduler
**Expected Outcome:**
- Instances on: 2026-06-15, 2026-07-01, 2026-07-15 (within 14-day horizon June 1 → June 15)
- Instance on 2026-06-01 (source) is skipped
- Correct ordinal numbering across month boundary
**Sub-scenarios:**
- [SUB-75a] Monthly with `monthDays: ['last']` → last day of each month (Feb 28, Mar 31, etc.)
- [SUB-75b] Monthly with `monthDays: ['first']` → first day of each month
- [SUB-75c] Monthly with `monthDays: [28, 29, 30, 31]` → handles months with fewer days (e.g. Feb 28)
- [SUB-75d] Monthly with `monthDays: [1]` → single instance on 1st of each month
- [SUB-75e] Monthly on 31st → skipped in months with 30 days (Apr, Jun, Sep, Nov)
- [SUB-75f] Monthly + horizon boundary → instance just inside/outside horizon
- [SUB-75g] Monthly + leap year → Feb 29 handled correctly
- [SUB-75h] Monthly + TPC → TPC overlay works within ~30-day cycles

---
**ID:** TS-76  
**Domain:** Recurrence / Interval  
**Title:** Interval recurrence (every N days) — arithmetic projection  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Interval task', dur: 30, pri: P3, placementMode: 'anytime', recurring: true, recur: { type: 'interval', every: 3, unit: 'days' }, recurStart: '2026-06-15' }`
- No existing instances
**Action:** Run scheduler
**Expected Outcome:**
- Instances on: 2026-06-18 (+3d), 2026-06-21 (+6d), 2026-06-24 (+9d), 2026-06-27 (+12d)
- Source date 2026-06-15 is skipped
- Each instance has correct ordinal and date arithmetic
**Sub-scenarios:**
- [SUB-76a] Interval every 1 day ('every': 1, 'unit': 'days') → daily-like (but arithmetic, not day-by-day iteration)
- [SUB-76b] Interval every 14 days (exactly the horizon) → last instance at horizon edge
- [SUB-76c] Interval every 15 days (beyond horizon) → no instances generated (first is past horizon)
- [SUB-76d] Interval with large N (every 365 days) → only one instance if within horizon
- [SUB-76e] Interval + anchor falls on recurrence boundary → correct projection
- [SUB-76f] Interval + recurStart in past → instances from today onward
- [SUB-76g] Interval + existing instances → dedup by date
- [SUB-76h] Interval with 'unit': 'months' → monthly arithmetic (every N months)

---
**ID:** TS-77  
**Domain:** Recurrence / Interval (weekly)  
**Title:** Interval recurrence (every N weeks) — weekly arithmetic  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Biweekly interval', dur: 30, pri: P3, placementMode: 'anytime', recurring: true, recur: { type: 'interval', every: 2, unit: 'weeks' }, recurStart: '2026-06-15' }`
- No existing instances
**Action:** Run scheduler
**Expected Outcome:**
- Instances on: 2026-06-29 (+14d)
- Source date 2026-06-15 is skipped
- Correct N-weeks arithmetic (every × 7 days)
**Sub-scenarios:**
- [SUB-77a] Every 1 week → instance weekly on anchor day-of-week
- [SUB-77b] Every 3 weeks → instances 21 days apart
- [SUB-77c] Every 1 week starting Wednesday → always Wednesday
- [SUB-77d] Every N weeks crossing year boundary
- [SUB-77e] Every N weeks + dedup with existing instances

---
**ID:** TS-78  
**Domain:** Recurrence / Rolling  
**Title:** Rolling recurrence — arithmetic from rollingAnchor  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Haircut', dur: 30, pri: P3, placementMode: 'anytime', recurring: true, recur: { type: 'rolling', intervalDays: 7 }, recurStart: '2026-06-01', rollingAnchor: '2026-06-08' }`
- No existing instances
**Action:** Run scheduler
**Expected Outcome:**
- Instances on: 2026-06-15 (anchor 6-08 + 7d), 2026-06-22 (+14d), 2026-06-29 (+21d)
- No instance on 2026-06-01 or 2026-06-08 (rollingAnchor overrides recurStart)
- Instances use arithmetic projection, not day-by-day iteration
**Sub-scenarios:**
- [SUB-78a] Rolling with null rollingAnchor → falls back to recurStart
- [SUB-78b] Rolling with null rollingAnchor AND null recurStart → falls back to src.date, then startDate
- [SUB-78c] Rolling with 3.5-day interval → rounds create instances at +4, +7, +11, +14 days
- [SUB-78d] Rolling with intervalDays=1 → daily arithmetic from anchor
- [SUB-78e] Rolling with existing terminal instance → deduped (date blocked)
- [SUB-78f] Rolling anchor changes between scheduler runs → different projections

---
**ID:** TS-79  
**Domain:** Recurrence / Boundary  
**Title:** Recurrence with recurEnd — no instances past end date  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Ending task', dur: 30, pri: P3, placementMode: 'anytime', recurring: true, recur: { type: 'daily' }, recurStart: '2026-06-15', recurEnd: '2026-06-20' }`
- No existing instances
**Action:** Run scheduler
**Expected Outcome:**
- Instances on: 2026-06-16 through 2026-06-20 (5 instances)
- No instances on 2026-06-21 or later, even though horizon extends to 2026-06-28
- Source date 2026-06-15 is skipped
**Sub-scenarios:**
- [SUB-79a] recurEnd before today → no instances generated (all in past)
- [SUB-79b] recurEnd === recurStart → only one instance (if not same day) or zero
- [SUB-79c] recurEnd in distant future → horizon still caps at 14 days
- [SUB-79d] Weekly + recurEnd mid-week → last instance on recurEnd date (if it matches a selected day)
- [SUB-79e] Monthly + recurEnd → no instances past recurEnd month
- [SUB-79f] Interval + recurEnd → last projection stops at or before recurEnd
- [SUB-79g] Rolling + recurEnd → last projection bounded by recurEnd

---
**ID:** TS-80  
**Domain:** Recurrence / Boundary  
**Title:** Recurrence with recurStart — instances start from this date  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Starting task', dur: 30, pri: P3, placementMode: 'anytime', recurring: true, recur: { type: 'weekly', days: 'MWF' }, recurStart: '2026-06-10' }` (Wednesday, before today)
- No existing instances
**Action:** Run scheduler
**Expected Outcome:**
- First instance after today: 2026-06-15 (Monday — first MWF day on or after today)
- If recurStart is before today, expansion anchors on recurStart but only emits instances from today forward
- Correct weekly cadence from recurStart anchor
**Sub-scenarios:**
- [SUB-80a] recurStart in the future → instances start from that future date
- [SUB-80b] recurStart === today → source date skipped, first instance next occurrence
- [SUB-80c] recurStart differs from src.date → recurStart takes precedence for anchor
- [SUB-80d] recurStart + biweekly parity → parity computed from recurStart
- [SUB-80e] recurStart null → falls back to src.date
- [SUB-80f] recurStart === recurEnd → no instances
- [SUB-80g] recurStart set after instances already exist → anchor change shifts cadence

---
**ID:** TS-81  
**Domain:** Recurrence / Template status  
**Title:** Paused template — expansion skipped  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Paused task', dur: 30, pri: P3, placementMode: 'anytime', recurring: true, recur: { type: 'daily' }, recurStart: '2026-06-15', status: 'pause' }`
- No existing instances
**Action:** Run scheduler
**Expected Outcome:**
- No expansion: 0 instances generated for this master
- Template remains in 'pause' status
- No new rows inserted into task_instances
**Sub-scenarios:**
- [SUB-81a] Paused template that previously had instances → existing instances preserved (no deletion)
- [SUB-81b] Paused template resumed → next scheduler run generates instances normally
- [SUB-81c] Paused + paused → no change each run
- [SUB-81d] Paused template with rolling recurrence → anchor unchanged while paused

---
**ID:** TS-82  
**Domain:** Recurrence / Template status  
**Title:** Disabled template — expansion skipped  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Disabled task', dur: 30, pri: P3, placementMode: 'anytime', recurring: true, recur: { type: 'daily' }, recurStart: '2026-06-15', disabled: true }`
- No existing instances
**Action:** Run scheduler
**Expected Outcome:**
- No expansion: 0 instances generated
- Template remains disabled
**Sub-scenarios:**
- [SUB-82a] Disabled template with existing instances → existing instances preserved
- [SUB-82b] Disabled template re-enabled → instances generated on next scheduler run
- [SUB-82c] Disabled + paused (both flags) → still skipped (double-guarded)
- [SUB-82d] Disabled rolling template → anchor unchanged while disabled

---
**ID:** TS-83  
**Domain:** Recurrence / Horizon  
**Title:** Horizon limit (14 days) — instances only generated within horizon  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Horizon task', dur: 30, pri: P3, placementMode: 'anytime', recurring: true, recur: { type: 'daily' }, recurStart: '2026-06-01' }` (recurStart 14 days before today)
- Existing instances up to today
**Action:** Run scheduler
**Expected Outcome:**
- Instances generated for dates today through today + 13 (June 15 – June 28)
- No instances generated for dates beyond June 28 (horizon = today + RECUR_EXPAND_DAYS)
- No instances generated for dates before today (even if recurStart is earlier)
**Sub-scenarios:**
- [SUB-83a] Weekly with selected day just outside horizon → no instance for that day
- [SUB-83b] Monthly with monthly day outside horizon → no instance for that month
- [SUB-83c] Interval where first projection lands outside horizon → no instances at all
- [SUB-83d] Horizon boundary on DST transition day
- [SUB-83e] CONFIG change to RECUR_EXPAND_DAYS (if configurable) → horizon adjusts

---
**ID:** TS-84  
**Domain:** Recurrence / Horizon  
**Title:** Grandfather clause — pending instances beyond horizon NOT deleted  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Grandfather task', dur: 30, pri: P3, placementMode: 'anytime', recurring: true, recur: { type: 'daily' }, recurStart: '2026-06-01' }`
- Existing pending instances: one on 2026-06-29 (1 day beyond 14-day horizon), one on 2026-07-01 (16 days beyond)
**Action:** Run scheduler (expandRecurring → reconcileOccurrences)
**Expected Outcome:**
- Pending instance on 2026-06-29 is preserved (grandfathered — not deleted)
- Pending instance on 2026-07-01 is preserved
- Instances within horizon (June 15–28) are generated normally
- Instances before today are NOT generated (replaced by existing terminal rows)
- The reconciler's toDeleteIds set excludes instances past horizon
**Sub-scenarios:**
- [SUB-84a] Mixed pending + terminal beyond horizon → both preserved
- [SUB-84b] Instances beyond horizon that are canceled/done/skip → all preserved
- [SUB-84c] Horizon shrink scenario: if RECUR_EXPAND_DAYS was previously 30 and now 14 → existing far-future instances grandfathered
- [SUB-84d] Grandfathered instances beyond horizon still candidate for missed detection
- [SUB-84e] Grandfathered + rolling anchor update → anchor advances normally despite being beyond horizon

---

# 2. Times Per Cycle (TS-85 to TS-93)

---
**ID:** TS-85  
**Domain:** TPC / Fill Policy  
**Title:** TPC with keep fill policy — skip doesn't open slot  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'TPC keep task', dur: 30, pri: P3, placementMode: 'anytime', recurring: true, recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 3 }, recurStart: '2026-06-15', fillPolicy: 'keep' }`
- Existing: one skipped instance on 2026-06-15 (Mon), one done instance on 2026-06-16 (Tue)
- No other existing instances
**Action:** Run expandRecurring with `fillPolicy: 'keep'`
**Expected Outcome:**
- Only 1 slot needed (1 pending spot still open) — the skip does NOT open a refill slot
- The 3-instance cycle currently has: 1 done + 1 skip = 2 occupied → cycle is "user-owned" → no refills
- Only the done instance counts as fulfilled; skip prevents new picks via refill-avoidance
**Sub-scenarios:**
- [SUB-85a] keep policy: all 3 instances skipped → no new picks, 0 instances emitted
- [SUB-85b] keep policy: 2 done + 1 skip → cycle full, 0 instances emitted
- [SUB-85c] keep policy: fresh cycle (no existing of any kind) → picks full tpc=3
- [SUB-85d] keep policy: mix of done + pending + skip → pending dates emitted (preserved), skip dates not refilled
- [SUB-85e] keep policy: all pending (no skip/done) → all pending emitted, no new picks

---
**ID:** TS-86  
**Domain:** TPC / Fill Policy  
**Title:** TPC with backfill fill policy — skip opens slot  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'TPC backfill task', dur: 30, pri: P3, placementMode: 'anytime', recurring: true, recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 3 }, recurStart: '2026-06-15', fillPolicy: 'backfill' }`
- Existing: one skipped instance on 2026-06-15 (Mon), one done on 2026-06-16 (Tue)
- No other existing instances
**Action:** Run expandRecurring with pendingBookedByDate and fillPolicy backfill
**Expected Outcome:**
- 2 slots needed (tpc=3 - 1 done = 2 fulfilled; skip does NOT count as fulfilled, so slot opens)
- New instance picked to fill the skip-opened slot, in addition to the 1 unfilled slot
- If pending dates already exist, they emit as desired (no new picks beyond budget)
**Sub-scenarios:**
- [SUB-86a] backfill: all 3 skipped → 3 new slots opened (all refilled)
- [SUB-86b] backfill: 2 cancel + 1 skip → 3 new slots opened (cancel counts as fulfilled in backfill? Check spec: cancel counts as fulfilled)
- [SUB-86c] backfill: 1 done + 2 skip → 2 new slots opened
- [SUB-86d] backfill: fresh cycle → same as keep, picks full tpc
- [SUB-86e] backfill: cycle with all done → 0 slots needed
- [SUB-86f] backfill + pendingBookedByDate → pending dates emitted, no replacement for skip if it would exceed budget

---
**ID:** TS-87  
**Domain:** TPC / Spacing Guard  
**Title:** TPC spacing guard — minGap respected  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Weekly spaced', dur: 30, pri: P3, placementMode: 'time_blocks', isFlexibleTpc: true, recurring: true, recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 2 }, recurStart: '2026-06-15' }`
- recurringHistoryByMaster: `{ 'master-1': '2026-06-15' }` (last done on Monday)
- Today = Monday, cycle = 7 days, minGap = max(1, floor(7*0.5)) = 3
**Action:** Run scheduler (findEarliestSlot for flexible TPC item)
**Expected Outcome:**
- First instance placed at or after 2026-06-15 (no guard for first placement after the anchor)
- Second instance placed at or after 2026-06-18 (Mon + 3 = Thu)
- Candidate days Mon (6/15), Tue (6/16), Wed (6/17) are rejected by spacing guard
- If cycle extends to 6/21 (Sun), only Thu-Sun are valid candidates
**Sub-scenarios:**
- [SUB-87a] minGap=3, history from 2 cycles ago → guard passes trivially
- [SUB-87b] minGap=3, last done at end of cycle → first eligible next-cycle date is correctly after minGap
- [SUB-87c] Daily tpc=1, cycleDays=1 → minGap=1 → no effective guard (adjacent days still valid)
- [SUB-87d] Monthly tpc=1, cycleDays=30 → minGap=15 → prevents early-month placement after mid-month completion
- [SUB-87e] Biweekly, cycleDays=14 → minGap=7 → prevents cross-cycle adjacency
- [SUB-87f] First-ever run (no history) → no guard, behaves as before
- [SUB-87g] History older than 1 cycle → guard passes, date far in the past

---
**ID:** TS-88  
**Domain:** TPC / Spacing Guard  
**Title:** TPC spacing guard safety valve — ignored when blocking all placements  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Tight cycle', dur: 30, pri: P3, placementMode: 'time_blocks', isFlexibleTpc: true, recurring: true, recur: { type: 'weekly', days: 'MF', timesPerCycle: 2 }, recurStart: '2026-06-15' }`
- recurringHistoryByMaster: `{ 'master-1': '2026-06-15' }` (done Mon)
- minGap=3, cycle has only Mon(6/15) and Fri(6/19) — both candidates: Mon blocked (within 3 days of last), Fri is valid
- NOW TEST THE SAFETY VALVE: cycleDays=3 (custom small cycle), minGap=1. Every day within guard.
**Action:** Run scheduler placement with all candidates blocked by spacing guard
**Expected Outcome:**
- Safety valve activates when ALL candidate dates are within minGap window
- The nearest candidate is selected regardless of spacing guard
- Instance placed (not unplaced)
- Safety valve prevents permanently unplaceable occurrences
**Sub-scenarios:**
- [SUB-88a] Safety valve: minGap=5, cycle has only 2 days, both within 5 days of last → guard ignored
- [SUB-88b] Safety valve NOT triggered when at least 1 candidate passes → guard enforced
- [SUB-88c] Safety valve with daily recurrence → minGap=1, always at least 1 candidate outside guard
- [SUB-88d] Safety valve across multiple cycles → prevents anti-pattern of consecutive days at cycle boundary

---
**ID:** TS-89  
**Domain:** TPC / Flexibility  
**Title:** TPC flexible (isFlexibleTpc=true) — can roam within cycle  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Flexible task', dur: 30, pri: P3, placementMode: 'time_blocks', isFlexibleTpc: true, recurring: true, recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 2 }, recurStart: '2026-06-15' }`
- DayReq expanded to all 5 MWF candidate days
- No existing instances
**Action:** Run scheduler
**Expected Outcome:**
- Scheduler can place the flexible TPC instance on ANY of the 5 eligible days, not just the picked date
- Instance can roam from picked Monday to e.g. Wednesday if Monday is full
- `isDayLocked=false` — not rigidly bound to occurrence date
- Roaming is bounded by cycle window (anchorDate to anchorDate+cycleDays-1)
**Sub-scenarios:**
- [SUB-89a] Flexible TPC + all 5 days available → placed on target-interval picked day
- [SUB-89b] Flexible TPC + picked day full → roams to next available day in cycle
- [SUB-89c] Flexible TPC + all days in cycle full → instance unplaced
- [SUB-89d] Flexible TPC + spacing guard → roam respects minGap from lastByMaster
- [SUB-89e] Flexible TPC across 2-week biweekly cycle → roams within 14-day window
- [SUB-89f] Flexible TPC + time_window mode → roam within window on any eligible day

---
**ID:** TS-90  
**Domain:** TPC / Rigidity  
**Title:** TPC non-flexible — day-locked to occurrence date  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Rigid TPC task', dur: 30, pri: P3, placementMode: 'anytime', isFlexibleTpc: false, recurring: true, recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 2 }, recurStart: '2026-06-15' }`
- isDayLocked=true (rigid anchoring)
**Action:** Run scheduler
**Expected Outcome:**
- Instance is day-locked to its occurrence date (the picked date)
- If that day has no available slot, instance goes unplaced (cannot roam)
- Backlog: instance stays on its day even if that day is past
- Non-flexible TPC behaves same as non-TPC recurring for day-lock purposes
**Sub-scenarios:**
- [SUB-90a] Non-flexible TPC + picked day full → unplaced (not roamed)
- [SUB-90b] Non-flexible TPC + picked day has space → placed at first available slot
- [SUB-90c] Non-flexible TPC + past occurrence → placed at latest available slot on that date
- [SUB-90d] Non-flexible TPC + deadline bracket stays anchored to occurrence date

---
**ID:** TS-91  
**Domain:** TPC / Target-interval steering  
**Title:** TPC target-interval steering — picks closest to lastPlaced + targetInterval  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Steered task', dur: 30, pri: P3, placementMode: 'anytime', recurring: true, recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 3 }, recurStart: '2026-06-15' }`
- cycleDays=7, targetInterval = 7/3 ≈ 2.33 days
- No existing instances
**Action:** Run expandRecurring
**Expected Outcome:**
- Picker computes targetInterval = cycleDays / tpc = 7/3 ≈ 2.33 days
- Picks sorted: closest to recurStart + n*targetInterval
- First pick near recurStart, second near recurStart+2.33, third near recurStart+4.67
- If target day unavailable, picks nearest available day
**Sub-scenarios:**
- [SUB-91a] target interval lands exactly on non-selected day → nearest selected day picked
- [SUB-91b] target interval with 2 pick cycles → even spacing across cycle
- [SUB-91c] target interval tpc=1 → picks centered in cycle (midpoint)
- [SUB-91d] target interval tpc=6 in 5-day week → picks fill all days with even spacing
- [SUB-91e] target interval with existing placements → new picks avoid already-booked days

---
**ID:** TS-92  
**Domain:** TPC / Spacing History  
**Title:** TPC with done status — counts toward spacing history  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Done spacing', dur: 30, pri: P3, placementMode: 'time_blocks', isFlexibleTpc: true, recurring: true, recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 2 }, recurStart: '2026-06-15' }`
- recurringHistoryByMaster: `{ 'master-1': '2026-06-15' }` (done on Monday)
- minGap = 3 days from last placement
**Action:** Run scheduler
**Expected Outcome:**
- Spacing guard blocks days within 3 days of 2026-06-15 (Mon)
- First eligible: 2026-06-18 (Thu)
- The done status correctly updated lastByMaster
- done counts as valid history data point for spacing computation
**Sub-scenarios:**
- [SUB-92a] Multiple consecutive 'done' across runs → each updates lastByMaster
- [SUB-92b] Done on first run, then done again → second placement respects spacing from first
- [SUB-92c] Combine done from recurringHistoryByMaster + done from same-run placement → most recent wins

---
**ID:** TS-93  
**Domain:** TPC / Spacing History  
**Title:** TPC with skip/cancel — does NOT block spacing  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Skip spacing', dur: 30, pri: P3, placementMode: 'time_blocks', isFlexibleTpc: true, recurring: true, recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 2 }, recurStart: '2026-06-15' }`
- recurringHistoryByMaster: `{ 'master-1': '2026-06-15' }` — but the 2026-06-15 was a SKIP (not done)
**Action:** Run scheduler with skip in spacing history
**Expected Outcome:**
- Skip does NOT seed spacing history
- lastByMaster is empty or doesn't count the skip
- No spacing guard applied (skip means user opted out of that slot)
- Placement proceeds as if no history exists
**Sub-scenarios:**
- [SUB-93a] Cancel also does NOT block spacing
- [SUB-93b] Missed also does NOT block spacing
- [SUB-93c] Skip followed by done → done updates history, skip ignored
- [SUB-93d] All instances skipped → no spacing history → no guard on next run

---

# 3. Rolling Recurrence (TS-94 to TS-100)

---
**ID:** TS-94  
**Domain:** Rolling / Anchor  
**Title:** Rolling anchor updated on done — re-anchored to instanceDate  
**Data Setup:**
- Master: `{ id: 'master-1', text: 'Rolling done', recurring: true, recur: { type: 'rolling', intervalDays: 7 }, rollingAnchor: '2026-06-08', recurStart: '2026-06-01' }`
- Instance: date='2026-06-15', status='done'
- currentAnchor = '2026-06-08'
**Action:** Call `computeRollingAnchor('done', '2026-06-15', '2026-06-08')`
**Expected Outcome:**
- Returns '2026-06-15' (instanceDate becomes new anchor)
- Next generation starts from 2026-06-15 + 7d = 2026-06-22
- Template's rollingAnchor field updated in DB
**Sub-scenarios:**
- [SUB-94a] Done on same day as current anchor (=) → new anchor = same date (accepted)
- [SUB-94b] Done far in the future → anchor jumps forward by more than interval
- [SUB-94c] Done on a past date (< currentAnchor) → stale guard returns null
- [SUB-94d] Done with null currentAnchor → always accepted
- [SUB-94e] Multiple done on same date (duplicate) → anchor set to that date (idempotent)

---
**ID:** TS-95  
**Domain:** Rolling / Anchor  
**Title:** Rolling anchor updated on skip — re-anchored to instanceDate  
**Data Setup:**
- Master: `{ id: 'master-1', text: 'Rolling skip', recurring: true, recur: { type: 'rolling', intervalDays: 7 }, rollingAnchor: '2026-06-08', recurStart: '2026-06-01' }`
- Instance: date='2026-06-15', status='skip'
- currentAnchor = '2026-06-08'
**Action:** Call `computeRollingAnchor('skip', '2026-06-15', '2026-06-08')`
**Expected Outcome:**
- Returns '2026-06-15' (skip re-anchors to instanceDate)
- Next generation from 2026-06-15 + 7d
- Full re-anchor from skip date — user skipping resets the cadence
**Sub-scenarios:**
- [SUB-95a] Skip same as current anchor → new anchor = same date
- [SUB-95b] Skip past date (stale guard) → null
- [SUB-95c] Skip with null anchor → instanceDate returned
- [SUB-95d] Multiple skips → each updates anchor

---
**ID:** TS-96  
**Domain:** Rolling / Anchor  
**Title:** Rolling anchor NOT updated on cancel — null (no change)  
**Data Setup:**
- Master: `{ id: 'master-1', text: 'Rolling cancel', recurring: true, recur: { type: 'rolling', intervalDays: 7 }, rollingAnchor: '2026-06-08', recurStart: '2026-06-01' }`
- Instance: date='2026-06-15', status='cancel'
- currentAnchor = '2026-06-08'
**Action:** Call `computeRollingAnchor('cancel', '2026-06-15', '2026-06-08')`
**Expected Outcome:**
- Returns null (no change to anchor)
- Anchor stays at '2026-06-08'
- Next generation still from 2026-06-08 + 7d = 2026-06-15 (but that date has a cancel, so it's terminal-deduped)
- User canceling does NOT affect the rolling cadence
**Sub-scenarios:**
- [SUB-96a] Cancel on the anchor date itself → anchor unchanged
- [SUB-96b] Cancel on a future instance → anchor unchanged, instance only blocked via dedup
- [SUB-96c] Cancel + null anchor → returns null (no change to null)
- [SUB-96d] Multiple cancels → anchor never changes
- [SUB-96e] Cancel after done → anchor stays at done date (cancel doesn't regress)

---
**ID:** TS-97  
**Domain:** Rolling / Anchor  
**Title:** Rolling anchor soft nudge on missed — instanceDate + 1 day  
**Data Setup:**
- Master: `{ id: 'master-1', text: 'Rolling missed', recurring: true, recur: { type: 'rolling', intervalDays: 7 }, rollingAnchor: '2026-06-08', recurStart: '2026-06-01' }`
- Instance: date='2026-06-15', status='missed' (system-set)
- currentAnchor = '2026-06-08'
**Action:** Call `computeRollingAnchor('missed', '2026-06-15', '2026-06-08')`
**Expected Outcome:**
- Returns '2026-06-16' (instanceDate + 1 day)
- Soft nudge: missed means the user didn't do it, so push anchor one day forward
- Next generation from 2026-06-16 + 7d = 2026-06-23
- The nudge prevents the next instance from being due the same day
**Sub-scenarios:**
- [SUB-97a] Missed + stale guard (instanceDate < currentAnchor) → null (stale wins over nudge)
- [SUB-97b] Missed multiple days in a row → each adds +1d, anchor advances further
- [SUB-97c] Missed on current anchor date (=) → anchor becomes currentAnchor + 1d
- [SUB-97d] Missed + null anchor → instanceDate + 1d returned
- [SUB-97e] Missed on a day that's already past anchor → stale guard returns null

---
**ID:** TS-98  
**Domain:** Rolling / Backfill  
**Title:** Rolling backfill from history — latest done date  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Rolling backfill', dur: 30, pri: P3, placementMode: 'anytime', recurring: true, recur: { type: 'rolling', intervalDays: 7 }, recurStart: '2026-01-01', rollingAnchor: null }` (no anchor — needs backfill)
- recurringHistoryByMaster: `{ 'master-1': '2026-06-08' }` (latest done from history)
- Instance on 2026-06-15 not yet generated
**Action:** runSchedule.js lines 481-506 — backfill rollingAnchor before expandRecurring
**Expected Outcome:**
- Before expansion, rollingAnchor is backfilled to '2026-06-08' from recurringHistoryByMaster
- Next instance generated at 2026-06-15 (6/08 + 7d)
- Without backfill, would use recurStart '2026-01-01' → wrong projection (20+ weeks old)
- Backfill prevents stale recurStart from generating incorrect dates
**Sub-scenarios:**
- [SUB-98a] Backfill when rollingAnchor is already set → no-op (existing anchor used)
- [SUB-98b] Backfill when neither rollingAnchor nor recurringHistoryByMaster exists → falls back to recurStart
- [SUB-98c] Backfill from 'done' only — skips/cancels/missed don't seed history
- [SUB-98d] Backfill when most recent history is a skip → falls through to recurStart (skip doesn't count)
- [SUB-98e] Backfill with multiple masters → each independently backfilled

---
**ID:** TS-99  
**Domain:** Rolling / Materialization  
**Title:** Rolling on-demand materialization — rc_-prefixed IDs  
**Data Setup:**
- Master: `{ id: 'master-1', text: 'Rolling materialize', recurring: true, recur: { type: 'rolling', intervalDays: 7 }, rollingAnchor: '2026-06-08', recurStart: '2026-06-01' }`
- No existing instance for 2026-06-15 (the "next" due date)
- User sets status='done' on the not-yet-materialized instance
**Action:** Status-change handler with on-demand materialization
**Expected Outcome:**
- Instance with ID `rc_master-1_2026-06-15` is materialized (rc_ prefix = on-demand)
- Instance gets status='done' and date='2026-06-15'
- Rolling anchor updated to '2026-06-15'
- Instance is exempt from TERMINAL_REQUIRES_SCHEDULE check (can be marked done without scheduled_at)
**Sub-scenarios:**
- [SUB-99a] On-demand materialization with status='skip' → rc_ instance created with skip
- [SUB-99b] On-demand materialization with status='cancel' → rc_ instance created with cancel
- [SUB-99c] On-demand materialization already exists → update status only (no duplicate)
- [SUB-99d] On-demand materialization outside horizon → still created (user action overrides horizon)
- [SUB-99e] Multiple on-demand materializations in sequence → each creates unique rc_ ID

---
**ID:** TS-100  
**Domain:** Rolling / Guard  
**Title:** Rolling stale guard — instanceDate < currentAnchor returns null  
**Data Setup:**
- Master: `{ id: 'master-1', text: 'Rolling stale', recurring: true, recur: { type: 'rolling', intervalDays: 7 }, rollingAnchor: '2026-06-15', recurStart: '2026-06-01' }`
- Instance: date='2026-06-12' (before anchor of 6-15), status='done'
- currentAnchor = '2026-06-15'
**Action:** Call `computeRollingAnchor('done', '2026-06-12', '2026-06-15')`
**Expected Outcome:**
- Returns null (stale guard blocks — instanceDate 6-12 < currentAnchor 6-15)
- Anchor unchanged at '2026-06-15'
- Prevents out-of-order completion from regressing the anchor
**Sub-scenarios:**
- [SUB-100a] Stale guard: exactly equal (>=) → allowed, returns instanceDate
- [SUB-100b] Stale guard: instanceDate = 2026-06-15, currentAnchor = 2026-06-12 → allowed (forward)
- [SUB-100c] Stale guard: null currentAnchor → always allowed (null < anything guard is skipped)
- [SUB-100d] Stale guard with skip → same behavior (null if stale)
- [SUB-100e] Stale guard with missed → null if stale (nudge not applied)
- [SUB-100f] Stale guard with cancel → null (cancel already returns null, guard redundant)

---

# 4. Instance Lifecycle (TS-101 to TS-110)

---
**ID:** TS-101  
**Domain:** Instance Lifecycle / Done  
**Title:** Recurring instance done — terminal, completed_at=now, rolling anchor updated  
**Data Setup:**
- Master: `{ id: 'master-1', text: 'Lifecycle done', recurring: true, recur: { type: 'daily' }, recurStart: '2026-06-15', rollingAnchor: null }`
- Instance: `{ id: 'master-1-1', date: '2026-06-15', status: '', scheduled_at: '2026-06-15T09:00:00Z' }`
**Action:** User sets instance status to 'done'
**Expected Outcome:**
- Instance status changes to 'done'
- `completed_at` set to current timestamp (now)
- `scheduled_at` preserved (keeps the original placement time)
- Rolling anchor updated (if rolling) — for daily this has no effect
- TPC: counts as fulfilled in cycle
- Spacing history: updates lastByMaster
- Terminal dedup: blocks re-expansion on 2026-06-15
- Cal sync: outbound sync if linked
**Sub-scenarios:**
- [SUB-101a] Done without scheduled_at → exempt from TERMINAL_REQUIRES_SCHEDULE for rolling
- [SUB-101b] Done on instance that's already done → idempotent (no change)
- [SUB-101c] Done + time_remaining → effective duration recorded
- [SUB-101d] Done on future instance (forward-dated) → completed_at in the future
- [SUB-101e] Done + split chunk → all sibling chunks get done status

---
**ID:** TS-102  
**Domain:** Instance Lifecycle / Skip  
**Title:** Recurring instance skip — terminal, scheduled_at snaps to now  
**Data Setup:**
- Master: `{ id: 'master-1', text: 'Lifecycle skip', recurring: true, recur: { type: 'daily' }, recurStart: '2026-06-15', rollingAnchor: null }`
- Instance: `{ id: 'master-1-1', date: '2026-06-15', status: '', scheduled_at: '2026-06-15T09:00:00Z' }`
**Action:** User sets instance status to 'skip'
**Expected Outcome:**
- Instance status changes to 'skip'
- `scheduled_at` snaps to current timestamp (now)
- Rolling anchor updated (if rolling)
- TPC keep policy: does NOT open a slot for refill
- TPC backfill policy: DOES open a slot (skip counts as unfulfilled)
- Spacing history: does NOT update lastByMaster
- Terminal dedup: blocks re-expansion on 2026-06-15
**Sub-scenarios:**
- [SUB-102a] Skip on instance without scheduled_at → scheduled_at set to now
- [SUB-102b] Skip on already-skipped instance → idempotent
- [SUB-102c] Skip then re-schedule → scheduler run adds new instance on different date (same ordinal? or new)
- [SUB-102d] Skip + split chunk → all sibling chunks get skip
- [SUB-102e] Skip future instance → snap to now (time-travel effect)

---
**ID:** TS-103  
**Domain:** Instance Lifecycle / Cancel  
**Title:** Recurring instance cancel — terminal, rolling anchor NOT updated  
**Data Setup:**
- Master: `{ id: 'master-1', text: 'Lifecycle cancel', recurring: true, recur: { type: 'daily' }, recurStart: '2026-06-15' }`
- Instance: `{ id: 'master-1-1', date: '2026-06-15', status: '', scheduled_at: '2026-06-15T09:00:00Z' }`
**Action:** User sets instance status to 'cancel'
**Expected Outcome:**
- Instance status changes to 'cancel'
- `scheduled_at` snaps to current timestamp
- Rolling anchor NOT updated (null returned)
- TPC backfill: counts toward fulfilled (backfill sees cancel as occupied)
- Spacing history: does NOT update lastByMaster
- Terminal dedup: blocks re-expansion on date
**Sub-scenarios:**
- [SUB-103a] Cancel on already-canceled instance → idempotent
- [SUB-103b] Cancel + split → all sibling chunks get cancel
- [SUB-103c] Cancel rolling instance → anchor unchanged, next instance still generated from previous anchor
- [SUB-103d] Cancel future instance → date blocked, next instances shift forward

---
**ID:** TS-104  
**Domain:** Instance Lifecycle / Missed  
**Title:** Recurring instance missed — system-set, completed_at=windowClose  
**Data Setup:**
- Clock: fixed at `2026-06-16T08:00:00Z` (next day)
- Master: `{ id: 'master-1', text: 'Lifecycle missed', recurring: true, recur: { type: 'daily' }, recurStart: '2026-06-15' }`
- Instance: `{ id: 'master-1-1', date: '2026-06-15', status: '', scheduled_at: '2026-06-15T14:00:00Z', windowClose: '2026-06-15T20:00:00Z' }`
- The window has closed (now > windowClose)
**Action:** Missed detection path (runSchedule Phase 9 or cal-history-cron)
**Expected Outcome:**
- Instance status changes to 'missed' (system-applied)
- `completed_at` set to `windowClose` time
- Rolling anchor: soft nudge to instanceDate + 1 day
- TPC: same as skip for fill policy (does NOT count as fulfilled for keep? Check spec)
- Spacing history: does NOT update lastByMaster
- Terminal dedup: blocks re-expansion on date
- No cal sync (missed does NOT sync)
- User CANNOT manually set 'missed' (should get 403)
**Sub-scenarios:**
- [SUB-104a] Missed detection runs on already-missed instance → idempotent
- [SUB-104b] Missed detection before windowClose → NOT marked missed (window still open)
- [SUB-104c] Missed without windowClose → completed_at = windowClose (may be null if no windowClose)
- [SUB-104d] Missed + split → all sibling chunks get missed

---
**ID:** TS-105  
**Domain:** Instance Lifecycle / Delete  
**Title:** Recurring instance delete — soft-skipped (status=skip)  
**Data Setup:**
- Master: `{ id: 'master-1', text: 'Lifecycle delete', recurring: true, recur: { type: 'daily' }, recurStart: '2026-06-15' }`
- Instance: `{ id: 'master-1-1', date: '2026-06-15', status: 'pending' }`
**Action:** User deletes the instance
**Expected Outcome:**
- Instance NOT hard-deleted (not removed from DB)
- Status changed to 'skip' (soft-skip)
- Same behavior as skip: scheduled_at snaps to now, rolling anchor updated, TPC keep policy blocks refill
- Instance appears as "skipped" in history (not "deleted")
- Calendar ledger cleaned if linked
**Sub-scenarios:**
- [SUB-105a] Delete pending instance → soft-skip
- [SUB-105b] Delete done instance → soft-skip (but done is terminal; delete overrides? Check spec)
- [SUB-105c] Delete already-skipped instance → idempotent (still skip)
- [SUB-105d] Delete future instance → soft-skip blocks that date
- [SUB-105e] Delete + split → all sibling chunks soft-skipped

---
**ID:** TS-106  
**Domain:** Instance Lifecycle / Template Delete  
**Title:** Recurring template delete — pending→hard delete, done/cancel/skip→archived  
**Data Setup:**
- Master: `{ id: 'master-1', text: 'Template delete', recurring: true, recur: { type: 'daily' }, recurStart: '2026-06-01' }`
- Instances:
  - master-1-1: date='2026-06-01', status='pending'
  - master-1-2: date='2026-06-02', status='done'
  - master-1-3: date='2026-06-03', status='skip'
  - master-1-4: date='2026-06-04', status='cancel'
**Action:** User deletes the master template
**Expected Outcome:**
- Pending instances (master-1-1) are HARD-deleted (removed from DB)
- Terminal instances (done/skip/cancel for master-1-2, -3, -4) are ARCHIVED (status kept, linked to deleted master)
- Template itself removed from task_masters
- Calendar ledger cleaned for all linked instances
**Sub-scenarios:**
- [SUB-106a] Delete template with only pending instances → all hard-deleted
- [SUB-106b] Delete template with only terminal instances → all archived
- [SUB-106c] Delete template with mixed statuses → pending hard-deleted, terminal archived
- [SUB-106d] Delete already-deleted template → idempotent (no-op or error)
- [SUB-106e] Delete template with far-future instances → pending ones hard-deleted

---
**ID:** TS-107  
**Domain:** Instance Lifecycle / Missed Detection  
**Title:** Missed detection via scheduler (TIME_WINDOW flex window past)  
**Data Setup:**
- Clock: fixed at `2026-06-16T10:00:00Z` (next day)
- Master: `{ id: 'master-1', text: 'Window missed', recurring: true, recur: { type: 'daily' }, recurStart: '2026-06-15' }`
- Instance: `{ id: 'master-1-1', date: '2026-06-15', placementMode: 'time_window', preferredTimeMins: 540, timeFlex: 60, dur: 30 }`
  - Preferred window: 9:00-11:00 (540-660 mins)
  - Flex window: 8:00-12:00 (480-720 mins)
  - Current time: 10:00 on 2026-06-16 — flex window entirely past
**Action:** Scheduler v2 missed-window pass (Phase 3 or 4)
**Expected Outcome:**
- Instance marked `_unplacedReason='missed'`
- Dual-placed on grid with `_overdue=true` (TIME_WINDOW gets dual placement)
- Not yet written to DB as 'missed' — that happens in runSchedule Phase 9
**Sub-scenarios:**
- [SUB-107a] TIME_WINDOW flex window partially past (still open for part of today) → NOT marked missed
- [SUB-107b] TIME_WINDOW flex=0 → rigid, must be exactly at preferred time → if past, marked missed
- [SUB-107c] TIME_WINDOW flex entirely in the future → NOT missed
- [SUB-107d] Non-recurring TIME_WINDOW task → same logic applied
- [SUB-107e] TIME_WINDOW yesterday, scheduler runs today after flex window → missed detected

---
**ID:** TS-108  
**Domain:** Instance Lifecycle / Missed Detection  
**Title:** Missed detection via scheduler (non-TIME_WINDOW preferred time past)  
**Data Setup:**
- Clock: fixed at `2026-06-16T08:00:00Z` (next day)
- Master: `{ id: 'master-1', text: 'Preferred missed', recurring: true, recur: { type: 'daily' }, recurStart: '2026-06-15' }`
- Instance: `{ id: 'master-1-1', date: '2026-06-15', placementMode: 'time_blocks', preferredTimeMins: 540 }` (has preferred time but NOT time_window mode)
**Action:** Scheduler v2 missed-preferred-time pass
**Expected Outcome:**
- Instance marked `_unplacedReason='missed'`
- NOT dual-placed (non-TIME_WINDOW tasks don't get dual placement)
- Goes to unplaced list
- DB status NOT yet updated to 'missed' (that's Phase 9's job)
**Sub-scenarios:**
- [SUB-108a] Non-TIME_WINDOW with preferred time still in future → NOT missed
- [SUB-108b] Non-TIME_WINDOW without preferredTimeMins → no missed detection from this path
- [SUB-108c] Anytime mode (no preferred time) → never marked missed via this path
- [SUB-108d] Preferred time = 780 (1pm) + task placed earlier → not missed even if preferred time past

---
**ID:** TS-109  
**Domain:** Instance Lifecycle / Missed Detection  
**Title:** Missed detection via runSchedule Phase 9  
**Data Setup:**
- Clock: fixed at `2026-06-16T08:00:00Z` (next day, scheduler run in progress)
- Master: `{ id: 'master-1', text: 'Phase9 missed', recurring: true, recur: { type: 'daily' }, recurStart: '2026-06-15' }`
- Instance: `{ id: 'master-1-1', date: '2026-06-15', status: 'pending', scheduled_at: '2026-06-15T14:00:00Z', timeFlex: 120 }`
  - 14:00 + flex 2hr = window closes 16:00 on 2026-06-15
  - Current time 2026-06-16 08:00 — window fully past
**Action:** runSchedule Phase 9 — past instances with expired timeFlex window
**Expected Outcome:**
- Instance status updated to `'missed'` in DB
- `scheduled_at` set to `windowClose` (16:00 on 2026-06-15)
- Rolling anchor (if applicable): soft nudge to instanceDate + 1 day
- Terminal dedup blocks re-expansion on that date
- Only past instances whose timeFlex window has expired are marked
**Sub-scenarios:**
- [SUB-109a] Phase 9: instance window not yet expired (still within timeFlex) → NOT marked missed
- [SUB-109b] Phase 9: already 'done'/'skip'/'cancel' → skipped (only pending)
- [SUB-109c] Phase 9: no timeFlex → uses default? Check spec: flexible tasks without timeFlex may still be marked
- [SUB-109d] Phase 9: instance from 2 days ago → still marked (no maximum age beyond window expiry)
- [SUB-109e] Phase 9: no windowClose → completed_at set to some fallback (scheduled_at + something)

---
**ID:** TS-110  
**Domain:** Instance Lifecycle / Missed Detection  
**Title:** Missed detection via cal-history-cron (24h window)  
**Data Setup:**
- Clock: fixed at `2026-06-16T10:00:00Z` (next day)
- Master: `{ id: 'master-1', text: 'Cron missed', recurring: true, recur: { type: 'daily' }, recurStart: '2026-06-15' }`
- Instance: `{ id: 'master-1-1', date: '2026-06-15', status: 'pending', scheduled_at: '2026-06-15T09:00:00Z' }`
- Cron script: cal-history-cron runs with 24-hour resolution window
**Action:** cal-history-cron — `shouldAutoMarkMissed()` check
**Expected Outcome:**
- For pending instances with scheduled_at > 24 hours ago → status set to 'missed'
- `completed_at` = scheduled_at (or windowClose if available)
- Rolling anchor soft nudge applied
- Cron runs once daily
- 24-hour window prevents marking instances that are only a few hours old
**Sub-scenarios:**
- [SUB-110a] Cron: instance scheduled 23 hours ago → NOT marked (within 24h grace)
- [SUB-110b] Cron: instance scheduled 25 hours ago → marked missed
- [SUB-110c] Cron: instance already done/skip/cancel → skipped
- [SUB-110d] Cron: multiple instances across multiple masters → each independently checked
- [SUB-110e] Cron: future-dated instances → skipped (scheduled_at in future)
- [SUB-110f] Cron with locking → prevents concurrent runs

---

# 5. Split Tasks — Non-Recurring (TS-111 to TS-119)

---
**ID:** TS-111  
**Domain:** Split / Non-Recurring  
**Title:** Split task — chunks created inline across available windows  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'task-1', text: 'Big task', dur: 120, pri: P3, placementMode: 'anytime', split: true, split_min: 30 }`
- Available windows: 08:00-12:00 and 13:00-17:00 on 2026-06-15
- No existing chunks
**Action:** Run scheduler (placeSplitInline)
**Expected Outcome:**
- 120 min split into chunks of 30 min each = 4 chunks
- Chunks placed inline across available windows:
  - Chunk 1: 08:00-08:30 (split_ordinal=1, split_total=4)
  - Chunk 2: 08:30-09:00 (split_ordinal=2, split_total=4)
  - Chunk 3: 09:00-09:30 (split_ordinal=3, split_total=4)
  - Chunk 4: 09:30-10:00 (split_ordinal=4, split_total=4)
- All chunks placed on same day (if capacity permits)
- Each chunk is a separate DB row (inline, not pre-materialized)
- `split_group` set to primaryId when chunks > 1
**Sub-scenarios:**
- [SUB-111a] Split across two available windows → chunks fill first window, overflow to second
- [SUB-111b] Split into 1 chunk only (dur ≤ split_min) → single chunk, split_total=1
- [SUB-111c] Split into many chunks (large duration, small split_min) → many rows
- [SUB-111d] Split + no available windows → all unplaced with partial_split

---
**ID:** TS-112  
**Domain:** Split / Minimum  
**Title:** Split task with split_min — chunks respect minimum  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Split min', dur: 100, pri: P3, placementMode: 'anytime', split: true, split_min: 30 }`
**Action:** Compute chunks
**Expected Outcome:**
- `computeChunks(100, 30)` returns `[ {splitOrdinal:1, dur:30, splitTotal:3}, {splitOrdinal:2, dur:30, splitTotal:3}, {splitOrdinal:3, dur:40, splitTotal:3} ]`
- No chunk smaller than split_min (30)
- Last chunk may be larger (absorbs remainder)
- If split_min is null → defaults to MIN_CHUNK (15)
**Sub-scenarios:**
- [SUB-112a] split_min=60, dur=90 → 2 chunks: [60, 30] → second chunk below min? No — 30 < 60, so runt merge: [90] single chunk of 90
- [SUB-112b] split_min=15, dur=100 → [15,15,15,15,15,15,10]→merged: [15,15,15,15,15,25]
- [SUB-112c] split_min=0 or negative → fallback to default 15
- [SUB-112d] split_min > dur → single chunk of dur

---
**ID:** TS-113  
**Domain:** Split / Runt  
**Title:** Split task — no runt chunks (remainder merged)  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Runt merge', dur: 75, pri: P3, placementMode: 'anytime', split: true, split_min: 30 }`
**Action:** Compute chunks
**Expected Outcome:**
- `computeChunks(75, 30)` returns `[ {splitOrdinal:1, dur:30, splitTotal:2}, {splitOrdinal:2, dur:45, splitTotal:2} ]`
- Remainder of 15 (< 30) is merged into previous chunk (becomes 45)
- No chunk with dur < split_min
- If the remainder is the ONLY chunk → single chunk with full duration
**Sub-scenarios:**
- [SUB-113a] dur=45, split_min=30 → single chunk of 45 (runt merge into previous, which is the only chunk)
- [SUB-113b] dur=31, split_min=30 → single chunk of 31 (remainder 1 < 30, merged into previous=only chunk)
- [SUB-113c] dur=60, split_min=45 → single chunk of 60 (remainder 15 < 45, merged)
- [SUB-113d] dur=90, split_min=45 → 2 chunks of 45 each (perfect split, no remainder)
- [SUB-113e] dur=100, split_min=30 → [30, 30, 40] (remainder 10 merged)

---
**ID:** TS-114  
**Domain:** Split / Cross-Day  
**Title:** Split task — can cross day boundaries  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'task-1', text: 'Cross-day split', dur: 600, pri: P3, placementMode: 'anytime', split: true, split_min: 60 }`
- Available daily windows: 08:00-18:00 each day
- No existing instances on 2026-06-15 through 2026-06-17
**Action:** Run scheduler (placeSplitInline)
**Expected Outcome:**
- Chunks span multiple days (non-recurring splits CAN cross day boundaries)
- Chunk 1-10 on 2026-06-15 (10 hours × 60 min), chunk 11 on 2026-06-16
- Total chunks: 600/60 = 10 chunks → spans 2 days
- Each chunk row has correct split_ordinal and split_total
- `_unplacedReason` NOT set (all chunks fit)
**Sub-scenarios:**
- [SUB-114a] Cross-day split with deadline → chunks bounded by deadline date
- [SUB-114b] Cross-day split with start-after → chunks start from earliest_start date
- [SUB-114c] Cross-day split with travel → only ordinal 1 has travel_before, last has travel_after
- [SUB-114d] Cross-day split across weekend → chunks skip weekends if dayReq='weekday'
- [SUB-114e] Cross-day split with location change → each chunk independently validated for location

---
**ID:** TS-115  
**Domain:** Split / Travel  
**Title:** Split task — travel_before only on ordinal 1  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Split travel before', dur: 90, pri: P3, placementMode: 'anytime', split: true, split_min: 30, travelBefore: 15 }`
**Action:** Run scheduler, examine chunks
**Expected Outcome:**
- Chunk 1 (ordinal=1): has `travelBefore=15`, `travelAfter=0`
- Chunk 2 (ordinal=2): `travelBefore=0`, `travelAfter=0`
- Chunk 3 (ordinal=3): `travelBefore=0`, `travelAfter=0`
- Only the first ordinal carries travel_before
- Travel buffer applied to chunk 1's placement (start = first available slot + 15 min buffer)
**Sub-scenarios:**
- [SUB-115a] travel_before=0 → no buffer on any chunk
- [SUB-115b] travel_before=30 on single-chunk split → buffer applied, ordinal=1 is also last
- [SUB-115c] travel_before on different day than first chunk → buffer applies from location arrival
- [SUB-115d] travel_before + time_window → buffer still applied within flex window

---
**ID:** TS-116  
**Domain:** Split / Travel  
**Title:** Split task — travel_after only on last ordinal  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Split travel after', dur: 90, pri: P3, placementMode: 'anytime', split: true, split_min: 30, travelAfter: 15 }`
**Action:** Run scheduler, examine chunks
**Expected Outcome:**
- Chunk 1 (ordinal=1): `travelAfter=0`
- Chunk 2 (ordinal=2): `travelAfter=0`
- Chunk 3 (ordinal=3): `travelAfter=15`
- Only the last ordinal carries travel_after
- Travel buffer applied to end of last chunk (end + 15 min)
**Sub-scenarios:**
- [SUB-116a] travel_after=0 on single chunk → no buffer
- [SUB-116b] travel_after + both travel_before → ordinal 1 gets before, last gets after
- [SUB-116c] travel_after across day boundary → buffer respects next day's schedule
- [SUB-116d] travel_after with deadline → buffer still applied before deadline

---
**ID:** TS-117  
**Domain:** Split / Partial  
**Title:** Split task — partial_split when insufficient windows  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'task-1', text: 'Partial split', dur: 300, pri: P3, placementMode: 'anytime', split: true, split_min: 60 }`
- Available daily window: 08:00-12:00 only (4 hours/day)
- Only one day available (2026-06-15), 4 chunks fit, remaining 1 chunk (60 min) can't fit
**Action:** Run scheduler (placeSplitInline)
**Expected Outcome:**
- 4 chunks placed on 2026-06-15 (08:00-12:00)
- Remaining 60 min → `_unplacedReason='partial_split'`
- `_unplacedDetail` indicates insufficient capacity
- Unplaced chunk marked in output
- Task is NOT fully unplaced — partially placed + partially unplaced
**Sub-scenarios:**
- [SUB-117a] Partial split with 0 windows → all chunks unplaced with partial_split
- [SUB-117b] Partial split on single-day window, remaining 5 min → runt merged into previous, not partial
- [SUB-117c] Partial split across multi-day horizon → all days searched before declaring partial
- [SUB-117d] Partial split + deadline → deadline caps search window, may cause early partial
- [SUB-117e] Partial split with template change → previously partial may become whole (blocks added)

---
**ID:** TS-118  
**Domain:** Split / Deadline  
**Title:** Split task with deadline — chunks bounded by deadline  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'task-1', text: 'Split deadline', dur: 240, pri: P3, placementMode: 'anytime', split: true, split_min: 30, deadline: '2026-06-16T12:00:00Z' }`
- Available windows: 08:00-18:00 on both days
**Action:** Run scheduler
**Expected Outcome:**
- All chunks placed before deadline (June 16, 12:00)
- If capacity insufficient before deadline → partial_split
- Scheduler's latestIdx capped at deadline date
- Last chunk ends at or before 12:00 on June 16
**Sub-scenarios:**
- [SUB-118a] Tight deadline (same day) → all chunks must fit in single day
- [SUB-118b] Generous deadline → chunks spread across multiple days within window
- [SUB-118c] Deadline before any available slot → all unplaced (impossible_window)
- [SUB-118d] Deadline exactly at chunk boundary → last chunk ends right at deadline
- [SUB-118e] Deadline + travel_after → last chunk's end + travel must be before deadline

---
**ID:** TS-119  
**Domain:** Split / Start-After  
**Title:** Split task with start-after — chunks bounded by start-after  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'task-1', text: 'Split start-after', dur: 120, pri: P3, placementMode: 'anytime', split: true, split_min: 30, earliestStart: '2026-06-17' }`
- Available windows 08:00-18:00 on June 15-19
**Action:** Run scheduler
**Expected Outcome:**
- No chunks placed before June 17 (earliest_start_at is hard lower bound)
- All 4 chunks (30 min each) placed on June 17 or later
- earliest_start_at caps earliestIdx in the search
- If insufficient capacity from June 17 onward → partial_split
**Sub-scenarios:**
- [SUB-119a] start-after same as today → chunks start from today
- [SUB-119b] start-after + deadline inverted (start > deadline) → impossible_window
- [SUB-119c] start-after far in future → chunks placed on that date or later
- [SUB-119d] start-after + travel_before → buffer applied after start-after date
- [SUB-119e] start-after updated after chunks placed → scheduler run may move chunks

---

# 6. Recurring Splits (TS-120 to TS-126)

---
**ID:** TS-120  
**Domain:** Split / Recurring  
**Title:** Recurring split — chunks pre-materialized as DB rows  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Recurring split', dur: 120, pri: P3, placementMode: 'anytime', recurring: true, split: true, split_min: 30, recur: { type: 'daily' }, recurStart: '2026-06-15' }`
- No existing instances
**Action:** Run scheduler (expandRecurring → reconcileSplits)
**Expected Outcome:**
- 4 chunks generated per occurrence: master-1-1-1 through master-1-1-4 (for June 15)
- 14 days × 4 chunks = 56 total chunk rows
- Chunks are pre-materialized as DB rows (not inline)
- Each chunk has: `master_id='master-1'`, `split_ordinal=N`, `split_total=4`
- Chunk IDs: deterministic format `<masterId>-YYYYMMDD[-N]`
- Recurring split chunks are created in Phase 1 upfront
**Sub-scenarios:**
- [SUB-120a] Pre-materialized chunks on existing reconciliation → count rows = expected
- [SUB-120b] Pre-materialized chunks with split_min=60 → 2 chunks per occurrence
- [SUB-120c] Pre-materialized chunks across horizon → all days pre-expanded
- [SUB-120d] Pre-materialized + existing chunks from prior run → reconciled (matched by date + ordinal)

---
**ID:** TS-121  
**Domain:** Split / Recurring / Day-Locked  
**Title:** Recurring split — day-locked (rigid) — same day only  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Rigid split', dur: 120, pri: P3, placementMode: 'time_blocks', recurring: true, split: true, split_min: 30, recur: { type: 'daily' }, recurStart: '2026-06-15', isDayLocked: true }`
- Available daily window: 08:00-10:00 (only 2 hours)
**Action:** Run scheduler
**Expected Outcome:**
- All 4 chunks (30 min each = 120 min total) must fit on the SAME day (occurrence date)
- If not enough room on that day → chunks go unplaced (day-locked cannot roam)
- 08:00-10:00 = 120 min, exactly fits 4 chunks of 30
- Chunks placed sequentially: 08:00, 08:30, 09:00, 09:30
- `latestIdx = earliestIdx = anchorDate` — no cross-day roaming
**Sub-scenarios:**
- [SUB-121a] Day-locked with window too small (only 90 min, need 120) → unplaced
- [SUB-121b] Day-locked with daily recurrence → all chunks same day, every day
- [SUB-121c] Day-locked with weekly recurrence → all chunks on picked day of week
- [SUB-121d] Day-locked + other tasks fill the window → unplaced (no room)
- [SUB-121e] Day-locked + travel buffers → chunk 1 start pushed by travel_before, reducing available window

---
**ID:** TS-122  
**Domain:** Split / Recurring / Cycle-Capped  
**Title:** Recurring split — cycle-capped (flexible TPC) — within cycle  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Flexible split', dur: 120, pri: P3, placementMode: 'time_blocks', isFlexibleTpc: true, recurring: true, split: true, split_min: 30, recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 2 }, recurStart: '2026-06-15' }`
- Available windows: several hours per day
- cycleDays = 7
**Action:** Run scheduler
**Expected Outcome:**
- Window: `anchorDate` to `anchorDate + cycleDays - 1`
- 4 chunks can roam within the 7-day cycle window
- NOT day-locked — chunks may span across days within the cycle
- If insufficient total capacity in the cycle → partial_split
- All chunks MUST complete before the cycle boundary (before next cycle's first day)
**Sub-scenarios:**
- [SUB-122a] Cycle-capped: chunks start on picked day, spill to next day within same cycle
- [SUB-122b] Cycle-capped: all chunks fit on single day
- [SUB-122c] Cycle-capped: chunks distributed across multiple days for optimal placement
- [SUB-122d] Cycle-capped: biweekly cycle of 14 days → chunks roam across 2 weeks
- [SUB-122e] Cycle-capped: TPC=1 (one pick in cycle) → still 4 chunks, must all fit within cycle days

---
**ID:** TS-123  
**Domain:** Split / Recurring / Time-Boxed  
**Title:** Recurring split — time-boxed to recurrence interval  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Time-boxed split', dur: 240, pri: P3, placementMode: 'anytime', recurring: true, split: true, split_min: 60, recur: { type: 'daily' }, recurStart: '2026-06-15' }`
- Daily recurrence → time-box = occurrence date only (same day)
- Available daily window: 6 hours (08:00-14:00)
**Action:** Run scheduler
**Expected Outcome:**
- Daily time-box: all 4 chunks (60 min each = 4 hours) must complete on the same day
- If daily window is only 3 hours → recurring_split_overflow
- Time-box boundary = before next recurrence instance (next day for daily)
- For daily: boundary is end of occurrence date (midnight or window end)
- Weekly: boundary is 7 days from anchor date
- Monthly: boundary is ~30 days from anchor date
- Rolling: anchor to anchor + intervalDays
**Sub-scenarios:**
- [SUB-123a] Weekly time-box: 7-day window for chunks
- [SUB-123b] Monthly time-box: ~30-day window
- [SUB-123c] Interval (every N days) time-box: N-day window
- [SUB-123d] Rolling time-box: anchor to anchor + intervalDays
- [SUB-123e] Time-box boundary = 1 day, chunks fit → placed
- [SUB-123f] Time-box boundary = 1 day, chunks don't fit → overflow

---
**ID:** TS-124  
**Domain:** Split / Recurring / Overflow  
**Title:** Recurring split — recurring_split_overflow when chunks don't fit  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Overflow split', dur: 480, pri: P3, placementMode: 'anytime', recurring: true, split: true, split_min: 60, recur: { type: 'daily' }, recurStart: '2026-06-15' }`
- Daily time-box = same day only
- Available daily window: 4 hours (08:00-12:00)
- 480 min / 60 min = 8 chunks → need 8 hours → only 4 available
**Action:** Run scheduler
**Expected Outcome:**
- 4 chunks placed (fit in 4-hour window)
- Remaining 4 chunks → `_unplacedReason='recurring_split_overflow'`
- `_unplacedDetail` indicates overflow due to time-box constraint
- Task flagged as overflow — placed on unscheduled list
- Entire occurrence flagged, not just individual chunks
**Sub-scenarios:**
- [SUB-124a] Weekly recurrence overflow: chunks span more than 7-day window
- [SUB-124b] Monthly recurrence overflow: need more than ~30 days of capacity
- [SUB-124c] Rolling overflow: chunks need more than intervalDays of capacity
- [SUB-124d] Overflow with flexible TPC: same behavior (cycle-capped still overflows)
- [SUB-124e] No overflow: all chunks fit within time-box → normal placement

---
**ID:** TS-125  
**Domain:** Split / Recurring / Drift Fix  
**Title:** Recurring split — drift fix at scheduler start  
**Data Setup:**
- Master: `{ id: 'master-1', text: 'Drifted split', dur: 90, pri: P3, recurring: true, split: true, split_min: 30, recur: { type: 'daily' }, recurStart: '2026-06-15' }`
- Existing rows from previous run that have wrong metadata (e.g., split_ordinal=1, split_total=1 — should be split_total=3 for 90 min / 30 min)
**Action:** `reconcileSplitsForUser()` at scheduler start
**Expected Outcome:**
- Drifted rows with wrong `(split_ordinal, split_total, dur)` get UPDATEd
- split_total corrected from 1 to 3
- split_ordinal values fixed
- dur values corrected to match expected chunks
- Duplicate or orphaned rows cleaned
- After fix, correct 3 chunks: [30, 30, 30]
**Sub-scenarios:**
- [SUB-125a] Drift: dur changed from 60 to 90 → chunks rebalanced: from 2×30 to 3×30
- [SUB-125b] Drift: split_min changed from 30 to 45 → chunks recomputed
- [SUB-125c] Drift: no drift (rows already correct) → idempotent, no changes
- [SUB-125d] Drift: split turned off → all chunks deleted
- [SUB-125e] Drift: too many rows (chunks > expected) → excess deleted
- [SUB-125f] Drift: too few rows (chunks < expected) → new chunks inserted

---
**ID:** TS-126  
**Domain:** Split / Status  
**Title:** Split + status change — all chunks in occurrence_ordinal get same status  
**Data Setup:**
- Master: `{ id: 'master-1', text: 'Split status', recurring: true, split: true, split_min: 30, recur: { type: 'daily' } }`
- Occurrence `master-1-1` has 3 chunks: ordinals 1, 2, 3 (all status='pending')
**Action:** User marks chunk 1 (ordinal=1) as 'done'
**Expected Outcome:**
- Chunk 1 status → 'done'
- Chunk 2 status → 'done' (propagated)
- Chunk 3 status → 'done' (propagated)
- All chunks sharing `(master_id='master-1', occurrence_ordinal=1)` get same status
- Chunks remain independent DB rows (not merged)
- Durations sum to the original task's duration
**Sub-scenarios:**
- [SUB-126a] Mark middle chunk (ordinal=2) as skip → all 3 become skip
- [SUB-126b] Mark last chunk (ordinal=3) as cancel → all 3 become cancel
- [SUB-126c] Mark chunk in middle occurrence (ordinal=2 of occurrence 1) — other occurrences unaffected
- [SUB-126d] Mark chunk as done when another chunk already done → idempotent (all done)
- [SUB-126e] Mixed statuses across different occurrence_ordinals → independent

---

# 7. Split × Mode (TS-126a to TS-126i)

---
**ID:** TS-126a  
**Domain:** Split × Placement Mode  
**Title:** Split + anytime — chunks placed in best available slots across days  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Anytime split', dur: 180, pri: P3, placementMode: 'anytime', split: true, split_min: 60 }`
- Multiple days with capacity
**Action:** Run scheduler
**Expected Outcome:**
- 3 chunks of 60 min placed in best available slots
- Scheduler's slack-sorted algorithm picks best slots across days
- No time constraints on placement time
- Cross-day allowed (non-recurring)
**Sub-scenarios:**
- [SUB-126a1] Anytime split with deadline → bounded by deadline
- [SUB-126a2] Anytime split + schedule floor/ceiling → respects grid bounds
- [SUB-126a3] Anytime split + other tasks → chunks compete with other tasks

---
**ID:** TS-126b  
**Domain:** Split × Placement Mode  
**Title:** Split + time_window — chunks constrained to preferred time ± flex window  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Time window split', dur: 120, pri: P3, placementMode: 'time_window', preferredTimeMins: 540, timeFlex: 120, split: true, split_min: 30 }`
**Action:** Run scheduler
**Expected Outcome:**
- All chunks placed within [preferred - flex, preferred + flex] = [07:00, 11:00]
- Each chunk independently validated against time window
- If total duration (120 min) exceeds window capacity (240 min — still fits) → placed
- If all chunks can't fit in window → some unplaced (or partial_split if non-recurring)
**Sub-scenarios:**
- [SUB-126b1] Time window flex=0 → all chunks at exact preferred time (impossible if total > single slot)
- [SUB-126b2] Time window small (30 min flex) → chunks constrained to tight band
- [SUB-126b3] Time window recurring + split → all chunks on occurrence date within window

---
**ID:** TS-126c  
**Domain:** Split × Placement Mode  
**Title:** Split + time_blocks — chunks constrained to selected when-tag blocks  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Block split', dur: 120, pri: P3, placementMode: 'time_blocks', when: 'morning,afternoon', split: true, split_min: 30 }`
**Action:** Run scheduler
**Expected Outcome:**
- All chunks placed within morning and afternoon time blocks
- Chunks distribute across available blocks on eligible days
- If insufficient block capacity → partial_split (or unplaced if recurring)
**Sub-scenarios:**
- [SUB-126c1] Blocks on single day → all chunks same day
- [SUB-126c2] Blocks across multiple days → chunks distributed
- [SUB-126c3] FlexWhen=true → blocks relaxed to anytime if full

---
**ID:** TS-126d  
**Domain:** Split × Placement Mode  
**Title:** Split + fixed — split not available (UI hides)  
**Data Setup:**
- `{ placementMode: 'fixed', split: true }`
**Action:** Check UI configuration
**Expected Outcome:**
- Split toggle is HIDDEN for fixed placement mode
- Backend doesn't enforce split for fixed-tasks
- Fixed tasks cannot be split (immovable anchor + multiple chunks doesn't make sense)
**Sub-scenarios:**
- [SUB-126d1] User tries to set split=true on existing fixed task → rejected (400 or UI block)

---
**ID:** TS-126e  
**Domain:** Split × Placement Mode  
**Title:** Split + all_day — split not available (no grid)  
**Data Setup:**
- `{ placementMode: 'all_day', split: true }`
**Action:** Check UI configuration
**Expected Outcome:**
- Split toggle is HIDDEN for all-day mode
- All-day tasks have no grid presence; splitting is meaningless
**Sub-scenarios:**
- [SUB-126e1] All-day task with split forced via API → backend rejects

---
**ID:** TS-126f  
**Domain:** Split × Placement Mode  
**Title:** Split + reminder — split not available (dur=0)  
**Data Setup:**
- `{ placementMode: 'reminder', dur: 0, split: true }`
**Action:** Check UI configuration
**Expected Outcome:**
- Split toggle HIDDEN for reminders
- Reminders have dur=0; splitting zero-duration is meaningless
- UI hides split section when marker checkbox is checked
**Sub-scenarios:**
- [SUB-126f1] Reminder with split forced via API → backend rejects

---
**ID:** TS-126g  
**Domain:** Split × Placement Mode  
**Title:** Split + time_window + flex=0 — behaves as rigid, all chunks at same time  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Rigid window split', dur: 90, pri: P3, placementMode: 'time_window', preferredTimeMins: 540, timeFlex: 0, split: true, split_min: 30 }`
**Action:** Run scheduler
**Expected Outcome:**
- timeFlex=0 means rigid anchor (exact preferred time)
- But splitting requires multiple time slots → contradictory
- Scheduler places chunks sequentially starting at preferredTimeMins
- Chunk 1: 09:00-09:30, Chunk 2: 09:30-10:00, Chunk 3: 10:00-10:30
- Chunks may extend beyond the "preferred time" (but there's no flex window)
- This is effectively "rigid start, sequential chunks"
**Sub-scenarios:**
- [SUB-126g1] timeFlex=0, single chunk (dur ≤ split_min) → placed at exact preferred time
- [SUB-126g2] timeFlex=0, multiple chunks stretch beyond grid end → partial

---
**ID:** TS-126h  
**Domain:** Split × Placement Mode  
**Title:** Split + time_blocks + flex_when=true — chunks relax to anytime when blocks full  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Flex when split', dur: 180, pri: P3, placementMode: 'time_blocks', when: 'morning', flexWhen: true, split: true, split_min: 30 }`
- Morning block is full (insufficient capacity for all chunks)
**Action:** Run scheduler (fallback ladder pass 3 with flexWhen)
**Expected Outcome:**
- Pass 1: tries to place all chunks in morning block → can't fit
- Pass 3 (flexWhen): relaxes `when` to `anytime` → chunks placed in any available block
- `_whenRelaxed` flag set on chunks
- Chunks complete across afternoon/evening blocks
**Sub-scenarios:**
- [SUB-126h1] flexWhen=false → stays in morning block, partial_split
- [SUB-126h2] flexWhen + still can't fit even with relaxation → unplaced
- [SUB-126h3] flexWhen + other tasks already fill other blocks → competitive placement

---
**ID:** TS-126i  
**Domain:** Split × Placement Mode  
**Title:** Split + time_blocks + flex_when=false — unplaced when blocks full  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Strict blocks split', dur: 120, pri: P3, placementMode: 'time_blocks', when: 'morning', flexWhen: false, split: true, split_min: 30 }`
- Morning block has only 60 min capacity
**Action:** Run scheduler
**Expected Outcome:**
- 2 chunks (60 min total) placed in morning
- Remaining 2 chunks unplaced with partial_split
- `_unplacedReason='partial_split'`
- flexWhen=false prevents relaxation
**Sub-scenarios:**
- [SUB-126i1] flexWhen=false, enough capacity → all placed normally
- [SUB-126i2] flexWhen=false recurring → recurring_split_overflow

---

# 8. Split × Template Interaction (TS-126j to TS-126p)

---
**ID:** TS-126j  
**Domain:** Split × Template  
**Title:** Split task in default blocks — chunks distributed across available windows  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Default block split', dur: 180, pri: P3, placementMode: 'time_blocks', when: 'morning,lunch,afternoon', split: true, split_min: 30 }`
- Default time blocks: morning (08:00-12:00), lunch (12:00-13:00), afternoon (13:00-17:00)
**Action:** Run scheduler
**Expected Outcome:**
- 6 chunks of 30 min distributed across morning, lunch, and afternoon blocks
- Chunks placed in earliest available slots per the scheduler's algorithm
- No partial_split (capacity sufficient)
**Sub-scenarios:**
- [SUB-126j1] Default blocks with weekend vs weekday → chunks respect day-of-week blocks
- [SUB-126j2] Default blocks changed (custom template) → chunks respect new blocks

---
**ID:** TS-126k  
**Domain:** Split × Template  
**Title:** Template change (blocks removed) → some chunks lose their slots → partial_split  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Template shrink split', dur: 180, pri: P3, placementMode: 'time_blocks', when: 'morning,afternoon', split: true, split_min: 30 }`
- Previous template had more blocks (morning+afternoon+evening)
- New template removes evening block
**Action:** Scheduler re-run after template change
**Expected Outcome:**
- Chunks that were placed in now-removed evening block get unmoved
- Some chunks may become partial_split if remaining blocks lack capacity
- Chunks redistribute to remaining blocks
- `partial_split` if total capacity < 180 min
**Sub-scenarios:**
- [SUB-126k1] Removed block had 1 chunk → that chunk re-placed elsewhere or unplaced
- [SUB-126k2] Removed block had all chunks → all chunks unplaced / partial_split
- [SUB-126k3] Template change + no capacity loss → all chunks re-accommodated

---
**ID:** TS-126l  
**Domain:** Split × Template  
**Title:** Template change (blocks added) → previously partial_split chunks become placeable  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Template expand split', dur: 180, pri: P3, placementMode: 'time_blocks', when: 'morning', flexWhen: false, split: true, split_min: 30 }`
- Previously only morning block (4 hours) → all 6 chunks fit, no issue
- But scenario: earlier had only 2 hour morning block → partial_split
- Now template adds afternoon block
**Action:** Scheduler re-run after template change
**Expected Outcome:**
- Previously partial chunks become fully placed with new capacity
- All 6 chunks placed across morning + afternoon
- partial_split flag cleared
**Sub-scenarios:**
- [SUB-126l1] Partial→full on template expansion → status cleared
- [SUB-126l2] Partial remains partial if still insufficient → flag stays

---
**ID:** TS-126m  
**Domain:** Split × Template  
**Title:** Template change (block hours shift) → chunks re-distributed to new windows  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Shifting split', dur: 120, pri: P3, placementMode: 'time_blocks', when: 'morning', split: true, split_min: 30 }`
- Block changes from 08:00-10:00 to 10:00-12:00
**Action:** Scheduler re-run after template change
**Expected Outcome:**
- All chunks shift from old block window to new window
- Chunks placed in 10:00-12:00 instead of 08:00-10:00
- No chunks in old window (08:00-10:00)
- If new window smaller than old → capacity lost → partial_split
**Sub-scenarios:**
- [SUB-126m1] Shift to smaller window → capacity loss
- [SUB-126m2] Shift to larger window → capacity gain
- [SUB-126m3] Shift that overlaps with other tasks → competitive placement

---
**ID:** TS-126n  
**Domain:** Split × Template  
**Title:** Holiday template (no blocks) → all chunks unplaced  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Holiday split', dur: 60, pri: P3, placementMode: 'time_blocks', when: 'morning', split: true, split_min: 30 }`
- Template for the day has zero blocks (holiday)
**Action:** Run scheduler
**Expected Outcome:**
- No windows available for any chunk
- All chunks unplaced with `_unplacedReason='no_windows'` or `'partial_split'`
- No chunks placed on holiday
**Sub-scenarios:**
- [SUB-126n1] Holiday affects only one day → chunks on that day unplaced, surrounding days fine
- [SUB-126n2] Partial holiday (reduced blocks) → some chunks placed, some unplaced

---
**ID:** TS-126o  
**Domain:** Split × Template  
**Title:** Template with single short block → split chunks may not all fit → partial_split  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Short block split', dur: 120, pri: P3, placementMode: 'time_blocks', when: 'lunch', split: true, split_min: 30 }`
- Lunch block: 12:00-13:00 (only 60 min)
**Action:** Run scheduler
**Expected Outcome:**
- 2 chunks (60 min) placed in lunch block
- Remaining 2 chunks → partial_split
- `_unplacedReason='partial_split'`
**Sub-scenarios:**
- [SUB-126o1] Single block, enough capacity → all placed
- [SUB-126o2] Single block, exactly at capacity → all placed, no margin

---
**ID:** TS-126p  
**Domain:** Split × Template  
**Title:** Template with many short blocks → chunks distributed across them  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Many blocks split', dur: 180, pri: P3, placementMode: 'time_blocks', when: 'morning,lunch,afternoon', split: true, split_min: 15 }`
- Blocks: 08:00-09:00 (60m), 09:30-10:00 (30m), 12:00-12:30 (30m), 14:00-15:00 (60m)
**Action:** Run scheduler
**Expected Outcome:**
- 12 chunks of 15 min distributed across all 4 blocks
- Chunks fill in order of earliest available slot
- 4 blocks × various lengths = 180 min total → all chunks placed
- No partial split
**Sub-scenarios:**
- [SUB-126p1] Many blocks separated by gaps → chunks placed in wings with gaps between
- [SUB-126p2] Many blocks, total capacity just enough → all placed
- [SUB-126p3] Many blocks, total capacity slightly under → partial_split

---

# 9. Split × Location/Template Interaction (TS-126q to TS-126u)

---
**ID:** TS-126q  
**Domain:** Split × Location  
**Title:** Split task with location=["work"] → chunks only placed during work-location blocks  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Work split', dur: 120, pri: P3, placementMode: 'time_blocks', when: 'morning', location: ['work'], split: true, split_min: 30 }`
- Work location has blocks defined (e.g., 09:00-17:00)
- Home location has different blocks
**Action:** Run scheduler
**Expected Outcome:**
- All chunks placed within work-location blocks only
- Home-location blocks are not candidates
- If work location blocks insufficient → partial_split
- Each chunk independently validated against location availability
**Sub-scenarios:**
- [SUB-126q1] Split between morning+afternoon → chunks only in work blocks during those times
- [SUB-126q2] Work location has no blocks on a given day → chunks for that day unplaced

---
**ID:** TS-126r  
**Domain:** Split × Location  
**Title:** locScheduleOverrides (remote day) → chunks shift to home-location blocks  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Remote split', dur: 90, pri: P3, placementMode: 'time_blocks', when: 'morning', location: ['work'], split: true, split_min: 30 }`
- locScheduleOverride says Tuesday is "remote day" → location resolves to "home"
- Home blocks: 08:00-10:00 (only 2 hours)
**Action:** Run scheduler on Tuesday
**Expected Outcome:**
- chunks placed in home-location blocks instead of work-location blocks
- Home blocks have 120 min capacity, need 90 min → all 3 chunks placed
- If home blocks insufficient → partial_split
**Sub-scenarios:**
- [SUB-126r1] Remote day with no blocks → chunks for that day unplaced
- [SUB-126r2] Multiple remote days → chunks distributed across home blocks on eligible days

---
**ID:** TS-126s  
**Domain:** Split × Location  
**Title:** hourLocationOverrides shifts one chunk's location but not another → asymmetric  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Asymmetric split', dur: 120, pri: P3, placementMode: 'time_blocks', when: 'morning,afternoon', location: ['work'], split: true, split_min: 30 }`
- hourLocationOverride: 10:00-11:00 → location "conference_room_a"
- Chunks placed: chunk 1 at 08:00-08:30 (work), chunk 2 at 08:30-09:00 (work), chunk 3 at 10:00-10:30 (conference_room_a)
**Action:** Run scheduler
**Expected Outcome:**
- Chunks 1-2 at work location (no override)
- Chunk 3 at conference_room_a (hourLocationOverride active during 10:00-11:00)
- Chunk 4 at 10:30-11:00 → also conference_room_a (still in override)
- Each chunk independently picks up location from its time slot
**Sub-scenarios:**
- [SUB-126s1] hourLocationOverride covers only part of a chunk → chunk split further? Or placed in dominant location
- [SUB-126s2] hourLocationOverride location has no tool access → chunk unplaced

---
**ID:** TS-126t  
**Domain:** Split × Location  
**Title:** Tool matrix change removes required tool → some chunks become unplaced  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Tool removed split', dur: 90, pri: P3, placementMode: 'time_blocks', when: 'morning', split: true, split_min: 30, tools: ['saw'] }`
- Tool matrix removes 'saw' from morning blocks
**Action:** Scheduler re-run after tool matrix change
**Expected Outcome:**
- All chunks in morning block now fail tool check
- Chunks become unplaced if no alternative blocks have the tool
- `_unplacedReason='partial_split'` or `'tool_unavailable'`
- If other blocks (afternoon) have 'saw' → chunks re-placed there
**Sub-scenarios:**
- [SUB-126t1] Tool added → previously unplaced chunks become placeable
- [SUB-126t2] Tool removed from some blocks but not others → chunks migrate to tool-available blocks
- [SUB-126t3] Tool removed globally → all chunks unplaced

---
**ID:** TS-126u  
**Domain:** Split × Location  
**Title:** Split chunks at different locations → each chunk independently validated  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Multi-location split', dur: 120, pri: P3, placementMode: 'time_blocks', when: 'morning,afternoon', location: ['work', 'home'], split: true, split_min: 30 }`
- Work blocks: 08:00-10:00
- Home blocks: 10:00-12:00
**Action:** Run scheduler
**Expected Outcome:**
- Chunks 1-4 (120 min) distribute across work + home blocks
- Work chunks validated against work-location constraints
- Home chunks validated against home-location constraints
- If either location has insufficient capacity → partial_split
- Cross-location travel (if different locations have different tools) → travel time between locations
**Sub-scenarios:**
- [SUB-126u1] Work block full → chunks overflow to home block
- [SUB-126u2] Home block has tool 'saw' but work doesn't → chunks needing 'saw' placed at home only
- [SUB-126u3] Location validation fail for one location but not other → partial placement

---

# 10. Split × Weather Interaction (TS-126v to TS-126y)

---
**ID:** TS-126v  
**Domain:** Split × Weather  
**Title:** Split task with weather constraint → each chunk independently weather-checked  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Weather split', dur: 120, pri: P3, placementMode: 'anytime', split: true, split_min: 30, weather_precip: 'dry_only' }`
- Weather: morning 10% precip (pass), afternoon 80% precip (fail)
**Action:** Run scheduler with weather data
**Expected Outcome:**
- Chunk 1 (08:00-08:30): 10% ≤ 20% → placed
- Chunk 2 (08:30-09:00): 10% → placed
- Chunk 3 (09:00-09:30): 10% → placed
- Chunk 4 (09:30-10:00): 10% → placed
- Additional chunks in afternoon: 80% > 20% → NOT placed (weather blocks)
- Partial_split if insufficient weather-passing slots remain
**Sub-scenarios:**
- [SUB-126v1] All weather checks pass → all chunks placed
- [SUB-126v2] All weather checks fail → all chunks unplaced
- [SUB-126v3] Mixed pass/fail → partial placement
- [SUB-126v4] Weather constraint 'any' → never blocks (always passes)

---
**ID:** TS-126w  
**Domain:** Split × Weather  
**Title:** Weather changes between chunks (morning dry, afternoon rain) → some chunks pass, some fail  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Changing weather split', dur: 180, pri: P3, placementMode: 'anytime', split: true, split_min: 30, weather_precip: 'dry_only' }`
- Hourly weather: 08:00=10%, 09:00=10%, 10:00=10%, 11:00=15%, 12:00=80%, 13:00=90%
**Action:** Run scheduler
**Expected Outcome:**
- Chunks 1-4 (08:00-10:00): all pass (precip ≤ 20%)
- Chunk 5 (10:00-10:30): passes (15%)
- Chunks 6+ (11:00 onward): some borderline (11:00 may pass at 15%)
- Chunks in 12:00-14:00: fail (80-90%)
- Result: partial placement, some chunks unplaced due to weather
**Sub-scenarios:**
- [SUB-126w1] Boundary: 21% precip for dry_only (fails) vs 20% (passes) → threshold test
- [SUB-126w2] Weather changes by location → cross-location chunks differently affected
- [SUB-126w3] Cloudcover + precip combined → both must pass

---
**ID:** TS-126x  
**Domain:** Split × Weather  
**Title:** Weather data missing → fail-open (BUG) → chunks placed in unsuitable weather  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'No weather data split', dur: 60, pri: P3, placementMode: 'anytime', split: true, split_min: 30, weather_precip: 'dry_only' }`
- No weather cache for location (or stale/expired)
**Action:** Run scheduler
**Expected Outcome:**
- Fail-open: weather constraint SKIPPED for slots with missing data
- Chunks placed even though weather data unavailable
- `_unplacedReason` NOT set for weather (weather not considered)
- Fresh weather fetch triggered for next run
- This is a known gap: chunks may be placed in unsuitable weather
**Sub-scenarios:**
- [SUB-126x1] Missing data for some slots but not others → mix of guarded and unguarded placements
- [SUB-126x2] Weather API down → all weather constraints skipped for all chunks
- [SUB-126x3] No weather constraint on task → zero overhead, normal placement

---
**ID:** TS-126y  
**Domain:** Split × Weather  
**Title:** Weather refresh → some chunks re-placed to different slots  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Weather refresh split', dur: 120, pri: P3, placementMode: 'anytime', split: true, split_min: 30, weather_precip: 'dry_only' }`
- Previous run: morning 10% → chunks placed in morning
- Weather refresh: morning now 80% (storm arriving), afternoon 10% (clearing)
**Action:** Weather refresh triggers scheduler re-run
**Expected Outcome:**
- Chunks previously in morning now fail weather check
- Chunks re-placed to afternoon slots (weather passes)
- If afternoon insufficient capacity → partial_split
- SSE notification of schedule change sent
**Sub-scenarios:**
- [SUB-126y1] Weather improves → previously unplaced chunks become placeable
- [SUB-126y2] Weather worsens → previously placed chunks become unplaced
- [SUB-126y3] Weather refresh with no constraint change → no chunk movement

---

# 11. Split × Travel Buffer Interaction (TS-126z to TS-126ae)

---
**ID:** TS-126z  
**Domain:** Split × Travel  
**Title:** Split task with travel_before=15 → only ordinal 1 has the buffer  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Travel before split', dur: 90, pri: P3, placementMode: 'anytime', travelBefore: 15, split: true, split_min: 30 }`
**Action:** Run scheduler
**Expected Outcome:**
- Chunk 1 (ordinal=1): travelBefore=15, start pushed 15 min later to accommodate buffer
- Chunk 2 (ordinal=2): travelBefore=0
- Chunk 3 (ordinal=3): travelBefore=0
- Buffer applied only to first ordinal
**Sub-scenarios:**
- [SUB-126z1] travelBefore=15 on single-chunk split → buffer applied (ordinal=1 is both first and last)
- [SUB-126z2] travelBefore=0 → no buffer on any chunk

---
**ID:** TS-126aa  
**Domain:** Split × Travel  
**Title:** Split task with travel_after=15 → only last ordinal has the buffer  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Travel after split', dur: 90, pri: P3, placementMode: 'anytime', travelAfter: 15, split: true, split_min: 30 }`
**Action:** Run scheduler
**Expected Outcome:**
- Chunk 3 (ordinal=3 = last): travelAfter=15
- Chunk 1 (ordinal=1): travelAfter=0
- Chunk 2 (ordinal=2): travelAfter=0
- Buffer applied only to last ordinal
**Sub-scenarios:**
- [SUB-126aa1] travelAfter=15 on single-chunk split → buffer applied
- [SUB-126aa2] travelAfter on crossing day boundary → buffer applied to end of last chunk on its day

---
**ID:** TS-126ab  
**Domain:** Split × Travel  
**Title:** Split task with both travel_before + travel_after → ordinal 1 has before, last has after  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Both travel split', dur: 90, pri: P3, placementMode: 'anytime', travelBefore: 10, travelAfter: 15, split: true, split_min: 30 }`
**Action:** Run scheduler
**Expected Outcome:**
- Chunk 1: travelBefore=10, travelAfter=0
- Chunk 2: travelBefore=0, travelAfter=0
- Chunk 3: travelBefore=0, travelAfter=15
- Both buffers applied simultaneously
- Total effective duration: 90 (work) + 10 (before) + 15 (after) = 115 min blocked in schedule
**Sub-scenarios:**
- [SUB-126ab1] travel_before + travel_after on single-chunk → both applied to same chunk
- [SUB-126ab2] travel_before + travel_after across day boundary → before on day 1, after on last day

---
**ID:** TS-126ac  
**Domain:** Split × Travel  
**Title:** Split chunks on same day → travel between chunks respected  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Same-day travel split', dur: 120, pri: P3, placementMode: 'anytime', split: true, split_min: 30 }`
- Chunks: ordinal 1 at location A (08:00-08:30), ordinal 2 at location B (needs 15 min travel from A)
**Action:** Run scheduler with location-based travel
**Expected Outcome:**
- Chunk 1 ends at 08:30 at location A
- Travel from A→B: 15 min
- Chunk 2 starts at 08:45 (08:30 + 15 min travel) at location B
- Chunk 3 starts at 09:15 (adjacent to chunk 2)
- Gap between chunks equals travel time
**Sub-scenarios:**
- [SUB-126ac1] Same location for all chunks → no inter-chunk travel needed
- [SUB-126ac2] Travel between every chunk (multi-location) → each gap has travel
- [SUB-126ac3] Travel time exceeds block window → chunks pushed to next available slot

---
**ID:** TS-126ad  
**Domain:** Split × Travel  
**Title:** Split chunks on different days → no inter-chunk travel (different days)  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Cross-day travel split', dur: 240, pri: P3, placementMode: 'anytime', split: true, split_min: 60 }`
- Chunks on Monday and Tuesday at different locations
**Action:** Run scheduler
**Expected Outcome:**
- Chunks on different days → no inter-chunk travel between Monday's last and Tuesday's first
- Travel_before applied to ordinal 1 on Monday
- Travel_after applied to last ordinal on Tuesday (or same day as last chunk)
- No cross-day travel gap enforced
**Sub-scenarios:**
- [SUB-126ad1] Same-day chunk boundary → travel between chunks enforced
- [SUB-126ad2] Different-day chunks, same location → no travel needed between days

---
**ID:** TS-126ae  
**Domain:** Split × Travel  
**Title:** Split + travel + location change → travel time between locations respected  
**Data Setup:**
- Master: `{ id: 'task-1', text: 'Location change travel split', dur: 90, pri: P3, placementMode: 'anytime', split: true, split_min: 30 }`
- Chunk 1 at "office" (08:00-08:30), Chunk 2 at "warehouse" (needs 20 min travel)
- Chunk 3 at "office" again (needs 20 min travel back)
**Action:** Run scheduler
**Expected Outcome:**
- Chunk 1: 08:00-08:30 at office
- Travel office→warehouse: 08:30-08:50 (20 min)
- Chunk 2: 08:50-09:20 at warehouse
- Travel warehouse→office: 09:20-09:40 (20 min)
- Chunk 3: 09:40-10:10 at office
- All travel gaps respected
**Sub-scenarios:**
- [SUB-126ae1] Location change but same travel time as split between chunks → seamless
- [SUB-126ae2] Travel exceeds block window → chunks stretch to next block

---

# 12. Split × Status Edge Cases (TS-126af to TS-126al)

---
**ID:** TS-126af  
**Domain:** Split × Status  
**Title:** Mark one chunk done → all chunks in same occurrence_ordinal get same status  
**Data Setup:**
- Master: `{ id: 'master-1', text: 'Status propagate done', split: true, split_min: 30, recurring: true, recur: { type: 'daily' } }`
- Occurrence 1 chunks: 3 chunks (all pending)
**Action:** User marks chunk 1 (ordinal=1 of occurrence 1) as 'done'
**Expected Outcome:**
- Chunk 1: done
- Chunk 2: done (propagated)
- Chunk 3: done (propagated)
- All 3 chunks in occurrence 1 receive 'done'
- Other occurrences unaffected
**Sub-scenarios:**
- [SUB-126af1] Mark middle chunk → all propagate
- [SUB-126af2] Mark last chunk → all propagate
- [SUB-126af3] Mark chunk when one already done → idempotent propagation

---
**ID:** TS-126ag  
**Domain:** Split × Status  
**Title:** Mark one chunk skip → all chunks in same occurrence_ordinal get skip  
**Data Setup:**
- Master: `{ id: 'master-1', text: 'Status propagate skip', split: true, recurring: true }`
- Occurrence 1: 3 pending chunks
**Action:** User marks chunk 2 as 'skip'
**Expected Outcome:**
- All 3 chunks in occurrence 1 become 'skip'
- TPC keep: blocks refill for that occurrence
- Rolling anchor (if rolling): updated to instanceDate
**Sub-scenarios:**
- [SUB-126ag1] Skip → scheduled_at snaps to now for all chunks
- [SUB-126ag2] Skip on one occurrence, other occurrences still pending

---
**ID:** TS-126ah  
**Domain:** Split × Status  
**Title:** Mark one chunk cancel → all chunks in same occurrence_ordinal get cancel  
**Data Setup:**
- Master: `{ id: 'master-1', text: 'Status propagate cancel', split: true, recurring: true }`
- Occurrence 1: 3 pending chunks
**Action:** User marks chunk 3 as 'cancel'
**Expected Outcome:**
- All 3 chunks in occurrence 1 become 'cancel'
- Rolling anchor: NOT updated (cancel → null)
- Terminal dedup: blocks re-expansion on date
**Sub-scenarios:**
- [SUB-126ah1] Cancel on one occurrence → other occurrences unaffected
- [SUB-126ah2] Cancel on split with time_remaining → chunks still propagate cancel

---
**ID:** TS-126ai  
**Domain:** Split × Status  
**Title:** Mixed statuses across different occurrence_ordinals → independent  
**Data Setup:**
- Master: `{ id: 'master-1', text: 'Mixed status split', split: true, recurring: true }`
- Occurrence 1 (ordinal=1): 3 chunks (pending)
- Occurrence 2 (ordinal=2): 3 chunks (pending)
**Action:** Mark occurrence 1 chunk as 'done', occurrence 2 chunk as 'skip'
**Expected Outcome:**
- Occurrence 1: all 3 chunks → 'done'
- Occurrence 2: all 3 chunks → 'skip'
- Occurrences are independent
- Statuses do not cross-contaminate
**Sub-scenarios:**
- [SUB-126ai1] Occurrence 1: done, Occurrence 2: done → both independent completions
- [SUB-126ai2] Occurrence 1: cancel, Occurrence 2: done → independent

---
**ID:** TS-126aj  
**Domain:** Split × Status  
**Title:** Split chunk with time_remaining → overrides dur for that chunk only  
**Data Setup:**
- Master: `{ id: 'master-1', text: 'Time remaining split', dur: 120, split: true, split_min: 30 }`
- Original chunks: 4 × 30 min
- User sets time_remaining=15 on chunk 2 (meaning 15 min of work left)
**Action:** User marks status update with time_remaining
**Expected Outcome:**
- Chunk 2's effective duration becomes 15 min (time_remaining overrides dur)
- Chunk 2's schedule slot may shrink
- Other chunks unaffected (still 30 min each)
- Total effective duration: 30 + 15 + 30 + 30 = 105 min
- If time_remaining=0 → chunk effectively done (zero remaining work)
**Sub-scenarios:**
- [SUB-126aj1] time_remaining > dur → limited to original dur
- [SUB-126aj2] time_remaining on all chunks → each independently overridden
- [SUB-126aj3] time_remaining on recurring split → same behavior per occurrence

---
**ID:** TS-126ak  
**Domain:** Split × Status  
**Title:** Split chunk marked wip → time_remaining starts counting down  
**Data Setup:**
- Master: `{ id: 'master-1', text: 'WIP split', dur: 60, split: true, split_min: 30 }`
- Chunk 1: placed 08:00-08:30, user marks as 'wip'
**Action:** User marks chunk as 'wip' (in-progress)
**Expected Outcome:**
- Chunk status → 'wip'
- `timeRemaining` starts counting down (elapsed time reduces remaining)
- On completion, time_remaining = 0 → final status 'done'
- Other chunks in occurrence still pending (they're separate rows)
**Sub-scenarios:**
- [SUB-126ak1] WIP on middle chunk → other chunks still pending
- [SUB-126ak2] WIP → done transition for individual chunk → propagates to sibling chunks?
- [SUB-126ak3] WIP with time_remaining counter → persists across sessions

---
**ID:** TS-126al  
**Domain:** Split × Status  
**Title:** Split chunk marked done before all chunks placed → remaining chunks still placed  
**Data Setup:**
- Master: `{ id: 'master-1', text: 'Early done split', dur: 180, split: true, split_min: 30 }`
- 6 chunks: Chunks 1-3 placed, Chunks 4-6 not yet placed (still pending in DB)
- User marks chunk 1 as 'done'
**Action:** User marks chunk done + scheduler re-run
**Expected Outcome:**
- Chunk 1: done (propagates to chunks 2-3 in same occurrence)
- Chunks 4-6: also get done? Or only placed chunks get propagated? 
  - Spec says "all chunks in same occurrence_ordinal" — but chunks 4-6 don't exist yet
  - If non-recurring inline → they get created and immediately marked done
  - If recurring pre-materialized → they already exist, get done status
- Remaining unplaced chunks still created/placed on next scheduler run
- Total duration is still accounted for
**Sub-scenarios:**
- [SUB-126al1] Split chunks not yet materialized → materialized and status propagated
- [SUB-126al2] Mid-occurrence done → remaining chunks still scheduled
- [SUB-126al3] All chunks placed before any done → straightforward propagation

---

# 13. Split × Recurring × Template Interaction (TS-126bm to TS-126br)

---
**ID:** TS-126bm  
**Domain:** Split × Recurring × Template  
**Title:** Recurring split + template change → time-box window shifts → chunks re-evaluated  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Recurring template shift', dur: 120, pri: P3, placementMode: 'time_blocks', when: 'morning', recurring: true, split: true, split_min: 30, recur: { type: 'daily' }, recurStart: '2026-06-15' }`
- Previous template: morning block 08:00-10:00
- New template: morning block 10:00-12:00 (shifted)
**Action:** Scheduler re-run after template change
**Expected Outcome:**
- Time-box window for daily = same day (unchanged — still daily)
- Chunks shift from 08:00-10:00 window to 10:00-12:00 window
- If new window smaller → some chunks overflow → recurring_split_overflow
- If new window larger → all chunks fit (maybe better distributed)
- Template change triggers reschedule (enqueueScheduleRun)
**Sub-scenarios:**
- [SUB-126bm1] Window shrinks → overflow
- [SUB-126bm2] Window grows → previously overflow chunks fit
- [SUB-126bm3] Window shifts but same capacity → re-distribution only

---
**ID:** TS-126bn  
**Domain:** Split × Recurring × Template  
**Title:** Recurring split + holiday template → all chunks for that occurrence unplaced  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Holiday recurring split', dur: 90, pri: P3, placementMode: 'time_blocks', when: 'morning', recurring: true, split: true, split_min: 30, recur: { type: 'daily' }, recurStart: '2026-06-15' }`
- Template for 2026-06-16 (Tuesday) has zero blocks (holiday)
**Action:** Scheduler re-run with holiday template
**Expected Outcome:**
- Occurrence on 2026-06-15: chunks placed normally (no holiday)
- Occurrence on 2026-06-16: all 3 chunks unplaced (holiday = no blocks)
- Occurrence on 2026-06-17: chunks placed normally
- Next-day occurrence unaffected
- `_unplacedReason` for holiday chunks: 'no_windows' or similar
**Sub-scenarios:**
- [SUB-126bn1] Multi-day holiday → all chunks unplaced for all holiday days
- [SUB-126bn2] Holiday + flexible TPC → chunks could roam to non-holiday day within cycle

---
**ID:** TS-126bo  
**Domain:** Split × Recurring × Template  
**Title:** Recurring split + location template change → chunks shift locations across occurrences  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Location shift split', dur: 120, pri: P3, placementMode: 'time_blocks', when: 'morning', location: ['work'], recurring: true, split: true, split_min: 30, recur: { type: 'daily' }, recurStart: '2026-06-15' }`
- Template changes: Monday morning at "work", Tuesday morning at "home" (locScheduleOverride)
**Action:** Scheduler re-run
**Expected Outcome:**
- Monday chunks at work-location blocks
- Tuesday chunks at home-location blocks
- Each occurrence independently resolved for location
- If one location has insufficient capacity → partial for that occurrence only
- Other occurrences placed normally
**Sub-scenarios:**
- [SUB-126bo1] Location template removes all blocks for some days → chunks for those days unplaced
- [SUB-126bo2] Location template adds new blocks → previously overflowing chunks fit

---
**ID:** TS-126bp  
**Domain:** Split × Recurring × Template  
**Title:** Recurring split + tool matrix change → some occurrences' chunks become unplaced  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Tool removed recurring split', dur: 120, pri: P3, placementMode: 'time_blocks', when: 'morning', recurring: true, split: true, split_min: 30, tools: ['saw'], recur: { type: 'daily' }, recurStart: '2026-06-15' }`
- Tool matrix removes 'saw' from Tuesday morning blocks
**Action:** Scheduler re-run after tool matrix change
**Expected Outcome:**
- Monday chunks: placed (tool available Monday)
- Tuesday chunks: unplaced for that occurrence (tool unavailable Tuesday) → may go unplaced or roam to tool-available day
- Wednesday chunks: placed (tool available Wednesday)
- If tool removed globally → all occurrences unplaced
- If tool added to new blocks → previously unplaced chunks become placeable
**Sub-scenarios:**
- [SUB-126bp1] Tool removed from some days but not others → per-occurrence impact
- [SUB-126bp2] Tool re-added → occurrences recover
- [SUB-126bp3] Tool removed + flexible TPC → chunks roam to tool-available day within cycle

---
**ID:** TS-126bq  
**Domain:** Split × Recurring × Weather  
**Title:** Recurring split + weather change → different occurrences affected differently  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Weather recurring split', dur: 120, pri: P3, placementMode: 'anytime', recurring: true, split: true, split_min: 30, weather_precip: 'dry_only', recur: { type: 'daily' }, recurStart: '2026-06-15' }`
- Weather: Monday dry (10%), Tuesday rain (80%), Wednesday dry (15%)
**Action:** Scheduler run with weather data
**Expected Outcome:**
- Monday: all chunks placed (weather passes)
- Tuesday: all chunks unplaced (weather fails for all slots) → recurring_split_overflow
- Wednesday: all chunks placed (weather passes)
- Each occurrence independently weather-checked
- Different occurrences can have different placement outcomes
**Sub-scenarios:**
- [SUB-126bq1] Weather varies within a day → some chunks of same occurrence pass, some fail
- [SUB-126bq2] Weather improves on refresh → previously unplaced occurrences now placed
- [SUB-126bq3] Weather worsens → previously placed occurrences unplaced

---
**ID:** TS-126br  
**Domain:** Split × Recurring × Overflow  
**Title:** Recurring split + time advance → crossing recurrence boundary → overflow detection  
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Master: `{ id: 'master-1', text: 'Time advance overflow', dur: 600, pri: P3, placementMode: 'anytime', recurring: true, split: true, split_min: 60, recur: { type: 'daily' }, recurStart: '2026-06-15' }`
- Daily recurrence → time-box = same day only
- Available daily window: 08:00-14:00 (6 hours = 360 min)
- 600 min / 60 min = 10 chunks → need 10 hours → only 6 available
**Action:** Scheduler run
**Expected Outcome:**
- 6 chunks placed (fit in 6-hour window)
- Remaining 4 chunks → `_unplacedReason='recurring_split_overflow'`
- Overflow detection triggered because time-box (1 day) prevents cross-day roaming
- Entire occurrence flagged as overflow
- User sees "recurring split overflow" message
- If next occurrence's day has more capacity, those chunks might fit separately
**Sub-scenarios:**
- [SUB-126br1] Daily recurrence + 6-hour window + 7 hours needed → overflow on EVERY occurrence
- [SUB-126br2] Weekly recurrence + 7-day window → chunks can roam across week, may avoid overflow
- [SUB-126br3] Rolling recurrence + 7-day interval → overflow if chunks need more than 7 days
- [SUB-126br4] Time advance (clock moves forward) → overflow detection re-evaluated (may recover if capacity freed)
- [SUB-126br5] Overflow on some occurrences but not others → per-occurrence overflow flag
- [SUB-126br6] Template adds capacity → previously overflow occurrence recovers

---

# Appendix: Test Matrix Summary

| Domain | ID Range | Count | Priority | Existing Coverage |
|--------|----------|-------|----------|-------------------|
| Recurrence Types | TS-72–84 | 13 | P1 | Partial (expandRecurring.test.js) |
| TPC | TS-85–93 | 9 | P1 | Minimal (expandRecurring.test.js) |
| Rolling Recurrence | TS-94–100 | 7 | P1 | Partial (rollingAnchor.test.js) |
| Instance Lifecycle | TS-101–110 | 10 | P1 | Partial (commands-status-delete-misc.test.js) |
| Non-Recurring Splits | TS-111–119 | 9 | P1 | None |
| Recurring Splits | TS-120–126 | 7 | P1 | None |
| Split × Mode | TS-126a–126i | 9 | P1 | None |
| Split × Template | TS-126j–126p | 7 | P1 | None |
| Split × Location | TS-126q–126u | 5 | P1 | None |
| Split × Weather | TS-126v–126y | 4 | P1 | None |
| Split × Travel | TS-126z–126ae | 6 | P1 | None |
| Split × Status | TS-126af–126al | 7 | P1 | None |
| Split × Recurring × Template | TS-126bm–126br | 6 | P1 | None |
| **Total** | **TS-72–126br** | **99** | — | **Major gaps** |