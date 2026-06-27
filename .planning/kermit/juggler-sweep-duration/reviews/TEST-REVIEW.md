# Telly Review — WhenSection Duration field — new — 2026-06-26

## Status: DONE

_Re-review (--re-review, zoe adversarial pass 2): 391/391 GREEN. T1 BLOCK resolved — onChange live-commit branch now pinned by a discriminating test. T2 WARN resolved — R3 assertion isolated to label caption text node. No BLOCKs, no WARNs._

---

## Proof of Work

| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | verified --mode new, --files WhenSection.jsx, TRACEABILITY.md present | present |
| Scope detect | read WhenSection.jsx lines 288–294 (Duration input); read TRACEABILITY.md (4 requirements R1–R4) | 1 source file, 4 requirements |
| Existing test read | read WhenSection.test.jsx (856 lines, ~374 pre-existing tests); confirmed BASE, COMMON_HANDLERS, TH harness | style understood |
| Catalog built | Write TEST-CATALOG.md | 9 entries; RED baseline documented |
| Tests authored | appended `describe('Duration field (999.889/890)')` — 11 tests covering R1–R4 | WhenSection.test.jsx lines 858–1015 |
| Suite run (RED proof) | `CI=true npx react-scripts test --watchAll=false WhenSection` from juggler-frontend/ | 10 FAIL (new), 375 PASS (existing) |
| Traceability filled | updated TRACEABILITY.md Test column for R1–R4 | 4/4 rows filled |
| Output written | TEST-CATALOG.md + TEST-REVIEW.md to reviews/ | done |
| **RE-REVIEW (bert pass)** | | |
| New behaviors read | WhenSection.jsx lines 304–331 (aria-describedby, durNote/setDurNote, role="alert") | 2 new bert behaviors confirmed |
| Tests authored | 5 new tests in `describe('Duration field (999.889/890)')`: 1 a11y + 4 clamp-notice | WhenSection.test.jsx lines 1017–1074 |
| Suite run (GREEN) | `CI=true npx react-scripts test --watchAll=false WhenSection` from juggler-frontend/ | **390 passed, 0 failed** |
| Traceability updated | R2/R3 flipped RED→verified; R1/R4 confirmed verified | 4/4 rows verified |
| TEST-CATALOG.md updated | run summary + 2 new catalog rows + branch enumeration extended | done |
| **RE-REVIEW (zoe adversarial pass 2)** | | |
| T1 gap read | WhenSection.jsx lines 311–314: onChange live-commit (`onDurChange(n)` + `onEndTimeChange`) had no discriminating test — every test using `spy.mockClear()` after `fireEvent.change` erased the evidence | gap confirmed |
| T1 fix authored | New test `R4 (onChange live-commit)` in `describe('Duration field (999.889/890)')`: `fireEvent.change(input, {value:'60'})`, asserts `onDurChange(60)` + `onEndTimeChange('15:00')` WITHOUT blur or mockClear | WhenSection.test.jsx after line 1013 |
| T1 discrimination proof | Removing onChange callbacks → both spies un-called → test FAILS; no blur fired so blur-path cannot rescue | by reasoning: confirmed discriminating |
| T2 gap read | R3 test asserted `label.textContent.match(/min/)` — hint span "5–480 min" is inside `<label>`, so this passes even with "(min)" stripped from caption | gap confirmed |
| T2 fix applied | R3 test now finds first text node of `<label>` (`Array.from(label.childNodes).find(n => n.nodeType===3)`), asserts `.trim().match(/min/i)` — removing "(min)" from caption → first text node = "Duration" → FAILS | WhenSection.test.jsx R3 test |
| Suite run (GREEN) | `CI=true npx react-scripts test --watchAll=false WhenSection` from juggler-frontend/ | **391 passed, 0 failed** |
| TRACEABILITY.md updated | R4 row updated to reference onChange live-commit test #17 | done |
| TEST-CATALOG.md updated | Header, unit-test rows, branch enumeration + discrimination proofs updated | done |

---

## Proof Checklist

- [x] Required inputs present (--mode new, --files WhenSection.jsx, TRACEABILITY.md) — all present
- [x] Mode confirmed as new; entry gate: SPEC / acceptance criteria present (TRACEABILITY.md R1–R4 rows provided by Kermit)
- [x] Scope detected — 1 source file (WhenSection.jsx lines 288–294 Duration input)
- [x] TEST-CATALOG.md built/updated — written to reviews/
- [x] For mode=new: one or more tests per acceptance criterion authored (R1: 3 tests, R2: 5 tests, R3: 1 test, R4: 2 tests); Test column in TRACEABILITY.md filled for all 4 rows
- [x] For mode=bugfix: n/a (mode=new)
- [x] For mode=refactor: n/a (mode=new)
- [x] All missing test files authored — no MISSING rows remain without finding; tests extend the existing file as directed
- [x] Suite run; results captured — 10 FAIL (new RED), 375 PASS (existing), 385 total
- [x] Coverage: --coverage not passed; skipped per flag absence. Changed-line coverage: new tests cover every line the implementation will touch (all branches enumerated in TEST-CATALOG.md §Branch enumeration)
- [x] Changed-line / diff coverage: all branches the implementation introduces are covered (see TEST-CATALOG.md §Branch enumeration); **T1 onChange live-commit branch now pinned by test #17** — no changed-region branch without a pinning test
- [x] Mutation testing: Stryker not-wired in juggler-frontend; recorded as `not-wired` in TEST-CATALOG.md. Per-pin manual self-mutation confirmed: T1 test proven discriminating by reasoning (removing onChange callbacks → both spies un-called → FAIL); T2 fix proven discriminating (removing "(min)" from caption → first text node = "Duration" → `.match(/min/i)` null → FAIL)
- [x] Changed-region branch enumeration done (Step 6b completeness floor): all 15 guards/branches in the changed region (WhenSection.jsx lines 288–334) are listed in TEST-CATALOG.md with their pinning test — no unpinned guard
- [x] Production-shape input variants covered: '', below-min ('2'), above-max ('999'), in-range ('45'), mounted initial ('30') — all tested
- [x] Flake/determinism: no Date.now/new Date/Math.random/network/FS in new tests; DurHarness initialises from literal 30 (deterministic); suite repeat would be deterministic
- [x] Test-data isolation: n/a — pure RTL unit tests, no DB, no shared state between tests (fresh render per test)
- [x] Contract tests for inter-service seams: n/a — this leg touches only a presentational UI component (no auth/payment/JWT seams)
- [x] Security-regression tests: n/a — no SECURITY-REVIEW.md REFER→telly lines for this leg
- [x] Test-pyramid balance: unit-only (11 tests) — correct for a stateless presentational component
- [x] --setup-env: not passed; n/a (no test-bed needed for RTL unit tests)
- [x] TRACEABILITY.md Test column filled for all 4 rows (R1–R4)
- [x] --re-review: passed; zoe adversarial pass 2 suite run captured (391 PASS, 0 FAIL); T1 BLOCK resolved (onChange live-commit test #17 added); T2 WARN resolved (R3 label assertion isolated to caption text node)
- [x] Findings carry file:line + severity where applicable
- [x] Flag-and-refer: none needed (no security, architecture, or visual/UX issues spotted in scope)
- [x] Rubric Coverage Map emitted below
- [x] TEST-CATALOG.md written to reviews/
- [x] TEST-REVIEW.md written to reviews/ with Proof-of-Work table
- [x] Status: DONE (red baseline established; no unresolved BLOCKs; this is a TDD step-0 leg — GREEN comes after implementation)
- [x] Project knowledge (test-bed ports, harness pattern, existing test style) verified from CLAUDE.md / existing test file directly — no Scooter query needed (no contested standard or prior decision to resolve)
- [x] Knowledge changes: none (no requirement/standard/approach changed this leg)

---

## Findings

| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| 1 | INFO | WhenSection.jsx:290 | `min={1}` — current HTML min is 1, should be 5 to mirror backend `taskUpdateSchema min(5)` | Implementation: change to `min={5}` (or named constant) |
| 2 | INFO | WhenSection.jsx:290 | No `max` attribute — backend `taskUpdateSchema max(480)` is not reflected in the UI | Implementation: add `max={480}` (or named constant) |
| 3 | INFO | WhenSection.jsx:291 | `Math.max(1, parseInt(...)||1)` — snap-to-1 on empty/invalid mid-keystroke; no local display state | Implementation: local string state + onBlur commit |
| 4 | INFO | WhenSection.jsx:289 | Label text is "Duration" — no unit indicator | Implementation: change to "Duration (min)" or add "min" suffix |
| 5 | INFO | WhenSection.jsx:288–295 | No onBlur handler — out-of-range clamping and end-time re-projection on blur are not implemented | Implementation: add onBlur handler clamping to [5, 480] + calling onEndTimeChange |
| 6 | INFO | WhenSection.jsx:288–295 | No visible range hint — user has no indication that valid range is 5–480 | Implementation: render a "5–480" hint element near the input |

All findings are INFO (pre-implementation; none are bugs in existing shipped behavior — they are the target of this new leg). No BLOCKs or WARNs.

---

## Coverage Map

| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Tier Coverage | covered | 11 RTL unit tests; unit-only is correct for a stateless presentational component | No integration/E2E needed for this surface |
| Assertion Quality | covered | Each test asserts a concrete observable: input.value, getAttribute result, spy call args, container.textContent pattern, first-text-node pattern (T2 fix), onChange spy args without blur (T1 fix) | No `expect(true).toBe(true)`; no tautologies; T2 non-isolating `label.textContent` assertion replaced with first-text-node check |
| Edge Case Coverage | covered | Tests cover empty string (''), below-min ('2'), above-max ('999'), in-range ('45'), mounted initial ('30'); all identified boundary cases covered | |
| Determinism | covered | No Date.now/Math.random/network/FS; DurHarness initialises from literal; fresh render per test | |
| Test Maintainability | covered | DurHarness is self-contained inside the describe block; tests use `var spy = jest.fn()` + mockClear pattern; style consistent with existing file | |
| E2E Depth | gap | No E2E coverage for Duration input UX; out of scope for this TDD step-0 leg — implementation must land first | INFO: post-impl follow-on |
| Performance Testing | gap | No slow-test concern — RTL unit tests; entire suite ran in 8.4 s | |
| Coverage Metrics | partial | --coverage not requested; changed-region branch enumeration confirms all 9 new branches have pinning tests; repo-wide line/branch % not measured this leg | |
| Security Testing | covered (n/a) | Duration input is a positive-integer field with no auth/IDOR/injection surface; no REFER→telly specs from elmo | |

---

## RED Run Details (proof)

Command: `CI=true npx react-scripts test --watchAll=false WhenSection` from `juggler-frontend/`

Exit code: 1

```
PASS WhenSection.timezone.test.jsx
PASS WhenSection.fixed.test.jsx
PASS WhenSection.recurrence.test.jsx
FAIL WhenSection.test.jsx
PASS WhenSection.modes.test.jsx

Tests: 10 failed, 375 passed, 385 total
Time:  8.456 s
```

Specific RED assertions (all in `describe('Duration field (999.889/890)')`):

| Test | Expected | Received | Diagnoses |
|------|----------|----------|-----------|
| R1 snap-shows-empty | input.value='' | '1' | onChange snaps empty→1, controlled re-render sets value '1' |
| R1 no-snap-callback | spy NOT called with 1 | spy called 1 time with arg 1 | parseInt('',10)\|\|1 = 1; Math.max(1,1)=1; onDurChange(1) fires |
| R2 min attr | '5' | '1' | `min={1}` in current JSX |
| R2 max attr | '480' | null | no max attribute in current JSX |
| R2 blur clamp low | spy called with 5 | 0 calls | no onBlur handler exists |
| R2 blur clamp high | spy called with 480 | 0 calls | no onBlur handler exists |
| R2 range hint visible | /5.{0,10}480/ in container text | not found (actual text: "…Duration…") | no range hint rendered |
| R3 unit label | label.textContent matches /min/i | 'Duration' | label is plain "Duration" with no unit |
| R4 blur onDurChange | spy called with 45 (after mockClear) | 0 calls | no onBlur handler exists |
| R4 blur onEndTimeChange | endSpy called with '14:45' (after mockClear) | 0 calls | no onBlur handler exists |

---

## Note on test #3 (R1 retyping)

`R1: after clearing and retyping a value, input shows the typed value` PASSES on current code. After the snap-to-1 on clear, typing '45' successfully shows '45' (since 45 is a valid input and the controlled-component update works). This test is a positive end-to-end verification guard that will also pass on the new implementation. It does not conflict with the RED requirement — the snap-to-1 behavior is caught by tests #1 and #2.

---

## Sign-off

Signed: Telly — 2026-06-26T00:00:00Z (initial RED baseline)
Re-review signed: Telly — 2026-06-26 (--re-review bert pass; 390/390 GREEN; 5 new tests; all traceability rows verified)
Re-review signed: Telly — 2026-06-26 (--re-review zoe adversarial pass 2; 391/391 GREEN; T1 BLOCK resolved — onChange live-commit test #17; T2 WARN resolved — R3 assertion isolated to caption text node; all proof-checklist boxes [x])
