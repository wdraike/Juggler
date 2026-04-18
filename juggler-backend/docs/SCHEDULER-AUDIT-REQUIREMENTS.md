# Scheduler Requirements Audit

Every requirement from SCHEDULER.md traced to implementation.
- **PASS** = code implements the requirement correctly
- **FAIL** = code does not match the requirement
- **STALE** = doc describes behavior that no longer matches the code (doc needs update)
- **MISSING** = requirement described but not implemented

---

## Guiding Principles

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| GP-1 | Deadlines drive schedule; priority is tiebreaker | PASS | Phase 2 sorts by slack (deadline-derived), pri is 2nd sort key |
| GP-2 | Past-due = due today + P1 boost | PASS | `_pastDue=true`, `pri='P1'`, `_slack=0` in Phase 2 |
| GP-3 | Pinned items dropped first during pile-up | MISSING | No pile-up eviction logic exists. Code prevents overlaps via occupancy grid instead. Spec §5b describes eviction order that is not implemented. |

## Phase 0: Immovable

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| P0-1 | Fixed tasks placed at locked time | STALE | Spec says `when:'fixed'`. Code uses `datePinned`. Migration converts existing rows. |
| P0-2 | Markers at their time, no occupancy | PASS | Markers go to `markersByDate`, not `dayOcc` |
| P0-3 | Pinned tasks at pinned time | PASS | `datePinned && sm !== null` → `fixedByDate` |
| P0-4 | Fixed/pinned on today shown even if past | PASS | `fixedDropped = isPast && tdKey !== effectiveTodayKey` |
| P0-5 | Fixed/pinned on past days dropped | PASS | Same condition |

## Phase 1: Recurring

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| P1-1 | Daily: placed on scheduled day | PASS | `ceiling = td` for non-tpc |
| P1-2 | Specific days of week: scheduled day only | PASS | `canPlaceOnDate` checks `dayReq` |
| P1-3 | Day-of-month: that calendar date | PASS | Handled by `expandRecurring` |
| P1-4 | Every-N-days: computed date | PASS | Handled by `expandRecurring` |
| P1-5 | Times-per-cycle: any eligible day in cycle | PASS | `isTpcFlexible` removes ceiling |
| P1-6 | Past occurrence with no flex → skipped | PASS | `flex < daysPast * 1440 → return` |
| P1-7 | Sort by priority tier, then within tier | STALE | Code sorts by slack across ALL tiers (better behavior, but doc says per-tier) |
| P1-8 | Missed recurring detection (flex window passed) | PASS | `flexEnd <= nowMins` → `missedRecurrings.push(t)` |

## Phase 2: Deadline Work

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| P2-1 | Chain tail = task with deadline | PASS | `hasDeadline[t.id] = true` |
| P2-2 | Chain member = has deadline OR transitive dep has deadline | PASS | BFS through `depends_on` |
| P2-3 | Solo anchor = 1-member chain | PASS | `deps.length === 0 && !hasAncestorsCount[t.id]` |
| P2-4 | Past-due tails: slack=0, P1 boost | PASS | `item._slack = 0; item.task.pri = 'P1'` |
| P2-5 | Slack = available_capacity - duration | PASS | `computeSlack()` walks eligible days |
| P2-6 | Chain member slack: walk backward from tail deadline | PASS | BFS in `computeSlack()` |
| P2-7 | Sort: slack asc, pri asc, dur desc, id | PASS | `allConstrained.sort(...)` |
| P2-8 | Forward placement pass | PASS | `placeItemForward(item)` scans earliest→deadline |
| P2-9 | Retry pass for dep-blocked items | PASS | Step 2f re-runs unplaced items |
| P2-10 | Chain rollback: unplace all, re-place tail first | PASS | Step 2g with reverse topo order |
| P2-11 | Past-due overflow: remove ceiling, place ASAP | PASS | Step 2i removes deadline/ceiling |
| P2-12 | Shared prereq gets tighter mustFinishBy | PASS | `min(consumer1.start, consumer2.start)` in slack computation |
| P2-13 | Impossible constraint detection (startAfter > deadline) | PASS | `earliest > latest → _unplacedReason = 'impossible_window'` |

## Phase 3: Unconstrained Fill

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| P3-1 | Sort by priority P1→P4 | PASS | `unconstrainedPool.sort(aPri - bPri)` |
| P3-2 | Place at earliest free slot | PASS | `placeItemForward(uItem)` |
| P3-3 | Respect when, dayReq, startAfter, deps | PASS | `canPlaceOnDate`, `depsMetByDate`, `getWhenWindows` all called |
| P3-4 | Multi-pass for cross-priority deps | PASS | Up to 5 passes, stops when no progress |

## Phase 4: FlexWhen Relaxation

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| P4-1 | Retry unplaced flexWhen=true tasks | PASS | Filters `item.task.flexWhen` |
| P4-2 | Relax when to "anytime" | PASS | Overrides when-windows to all blocks |
| P4-3 | Mark as _whenRelaxed | PASS | `p._whenRelaxed = true` |

## Phase 5: Recurring Rescue

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| P5-1 | Find unplaced recurring after Phase 4 | PASS | Filters recurring + remaining > 0 |
| P5-2 | Bump lower-priority non-deadline tasks | PASS | Sorted by location overlap, then pri desc |
| P5-3 | If recurring places, try re-placing bumped tasks | PASS | Restore loop for bumped items |
| P5-4 | If bumped tasks can't re-place, undo entire bump | PASS | State save/restore mechanism |

## Cleanup

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| CL-1 | Merge adjacent same-task chunks | REMOVED | Backend merge-back deleted. Frontend handles visual collapse. Spec §5a describes this but code no longer does it. |
| CL-2 | Pile-up eviction by priority | MISSING | Spec §5b describes eviction order. Code prevents overlaps during placement. No post-hoc eviction exists. |

## Persist

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| PE-1 | Write scheduled_at for every placed task | PASS | Batch CASE UPDATE |
| PE-2 | Write date/day/time for every placed task | PASS | Added in today's fix |
| PE-3 | Write dur for placed tasks | PASS | In batch UPDATE |
| PE-4 | Clear date_pinned on scheduler-placed tasks | PASS | `date_pinned: 0` |
| PE-5 | Set unscheduled=1 on evicted/unplaced tasks | PASS | Phase 8 loop |
| PE-6 | Preserve scheduled_at on unscheduled tasks | PASS | Only sets `unscheduled=1`, doesn't clear `scheduled_at` |
| PE-7 | Single transaction per user | PASS | `db.transaction(async function(trx) {...})` |
| PE-8 | Past recurring outside flex window → status='skip' | PASS | Phase 9 |
| PE-9 | Past non-recurring → move to today | PASS | Phase 9 sets `scheduled_at = todayMidnight` |

## Guard Rails

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| GR-1 | No free slot → unscheduled | PASS | Pool items with remaining > 0 after all phases |
| GR-2 | Day restriction mismatch → unscheduled | PASS | `canPlaceOnDate` returns false |
| GR-3 | Dependencies not placed → wait for next run | PASS | `depsMetByDate` returns false; item stays unplaced |
| GR-4 | Location/tools unavailable → skip slot | PASS | `canTaskRun` + `resolveLocationId` |
| GR-5 | Today full after past-due remap → unscheduled | PASS | Overflow pass attempts, then marks unplaced |
| GR-6 | Unscheduled-recurring midnight guard | PASS | `scheduled_at` left NULL, placement phase assigns slot |

## Triggers

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| TR-1 | User edits task → scheduler runs | PASS | `enqueueScheduleRun` called on mutation |
| TR-2 | Calendar sync → scheduler runs | PASS | Enqueued after sync completion |
| TR-3 | Manual "Run scheduler" | PASS | REST + MCP endpoints |
| TR-4 | Status change → scheduler runs | PASS | `enqueueScheduleRun` on status update |
| TR-5 | Queue poller ~2s | PASS | `scheduleQueue.js` polling interval |

## Safety

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| SA-1 | Deterministic IDs | STALE | Spec says `masterId-YYYYMMDD-N`. Code uses ordinal IDs `masterId-N`. |
| SA-2 | One run per user via sync_locks | PASS | `withLock(userId, ...)` |
| SA-3 | Drift detection for split chunks | PASS | Reconcile checks `(split_ordinal, split_total, dur)` |
| SA-4 | Idempotent on stable input | PASS | Tests verify 0 DB updates on second run |

## Split Chunks

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| SP-1 | Chunk 1 inherits preferred time | PASS | In-memory chunk creation copies `preferredTimeMins` for ordinal 1 |
| SP-2 | Chunks 2..N start unplaced | PASS | `time: null` for ordinal > 1 |
| SP-3 | Each chunk is independent — marking one done means that split is finished, not the whole task | PASS | Code correctly updates only the single chunk. Spec was wrong to describe propagation — each chunk represents independent work. |
| SP-4 | Drift detection updates chunks | PASS | Reconcile fixes mismatched `split_ordinal/split_total/dur` |
| SP-5 | N = ceil(D / M) chunks per occurrence | PASS | `computeChunks(dur, splitMin)` |

## Edge Cases

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| EC-1 | Circular deps detected and broken | PASS | DFS cycle detection, edge removed |
| EC-2 | Prereq with own deadline | PASS | `min(consumer.effective_start, own_deadline)` |
| EC-3 | Recurring prereq blocks consumer | PASS | Consumer skips to next eligible day |
| EC-4 | Tail unscheduled when day full | PASS | Overflow pass attempts ASAP placement |
| EC-5 | Long chains that don't fit | PASS | Chain rollback prioritizes tail |
| EC-6 | startAfter without deadline → Phase 3 | PASS | Forward fill respects floor |
| EC-7 | startAfter > deadline → impossible | PASS | Flagged with `impossible_window` |

## Unplaced Output

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| UP-1 | Generated tasks with _unplacedReason kept in output | PASS | Fixed: filter now checks `_unplacedReason` |
| UP-2 | Generated tasks without reason filtered from output | PASS | `!t.generated` unless `_unplacedReason` set |
| UP-3 | Recurring instances: today/past → marked unscheduled | PASS | Fixed: checks `instDate > today` before skipping |
| UP-4 | Recurring instances: future → silently skipped | PASS | Future instances deferred |

---

## Summary

| Status | Count |
|--------|-------|
| PASS | 62 |
| FAIL | 0 |
| STALE | 4 |
| MISSING | 2 |
| REMOVED | 1 |

### MISSING (spec describes, code doesn't implement)

**GP-3 / CL-2: Pile-up eviction.** Spec §5b describes a post-placement eviction order (pinned first, then priority, then duration). Code prevents overlaps during placement instead. The spec's Principle 3 has no code path.

### STALE (doc doesn't match current code)

**P0-1:** Spec says `when:'fixed'`, code uses `datePinned`
**P1-7:** Spec says per-priority-tier sort, code sorts across all tiers by slack
**SA-1:** Spec says `masterId-YYYYMMDD-N` IDs, code uses ordinal IDs
**CL-1:** Spec describes backend merge-back, code removed it

### REMOVED (intentionally deleted)

**CL-1: Backend merge-back.** Removed because it folded split chunks into single blocks. Frontend handles visual collapse.
