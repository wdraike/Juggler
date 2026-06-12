# Zoe Review — juggler-hex-h6-scheduler (H6 FINAL ADVERSARIAL CAPSTONE — W0→W4 complete) — refactor — 2026-06-12

## Status: ISSUES

BLOCK: 0 · WARN: 1 · INFO: 3

**Headline verdict: the complete H6 hex extraction (W0 baseline → W1 domain → W2 adapters/ports → W3 RunScheduleCommand + delta-write → W4 facade + caller migration) is BEHAVIOR-IDENTICAL and TRUSTWORTHY TO SHIP.** The golden-master gate survived all 5 waves intact — two end-to-end regression mutations (delta-write disabled; slack-sort inverted in the *extracted* ConstraintSolver) both went RED on the final integrated code. Frozen literals are concrete (not weakened to shape). Determinism held 3×45/45. The shipped facade is a genuine by-reference re-export (`===`), so callers cannot diverge today.

**The one WARN is a *gate-durability* gap, not an extraction defect:** F006 is confirmed real and escalated. The `schedule-routes` (and MCP) caller tests mock the legacy `runSchedule` path and assert only the canned mock echo — so a facade that drops args, or even one that completely short-circuits `runScheduleAndPersist`, leaves the 22 route tests + MCP suite fully GREEN. This does not affect H6's behavior-identity (the shipped facade re-exports by reference), but it means NO test guards the facade seam against the *next* change. Telly correctly filed it INFO; I re-rate WARN because the facade is now the sanctioned public entry point and its forwarding contract is untested.

---

## Proof of Work

| Step | Action / command | Result |
|------|------------------|--------|
| Inputs | Read TEST-REVIEW.md (telly DONE), prior ZOE-REVIEW.md (W3), facade.js, goldenMaster.h6.test.js (1420 ln), callers | mode=refactor, depth=deep; all present |
| Baseline backups | `cp` facade / runSchedule / unifiedScheduleV2 / ConstraintSolver / GM-test → /tmp; `shasum` each | facade `1079259…`, runSchedule `c055eca…`, ConstraintSolver `8c60fa5…`, GM-test `10acf74…` |
| **Determinism 3×** | `DB_PORT=3407 … npx jest goldenMaster.h6 --no-coverage` ×3 | **45/45, 45/45, 45/45** — W3 flaky-fix held through W4 |
| **CAP-1 facade by-ref identity** | `node -e` compare facade exports `===` legacy | runScheduleAndPersist / getSchedulePlacements / computeWindowCloseUtc / unifiedScheduleV2 ALL `=== true` — shipped facade cannot diverge |
| **CAP-1 facade drop-arg mutation** | facade `runScheduleAndPersist:(u,ids,opts)=>real(u)` (drops ids+opts) → GM + schedule-routes | GM 45/45 (imports runSchedule directly — expected); **schedule-routes 22/22 — NOT caught** |
| **CAP-1 facade short-circuit mutation** | facade returns bogus `{ZOE_MUTATED:true}`, never calls real fn → callers | **schedule-routes 22/22 + MCP 290/290 — NOT caught** → F006 confirmed (mock swallows args; test asserts only canned echo) |
| Facade restore | `cp /tmp backup → facade.js`; shasum | `1079259…` byte-identical |
| **CAP-2a delta-write disabled** | `placementMatchesDbRow(...)` → `false && placementMatchesDbRow(...)` (runSchedule.js:1411) → GM | **3 failed, 42 passed** — S5×2 + C-IDEM RED (test:848/893/1308). Gate bites end-to-end. |
| Revert 2a | `cp /tmp backup → runSchedule.js` (NOT git checkout) | `c055eca…` byte-identical |
| **CAP-2b slack-sort inverted (extracted slice)** | ConstraintSolver.js:123-124 `return -1/1` ↔ `1/-1` → GM | **2 failed, 43 passed** — S1 frozen-literal order RED. W1 extraction did NOT hollow the S1 pin. |
| Revert 2b | `cp /tmp backup → ConstraintSolver.js` | `8c60fa5…` byte-identical |
| **F003 comment-strip** | `grep -nE "fn\.now"` runSchedule.js + block-comment + string-literal greps | 3 mentions, ALL on `//` line comments (L106/500/1701); **0 block-comment, 0 string-literal** `fn.now()` → strip is correct on current source; theoretical only |
| **F005 sleep adequacy** | `information_schema` precision of `updated_at`; then delta-OFF + sleep→10ms probe | `updated_at`=timestamp, precision=**0** (1s); at 10ms sleep, S5-single + C-IDEM **FALSELY PASS** (same-second), only S5-batch stays RED → **1100ms is load-bearing & adequate** |
| Restore (F005 probe) | `cp /tmp` GM-test + runSchedule back | GM-test `10acf74…`, runSchedule `c055eca…` byte-identical |
| **F006 mechanism** | Read schedule-routes.test.js:81 mock + :168 assertion; MCP mock greps | mock canned `{dayPlacements:{}}`; test asserts only `status 200` + `body.dayPlacements`; no `toHaveBeenCalledWith` → confirmed |
| Shallow-assertion sweep | grep `toBeDefined/toBeTruthy/expect(true)` in GM | 1 hit (C-SCORE:1106) — guard for `expect(penalty).toBe(80)` on next line → not shallow. 91 `expect()` across 45 tests |
| Frozen-literal integrity | Read CORE (190-223), S1 (386-401) `toEqual` snapshots | Concrete values intact (720/780/810; total:0; breakdown all 0; slack all null; S1 720/750/780) — NOT weakened to shape |
| **Clean-tree verify** | `git status`; marker grep; final GM run | status == pre-audit baseline; 0 mutation markers; GM 45/45; /tmp backups removed |
| Output | Write ZOE-REVIEW.md + zoe-REVIEW.json | Done |

---

## Proof Checklist

- [x] --mode present; recorded (refactor, depth=deep)
- [x] Required inputs present (TEST-REVIEW.md DONE + TEST-CATALOG present + golden-master + facade + callers)
- [x] Shallow-assertion grep run; output examined — 1 `toBeDefined` (C-SCORE:1106), is a guard for an adjacent concrete `.toBe(80)`; not shallow
- [x] Assertion-free grep — N/A; GM has 91 `expect()` across 45 tests, every test asserts
- [x] ≥1 suspect test re-executed — full GM ×3 + 5 mutated runs (facade drop-arg, facade short-circuit, delta-OFF, slack-invert, delta-OFF+sleep-10ms)
- [x] Suspect-selection risk-ordered: (1) facade re-export seam [CAP-1], (2) delta-write data-mutation path [CAP-2a], (3) extracted slack-sort core [CAP-2b], (4) F005 timing-sleep false-pass window, (5) F003 comment-strip false-pass direction
- [x] **SPOT-MUTATION ×5 executed; results recorded; tree reverted byte-identical (4 source shas + GM-test sha all match pre-audit baseline; git status == baseline; 0 markers)**
- [x] Mock-hides-bug: F006 CONFIRMED — schedule-routes + MCP mock the legacy `runSchedule` and assert only the mock's canned return; a fully short-circuited facade stays GREEN → mock-only seam coverage of the facade forwarding contract
- [x] Snapshot-triviality + tautology: CORE/S1 `toEqual` snapshots are concrete frozen literals, NOT `toMatchSnapshot` auto-snapshots, NOT self-comparisons; verified not weakened across 5 waves
- [x] Mode-specific (refactor) challenge: characterization gate PINS observable output (frozen literals) AND still DETECTS a behavior change end-to-end (delta-OFF → S5/C-IDEM RED; slack-invert in extracted slice → S1 RED). Behavior pinning is REAL post-extraction.
- [x] Error/negative-path: S5 covers the no-write skip path; S3-FULL covers recurring→unplaced; mutations cover the broken-write/wrong-order paths
- [x] Bird PASS: N/A — backend-only refactor, no UX-REVIEW
- [x] Bird a11y re-verify: N/A
- [x] **Flake re-run ≥2×: GM 3×45/45 — W3 determinism held through W4**
- [x] Severity-calibration: telly F006 INFO → re-rated **WARN** (facade is now the public seam; forwarding contract untested; short-circuit mutation proves the gap is exploitable by the next change). F003/F005 confirmed correctly rated (theoretical / adequate-as-is).
- [x] Each finding carries file:line + severity
- [x] Flag-and-refer emitted (F006 fix is a test-authoring change → REFER→telly; H7 facade-thinning → REFER→oscar)
- [x] Rubric Coverage Map emitted — all 9 dimensions
- [x] Proof of Work populated with actual commands + results
- [x] Status set (ISSUES — 1 WARN)
- [x] ZOE-REVIEW.md written
- [x] Scooter: not consulted — every fact established by code-read + DB introspection + executed mutations on the running suite; no settled-knowledge question arose
- [x] Knowledge changes: none authored by zoe (audit only)

---

## Findings

### Telly Audit
| # | Severity | File:Line | Description | Required Fix |
|---|----------|-----------|-------------|--------------|
| Z1 | **WARN** | tests/api/schedule-routes.test.js:81,168 (+ MCP suite) | **F006 confirmed & escalated.** Caller tests mock the legacy `src/scheduler/runSchedule` path and assert ONLY the canned mock echo (`status 200` + `body.dayPlacements`) — no `toHaveBeenCalledWith`. I mutated the facade to (a) drop `ids`+`opts` and (b) fully short-circuit `runScheduleAndPersist` (returning bogus `{ZOE_MUTATED:true}`, never calling the real fn) — **schedule-routes stayed 22/22 GREEN and MCP 290/290 GREEN both times.** No test guards the facade's forwarding contract. Behavior-identity of the *shipped* facade is NOT at risk (proven `===` by-reference), but the gate would not catch the NEXT change that adds facade indirection. | Add ONE caller-level assertion that the facade forwards args to the underlying fn — either `expect(mocked.runScheduleAndPersist).toHaveBeenCalledWith(userId, ids, opts)`, OR move the mock to `src/slices/scheduler/facade` and assert through it. Telly's owned change (test authoring). |

### Resolved / Cleared this pass (telly-referred loose ends)
| Ref | Was | Verdict | Proof |
|-----|-----|---------|-------|
| **F003** (P1 comment-strip block/string) | WARN — `indexOf('//')` doesn't handle block comments or `//` in strings | **CLEARED (theoretical only on current source)** | All 3 `fn.now()` mentions in runSchedule.js are on `//` line comments (L106/500/1701); 0 in block comments, 0 in string literals. Strip is correct today. Also: the false-pass DIRECTION is benign — a surviving comment-mention would INCREASE the count → test FAILS (over-strict), it cannot HIDE a real `fn.now()`. A real hidden violation would need a real `db.fn.now()` after a `//`-bearing string on the same line — none exists. |
| **F005** (1100ms sleep sufficiency) | INFO — timing-based, possibly fragile | **CLEARED — load-bearing & adequate** | `updated_at` = timestamp, DATETIME_PRECISION=0 (1s). Probe: with delta-write disabled AND sleep dropped to 10ms, S5-single + C-IDEM **falsely PASS** (run-1/run-2 same wall-clock second) — only S5-batch stays RED. The 1100ms is precisely what crosses the second boundary and makes the gate bite. Adequate as-is; do NOT shorten below ~1100ms. |

### CAPSTONE gate-bites confirmation (the decisive end-to-end check)
| Check | Mutation | Result | Meaning |
|-------|----------|--------|---------|
| CAP-2a delta-write | `placementMatchesDbRow(...)` → `false && …` (runSchedule.js:1411) | **3 failed** (S5×2 + C-IDEM RED) | S5/C-IDEM delta pin survived W0→W4; gate detects a broken delta-write |
| CAP-2b slack-sort (in **extracted** slice) | ConstraintSolver.js:123-124 comparators flipped | **2 failed** (S1 frozen-literal order RED) | W1 domain extraction did NOT hollow the S1 ordering pin; the extracted core is genuinely exercised by the gate |
| CAP-1 facade identity | `node` `===` compare | 4/4 `=== true` | shipped facade is a true by-reference re-export — callers cannot get different behavior |

### Flag-and-Refer
| # | Severity | Refer To | File:Line | Description |
|---|----------|----------|-----------|-------------|
| 1 | INFO | REFER→telly | tests/api/schedule-routes.test.js:81 + MCP caller suites | Z1 fix is a test-authoring change (add forwarding assertion / re-point mock to facade) — telly's column. |
| 2 | INFO | REFER→oscar | juggler-backend/src/scheduler/runSchedule.js (uncommitted, sha c055eca…) | runSchedule.js carries the W3 delta-write change UNCOMMITTED in the working tree (same reconstructed file from W3). Verify before committing the H6 leg. Carried forward — out of zoe's column. |
| 3 | INFO | REFER→oscar | juggler-backend/src/slices/scheduler/facade.js (H7 scope) | The Z1 gap closes naturally at H7 when the legacy `runSchedule.js`/`unifiedScheduleV2.js` are thinned/deleted and callers import only the facade — at that point the mock MUST target the facade. Track Z1 as an H7 prerequisite if not fixed now. |

---

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Assertion Depth | covered | CORE/S1/S3/C-SCORE/C-WX frozen-literal `toEqual` (concrete values); 91 `expect()` / 45 tests; the lone `toBeDefined` (C-SCORE:1106) guards an adjacent `.toBe(80)`. Mutations forced RED → assertions are load-bearing. | Strongest layer of the gate |
| Edge Case Gaps | covered | S3 recurring→unplaced (full day); C-WX fail-open (null + missing-hour); S2 severity crunch; C-IDEM 3-task batch; F005 same-second window probed & guarded | No gap |
| Test Gaps | partial | Whole-extraction gate proven intact (CAP-2a/2b RED). GAP: the facade forwarding seam itself is untested — short-circuit mutation stays GREEN (Z1 WARN). | Z1 |
| UX Gaps | n/a | Backend-only refactor; no UX-REVIEW | — |
| Security Gaps | n/a | No auth/payment/entitlement seam touched by W4; S4/S6 require-closure confirms scheduleQueue isolation (no self-trigger/cascade via facade) | — |
| Documentation Gaps | covered | facade.js header accurately describes thin re-export + S4/S6 invariant + H7 scope; verified against `===` identity proof | — |
| Architecture Gaps | covered | Facade is the single sanctioned entry; both callers migrated (routes:10, mcp:7); by-reference re-export keeps behavior identical; delta-write routes through extracted KnexScheduleRepository (CAP-2a confirms) | — |
| Review Quality | covered | The 3 telly-referred loose ends (F003/F005/F006) were each independently EXECUTED, not reasoned: F003 grepped, F005 precision-probed + sleep-shortened, F006 mutation-proven. Gate re-mutated end-to-end ×2 to prove it still bites. | — |
| False Passes | partial | The behavioral gate has NO false pass (every mutation that breaks real behavior goes RED). One TEST-LEVEL false-pass surface exists at the facade seam: a short-circuited facade falsely passes the caller tests (Z1). Not a current-behavior false-pass; a latent gate gap. | Z1 |

---

## FINAL VERDICT — H6 extraction trustworthy to ship?

**YES — ship it.** The complete W0→W4 extraction is behavior-identical and the golden-master gate is trustworthy:

1. **Gate survived all 5 waves intact** — delta-write disabled → S5×2+C-IDEM RED; slack-sort inverted *in the extracted ConstraintSolver* → S1 RED. No wave silently hollowed a prior pin.
2. **Frozen literals are concrete** — CORE (720/780/810; score 0; slack null) and S1 (720/750/780) are real `toEqual` snapshots of computed output, not shape-checks, not auto-snapshots, not self-comparisons.
3. **The shipped facade cannot diverge** — all 4 public symbols are `===` to the legacy exports (by-reference re-export).
4. **Determinism held through W4** — 3×45/45.
5. **F003 cleared** (theoretical; strip correct on current source, and the false-pass direction is benign). **F005 cleared** (1100ms is load-bearing and adequate — proven by the same-second probe).

**One non-blocking caveat (Z1 WARN):** the facade's *forwarding contract* is untested — caller tests mock the legacy path and would not catch a future facade that drops/transforms args. This is gate-durability debt, not an H6 behavior defect. Recommend the one-line `toHaveBeenCalledWith` fix now, or tracking it as an explicit H7 prerequisite (where the mock MUST move to the facade once the legacy files are thinned).

---

## Sign-off
Signed: Zoe — 2026-06-12T20:15:00Z
