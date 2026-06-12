# BERT-LOG — juggler-backend H6 W2 scheduler ports/adapters — refactor — 2026-06-12

## Status: DONE

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | verified --mode refactor, --source CODE-REVIEW.md + ARCH-REVIEW.md present | present |
| Read context | read CODE-REVIEW.md (ernie W1), ARCH-REVIEW.md (cookie W2-1), juggler CLAUDE.md, SchedulerWeatherProvider.js, KnexScheduleRepository.js, runSchedule.js (flush:1700-1773, placementMatchesDbRow:351-392), weather/facade.js, weather.controller.js | done |
| Parse findings | extracted 2 WARN findings in scope: cookie W2-1 (facade boundary) + ernie W1 (slack_mins behavioral divergence) | done |
| Investigate slack_mins | grep runSchedule.js for slack_mins — 8 hits; read legacy batched flush (1714-1773); confirmed CASE fold for scheduled_at/dur/date/day/time, NO slack_mins CASE; dbUpdates carry slack_mins but the batch silently drops it | legacy does NOT persist slack_mins via the batched path |
| Apply Fix 1 | SchedulerWeatherProvider.js:30 — repoint require from controllers/weather.controller to slices/weather/facade; also updated JSDoc comment on line 9 | done |
| Apply Fix 2a | KnexScheduleRepository.js:171-183 — removed slack_mins CASE fold; added clarifying comment on why it is absent (behavior-faithful to legacy drop) | done |
| Apply Fix 2b | runSchedule.js:377-389 — removed slack_mins branch from placementMatchesDbRow; added comment explaining the omission (comparing a never-written field causes perpetual mismatch) | done |
| Adjacent-regression | grep roundCoord call-sites — 2 (facade.js:218 source + controller.js:144 re-export; no other consumer); grep slack_mins comparison in test files — contract test asserts nothing about slack_mins (zoe R2 referred); golden-master pins computed slackByTaskId not slack_mins write-pattern (ernie I1 confirmed) | 0 affected callers broken |
| Self-verify | node --check all 3 mutated files — PARSE OK; golden-master 43/43; adapter contract 14/14; full scheduler suite 114/114 | all green |
| REFER lines | 0 emitted (no new test/doc requirement from these two mechanical fixes) | n/a |
| Output written | Write BERT-LOG.md + bert-REVIEW.json | Done |

## Slack_mins Investigation Result

**Question:** Does the legacy live persist path (runSchedule.js `pendingUpdates` flush, lines 1700-1773) ever write `slack_mins` via the batched CASE update?

**Evidence:**
- Lines 1401-1402: placed-task `dbUpdate` receives `slack_mins = result.slackByTaskId[taskId]` when present
- Line 1707: partition condition `(dbUpdate.scheduled_at || dbUpdate.dur) && !dbUpdate.status` — these dbUpdates (which carry slack_mins) route to `scheduledAtUpdates`
- Lines 1714-1773 (batched CASE flush): builds CASE for `scheduled_at`, `dur`, `date`, `day`, `time` — NO slack_mins CASE fold exists
- **Result: the legacy batch silently drops `slack_mins`** even when `dbUpdate` carries it. It is never persisted via the batched path.
- Lines 379-389 (`placementMatchesDbRow`): DID compare slack_mins — causing the skip check to find a mismatch when slack changed, triggering a write, but that write then silently dropped slack_mins from the batch. Net effect: perpetual redundant writes on tasks where slack changes, but slack_mins is never actually updated in DB.

**Reconciliation applied:**
- Option (b) from ernie's W1 finding: remove the slack_mins fold from `writeChanged` (not present in legacy batch), remove the slack_mins comparison from `placementMatchesDbRow` (comparing a never-written field causes false mismatches).
- `writeChanged` is now byte-faithful to the legacy flush for the batched path (only approved deviations: P1 `new Date()` + S5 delta-write).
- `placementMatchesDbRow` now only compares fields the live write path actually persists.

## Proof Checklist
- [x] Required inputs present: --mode refactor, --source CODE-REVIEW.md + ARCH-REVIEW.md
- [x] Mode confirmed: refactor — behavior-preserving relative to legacy (no third behavioral change introduced)
- [x] All BLOCK findings addressed (none in scope — 0 BLOCK in these review files for this leg)
- [x] All WARN findings addressed: cookie W2-1 fixed (facade repoint); ernie W1 fixed (slack_mins reconciliation)
- [x] No unapproved fallbacks introduced
- [x] No tests authored by bert (existing suite covers; no new refer needed)
- [x] No docs authored by bert
- [x] Disputed findings referred back to reviewer — none disputed
- [x] Design-level fixes referred up — none required (both fixes are mechanical)
- [x] Blast-radius bound respected: Fix 1 = 2 lines in 1 file; Fix 2 = ~16 lines removed/replaced across 2 files. Well within 40-line / 3-file bound
- [x] Adjacent-regression checked: roundCoord call-sites verified (facade is source, controller is pass-through re-export); slack_mins comparison removal verified against test suite (golden-master + adapter contract green)
- [x] Findings re-anchored: Fix 1 at line 30 (confirmed by Read); Fix 2a at lines 171-183 (confirmed by Read); Fix 2b at lines 377-389 (confirmed by Read)
- [x] Fix self-verified: all 3 mutated files parse OK; golden-master 43/43; adapter contract 14/14; full scheduler suite 114/114
- [x] BERT-LOG.md written in Contract-4 format
- [x] Changed files listed
- [x] REFER lines listed (none)
- [x] Status line set: DONE
- [x] Hand-off message emitted naming owning re-reviewers

## Findings Actioned
| # | Severity | Source | File:Line | Description | Fix Applied | Result |
|---|----------|--------|-----------|-------------|-------------|--------|
| W2-1 | WARN | ARCH-REVIEW (cookie) | SchedulerWeatherProvider.js:30 | `roundCoord` sourced via `controllers/weather.controller` instead of canonical `slices/weather/facade` — deviates from binding facade-only boundary rule even though it resolves to the same function | Repointed `require` from `'../../../controllers/weather.controller'` to `'../../weather/facade'`; also updated JSDoc comment on lines 8-10 to remove reference to controller path | Fixed |
| W1-slack | WARN | CODE-REVIEW (ernie) | KnexScheduleRepository.js:171-183 + runSchedule.js:377-389 | Undeclared third behavioral change: slack_mins CASE fold in writeChanged that legacy batch silently drops; placementMatchesDbRow comparing a never-written field causing perpetual false-mismatches | Investigation confirmed: legacy batch does NOT persist slack_mins. Removed the slack_mins CASE fold from writeChanged; removed the slack_mins branch from placementMatchesDbRow. Added comments explaining the intentional omission in both files | Fixed |

## Refers Emitted
None.

## Changed Files
- `juggler-backend/src/slices/scheduler/adapters/SchedulerWeatherProvider.js` (line 9-11 JSDoc updated; line 30 require repointed from controllers/weather.controller to slices/weather/facade)
- `juggler-backend/src/slices/scheduler/adapters/KnexScheduleRepository.js` (lines 171-183 slack_mins CASE fold removed; replaced with explanatory comment)
- `juggler-backend/src/scheduler/runSchedule.js` (lines 377-389 slack_mins branch removed from placementMatchesDbRow; replaced with explanatory comment)

## Test Results
| Suite | Result |
|-------|--------|
| Golden-master (goldenMaster.h6.test.js) | 43/43 PASS |
| S5/C-IDEM real it() within golden-master | GREEN (included in 43/43) |
| Adapter contract (scheduleAdapters.contract.test.js) | 14/14 PASS |
| Domain value-objects-entities (value-objects-entities.test.js) | included in 114/114 |
| Domain solvers (solvers.test.js) | included in 114/114 |
| Full scheduler suite (all 4 suites) | 114/114 PASS — no new failures |

## Sign-off
Signed: Bert — 2026-06-12T15:45:00Z
