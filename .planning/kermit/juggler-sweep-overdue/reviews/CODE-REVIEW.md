# Ernie Review — juggler-sweep-overdue (taskMappers.js + runSchedule.js diff) — bugfix — 2026-06-26

## Status: DONE

## Re-review delta (2026-06-26 — F1 only)
| Prior finding | Re-scan (runSchedule.js helper :235, call-site :1942) | Verdict |
|---------------|------------------------------------------------------|---------|
| F1 BLOCK (`min()` regressed R50.0) | bert changed the combine to `periodBoundary > windowClose ? periodBoundary : windowClose` (helper :240) = MAX of the two non-null deadlines; null-handling (`periodBoundary==null`→windowClose-or-null; `windowClose==null`→periodBoundary) ignores nulls correctly; call-site `today < effectiveDeadline → stay live` ⇒ overdue only when `today >= max(periodEnd, windowClose)` = past BOTH. This is the exact De Morgan dual of the original two independent OR guards (live if within EITHER window) — behavior-preserving. R50.0 preserved: `periodEnd > windowClose ⇒ effectiveDeadline = periodEnd`, so a flexible-TPC instance stays live until the cycle boundary, not the earlier flex window. No residual `min`/"earlier" semantics remain (grep NONE). Doc comment :220-228 + call-site comment :1932-1937 updated to `max`/De Morgan and now agree with the code. | **RESOLVED** |

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | mode=bugfix, files from positional list (2 files) | present |
| Scope detect | `git diff` of taskMappers.js + runSchedule.js in worktree | 2 files, ~115 changed lines |
| Mode gate | bugfix → repro/tests: leg ships placement-disjointness/overdue-pastdue/weather suites (BERT-LOG 28/28) | present, but the BLOCK scenario is untested (see F4) |
| Read context | SPEC.md (governing rules R50/R50.0/999.671), BERT-LOG.md, juggler CLAUDE.md, memory (never-missing, R50) | done |
| Logic scan | traced computeEffectiveDeadline control-flow vs original two sequential guards | F1 BLOCK |
| Null/`??` scan | `preferred_time_mins != null ? ... : scheduledMins` preserves 0 (midnight) | correct — confirmed, no finding |
| Guard-change scan | `time_flex > 0` → `time_flex != null`; checked schema/validation for negatives | F2 INFO (validation caps 0..480) |
| Disjointness scan | off-by-one (`>` not `>=`), single-entry, unsorted, missing dur | correct; F3 INFO (NaN-dur silently skipped) |
| WARN-wiring scan | exception-safety + `dayPlacements` scope at line 2035 | safe — no throw, var in-scope (1456, same fn) |
| Hard-constraint scan | 999.671 floating-one-off / isPlacedRecurringInstance / hasHardCommitment gate | UNTOUCHED — not a BLOCK |
| Error-handling/resource/concurrency/type | pure helpers, no async/IO/state added | clean |
| Output written | this file + ernie-REVIEW.json | done |

## Proof Checklist
- [x] Required inputs present — mode=bugfix, 2-file scope non-empty
- [x] Scope confirmed — taskMappers.js, runSchedule.js (diff read in full; widened to surrounding Reads)
- [x] Mode gate checked — bugfix; leg has tests, but the F1 scenario (flexible-TPC + period boundary) has NO covering test (BERT-LOG confirms)
- [x] Complexity scan — new helpers are small/pure; no file-size or nesting regression
- [x] Error handling scan — no new promises/catches; WARN loop cannot throw
- [x] Floating-promise / forEach(async) scan — none introduced (synchronous `forEach` over array)
- [x] Error-cause-preservation scan — n/a (no new catch/re-throw)
- [x] Input validation scan — helpers are internal; guarded against null/short arrays
- [x] Unapproved-fallback scan — `?? scheduledMins` / `!= null ? :` are deliberate AC2b defaults, not maybe-null papering; documented in SPEC AC-840-1
- [x] Numeric precision/boundary scan — disjointness uses `>` (touching allowed, correct); minute math integer-safe
- [x] ReDoS scan — no regex added
- [x] Date/TZ & DB-clock scan — F5 INFO (UTC-minutes treatment of preferred_time_mins in cron path)
- [x] Resource scan — no handles/timers/sync-IO added
- [x] DB-transaction/atomicity scan — WARN loop adds no writes; persistDelta unchanged
- [x] Concurrency scan — helpers pure, no shared mutable state
- [x] Idempotency scan — n/a (no queue/webhook consumer in diff)
- [x] Grep matches triaged — validation (0..480), dayPlacements scope, 999.671 region all READ and reasoned
- [x] Type safety scan — `task.preferredTimeMins`/`preferred_time_mins` dual-read guarded; no unsafe casts
- [x] React logic scan — SKIPPED (no .jsx/.tsx in this 2-file scope; ConflictsView.jsx is out of this review's scope)
- [x] Observability scan — `logger.warn` structured with date+ids+slots; no bare console
- [x] Dead-code scan — no commented-out blocks / TODOs introduced
- [x] Flag-and-refer emitted — F4→telly (missing regression test)
- [x] All findings carry file:line + BLOCK/WARN/INFO
- [x] No "missing test" filed as ernie BLOCK — F4 is INFO REFER→telly
- [x] No security findings reviewed in depth — none present
- [x] Prior knowledge consulted — R50.0 + 999.671 read from SPEC governing rules + memory (juggler-never-missing-invariant); F1 contradicts a LOCKED invariant
- [x] Knowledge change reported — F1 reveals SPEC AC-840-4 itself prescribes the defective `min()`; flagged for Kermit/Scooter reconciliation (see F1 fix)
- [x] Rubric Coverage Map emitted
- [x] Output written
- [x] Re-review delta recorded — F1 re-scanned at helper :235 / call-site :1942; RESOLVED (max semantics, De Morgan-equivalent, R50.0 preserved)
- [x] Status set: DONE (F1 BLOCK resolved; 0 unresolved BLOCK)

## Findings
| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| F1 | RESOLVED (was BLOCK) | runSchedule.js:235 (call-site :1942) | **RESOLVED 2026-06-26:** bert changed the combine to `max` (`periodBoundary > windowClose ? periodBoundary : windowClose`), the exact De Morgan dual of the original OR guards — overdue only when past BOTH; R50.0 period-boundary extension restored. Null-handling ignores nulls (one null→the other, both null→null). Call-site `today < effectiveDeadline` is consistent with max. Verified: no residual `min` semantics, doc/call-site comments corrected. ORIGINAL: `computeEffectiveDeadline` returned `min(periodBoundary, windowClose)`, but the two original sequential guards implemented **OR** semantics ("stay live if within EITHER window" — comment at :1930-1931 and the deleted "either of which keeps it from being missed"). `min()` makes the instance stay live only while within **BOTH** windows, i.e. it expires at the *earlier* deadline. Because `time_flex` is capped at 480min (same-day) while `periodEnd` is the cycle end (later), `min()` ≈ `windowClose` ALWAYS → the R50.0 period-boundary extension is **never applied**. A flexible-TPC recurring instance (e.g. 3×/week) is flagged overdue/unscheduled mid-cycle instead of staying live until the week ends — a direct R50.0 violation and a scheduler-cascade regression. The control flow was NOT preserved. | Combine must be **`max`** (later deadline), not `min`: stay live while `today < max(periodBoundary, windowClose)`. NOTE: SPEC AC-840-4 itself prescribes `min()`, so the SPEC is also wrong — REFER→Kermit/Scooter to reconcile AC-840-4 against R50.0 before bert re-fixes. The both-null→null branch is safe at the call site (`!effectiveDeadline || today < …` returns/stays-live), so only the operator is wrong. |
| F2 | INFO | taskMappers.js:427 / runSchedule.js:206 | `time_flex != null` admits negative flex; a negative would make `windowCloseMins = preferred + negative < preferred` → window closes before the slot → premature overdue. | No change required: `taskValidation.js:152` rejects `tfVal < 0` (range 0..480) at the API boundary, so negatives cannot persist via the supported path. Defense-in-depth only. |
| F3 | INFO | runSchedule.js:253-255 | `checkPlacementDisjointness`: an entry with missing/NaN `dur` or `start` yields `NaN > next.start === false`, so a malformed placement silently produces no violation — a WARN-only assertion could under-report. | Acceptable for a non-blocking diagnostic; optionally coerce/guard `prev.dur`/`start` to numbers and warn on non-numeric. Off-by-one is correct (`>` not `>=`; touching `aEnd === next.start` is not a violation). Single-entry/empty/null/unsorted all handled correctly. |
| F4 | INFO | runSchedule.js:1937 | The F1 regression scenario (flexible-TPC recurring instance with a period boundary later than the flex window) has NO covering test — BERT-LOG explicitly notes "no existing test covers the flexible-TPC-with-timeFlex scenario," which is exactly why the `min`/`max` inversion passed green. | REFER→telly: add a regression test where `periodEnd > windowClose` and `windowClose < today < periodEnd` asserts the instance stays live (not overdue/unscheduled). This test must go RED on the current `min()` code. |
| F5 | INFO | runSchedule.js:211-217 | `computeWindowCloseUtc` treats `preferred_time_mins` as UTC-minutes-since-midnight and anchors to `saDate`'s UTC midnight; if `preferred_time_mins` is stored as local-tz minutes there is a tz skew in the cal-history cron (`missedHelpers`) consumer. | Pre-existing/acknowledged by the in-code "UTC-pure" comment; the former in-scheduler auto-mark consumer was removed (Leg D). Low impact — note only. |

## Confirmations (checked, no finding)
- **`preferred_time_mins ?? scheduledMins` preserves 0 (midnight):** both sites use `(x != null ? x : scheduledMins)`, a strict null/undefined check — a stored `0` (00:00) is preserved and does NOT fall through to the slot. Correct vs `||`.
- **`time_flex == 0` enters the windowed path (AC2c):** `!= null` admits `0`; zero-width window → overdue at the slot/preferred minute. Correct.
- **999.671 hard constraint UNTOUCHED:** the diff changes only the `time_flex` sub-condition *inside* the `isPlacedRecurringInstance` windowed branch (taskMappers.js:427) and its comment; the floating-one-off / `isPlacedRecurringInstance` / hard-commitment gate (SPEC :339-371) is not in the diff. Not a BLOCK.
- **WARN wiring cannot throw / aborts nothing:** `checkPlacementDisjointness` guards `!dayPlacements` (returns `[]`); `dayPlacements` is `var`-declared at runSchedule.js:1456 in the same function as the call at :2035 (no function boundary between — verified), so no ReferenceError; `logger.warn` over `[]` is a no-op.

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Correctness | covered | F1 RESOLVED — combine now `max` (De Morgan dual of OR guards); R50.0 period extension restored; null-handling + call-site comparison verified consistent | re-review 2026-06-26 |
| Readability | covered | helpers well-commented, named, JSDoc'd | comment at :1930-1932 is now self-contradictory (claims roam-until-period, codes earlier-of) |
| Maintainability | covered | pure helpers extracted + exported | improves testability of the deadline combine |
| Error Handling | covered | WARN loop cannot throw; no new async/catch | — |
| Coupling | covered | helpers are pure, no new deps | — |
| Type Safety | partial | dual-read `preferredTimeMins`/`preferred_time_mins` guarded; NaN-dur path (F3) | low |
| API Design | covered | three new named module exports; signatures clear | — |
| Resource Management | covered | no handles/timers/sync-IO added | — |
| Concurrency Safety | covered | no shared mutable state; helpers pure | — |

## Refers
- F1 → Kermit/Scooter: SPEC AC-840-4 prescribes `min()`, which contradicts LOCKED R50.0 — reconcile the AC before re-fix.
- F4 → telly: add the flexible-TPC-period-boundary regression test (must go RED on current `min()`).

## Sign-off
Signed: Ernie — 2026-06-26T00:00:00Z
