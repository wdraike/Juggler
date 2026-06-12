# Ernie Review — H6 W3 RunScheduleCommand orchestration — refactor — 2026-06-12

## Status: DONE

## Repoint-equivalence verdict
**EQUIVALENT.** The deleted inline `pendingUpdates` flush (sort → partition → batched
scheduled_at/dur/date/day/time CASE at CHUNK=200 → per-row otherUpdates loop) is reproduced
byte-for-byte inside `KnexScheduleRepository.writeChanged`, reached via
`RunScheduleCommand.persistDelta`. Same rows written, same `instanceOnly:true` partition, same
fields, same 200-chunk size, same deterministic id-sort, same `day||null`/`time||null` binding
defaults. The only deltas are the two human-approved ones (P1 `new Date()` for `updated_at`;
S5 caller already excluded unchanged rows). No field/row/order dropped or added. trx-binding,
deadlock-retry, scheduleQueue-isolation, error propagation, and side-effect preservation all
confirmed below.

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | mode=refactor, files=slices/scheduler/application/ + runSchedule.js | present |
| Scope detect | read RunScheduleCommand.js, application/index.js, KnexScheduleRepository.js, MysqlClockAdapter.js; `git diff HEAD runSchedule.js` (full) | 4 src files + 1 diff |
| Refactor gate | characterization tests | `tests/characterization/scheduler/goldenMaster.h6.test.js` + `tests/slices/scheduler/scheduleAdapters.contract.test.js` present (green per W2 commit) |
| Q1 persist-equivalence | diffed deleted inline flush vs `writeChanged` line-by-line | equivalent (see verdict) |
| Q2 trx-binding | traced every `_runScheduleCommand.*(trx,...)` → `_repo(trx)` → `repositoryFactory(trx)` | all writes trx-bound (T-TX) |
| Q3 deadlock-retry | read retry handler 1914-1921 + singleton lifecycle | re-call re-opens tx, fresh trx per attempt, singleton holds no trx state |
| Q4 no scheduleQueue | `grep -rn require( slices/scheduler/{application,adapters}` | zero scheduleQueue/enqueueScheduleRun requires (only doc comments) |
| Q5 error handling | read async methods + `_assertDates` throw path | proper await, throws propagate to retry handler, no swallow |
| Q6 side-effects | inspected deleted flush boundaries (1695-1696..1707-1708) | flush was pure SQL — no SSE/in-memory state dropped |
| Complexity scan | wc -l | RunScheduleCommand 160, KnexScheduleRepository 223 — both <300 |
| Error/floating-promise scan | grep forEach(async)/.then/||/?? on W3 files | no floating promise, no forEach(async); all `||` are DI defaults / legacy-verbatim |
| Fallback scan | each `||`/`??` read in context | none paper over a maybe-null business field; all approved DI/legacy patterns |
| P1 date scan | traced scheduled_at/completed_at value origins (localToUtc/computeWindowCloseUtc) | all JS Dates → `_assertDates` passes, no new throw on normal path |
| Output written | Write .planning/kermit/reviews/CODE-REVIEW.md | Done |

## Proof Checklist
- [x] Required inputs present — mode=refactor, file scope non-empty (2 path scopes)
- [x] Scope confirmed — RunScheduleCommand.js, application/index.js, KnexScheduleRepository.js, MysqlClockAdapter.js, runSchedule.js diff
- [x] Mode noted + gate checked — refactor; characterization (goldenMaster.h6 + adapter-contract) present/green
- [x] Complexity scan run — both new files <300 lines, no deep nesting beyond legacy
- [x] Error handling scan run — async methods await correctly; `_assertDates` throw propagates; no empty catch
- [x] Floating-promise / forEach(async) / Promise.all-partial scan run — `Promise.all` over `_rollingBackfills` is independent updates, full-fail-on-one matches legacy; no footgun
- [x] Error-cause-preservation scan run — no catch-returns-success-default introduced; `_assertDates` fails loud
- [x] Input validation scan run — `writeChanged` requires `opts.userId` (throws if absent); `_repo` requires trx (throws); not a public HTTP entry point
- [x] Unapproved-fallback scan run — all `||`/`??` are DI constructor defaults or legacy-verbatim (`day||null`); none over a maybe-null field
- [x] Numeric precision/boundary scan run — chunk loop `ci += CHUNK` identical to legacy; no parseInt/money/off-by-one introduced
- [x] ReDoS scan run — no regex on user input; `_schedAtMs` regex is a fixed anchored datetime pattern over DB/internal values, bounded
- [x] Date/TZ & DB-clock scan run — DB clock (`SELECT NOW(3)`) preserved as source of truth for cache `generatedAt` via `dbNow`; P1 `new Date()` for `updated_at` is the approved change, asserted Date-typed
- [x] Resource management scan run — no new handles/timers; trx owned by caller, closed by caller's `db.transaction`
- [x] DB-transaction/atomicity scan run — every persist primitive trx-bound; commits/rolls back with caller tx (the `db`-not-`trx` reconcile write at 886 is the deliberate pre-existing safety-net, intent unchanged)
- [x] Concurrency scan run — `_runScheduleCommand` module-singleton is stateless w.r.t. trx (no shared mutable per-request state); each call builds a fresh trx-scoped repo
- [x] Idempotency-under-retry scan run — deadlock-retry re-opens whole tx with fresh trx; no duplicate-effect risk (whole tx rolled back before retry)
- [x] Grep matches triaged — every `||` read in context; floating-promise/ReDoS/idempotency reasoned, not counted
- [x] Type safety scan run — no `as any`/@ts-ignore (JS); `_assertDates` adds a runtime type guard on date columns
- [x] React logic scan — skipped (no .jsx/.tsx in scope)
- [x] Observability scan run — `logger.info` preserved; no bare console.log introduced
- [x] Dead code scan run — inline flush fully removed (not commented out); no TODO/FIXME added
- [x] Flag-and-refer emitted — data-integrity/P1/sync → elmo; tests → zoe (see Findings INFO rows)
- [x] All findings carry file:line + BLOCK/WARN/INFO
- [x] No "missing test" findings filed
- [x] No security findings reviewed in depth (referred to elmo)
- [x] Prior knowledge — non-trivial refactor: cookie owns the design-time Scooter consult block (ARCH-REVIEW.md); ernie does not duplicate (per skill rule)
- [x] Knowledge changes reported — none (behavior-preserving refactor; no requirement/standard changed by ernie)
- [x] Rubric Coverage Map emitted — all 9 dimensions marked
- [x] Output file written
- [x] Status line set — DONE (no BLOCK)

## Findings
| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| 1 | INFO | KnexScheduleRepository.js:171-178 | `slack_mins` is silently dropped in the batched CASE path (not emitted as a CASE column) — but this is BYTE-FAITHFUL to the legacy inline flush, which also never wrote slack_mins in the batched path. Rows carrying only `slack_mins` + scheduled_at route through the batched path and lose slack_mins in BOTH old and new code. Equivalence preserved; the latent legacy quirk is out of W3 scope. | No change for W3. If the slack_mins-loss is a latent bug, REFER→elmo (data-integrity) / separate backlog item. |
| 2 | INFO | runSchedule.js:886 | The reconcile safety-net write uses `db` (not `trx`) with `updated_at: _runScheduleCommand.clockNow()` (was `db.fn.now()`). NOT routed through the command — the deliberate "survives rollback" path. The P1 swap to `clockNow()` (JS Date) is consistent with the rest of W3. Dual-connection rollback semantics are elmo's column. | REFER→elmo (P1/data-integrity/rollback semantics co-lead). |
| 3 | INFO | runSchedule.js:1006-1037 | Phase-1 chunk INSERT now stamps `created_at`/`updated_at` with `clockNow()` (JS Date) and projects an ISO string into `phase1InsertedById` for `rowToTask`. Behavior-equivalent reasoning is sound (DB row = Date, projection = parseable ISO). | REFER→zoe to confirm golden-master covers the changeset projection for phase-1 inserts. |
| 4 | INFO | tests/characterization/scheduler/goldenMaster.h6.test.js | Refactor gate (characterization + adapter-contract) exists; the WRITE-set equivalence (S5) is what gates this leg, not just golden output. Adversarial verification of the write-set assertions is zoe's. | REFER→zoe (test truthfulness of write-set / golden-master). |

No BLOCK. No WARN.

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Correctness | covered | Inline flush vs `writeChanged` diffed line-by-line; partition/CASE/chunk/sort/otherUpdates identical; P1+S5 are the only (approved) deltas | Repoint equivalent |
| Readability | covered | Command is a thin 160-line per-primitive orchestrator; intent-documented | Below size threshold |
| Maintainability | covered | Two delta-write impls collapsed to one (`writeChanged`); inline flush removed, not commented | Reduces duplication |
| Error Handling | covered | `writeChanged` requires userId (throws), `_repo` requires trx (throws), `_assertDates` fails loud; throws propagate to deadlock-retry at 1914 | No swallow |
| Coupling | partial | Command depends only on adapters (KnexScheduleRepository, MysqlClockAdapter) + ports; no scheduleQueue | Topology/boundary depth → cookie |
| Type Safety | covered | JS; `_assertDates` adds runtime Date guard on P1 columns; scheduled_at/completed_at confirmed Date-typed from localToUtc/computeWindowCloseUtc | No unsafe cast |
| API Design | covered | Typed per-primitive seam (persistDelta/deleteTasksWhere/backfillRollingAnchor/dbNow/clockNow); trx passed explicitly (T-TX) | Clear contract |
| Resource Management | covered | No new handles/timers; trx lifecycle owned by caller's `db.transaction` | No leak |
| Concurrency Safety | covered | Module-singleton `_runScheduleCommand` is stateless per-request (trx passed per-call, fresh repo per-call); deadlock-retry re-opens whole tx with fresh trx, no stale-trx capture | Singleton safe |

## Sign-off
Signed: Ernie — 2026-06-12T00:00:00Z
