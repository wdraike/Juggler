# Cookie Architecture Review — H6 scheduler (W1 domain core + W2 ports/adapters) — refactor — 2026-06-12

## Status: DONE

---

# ═══ W4 (FINAL) — scheduler slice facade + caller migration (2026-06-12) ═══

**Scope (4 files):** `slices/scheduler/facade.js` (new), `slices/scheduler/index.js` (new),
`mcp/tools/schedule.js` (M), `routes/schedule.routes.js` (M). Mode: refactor, depth standard,
--re-review. The W1/W2/W2-1 boundaries (domain core + ports/adapters) passed previously and are
retained below. This wave fronts the slice with the single public facade and migrates the 3
caller sites to it.

## W4 Status: DONE — 0 BLOCK · 0 WARN · 2 INFO (both H7 carry-forward, expected)

The W4 facade is the single sanctioned public entry, mirrors the task/weather facade+index
idiom exactly, exposes the three public scheduler operations + the slice layers, and the 3
caller sites now import from the facade with **zero** reach into `src/scheduler/*` for any
scheduler-core operation. Boundary direction is inward-only; the S4/S6 trigger seam
(`enqueueScheduleRun`) is correctly left OUTSIDE the facade. No new boundary violation. The
scheduler slice is now **structurally complete** as a hex slice (domain/ports/adapters/
application/facade/index) consistent with task + user-config. The only carry items are H7's
(legacy-file thinning, the all-6-slices boundary-lint rule, the 3 inline writes) — all
explicitly H7-scoped per ROADMAP:305-312, none introduced or relitigated by W4.

## W4 Findings

| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| W4-1 | **INFO** | facade.js:42-45, 51-52 (fronts legacy runSchedule.js + unifiedScheduleV2.js) | **H7 carry (expected, not a defect).** The facade re-exports the still-present legacy `src/scheduler/runSchedule.js` (110 KB) + `src/scheduler/unifiedScheduleV2.js` (84 KB) verbatim. Thinning/deleting those files is H7 boundary-hardening, not H6 — ROADMAP:305-312 ("Phase H7 — Cleanup & boundary hardening") owns `src/db.js` deletion + "boundary lint enforces **all 6 slices**". The facade-fronting-legacy idiom is the same staging the task slice used. Tracked for H7. | REFER→H7: thin/delete the legacy scheduler files once the facade is the sole entry and the boundary-lint rule lands. |
| W4-2 | **INFO** | runSchedule.js:886,911,1779,1781,2330,2332 (6 inline knex writes = 3 logical surfaces); eslint.boundaries.config.js (no scheduler block) | **H7 carry (expected).** (a) 6 inline knex `.update/.insert` sites remain in runSchedule.js — the `task_instances` drift/unschedule writes + the `schedule_cache` upsert (2 paths). **These are already P1-clean**: they use `_runScheduleCommand.clockNow()` / `persistDelta`, NOT `db.fn.now()` (the W3 cutover removed all live `db.fn.now()` — only 2 *comment* references remain). So the P1 veto is satisfied; the residual is the *logical* "3 inline writes" deferred to H7 thinning. (b) No `slices/scheduler/**` block in `eslint.boundaries.config.js` yet (the config was last touched by the H5 commit cc61029, NOT W4 — scope-clean). The per-slice boundary rule is H7's exit gate ("boundary lint enforces all 6 slices", ROADMAP:312). | REFER→H7: route the 3 inline writes through `RunScheduleCommand`/`writeChanged` + add the `slices/scheduler/{facade,index,adapters,application,domain}` boundaries block. |

## W4 facade-boundary proof (own evidence)

**1. Facade is the single public entry + mirrors the sibling idiom.**
- `facade.js` exposes the 3 public scheduler-core operations the callers use:
  `runScheduleAndPersist`, `getSchedulePlacements` (both `runSchedule.*`), `unifiedScheduleV2`
  — plus the `RunScheduleCommand` application seam, the pure domain core, the 5 ports, and the
  6 adapters as named exports. This is the **same export surface shape** as
  `slices/task/facade.js` (public ops + mappers/validation + ports + adapters) and
  `slices/weather/facade.js`.
- `index.js` is a flat `module.exports = Object.assign({ scheduler: facade }, facade);` —
  **byte-pattern-identical** to `slices/task/index.js:21` and `slices/weather/index.js`
  (verified side-by-side). Both the namespaced (`{ scheduler }`) and direct-named shapes work
  (runtime-proven: `idx.scheduler` is object, `idx.getSchedulePlacements` is function).
- **Runtime fidelity (the refactor invariant):** `node -e` proved the facade re-exports are the
  *same function objects* as the legacy entry points —
  `facade.runScheduleAndPersist === require('scheduler/runSchedule').runScheduleAndPersist` →
  **true**; same for `getSchedulePlacements`; `facade.unifiedScheduleV2 === require('scheduler/unifiedScheduleV2')`
  → **true**. The facade changes the IMPORT PATH only, never behavior — consistent with the
  golden-master-pinned, behavior-preserving extraction.

**2. Caller migration complete — no external reach into scheduler-core internals.**
- `mcp/tools/schedule.js:7` → `require('../../slices/scheduler/facade')` for
  `runScheduleAndPersist` + `getSchedulePlacements`. ✓
- `routes/schedule.routes.js:10` → `require('../slices/scheduler/facade')` (run + placements);
  `:79` → `require('../slices/scheduler/facade').unifiedScheduleV2` (admin /debug). ✓ (2 sites.)
- **Grep proof:** `grep 'runScheduleAndPersist|getSchedulePlacements|unifiedScheduleV2' …require`
  across `src/` (excluding `src/slices/scheduler/`) shows **every** external import of the three
  public ops now resolves to `slices/scheduler/facade` — the only other hits are intra-`src/scheduler/*`
  internal wiring (unifiedScheduleV2↔runSchedule↔scheduleQueue↔schedulerSession), which is the
  slice's own internals, not an external reach-in. Zero external caller imports
  `runScheduleAndPersist`/`getSchedulePlacements`/`unifiedScheduleV2` from `src/scheduler/*`.

**3. /nudge trigger seam correctly OUTSIDE the facade (S4 — confirmed correct).**
- `routes/schedule.routes.js:13` keeps `require('../scheduler/scheduleQueue').enqueueScheduleRun`
  direct for `POST /nudge` (:65). This is the **mutation→schedule trigger seam**, not a
  scheduler-core operation — DESIGN:225-228/242/244 (S4 "triggered by user/MCP mutation only —
  never self-triggers"; the trigger enters via the driving adapter, NOT the core). Routing it
  through the facade would pull `scheduleQueue` into the public scheduler surface and risk the
  S4/S6 closure. **Verified clean:** `facade.js` and `RunScheduleCommand.js` reference
  `scheduleQueue` only in *comments* documenting the invariant — neither imports it. The
  golden-master S4/S6 static require-closure assert (that `RunScheduleCommand` is not in the
  `scheduleQueue` closure) holds. Leaving /nudge outside the facade is **correct**.
- `schedulerSession` (routes:12) — the admin-stepper dry-run session driver — is likewise
  correctly NOT a facade op; it is admin-visualization infra that internally calls
  `unifiedScheduleV2`, not one of the 3 public scheduler-core operations.

**4. Boundary direction inward; no new violation.**
- Facade → `./domain`, `./application`, `./adapters`, `./domain/ports/*` (inward into the
  slice) + the two legacy entry modules it fronts (`../../scheduler/runSchedule`,
  `../../scheduler/unifiedScheduleV2`). No outward/back-edge into another slice's internals;
  no infra-SDK import in the facade (it wires, it does not touch knex/queues directly). Callers
  point at the facade (inward to the slice's public face), never past it.

## W4 scope-discipline confirmation (de-risk decision held)

| Out-of-scope item (H7) | Touched by W4? | Evidence |
|---|---|---|
| `eslint.boundaries.config.js` (scheduler block) | **NO** | Working tree shows no eslint change; last touched by H5 commit `cc61029`; grep `scheduler` in the config → empty. Scope-clean. |
| 3 inline writes in runSchedule.js | **NO** | The 6 inline `.update/.insert` sites are unchanged by W4 (working tree: only facade.js, index.js, schedule.js, schedule.routes.js). Already P1-clean (clockNow, not db.fn.now). H7 thins them. |
| Legacy `src/scheduler/*` thinning | **NO** | runSchedule.js + unifiedScheduleV2.js present & fronted, not modified. H7 deletes/thins. |

Working-tree `git status` = exactly the 4 in-scope files (facade.js ??, index.js ??,
schedule.js M, schedule.routes.js M). No scope creep into H7.

## H6 structural-completeness assessment

With W4 done, the scheduler slice is **structurally complete as a hex slice**, matching the
task + user-config precedent:

| Layer | Present? | Evidence |
|-------|----------|----------|
| `domain/` (entities, VOs, solvers, ports) | ✓ | W1 — ConstraintSolver/ScoreEngine/ConflictResolver + Schedule/ScheduledTask + TimeWindow/Priority/Deadline; 5 ports |
| `application/` (orchestrator) | ✓ | W3 — `RunScheduleCommand` (sole delta-write seam; never imports scheduleQueue) |
| `adapters/` (Knex/InMemory/Task/Cal/Weather/Clock) | ✓ | W2 — 6 adapters, all inward-on-port, cross-slice via facade |
| `facade.js` (single public entry) | ✓ | W4 — this wave |
| `index.js` (barrel) | ✓ | W4 — mirrors task/weather |

Hex invariants hold end-to-end: ports pure-inside (W2), adapters depend inward (W2),
cross-slice via facade (W2-1 fix), domain severed from legacy fs side-effect (W1),
S4/S6 trigger-outside-core (W4). **H6 extraction is structurally complete.**

## H7 carry list (what remains — NOT H6)

1. **Legacy-file thinning/deletion** — `src/scheduler/runSchedule.js` (110 KB) +
   `unifiedScheduleV2.js` (84 KB) are fronted by the facade but still hold the live logic;
   thin/retire once the facade is the proven sole entry. (W4-1)
2. **Per-slice eslint boundary rule** — add `slices/scheduler/{facade,index,adapters,
   application,domain}` block to `eslint.boundaries.config.js`; H7 exit gate is "boundary lint
   enforces **all 6 slices**" (ROADMAP:312). (W4-2)
3. **3 inline writes** — route the `task_instances` drift/unschedule + `schedule_cache` upsert
   (runSchedule.js:886,911,1779/1781,2330/2332) through `RunScheduleCommand`/`writeChanged`.
   Already P1-clean (clockNow, not db.fn.now); this is logic-consolidation, not a P1 fix. (W4-2)
4. **`src/db.js` deletion** — H7 exit gate `grep …require…db → 0` + `src/db.js` deleted
   (ROADMAP:312). Note `mcp/tools/schedule.js:9` and the routes still `require('../../db')` /
   `require('../db')` for the timezone/config reads — those are H7's db.js-retirement targets,
   NOT W4 scope (W4 migrated only the scheduler-core ops).

## W4 Re-Review Delta
| Finding | Prior | W4 | Evidence |
|---------|-------|-----|----------|
| W2-2 (scheduler eslint rule absent) | PERSISTS (expected, W4→H7) | **RE-SCOPED to H7** | The roadmap places the all-6-slices boundary lint at H7 (ROADMAP:312), not W4. W4 builds the facade; the lint rule that *guards* it is H7. Carry → W4-2. |
| W2-3/W2-5 (half-wired writeChanged + 19 db.fn.now) | INFO (W3) | **RESOLVED at W3** | W3 cutover done: runSchedule.js delegates to `RunScheduleCommand.persistDelta`; **0 live** db.fn.now (2 comment refs only). Residual = logic-consolidation of 3 inline writes → H7 (W4-2). |
| W4-1 (facade fronts legacy files) | — | **NEW INFO (H7 carry)** | facade.js:42-45 fronts runSchedule/unifiedScheduleV2; thinning = H7. |
| W4-2 (3 inline writes + eslint rule) | — | **NEW INFO (H7 carry)** | Both H7-scoped per ROADMAP:305-312; scope-clean in W4. |

**W4 counts:** 0 BLOCK · 0 WARN · 2 INFO (both H7 carry, expected). Zero unresolved BLOCK →
**W4 Status DONE.**

## W4 Scooter Consult (refactor — cookie owns)
**Question** (`--domain scheduler`): is (a) the facade-fronting-still-present-legacy-files
pattern, (b) deferral of legacy-file thinning + per-slice eslint rule + the inline
schedule_cache/task_instances writes to H7, and (c) leaving the /nudge `enqueueScheduleRun`
trigger seam OUTSIDE the facade — all blessed by binding DESIGN/WBS/ROADMAP decisions, and does
W4 relitigate any veto?

**Scooter's answer (federated: DESIGN §3/§6.1/§7 + S4/S6 table, ROADMAP H6/H7, WBS §4.x,
scheduler-rules; brain healthy — no HEALTH-ALERT, vector probe OK):**
- **(a) facade-fronting-legacy = BLESSED, behavior-preserving staging.** DESIGN:100/259
  ("External code imports `<slice>/facade` only") + DESIGN:116 ("facade.js — the ONLY public
  entry point"). The extraction gate (DESIGN §3, ROADMAP:299) requires golden-master bit-for-bit
  before+after — an import-path-only facade satisfies it. Same idiom as the task slice. No veto.
- **(b) thinning + eslint + inline-writes → H7 = BINDING.** ROADMAP:305-312 defines "Phase H7 —
  Cleanup & boundary hardening" with exit gate `src/db.js` deleted + "boundary lint enforces
  **all 6 slices**". The per-slice eslint rule and the db.js retirement are explicitly H7, not
  H6. WBS:302-303 places `eslint.boundaries.config.js` enforcement as its own item. Deferral is
  the documented plan, not a gap.
- **(c) /nudge trigger OUTSIDE the facade = BINDING + correct.** DESIGN:225-228/242 (S4 "triggered
  by user/MCP mutation only — never self-triggers"; trigger enters via the driving adapter) +
  S6:244 ("no cascading scheduler calls"). The facade fronting the core must NOT pull
  `scheduleQueue` in; ADR-0001 (DESIGN:323) makes the mutation→schedule trigger its own seam
  (lib-events / scheduleQueue), deliberately separate from the scheduler-core facade. Leaving
  /nudge's direct `enqueueScheduleRun` outside is the mandated boundary.
- **scheduler-rules:** active decisions = the 2026-05-12 `new Date()`-over-`db.fn.now()` (= P1) +
  circular-JSON root cause. **No vetoes, no failed approaches.** W4 relitigates none — it is
  import-path-only; the `db.fn.now()` removal already landed in W3, *reinforcing* the decision
  (0 live db.fn.now in the live path). 

**Binding prior decision/veto relitigated:** **None.** Confidence: documented (DESIGN/ROADMAP/WBS
authoritative; scheduler-rules confirms no veto on the facade/trigger boundary). **Gap to INBOX:**
none required.

## W4 Coverage Map
| Dimension | Status | Evidence |
|-----------|--------|----------|
| Algorithmic Efficiency | covered | No algorithmic change — facade re-exports same fn objects (`===` proven); pure import-path move. |
| Modularity | covered | Slice now has facade+index+domain+application+adapters; single public entry; mirrors task/weather. |
| Separation of Concerns | covered | Public ops vs trigger seam (scheduleQueue) cleanly split; /nudge + schedulerSession stay outside the core facade. |
| Scalability | covered | No new instance-local state, no pool/connection change; routes keep per-user sync-lock + rate-limit (unchanged). |
| Data Architecture | partial | No migration in scope. 3 inline writes (task_instances/schedule_cache) remain in runSchedule.js — P1-clean, consolidation → H7. |
| Resilience | covered | MCP path keeps withLock+retry/backoff; routes keep withSyncLock+rate-limit; facade adds no unbounded call. No inter-service call introduced. |
| Extensibility | covered | Facade surface lets future in-slice wiring + tests import ports/adapters by name; H7 boundary-lint will guard it. |
| Infrastructure | covered | No Terraform/Dockerfile/deploy-yaml/IAM in scope; no Cloud Run config touched. eslint config untouched (H7). |
| Redundancy | covered | No failover/replication surface in scope; facade is a thin re-export, introduces no duplicated logic (re-exports, not re-implements). |

---

---

# ═══ W2-1 RE-REVIEW — facade boundary fix (2026-06-12) ═══

**Trigger:** bert fix of W2-1 WARN. **Scope:** `SchedulerWeatherProvider.js` (one-line edit, line 31). Mode: refactor, depth standard, --re-review.

## Re-Review Delta
| Prior finding | Status | Evidence |
|---|---|---|
| **W2-1** (WARN — weather-via-controller hop) | **RESOLVED / CLOSED** | Line 31 now `require('../../weather/facade').roundCoord` (was `require('../../../controllers/weather.controller').roundCoord`). Cross-slice edge is now scheduler→weather **via the facade** (allowed), no longer a hop through the HTTP controller layer. |
| W2-2 (eslint scheduler block absent) | PERSISTS — expected (W4) | Out of this re-review's scope; unchanged, still tracked for W4. |
| W2-3, W2-4, W2-5 (INFO) | PERSISTS — carry-forward | Out of scope (W3 / code-logic refers); unchanged. |

**Counts after fix:** 0 BLOCK · 1 WARN (W2-2, expected/W4) · 3 INFO. (W2-1 WARN cleared.)

## W2-1 closure proof
1. **Facade genuinely exports `roundCoord`.** `slices/weather/facade.js:72` `var roundCoord = GeoPoint.gridValue;` → exported at `facade.js:218` `roundCoord: roundCoord`. Confirmed present.
2. **Function reference identical — behavior unchanged.** Runtime-proven via `node -e`:
   - `facade.roundCoord === GeoPoint.gridValue` → `true`
   - `controller.roundCoord === facade.roundCoord` → `true` (the old controller path `weather.controller.js:144` was itself `exports.roundCoord = weather.roundCoord`, a re-export of the same facade fn). The fix removes a redundant hop to the **same terminal function object** — zero behavior delta.
   - Edge cases preserved: `roundCoord(1.23) === 1.2`; neg-zero `Object.is(roundCoord(-0.05), -0) === true`.
3. **Cross-slice dependency via facade (allowed), not into internals/controller.** New target is `slices/weather/facade` — the canonical slice entry point — not `controllers/weather.controller` (HTTP layer) nor any weather-internal module. Matches the established pattern: SchedulerTaskProvider→`task/facade`, SchedulerCalendarProvider→`calendar/facade`.

## No remaining non-facade cross-slice edge (full scheduler-adapters scan)
`grep 'require(' adapters/*.js | grep '\.\./\.\.'` — every cross-**slice** edge now routes through `facade.js`:
| File:Line | Target | Verdict |
|---|---|---|
| SchedulerWeatherProvider.js:31 | `../../weather/facade` | ✅ via facade (the fix) |
| SchedulerCalendarProvider.js:34 | `../../calendar/facade` | ✅ via facade |
| SchedulerTaskProvider.js:40 | `../../task/facade` | ✅ via facade |
| SchedulerWeatherProvider.js:36 · KnexScheduleRepository.js:39,59 · MysqlClockAdapter.js:32 | `../../../lib/db`, `../../../lib/tasks-write` | ✅ shared-infra from the adapter ring (ADR-0002) — not a slice reach-in |

No remaining controller-layer hop and no slice-internal reach-in. **W2-1 CLOSED.**

## Scooter Consult (re-review)
The binding rule (DESIGN §6.1 "facade-only" cross-slice, lines 100/259-262) was consulted and cited in the original W2-1 finding; this fix conforms to that already-settled rule rather than introducing a new structural question. No relitigation — prior W2 Scooter consult (`scooter_consult: done`) stands.

---

# ═══ W2 — Ports + Adapters boundary review (2026-06-12) ═══

**Scope:** `juggler-backend/src/slices/scheduler/domain/ports/` (5 ports + barrel) and
`juggler-backend/src/slices/scheduler/adapters/` (6 adapters + barrel). This is the
adapter/port boundary check; the W1 boundary + Scooter consult passed previously (W1 section
below, retained). Mode: refactor, depth deep, re-review.

## W2 Status: DONE — 0 BLOCK · 2 WARN · 4 INFO

The W2 port/adapter seam is architecturally sound and matches the `slices/task` precedent. The
hexagonal direction holds (ports pure-inside, adapters depend inward, zero port→adapter edge);
the two genuine cross-slice dependencies (task, calendar) route through FACADES as the DESIGN
mandates; the DB adapter uses `lib/db` (ADR-0002), not `src/db.js`. The two WARNs are (1) the
weather adapter sourcing `roundCoord` through `controllers/weather.controller` instead of the
canonical `slices/weather/facade` (a house-style deviation, not a back-edge — the controller is
a by-reference re-export), and (2) the expected-but-noteworthy **half-wired state**: the W2
`KnexScheduleRepository.writeChanged` exists and duplicates the persist surface that **still
runs inline in `runSchedule.js`** (with the legacy `db.fn.now()` on 19 sites). That wiring +
inline-removal is a **W3** task per the WBS — correct sequencing, flagged so W3 closes it.

## W2 Findings

| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| W2-1 | **WARN** | adapters/SchedulerWeatherProvider.js:30 | `roundCoord` is sourced via `require('../../../controllers/weather.controller').roundCoord` — a hop through the **HTTP controller layer**, not the slice facade. Every other cross-slice adapter routes slice→slice via `facade.js` (SchedulerTaskProvider → `../../task/facade`; SchedulerCalendarProvider → `../../calendar/facade`). The canonical path exists: `slices/weather/facade.js:218` exposes `roundCoord` directly (by-reference, bit-identical — the controller merely re-exports it from the same facade). It RESOLVES to the same function (no behavior risk; H6 output pinned by golden-master) and the **legacy scheduler used this exact controller path**, so it is behavior-preserving and not a *new* coupling — but it deviates from the binding "facade-only" boundary rule (DESIGN §6.1 line 100/259-262) when a clean facade path is available, and the absence of a scheduler eslint boundary rule (W2-2) means nothing yet catches it. | Repoint to `require('../../weather/facade').roundCoord`. Low-risk one-line change; can land in W2 or be folded into the W4 eslint-boundary wave. Track. |
| W2-2 | **WARN** | eslint.boundaries.config.js (scheduler slice absent) | No per-slice eslint boundary rule for `slices/scheduler/**` yet (calendar:89-103, weather:109-140, task:146+ are covered; scheduler is not). **Expected** — the WBS/ROADMAP (line 297) schedules the scheduler facade + per-slice eslint rule for **W4**. Absence now is correct, NOT a defect; confirmed tracked. Its absence is *why* W2-1 isn't auto-caught. | Confirm the W4 item adds a `slices/scheduler/{facade,index,adapters,application,domain,test}` boundaries block mirroring the task/calendar/weather pattern. Track, do not fix in W2. |
| W2-3 | **INFO** | runSchedule.js:~1700-1762 (inline persist) AND adapters/KnexScheduleRepository.js:92-198 (writeChanged) | **Half-wired state (W2/W3 boundary — sound, not awkward).** The W2 `KnexScheduleRepository.writeChanged` reproduces the persist surface (batched CASE update + per-row otherUpdates + delete + rolling-anchor backfill), but `runSchedule.js` STILL persists inline through that same logic and STILL uses `db.fn.now()` (19 sites: 502, 887, 1339, 1392, 1498, 1551, 1576, 1599, 1609, 1655, 1662, 1678, 1720…). So there are presently TWO copies of the write surface and the **live path is the legacy inline one** (with the P1-violating `db.fn.now()`). This is EXPECTED per WBS §4.8 (RunScheduleCommand, line 220-221) + ROADMAP line 295 — W3's `RunScheduleCommand` pulls via ports, runs the core, calls `writeChanged(delta)`, and the inline persist + its `db.fn.now()` are deleted then. The W2 adapter is correctly built ahead of its caller; this is staged sequencing, not an architectural defect. **W3 must:** (1) route the live persist through `KnexScheduleRepository.writeChanged`, (2) delete the inline persist block from runSchedule.js, (3) eliminate the 19 `db.fn.now()` sites (ADR-0003/P1). Until W3, the P1 violation + duplicated logic LIVE in runSchedule.js — flagged for W3, not a W2 blocker. | REFER→W3 (RunScheduleCommand leg): wire writeChanged + remove inline persist + the 19 db.fn.now() sites. Until then, the delta-write S5 skip logic that IS live (runSchedule.js:304-391) is correct. |
| W2-4 | **INFO** | adapters/KnexScheduleRepository.js (whole), SchedulerWeatherProvider.js:34-75, SchedulerTaskProvider.js:53-60 | Byte-identical fidelity of the moved SQL/persist logic (the CASE-update construction, the `loadWeatherForHorizon` fail-open ladder, the `tasks_v` working-set predicate) to the legacy originals is a code-logic correctness concern, not a boundary one — and is the spine of this behavior-preserving extraction. The P1 `_assertDates` guard (KnexScheduleRepository.js:68-79) is sound defensive logic but its correctness/coverage is ernie/telly's. | REFER→ernie: verify the moved persist/load logic (CASE construction, fail-open branches, working-set predicate) is byte-identical to the legacy. REFER→telly: confirm the InMemory↔Knex contract suite asserts both implementations conform to SCHEDULE_REPOSITORY_PORT_METHODS, and the golden-master is still GREEN. |
| W2-5 | **INFO** | runSchedule.js:1339,1392,1498,… (19 sites) | The 19 live `db.fn.now()` sites in runSchedule.js are an ADR-0003/P1 data-integrity concern (the circular-JSON-serialization break the veto addressed). They are *intended* to be removed in W3 (the repository does it correctly), so this is not a new regression — but the live write path currently violates the P1 invariant the repository was built to fix. | REFER→elmo/ernie at W3: confirm the W3 cutover removes all 19 and the live path no longer emits a Knex raw builder on the write path. Not a W2-scope finding (the W2 adapter is correct). |

## W2 Hexagonal direction proof (own evidence)

- **Ports are pure-inside, zero outward dependency.** All 5 ports (ScheduleRepositoryPort,
  TaskProviderPort, CalendarProviderPort, WeatherProviderPort, ClockPort) are JSDoc `@typedef`
  contracts + a throw-not-implemented base + a frozen `*_PORT_METHODS` array. **Zero**
  `require()` of any infra SDK, any adapter, or any sibling — the only `require` in the ports
  ring is the barrel re-exporting the 5 port modules. No adapter logic leaked into a port; no
  port imports an adapter (grep confirmed: ports/ has zero adapter import). Direction holds.
- **Adapters depend INWARD on their port.** Each of the 6 adapters opens with
  `require('../domain/ports/<Port>').<PORT>_METHODS` — the adapter points at the port (inward),
  never the reverse. The barrel (`adapters/index.js`) only re-exports the 6 adapter modules.
- **Cross-slice deps route through FACADES (the binding rule — DESIGN §6.1, ROADMAP 294):**
  - SchedulerTaskProvider → `require('../../task/facade')` — slice→slice via facade ✓ (cuts
    the legacy `runSchedule.js:92-95` direct `controllers/task.controller` coupling; facade
    re-exports the byte-identical W2 domain mappers `rowToTask`/`taskToRow`/`buildSourceMap`,
    confirmed at task/facade.js:1005-1007).
  - SchedulerCalendarProvider → `require('../../calendar/facade')` (lazy) — slice→slice via
    facade ✓.
  - SchedulerWeatherProvider → `require('../../../controllers/weather.controller')` — via the
    **controller** not the facade (W2-1 WARN; functionally a by-reference re-export of
    weather/facade.js:218, so resolves to the same fn, but not the canonical path).
  - **No adapter reaches into another slice's internals** (no `slices/<x>/domain` or
    `slices/<x>/adapters` import from the scheduler adapters ring) — only facades + the
    controller hop above. Back-edge scan: zero `require` of legacy `src/scheduler/*` from the
    adapters/ports tree.
- **DB connection seam (ADR-0002):** KnexScheduleRepository.js:59 and the weather/clock
  adapters obtain knex via `require('../../../lib/db').getDefaultDb()` (resolved:
  `src/lib/db/index.js:50` defines `getDefaultDb()`), never `src/db.js` — identical to the
  KnexTaskRepository precedent (KnexTaskRepository.js:78). Writes delegate to `lib/tasks-write`
  (the real master/instance write module), not reinvented routing. ✓
- **No raw infra-SDK leak into domain:** the only knex/SQL touch is inside the adapters ring
  (KnexScheduleRepository, SchedulerTaskProvider's `tasks_v` read, SchedulerWeatherProvider's
  `weather_cache` read, MysqlClockAdapter's `SELECT NOW(3)`) — all legitimate adapter homes.
  Zero DB/SDK import in `domain/ports/`. Matches Step-5 hexagonal rule.

## W2 Precedent-conformance (matches slices/task)

| Convention | task slice (precedent) | scheduler slice (this leg) | Verdict |
|------------|------------------------|----------------------------|---------|
| ports in `domain/ports/` | TaskRepositoryPort, TaskCachePort, TaskEventPort | ScheduleRepositoryPort, TaskProviderPort, CalendarProviderPort, WeatherProviderPort, ClockPort | ✓ same location |
| throw-not-implemented base + `*_PORT_METHODS` frozen array | yes (TaskRepositoryPort) | yes (all 5) | ✓ same contract shape |
| Knex + InMemory pair for the repo | KnexTaskRepository + InMemoryTaskRepository | KnexScheduleRepository + InMemoryScheduleRepository | ✓ same double pattern |
| adapter → `lib/db`.getDefaultDb (not src/db.js) | KnexTaskRepository.js:78 | KnexScheduleRepository.js:59 | ✓ ADR-0002 |
| barrel `index.js` re-export | (slice barrels) | ports/index.js + adapters/index.js | ✓ |
| cross-slice via facade | (n/a for task) | task & calendar via facade; weather via controller | ⚠ weather deviates (W2-1) |

## W2 Re-Review Delta
| Finding | Prior (W1) | W2 | Evidence |
|---------|-----------|-----|----------|
| W1 fs-leak BLOCK | RESOLVED | n/a (W1) | Unchanged — W1 closed. |
| W2-1 weather-via-controller | — | **NEW WARN** | SchedulerWeatherProvider.js:30 controller hop vs weather/facade:218. |
| W2-2 scheduler eslint rule | (W1 #2 WARN, W4) | **PERSISTS (expected)** | Still W4 per ROADMAP:297. |
| W2-3 half-wired writeChanged | — | **NEW INFO** | writeChanged built; inline persist still live → W3 (WBS §4.8). |
| W2-4 / W2-5 moved-logic + db.fn.now | (W1 #3 ernie-refer) | **NEW INFO** | Logic fidelity → ernie; 19 live db.fn.now → W3 P1 cutover. |

**W2 counts:** 0 BLOCK · 2 WARN · 4 INFO. Zero unresolved BLOCK → **W2 Status DONE.**

## W2 Scooter Consult (refactor — cookie owns)
**Question** (`--domain scheduler`): binding decisions/vetoes on (a) slice→slice-via-facade
rule for cross-slice adapter deps, (b) weather adapter via `controllers/weather.controller` vs
`slices/weather/facade`, (c) the half-wired writeChanged/inline-persist-with-db.fn.now() state,
(d) the lib/db ADR-0002 connection seam.

**Scooter's answer (federated: DESIGN §6.1/§7, ROADMAP H6, WBS §4.8, scheduler-rules; brain
healthy — no HEALTH-ALERT):**
- **(a) slice→slice via facade = BINDING.** DESIGN §6.1 line 100/259-262 ("External code imports
  `require('./slices/<domain>/facade')` only … never another slice's internals") + ROADMAP line
  294 names the adapters as "over Task facade"/"over Calendar facade". No veto. The task &
  calendar adapters conform.
- **(b) weather-via-controller = standards deviation, NOT a veto.** DESIGN line 124/127 lists
  weather as a real slice with `slices/weather/facade.js`, which exposes `roundCoord`
  (facade.js:218). The canonical path is the facade; the controller hop is a by-reference
  re-export (behavior-identical) and is the *legacy* path, so it is behavior-preserving — but
  the binding boundary rule prefers the facade. → WARN (W2-1).
- **(c) half-wired state = EXPECTED, not a defect.** WBS §4.8 (RunScheduleCommand) + ROADMAP
  line 295 assign `writeChanged(delta)` wiring + S5 to **W3**. The W2 adapter built ahead of its
  caller is correct staging. The live inline `db.fn.now()` is the legacy path W3 deletes
  (ADR-0003/P1). → INFO (W2-3/W2-5), tracked for W3.
- **(d) lib/db ADR-0002 = BINDING + correctly applied.** ADR-0002 (DESIGN:336) routes every
  `Knex*Repository` through `lib-db`, retiring `src/db.js`; KnexScheduleRepository.js:59 conforms,
  matching the KnexTaskRepository precedent. ✓
- **scheduler-rules:** active decisions are the 2026-05-12 `new Date()`-over-`db.fn.now()`
  (= ADR-0003/P1) + circular-JSON root cause. **No veto, no failed approach** touches the
  port/adapter boundary, the facade rule, or the connection seam. W2 relitigates nothing.

**Binding prior decision/veto relitigated:** None. The `new Date()`-over-`db.fn.now()` veto
is *reinforced* by the W2 repository (it does it correctly); the live inline violation in
runSchedule.js is a W3-scoped cutover item, surfaced here, not a relitigation.

**Confidence:** documented (DESIGN/ROADMAP/WBS authoritative; KG decision coverage thin but
the governing standards are in the authoritative docs — absence of a contradicting KG node is
not proof, but no doc contradiction surfaced). **Gap to INBOX:** none required.

---

### W1 review (retained below — domain core, already DONE)

## Status: DONE

**RE-REVIEW (2026-06-12):** the single BLOCK (H6 W1 — transitive `fs.readFileSync` on
domain load) is **CLOSED**. bert extracted `PRI_RANK` into a NEW pure leaf
`src/slices/scheduler/domain/constants.js` (a frozen literal `{P1:100,P2:80,P3:50,P4:20}`
with **zero** `require()`), rewired `Priority.js`/`ScoreEngine.js` to import the leaf, and
made legacy `src/scheduler/constants.js` **re-export the same frozen object** (verified
`===` same reference — single source, no duplication). `computeSchedulerHash` stays in the
legacy module but the domain no longer transitively reaches it.

**Independent verification (own evidence, not bert's word):**
- **fs proof — domain load:** requiring `slices/scheduler/domain/index.js` performs **14**
  app-level `fs.readFileSync` calls; **all 14** are the Node CJS loader reading the domain
  tree's own `.js` module files (enumerated by path: 11 domain files + index + reused
  task `PlacementMode` + `lib/placementModes`). `computeSchedulerHash`-target reads
  (`unifiedScheduleV2.js`/`runSchedule.js`/`reconcileOccurrences.js`/`expandRecurring.js`)
  = **0**. (The prior `node:internal`-only filter over-counts the CJS loader's own module
  reads as "app-level"; the discriminating count — scheduler-source/hash reads — is the one
  the W1 gate cares about, and it is **0**.)
- **Contrast — legacy load:** requiring `src/scheduler/constants.js` still shows **4**
  `computeSchedulerHash`-target reads. The fs side-effect now lives **only** in the legacy
  ring; the domain is severed from it.
- **Single-source:** `domainConst.PRI_RANK === schedulerConst.PRI_RANK` → **true** (same
  frozen object); values byte-identical `{P1:100,P2:80,P3:50,P4:20}`; exactly **one** literal
  definition in the codebase; `Priority.rank` returns `[100,80,50,20]`.
- **No new boundary violation / inward-only:** every `require()` in the whole domain tree is
  domain-local or the one allowed sibling `task/domain` → `PlacementMode` reuse; **zero**
  `require()` of legacy `src/scheduler/*` anywhere in the tree (back-edge severed). The
  `scheduler/constants.js → domain/constants` edge is the acceptable **legacy→domain
  (inward)** direction, not a back-edge. No circular dep (both load orders clean).

The W1 boundary now clears: direction was already sound; the purity (no-fs) gate is now
met in fact. The original WARN #2 (eslint slice rule, tracked for W4) and INFO #3/#4
(REFER→ernie / REFER→telly) are unchanged.

---

### Original review (superseded by the re-review above)

**Original Status: ISSUES.** One BLOCK: the "pure / zero-I/O" domain core transitively
triggered `fs.readFileSync` at module-load time via `scheduler/constants.js`. The boundary
*direction* was sound (delegation points inward, no circular dep, no infra SDK, matches the
task/user-config precedent), but the W1 exit-gate clause "no … fs" was violated in fact —
proven by a load-trace (18 `fs.readFileSync` calls on requiring the pure barrel). **Now
resolved — see re-review.**

## Re-Review Delta
| Finding | Prior | Now | Evidence |
|---------|-------|-----|----------|
| #1 fs-leak in pure domain core (BLOCK) | BLOCK / ISSUES | **RESOLVED** | Pure leaf `domain/constants.js` carries `PRI_RANK`; domain load = 0 computeSchedulerHash reads (was 18); legacy re-exports same `===` object. |
| #2 eslint scheduler slice rule (WARN) | WARN (tracked, W4) | **PERSISTS** (expected) | Still scheduled for W4 — correct, not a defect. |
| #3 moved-logic byte-identity (INFO REFER→ernie) | INFO | **PERSISTS** | Code-logic ownership unchanged. |
| #4 domain test coverage (INFO REFER→telly) | INFO | **PERSISTS** | Test-inventory ownership unchanged. |

**Counts:** RESOLVED 1 · PERSISTS 3 (1 expected-WARN + 2 INFO-refers) · NEW 0. Zero unresolved BLOCK → Status DONE.

## Scooter Consult
**Question asked** (`--domain scheduler`): "H6 W1 scheduler domain core extraction — pure
ConstraintSolver/ScoreEngine/ConflictResolver in slices/scheduler/domain. Any binding
decisions/vetoes on the domain boundary, the slice layout, or the
delegation-from-legacy-entry approach?"

**Scooter's answer (federated: MemPalace + scheduler-rules + WBS/DESIGN docs):**
- **Brain health:** `mempalace status` responded (128,431 drawers); no `~/.mempalace/HEALTH-ALERT`.
  The `decisions`/`architecture` rooms are session-transcript-mined (not curated KG decision
  nodes), so the decision read path is the authoritative docs (WBS/DESIGN) + `scheduler-rules`,
  per Scooter's own "decisions are read from the KG, not the polluted room" rule. **Confidence:
  partial** — KG decision coverage for H6 is thin; absence of a recorded contradiction is **not**
  proof of consistency.
- **scheduler-rules vetoes/failed-approaches:** **None recorded.** Active decisions are all from
  the 2026-05-12 task-creation/save-failure debugging session (`new Date()` over `db.fn.now()` for
  `created_at`; circular-JSON root cause) — **no veto touches the domain boundary, the slice
  layout, or the delegation-from-legacy-entry approach.** The `new Date()`-over-`db.fn.now()`
  decision is consistent with — and reinforced by — the W2 gate ("fixes 19 `db.fn.now()`→`new
  Date()`"), so W1 relitigates nothing.
- **Binding standards in play (authoritative docs):** DESIGN §3/§6/§7 + WBS W1 row govern. The W1
  exit gate is explicit: **"Pure core (no db/redis/fs/require-controller); domain unit tests green
  incl. integrated 3-solver pipeline scenario; golden-master still GREEN; S1/S2/S3/S7 logic
  resident in core."** The slice-layout precedent is `slices/task/domain` and
  `slices/user-config/domain` (entities / value-objects / logic / index.js barrel; PlacementMode
  reused not duplicated — S7). The delegation-from-legacy-entry approach (legacy file imports the
  slice, binds local names) is the **established H3/H4/H5 pattern**, not novel.

**Binding prior decision / veto the refactor relitigates:** None. No veto surfaced. **However**,
the W1 exit-gate "no fs" clause (a binding standard, not a veto) is contradicted by the as-built
constants coupling — recorded as BLOCK-1 below. This is a standards-conformance failure, not a
relitigation, so it is BLOCK on the gate, not a Contradiction-Guard challenge.

**Gap emitted to Scooter INBOX:** none required — the governing standard (W1 gate) is documented;
the finding is conformance, surfaced here for bert/the fix loop.

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | verified --mode refactor + --files (3 paths) | present |
| Scope detect | listed domain tree + 2 legacy entries | 11 domain files + 2 legacy = 13 |
| Context files | read juggler CLAUDE.md, WBS-juggler-hex-h6-scheduler.md, scheduler-rules | found |
| Scooter consult (refactor — cookie owns) | Skill scooter --ask … --domain scheduler | done — no veto; W1 gate binding |
| Infra review | n/a — no TF/Docker/deploy YAML in scope | 0 (out of scope) |
| Service boundaries | cross-service import scan (domain tree) | 0 cross-service imports |
| Hexagonal boundary | infra-SDK-in-domain grep + load-trace (Step 5) | original: 0 direct SDK, 1 BLOCK transitive fs (18 reads). **RE-REVIEW: BLOCK RESOLVED — 0 computeSchedulerHash scheduler-source reads on domain load (14 reads all CJS-loader module reads); pure leaf; same-ref PRI_RANK; no back-edge** |
| Re-review fs proof (own evidence) | load-trace domain vs legacy, path-enumerated + hash-target discriminator | domain: 0 hash-source reads · legacy: 4 — side-effect isolated to legacy ring |
| Re-review single-source | `domainConst.PRI_RANK === schedulerConst.PRI_RANK` + value/freeze check | `===` true (same frozen obj); `{P1:100,P2:80,P3:50,P4:20}`; 1 literal only |
| Re-review back-edge / direction | grep domain tree for `require` of legacy `src/scheduler/*`; circular-dep load probe | 0 back-edges; inward-only; no cycle (both load orders clean) |
| Data-flow topology | domain isolation; PlacementMode reuse | clean (domain→domain reuse only) |
| Design patterns | barrel/precedent comparison vs task + user-config | consistent |
| Scalability | n/a — pure in-process logic, no instance state added | covered (no new state) |
| Resilience | n/a — no inter-service call added | n/a |
| Migration safety | n/a — no schema migration in scope | n/a |
| API-contract versioning | n/a — no shared inter-service contract touched | n/a |
| Observability arch | n/a — no cross-service hop added | n/a |
| Dependency direction | delegation legacy→slice; circular-dep probe | inward; **no circular dep** |
| Deep research (--depth deep) | cross-service topology / migration build-order tracing | n/a (single-process refactor) |
| Flag-and-refer | out-of-column issues emitted | 2 INFO REFER (ernie, telly) |
| Output written | Write ARCH-REVIEW.md + cookie-REVIEW.json | Done |

## Proof Checklist
- [x] Required inputs present (--mode refactor + --files)
- [x] Scope confirmed — 13 files in list (11 domain + 2 legacy entries)
- [x] Mode-appropriate checks run (mode: refactor — confirmed boundaries, Scooter consult done)
- [x] Infra/GCP/Cloud Run config scan completed (no infra files in scope — noted)
- [x] Service boundary scan completed (zero cross-service imports in domain tree)
- [x] Hexagonal ports/adapters scan completed (Knex/CloudTasks/googleapis/Redis/model-provider — 0 direct; transitive fs BLOCK found via load-trace)
- [x] Data-flow topology + domain isolation scan completed (PlacementMode reused from task slice — domain→domain, allowed)
- [x] Design patterns consistency scan completed (barrel + layer layout matches task/user-config precedent)
- [x] Scalability/statelessness scan completed (no instance-local state introduced)
- [x] Resilience scan completed (no inter-service call introduced)
- [x] Migration & backward-compat safety scan completed (no migration in scope)
- [x] API-contract versioning scan completed (no shared contract touched)
- [x] Observability architecture scan completed (no cross-service hop added)
- [x] Dependency direction scan completed (inward delegation; no circular dep — node require-graph clean)
- [x] Deep-research enrichment: n/a for a single-process pure-logic refactor — noted
- [x] Grep matches triaged, not just counted (every require escape READ + reasoned; constants escape load-traced)
- [x] All findings carry file:line + severity (BLOCK/WARN/INFO)
- [x] Flag-and-refer lines emitted for out-of-column issues (code-logic→ernie, coverage→telly)
- [x] Prior knowledge consulted via Scooter (single front door) — no relitigation; no veto surfaced
- [x] Knowledge changes reported to Scooter — none changed this leg (no INBOX notice required)
- [x] Rubric Coverage Map emitted — every dimension marked
- [x] Output file written in Contract-4 format
- [x] Status line set: DONE (re-review — was ISSUES; sole BLOCK resolved)

## Findings
| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| 1 | **BLOCK — RESOLVED (re-review 2026-06-12)** | src/slices/scheduler/domain/value-objects/Priority.js:24 AND src/slices/scheduler/domain/logic/ScoreEngine.js:21 | ORIGINAL: the "pure / zero-I/O" domain core required `../../../../scheduler/constants`, which at module-load invoked `computeSchedulerHash()` → `fs.readFileSync` of scheduler source (18 reads on barrel load). **FIX VERIFIED:** PRI_RANK extracted to NEW pure leaf `src/slices/scheduler/domain/constants.js` (`Object.freeze({P1:100,P2:80,P3:50,P4:20})`, zero `require()`); Priority.js:24 + ScoreEngine.js:21 now `require('../constants')`. Re-run load-trace: **0** computeSchedulerHash scheduler-source reads on domain load (14 total reads, all CJS-loader module reads — path-enumerated). Legacy `scheduler/constants.js` re-exports the **same `===` frozen object** (single source; values byte-identical). Zero `require()` of legacy `src/scheduler/*` in the domain tree (no back-edge). | DONE — pure-leaf extraction (option a). Independently verified by the fs proof, the `===` reference check, and the back-edge scan. No further action. |
| 2 | WARN | eslint.boundaries.config.js (scheduler slice absent) | No per-slice eslint boundary rule for `slices/scheduler/**` yet (task + user-config are covered; scheduler is not). **Expected** — the WBS schedules the scheduler slice eslint rule for W4. Absence now is correct, NOT a defect; flagged only to confirm it is tracked and must land in W4. No fix required this wave. | Confirm the W4 item adds a `slices/scheduler/{facade,index,adapters,application,domain,test}` boundaries block mirroring the task/user-config pattern (eslint.boundaries.config.js:313-404). Track, do not fix in W1. |
| 3 | INFO | src/slices/scheduler/domain/logic/ConstraintSolver.js (whole), ScoreEngine.js (whole) | Byte-identical algorithmic correctness of the moved comparators/penalty math (compareItems tie-breaks, severity ranking, parseDateKey, the 6 penalty constants) is a code-logic concern, not a boundary one — and is the spine of this behavior-preserving refactor. | REFER→ernie: verify the moved logic is byte-identical to the legacy originals (comparator branches, numeric constants, parseDateKey legacy M/D branch). |
| 4 | INFO | src/slices/scheduler/domain/** (test coverage) | W1 gate requires "domain unit tests green incl. integrated 3-solver pipeline scenario (Snuffy)" + golden-master still GREEN. Coverage adequacy of the new domain unit tests + the integrated multi-solver fixture is a test-inventory concern. | REFER→telly: confirm domain unit tests + integrated 3-solver pipeline scenario exist and are green, and the W0 golden-master is still GREEN post-extraction. |

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Algorithmic Efficiency | covered | Minute-grid occupancy primitives (O(dur) reserve/isFree) and prefix-sum unchanged; comparators O(n log n) sort — all byte-identical moves, no new complexity introduced | Correctness of the moves → ernie (INFO #3) |
| Modularity | covered | 11-file domain tree split into value-objects / entities / logic + index barrel; mirrors task + user-config precedent exactly | Strong — clean cohesive slice |
| Separation of Concerns | **covered (re-review)** | Pure logic separated from the legacy orchestrator; the domain now reads PRI_RANK from a self-contained pure leaf (`domain/constants.js`) and no longer reaches into legacy `scheduler/constants.js` — the fs-hashing side-effect is fully isolated to the legacy ring. Seam is clean (BLOCK-1 RESOLVED). | Verified — domain is self-contained; inward-only |
| Scalability | covered | No instance-local state introduced; pure in-process functions operating on caller-owned maps/arrays; no Cloud Run scale-out concern added | n/a for this wave |
| Data Architecture | covered | No schema/migration touched; entities are read-models over the existing output shape (Schedule.fromResult / ScheduledTask.fromEntry round-trip with no field changes) | Output shape pinned by golden-master |
| Resilience | covered | No inter-service/external call added; ConflictResolver.resolve is a read-only reducer | n/a |
| Extensibility | covered | Closed-enum VOs (Priority/PlacementMode) reject unknown terms; solvers are pure + composable (S7); future waves (ports/adapters/facade) build on this core per WBS | PlacementMode reused, not duplicated — single canonical VO |
| Infrastructure | covered | No TF/Docker/deploy YAML in scope; the one infra-shaped issue is the transitive `fs` leak (BLOCK-1), which is a purity-boundary defect not a deploy-config one | — |
| Redundancy | covered | PlacementMode + PRI_RANK are reused from a single source rather than duplicated (one canonical placement-mode VO; PRI_RANK from constants) — no divergent copies | The PRI_RANK reuse is correct in intent; only its *carrier module's side effect* is the problem (BLOCK-1) |

## Sign-off
Signed: Cookie — 2026-06-12T14:21:19Z (original)
Re-review signed: Cookie — 2026-06-12T17:40:00Z — BLOCK #1 RESOLVED, Status DONE; W1 boundary + no-fs gate both clear.
