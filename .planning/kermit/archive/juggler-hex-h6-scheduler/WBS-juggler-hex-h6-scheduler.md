# WBS — juggler-hex-h6-scheduler — refactor — 2026-06-12

## Intent
Extract the juggler scheduler core (5,373 ln across `src/scheduler/`) into a pure hexagonal slice —
`ConstraintSolver`/`ScoreEngine`/`ConflictResolver` domain core (zero I/O) behind ports, with
`RunScheduleCommand` as the sole I/O orchestrator and `slices/scheduler/facade.js` as the entry.
**Behavior-identical refactor** gated by a golden-master characterization suite that is green BEFORE
and AFTER extraction (DESIGN §3 / invariant S8). LAST + HIGHEST-risk hex phase — *scheduler bugs
cascade and corrupt all task data* (CLAUDE.md §Scheduler).

**Business acceptance:** scheduling output bit-for-bit identical pre/post extraction; S1–S8 + P1 each
pinned by a characterization test; no scheduling-time regression vs baseline; exit-gate greps pass
(`grep db.fn.now` in extracted adapter = 0; `RunScheduleCommand` does not import `scheduleQueue`).

## Locked decisions (Scooter + user, 2026-06-12)
- **S5 = deliberate behavioral change to delta-write (user, 2026-06-12).** zoe/ernie found the current scheduler writes EVERY placed task every run (runSchedule.js:1264 "NEW DESIGN … no minimal-diff optimization"), contradicting DESIGN §6 S5 ("delta-writes only"). **User ruling: change to write-changed (delta-write).** So DESIGN S5 STANDS (honored, not stale); the write-all code is the deviation H6 corrects. Consequences: (a) the bit-for-bit golden-master gate covers **schedule OUTPUT only** (placements/unplaced/score/slack), NOT write-pattern; (b) **S5 + C-IDEM are RED-now / GREEN-after behavioral tests** (TDD — current code writes-all and is non-idempotent at DB level; they flip GREEN when delta-write lands in W2/W3), NOT green-before-and-after characterizations; (c) ⚠️ **BINDING RISK** — the "NEW DESIGN" write-all rationale was *"eliminates stale-DB states the sync used to compensate for"*; delta-write must NOT reopen that calendar-sync staleness bug (CLAUDE.md: sync DB-contention is a known open issue). W2/W3 (elmo+cookie+telly) MUST verify sync correctness under delta-write. Scooter challenge `h6-s5-deltawrite-contradiction` resolves: write-all superseded by delta-write restoration.
- **Single leg, wave commits** (W0→W5 serial chain; each wave a commit, H4 precedent).
- **Dead stubs deferred to H7** — `dateHelpers.js`/`dependencyHelpers.js`/`locationHelpers.js`/`timeBlockHelpers.js` (4-ln shims) + `unifiedSchedule.js` (1 ln) NOT touched in H6; H7 deletes them.
- **Trigger seam verify-wired only** — VERIFIED (evidence): `scheduleQueue.js` owns the mutation→schedule trigger; `runSchedule.js` body does not call `enqueueScheduleRun`; `src/lib/events/` exists. H6 proves S4 via characterization + keeps `RunScheduleCommand` free of `scheduleQueue`. No new event plumbing (that is a follow-on, not H6 exit).
- **P1 fix in-scope** — the 19 `db.fn.now()`/`trx.fn.now()` violations in `runSchedule.js` move into `KnexScheduleRepository` corrected to `new Date()` (ADR-0003 veto).
- **task.controller coupling cut** — `runSchedule.js`→`require('../controllers/task.controller')` (rowToTask/buildSourceMap/taskToRow) replaced by `SchedulerTaskProvider` over the task facade.

## Scooter answer (cited)
Settled/documented. Port + adapter names fixed (DESIGN §2.2/§3). Vetoes in play (never re-propose):
scheduler LAST (DESIGN §9) · no `db.fn.now()` (ADR-0003/P1) · no self-trigger (S4) · delta-write only,
no full-rebuild (S5) · no off-day recurring placement (S3) · golden-master green before+after (DESIGN §3/S8).
Sources: JUGGLER-HEX-DESIGN.md §2.2/§3/§4/§6/§9 · JUGGLER-HEX-ROADMAP.md §3-H6/§4/§6 · scheduler-rules · ADR-0001/0002/0003.

## Work Items
| ID | Task | Mode | Scope | Inputs required | Depends on | Acceptance criteria | Agents | Wave |
|----|------|------|-------|-----------------|-----------|---------------------|--------|------|
| W0 | **Characterization golden-master** suite, green on CURRENT code. `tests/characterization/scheduler/goldenMaster.h6.test.js` snapshots {dayPlacements, unplaced, score, slackByTaskId} over real fixtures (test-bed 3407). Adds the gap-tests: S3 same-day-recurrence, S4 no-self-trigger (static require-graph assert: core does not import scheduleQueue), S5 delta-write-count (full-run), S6 no-cascade (spy enqueueScheduleRun uncalled), score-engine snapshot, idempotence (run-2 updated=0), weather-fail-open. **Includes a multi-phase mixed-constraint integrated fixture** (Snuffy: prove the 3 solvers compose, not just unit-isolate). Also: update ROADMAP.md H2–H5 COMPLETE blocks + header (stale; housekeeping). **Post-zoe correction (2026-06-12):** CORE snapshot pins schedule OUTPUT values via frozen-literal `toEqual` (NOT shape-only — zoe BLOCK/WARN: survived inverted slack sort + isDayLocked=false). Characterization tests (S1/S2/S3/S4/S6/S7/C-SCORE/C-WX) green-before-and-after, OUTPUT only. **S5 + C-IDEM are RED-now/GREEN-after behavioral tests** (delta-write not yet implemented). S3/C-WX fixtures MUST force the conflict that exercises the mechanism (zoe: current fixtures never call the lock/weatherOk). S5/C-IDEM integration tests MUST actually invoke runSchedule (zoe BLOCK-2/ernie F2: they hand-roll the diff). | refactor | juggler | DESIGN §3/§6, SCHEDULER.md, existing scheduler tests, test-bed 3407 | — | Characterization (output) tests GREEN on un-refactored code; **each zoe mutation (MUT-A isDayLocked, MUT-B weatherOk, MUT-D slack-sort) produces ≥1 RED** before S8 declared cleared; S5+C-IDEM RED on current code (correctly, pending delta-write); integrated multi-solver fixture present; CORE = frozen-literal toEqual; roadmap doc reflects H2–H5 complete | telly (lead), zoe, ernie | 0 |
| W1 | **Pure domain core** — `slices/scheduler/domain/`: `ConstraintSolver.solve(tasks,constraints,timeWindows)` (S1 most-constrained→least; S2 severity comparator), `ScoreEngine.score(schedule)` (from scoreSchedule.js), `ConflictResolver.resolve(schedule,calendarBusy)`. Entities/VOs: `Schedule`(agg root), `ScheduledTask`, `Constraint`, `ScoredSchedule`; VOs `TimeWindow`, `Priority`, `Deadline`, `PlacementMode`(S7 closed-enum). ZERO I/O. | refactor | juggler | W0 suite, DESIGN §3, unifiedScheduleV2.js, scoreSchedule.js | W0 | Pure core (no db/redis/fs/require-controller); domain unit tests green **incl. integrated 3-solver pipeline scenario** (Snuffy); golden-master still GREEN (core reproduces snapshot); S1/S2/S3/S7 logic resident in core | ernie (lead), telly, cookie | 1 |
| W2 | **Ports & Adapters** (Snuffy: collapsed — no design space between a port and its adapter; matches H4 W3+W4 precedent). Ports: `TaskProviderPort`, `CalendarProviderPort`, `ScheduleRepositoryPort`(`writeChanged(delta)`, S5), `WeatherProviderPort`, `ClockPort`. Adapters: `SchedulerTaskProvider` (cuts task.controller coupling; reproduces rowToTask/taskToRow/buildSourceMap exactly), `SchedulerCalendarProvider` (over calendar facade), `KnexScheduleRepository` (**fixes 19 `db.fn.now()`→`new Date()`**; uses **lib-db** not src/db.js; encapsulates 42 DB touchpoints; **implements delta `writeChanged` — the write-all→write-changed behavioral change, flips S5/C-IDEM RED→GREEN**), `InMemoryScheduleRepository`, `MysqlClockAdapter`. | refactor+behavioral-change | juggler | W1, DESIGN §2.2, count edge-case list (19 fn.now sites, db.js sites), S5 user ruling | W1 | 5 ports defined (domain depends only on ports); all adapters implement their port; `grep -n 'fn.now' KnexScheduleRepository` = 0; uses lib-db; **all 19 P1 sites verified fixed (elmo code-read)**; SchedulerTaskProvider reproduces rowToTask/taskToRow/buildSourceMap (signature+semantics); P1 adapter unit asserts JS Date type; **delta-write lands: S5 (write count=changed) + C-IDEM (run-2=0) now GREEN**; ⚠️ **sync-correctness verified under delta-write — no stale-DB regression** (the "NEW DESIGN" rationale); OUTPUT golden-master still GREEN | ernie (lead), **elmo (CO-LEAD — data integrity: 19 P1 fixes + coupling cut + delta-write sync-safety)**, cookie, telly | 2 |
| W3 | **Application** — `RunScheduleCommand`: pulls via ports, runs pure core in-memory, writes ONLY changed tasks via `ScheduleRepositoryPort.writeChanged(delta)` (S5), **never imports scheduleQueue** (S4/S6), no cascade, keeps deadlock-retry (MAX_RETRIES=3) + sync-lock claim in orchestrator. | refactor | juggler | W2, behavior_contract S4/S5/S6 | W2 | `RunScheduleCommand` orchestrates pure core; delta-write count = changed tasks; no `scheduleQueue` import (static assert green); no recursion; deadlock-retry + sync-lock preserved unmutated; golden-master GREEN | ernie (lead), elmo (concurrency/locking), telly | 3 |
| W4 | **Facade + migration** — `slices/scheduler/facade.js`; migrate `unifiedScheduleV2.js`/`runSchedule.js`/`schedule.routes.js` entry to the facade (thin shim or redirect); per-slice eslint boundary rule; final exit-gate verification. | refactor | juggler | W3, DESIGN §7, eslint slice-rule pattern (H4/H5) | W3 | Entry points route through facade; no old imports remain; per-slice eslint rule active; **golden-master GREEN after full extraction, snapshot bit-for-bit IDENTICAL (zoe adversarial verify, not just "test passes")**; no scheduling-time regression; exit greps pass | cookie (lead), ernie, telly, zoe | 4 |

## Dependency Graph
W1←W0 · W2←W1 · W3←W2 · W4←W3 (strict serial extraction chain — irreducible per Step 3.6;
the golden-master gate requires the suite green before the chain starts and after it ends).

## Dependency Determination Log
| Dep | Type | Source |
|-----|------|--------|
| W1←W0 | build-order | DESIGN §3 extraction gate — suite must be green on current code before any restructure (S8) |
| W2←W1 | data | ports+adapters are defined against the domain core's needs |
| W3←W2 | data | RunScheduleCommand wires the W2 adapters |
| W4←W3 | build-order | facade fronts the completed application layer; final golden-master gate |
| W2 = ports+adapters (was W2+W3) | derived | Snuffy OVER_SCOPED: no design space between a port and its immediate adapter; H4 precedent committed W3+W4 ports+adapters together (6e9e521). Collapsed to cut one review gate; review depth unchanged (elmo co-lead added) |
| Chain not parallelized | derived | Step 3.6 — each wave consumes the prior's output; serial by nature. Within W1 (3 solvers) + W2 (5 adapters) sub-units share one test/review surface → batched into one item each (Step 3.2 batching test), not split into same-wave parallel items |

## Waves
Wave 0: W0 (characterization golden-master — BLOCKING entry gate, green on current code)
Wave 1: W1 (pure domain core)
Wave 2: W2 (ports & adapters — P1 fix + coupling cut; elmo co-lead)
Wave 3: W3 (application — RunScheduleCommand)
Wave 4: W4 (facade + migration + final golden-master gate)

## Risk register (count brief)
- **S8 BLOCKING**: no golden-master exists → W0 is mandatory entry work, not optional.
- **19 P1 violations** in runSchedule.js (lines 404,789,804,912-913,1241,1281,1375,1399,1428,1453,1476,1486,1532,1539) → fixed in W3 KnexScheduleRepository, none carried to core/command.
- **task.controller coupling** (runSchedule.js:92-95) → cut in W3 SchedulerTaskProvider.
- **42 DB touchpoints** → all encapsulated in KnexScheduleRepository (W3).
- **Cascade corruption**: scheduler bugs corrupt all task data → golden-master bit-for-bit gate every wave.

## Determination Log (decisions)
- Mode = refactor (behavior-identical extraction). Classifier: full/deep, risky=true (concurrency). count recommended_routing == classifier (evidence-cited).
- Leg granularity = single leg / wave commits (user, 2026-06-12).
- Stubs → H7 (user). Trigger seam → verify-wired only, S4 proof (user; seam existence verified by Kermit, evidence-first Step 3.0).
- Roadmap H2–H5 COMPLETE doc-update folded into W0 (housekeeping; entry-gate doc was stale — count ambiguity #1 resolved: fold into leg, not separate chore).
- **Snuffy verdict (2026-06-12): UNDER_SCOPED, Classifier AGREE (full/deep).** Applied: (1) collapsed W2+W3 → single Ports&Adapters wave (OVER_SCOPED on the split; H4 precedent); (2) elmo CO-LEAD on W2 (near-binding under-scope flag on data-integrity surface — 19 P1 fixes + coupling cut); (3) W0/W1 integrated multi-solver fixture criterion; (4) W4 zoe bit-for-bit identity verify. All accepted (no overrule). Lane=full, depth=deep confirmed.
