# Zoe Review — WhenSection Duration field (999.889/890) — new — 2026-06-26

## Status: DONE

**RE-REVIEW (2026-06-26):** Both zoe findings telly was asked to fix are now CLOSED, confirmed by
surgical mutation (mutate → run → FAIL → revert clean):
- **T1 (BLOCK) RESOLVED.** telly added `R4 (onChange live-commit)` (test lines 1019-1041): renders
  WhenSection with bare spies, `fireEvent.change → '60'`, asserts `onDurChange(60)` +
  `onEndTimeChange('15:00')` with NO blur and NO mockClear. Mutation re-run: neutering the in-range
  commit lines (WhenSection.jsx:312-313 `onDurChange(n)` + `onEndTimeChange(addMinutesTo24h(time,n))`)
  makes THIS test FAIL ("Number of calls: 0"). The onChange live-commit / native-stepper path is now
  genuinely pinned. (Confirmed-discriminating — same fix verified on clean code = PASS.)
- **T2 (WARN) RESOLVED.** R3 label test (lines 978-989) now reads the label's first TEXT node
  (`Array.from(label.childNodes).find(n => n.nodeType === 3)`), excluding the `#dur-range-hint` span.
  Mutation re-run: stripping `(min)` from the caption (`Duration (min)` → `Duration`) makes the test
  FAIL (`Received string: "Duration"` vs `/min/i`). The assertion now isolates the caption.

No new false-pass introduced by the test edits (both edits verified discriminating + PASS on clean
source; full WhenSection.test file 106/106 green; frontend suite 391/391). The original-pass R1/R2/R4-blur
tests are unchanged and still honest. Remaining open items are bird WARNs (B1/B2: a11y/viewport PASSes
are static-only with no executed axe/contrast/Playwright evidence) — bird's column, WARN-tier, not a
BLOCK, and outside the telly-fix scope of this re-review.

---

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | ls reviews/TEST-REVIEW.md TEST-CATALOG.md UX-REVIEW.md | all present |
| Baseline run | `CI=true npx react-scripts test --watchAll=false WhenSection.test -t "Duration field"` | 16/16 PASS |
| Shallow-assertion grep | `grep -nE "expect\(true\)\|toBeTruthy\|toBeDefined\|toMatchSnapshot\|\.skip\|\.todo"` test file | 0 hits |
| SPOT-MUTATION A (R3) | strip `(min)` suffix from label (`Duration (min)`→`Duration`); run R3 test #9 | **test STILL PASSES** → non-isolating false-pass |
| SPOT-MUTATION B (onChange) | neuter onChange live-commit `onDurChange(n)`+`onEndTimeChange` (lines 311-314); run full Duration suite | **all 16 STILL PASS** → live-commit/stepper path unpinned |
| SPOT-MUTATION C (clamp, +control) | remove `Math.min/Math.max` clamp; run R2 #6/#7 | both FAIL (Recv 2 not 5; 999 not 480) → R2 genuine |
| SPOT-MUTATION D (snap, +control) | restore old `Math.max(1,parseInt\|\|1)` snap; run R1 | #1/#2 FAIL (Recv "1"; spy called 1), #3 PASS → R1 genuine, #3 non-discriminating (disclosed) |
| Tree revert | `cp /tmp/zoe-mut.WhenSection.jsx.bak …`; `diff` + `grep -c MUT` | CLEAN, 0 residue |
| Mock-hides-bug | new tests use a STATEFUL `DurHarness` (real React.useState + setDur), not value-pinning noop | no mock-echo; harness load-bearing (proven by Mut D) |
| Bird evidence check | read UX-REVIEW.md; cross-checked all 4 WARN resolutions against WhenSection.jsx:207-331 | resolutions accurate; a11y/viewport PASS = static-only, no axe/contrast numbers |
| Output written | ZOE-REVIEW.md + zoe-REVIEW.json | done |
| **RE-REVIEW baseline** | `CI=true react-scripts test WhenSection.test` | 106/106 PASS (incl. new R4 live-commit + reworked R3) |
| **RE-REVIEW Mut T1** | neuter onChange commit (jsx:312-313 `onDurChange(n)`+`onEndTimeChange`); run `-t "live-commit"` | **R4 live-commit FAILS** (durSpy "Number of calls: 0") → discriminating; reverted from /tmp bak |
| **RE-REVIEW Mut T2** | strip `(min)` from caption (`Duration (min)`→`Duration`); run `-t "R3: duration label"` | **R3 FAILS** (`Received "Duration"` vs `/min/i`) → caption isolated; reverted from /tmp bak |
| **RE-REVIEW revert check** | `grep -c ZOE-MUT` + caption grep + restored-suite run | 0 residue; caption restored; 106/106 PASS on clean source |

## Proof Checklist
- [x] --mode present (new) — recorded in header
- [x] Required inputs present (TEST-REVIEW.md + TEST-CATALOG.md + UX-REVIEW.md) — all in reviews/
- [x] Shallow-assertion grep run — 0 hits (no expect(true)/toBeTruthy/toBeDefined/snapshot/skip/todo)
- [x] Assertion-free grep — every `it()` in the Duration block carries ≥1 concrete `expect`; none empty
- [x] ≥1 suspect test re-executed — full 16-test Duration suite run (baseline + per-mutation)
- [x] Suspect-selection criterion applied — risk-ordered: R3 unit (claimed-isolating), onChange-commit (R4 stepper, coverage probe), then clamp/free-type positive controls
- [x] SPOT-MUTATION on ≥1 suspect — 4 mutations (A/B confirm false-pass; C/D positive controls); tree reverted clean (diff empty, 0 MUT residue)
- [x] Mock-hides-bug — DurHarness is stateful (setDur), not a mock echoing its own return; harness statefulness proven load-bearing by Mutation D
- [x] Snapshot-triviality + tautology grep — no snapshots; coverage-theater probe = onChange live-commit branch (Mutation B) = real miss
- [x] Mode-specific challenge (new) — each acceptance criterion test checked for "asserts the requirement vs. that code ran"; R3 fails this, R1/R2/R4-blur pass it
- [x] Error/negative-path audit — clamp-notice negative case (#15 in-range→no alert) present and discriminating; empty/garbage blur path reverts to last value (covered by R1)
- [x] Requirement coverage — R1✓(genuine), R2✓(genuine), R3⚠(non-isolating test), R4◑(blur pinned, onChange/stepper UNpinned); no validate_traceability.py in juggler-frontend
- [x] Zero-tolerance domains — n/a (presentational UI; no scheduler/auth/billing)
- [x] User story coverage — no US-{N} rows for this leg (SPEC uses R1-R4 criteria)
- [x] VERIFICATION-CHECKLIST.json — none in juggler-frontend; per-requirement verdicts recorded in Findings instead
- [x] Bird PASS verdicts challenged for browser-execution evidence — all static, no Playwright/axe; recorded as evidence gap
- [x] Bird a11y claims independently re-verified — re-run NOT possible (static brief, no live server); wiring cross-corroborated by telly's executable a11y test #12; contrast numbers absent → unverified
- [x] Flake re-run — suite is deterministic (no Date/random/network); ran ≥2× across mutations with stable results
- [x] Severity-calibration audit — telly's "No gaps" completeness claim re-rated to BLOCK; no bird under-rating found
- [x] Each finding carries file:line + severity
- [x] Flag-and-refer emitted (durDraft useEffect React logic → ernie, already referred by bird)
- [x] Rubric Coverage Map emitted — all 9 dimensions marked
- [x] Proof of Work populated with actual commands + results
- [x] Status set (ISSUES)
- [x] ZOE-REVIEW.md written
- [x] Scooter — not needed (no contested standard; canonical range 5-480 already cited in SPEC from task.schema.js)
- [x] Knowledge changes — none made this leg

---

## Findings

### Telly Audit
| # | Severity | File:Line | Description | Required Fix |
|---|----------|-----------|-------------|--------------|
| T1 | BLOCK → **RESOLVED (re-review 2026-06-26)** | WhenSection.test.jsx:1019-1041 | **FIXED.** telly added `R4 (onChange live-commit)` test that types '60' (no blur, no mockClear) and asserts `onDurChange(60)` + `onEndTimeChange('15:00')`. zoe re-mutated jsx:312-313 (neutered the in-range onChange commit) → test FAILS ("Number of calls: 0"); PASSES on clean source → genuinely discriminating. onChange/native-stepper path now pinned; "No gaps" claim is now true. |
| T1-orig | BLOCK (superseded) | WhenSection.test.jsx:991-1013 + TEST-CATALOG.md:88,99 | **Confirmed false-pass — R4 stepper/live-commit path is unpinned.** Mutation B neutered the onChange in-range commit (`onDurChange(n)` + `onEndTimeChange(addMinutesTo24h(time,n))`, WhenSection.jsx:311-314) and ALL 16 tests still passed. This is the path the native number-spinner stepper AND every in-range keystroke use to update the parent's `dur`/end-time. Every R4/R2 commit test types a value then `spy.mockClear()` and asserts only the **blur** contribution, so the onChange commit is deliberately erased and never re-asserted. telly's TEST-CATALOG branch-enumeration (line 99) states "All changed-region branches have at least one pinning test. No gaps." — that branch is absent from the table and demonstrably unpinned. R4 ("native stepper still adjusts the value") is therefore not protected: a refactor could break live-update and CI stays green. | Add a test that types/steps an in-range value (e.g. '50') with the stateful harness and asserts `onDurChange(50)` + `onEndTimeChange('14:50')` fire WITHOUT any blur and WITHOUT mockClear. Correct the "No gaps" enumeration claim. |
| T2 | WARN → **RESOLVED (re-review 2026-06-26)** | WhenSection.test.jsx:978-989 | **FIXED.** R3 now asserts the label's first TEXT node (`childNodes.find(nodeType===3)`), excluding the `#dur-range-hint` span. zoe re-mutated the caption (`Duration (min)`→`Duration`) → test FAILS (`Received "Duration"` vs `/min/i`); PASSES on clean source → caption now isolated and discriminating. |
| T2-orig | WARN (superseded) | WhenSection.test.jsx:978-985 | **Non-isolating false-pass — R3 unit-label test.** `expect(label.textContent).toMatch(/min/i)` passes even when the label's `(min)` suffix is removed (Mutation A: label→"Duration" → test STILL PASSES). Reason: the range-hint `<span id="dur-range-hint">5–480 min</span>` (WhenSection.jsx:330) is a CHILD of the same `<label>`, so `label.textContent` always contains "min" from the hint. The test claims to pin "label indicates the unit" but a regression that strips the label suffix would go undetected. (Feature itself is not broken — the hint still surfaces the unit — hence WARN not BLOCK.) | Assert the label's own text node specifically, e.g. `getByText('Duration (min)')` or assert the input's accessible name, rather than the whole label subtree which includes the hint. |
| T3 | INFO | WhenSection.test.jsx:916-924 | R1 test #3 ("after clearing and retyping… shows the typed value") is non-discriminating — Mutation D confirmed it PASSES on the old snap-to-1 code. telly transparently disclosed this (TEST-REVIEW.md "Note on test #3"). No fix required; #1/#2 carry the real R1 proof. | None — kept as a positive guard; disclosure is honest. |
| T4 | INFO | WhenSection.jsx:205 | `React.useEffect(() => setDurDraft(String(dur)), [dur])` resync of the draft from an EXTERNAL `dur` change (e.g. editing the End time, which calls `onDurChange`) is not directly exercised by any test — the in-harness paths make it a redundant no-op. Minor; the End-time→Duration interaction is the realistic trigger. | Optional: add a test that changes End time and asserts the Duration draft re-syncs. |

### Bird Audit
| # | Severity | File:Line | Description | Required Fix |
|---|----------|-----------|-------------|--------------|
| B1 | WARN | UX-REVIEW.md:122-142 | **All a11y PASSes are static code-inspection with zero executed evidence.** "Color contrast AA text … PASS … contrast verified both themes" (line 129) cites NO ratio. No axe run, no live screen-reader pass, no contrast-tool output — yet 1.4.3 / 1.4.11 / 4.1.3 / screen-reader rows are marked PASS. Per zoe Step 8a these are unverified claims, not verifications. Re-run NOT possible here (static brief, no live server) → recorded as unverified. Partial mitigation: the aria-describedby wiring (WARN-3) is independently corroborated by telly's executable a11y test #12 (which I re-ran — genuine, resolves `#dur-range-hint` to a real element containing "480 min"). | Run axe + a contrast tool on the live Duration field at dark+light; record actual ratios and any violation count before a production a11y PASS. |
| B2 | WARN | UX-REVIEW.md:106-118 | Viewport coverage claims PASS across 7 sizes but every row is "static" — no browser render. Reflow/zoom/target-size "PASS" are inferred from source, not observed. Bird itself downgrades Responsive Design to "partial" and recommends a 375px visual check, which is honest, but the 7-viewport table still reads as verified. | One real render at 375px + 320px reflow before claiming viewport PASS. |
| B3 | INFO | UX-REVIEW.md:100 | "min" (INFO-5) is contextually unambiguous for "Duration (min)". Note the adjacent field renders "Min chunk (min)" which overloads "min" as both *minimum* and *minutes*; not in this leg's scope but a latent label-clarity smell. | None this leg. |

### Flag-and-Refer
| # | Severity | Refer To | File:Line | Description |
|---|----------|----------|-----------|-------------|
| 1 | INFO | REFER→ernie | WhenSection.jsx:202-205 | `durDraft` useState + `[dur]` useEffect resync is React state logic (correctness, not test/UX truthfulness) — already referred to ernie by bird (INFO-7). No new issue; production logic reads correct. |

---

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Assertion Depth | partial | R1/R2/R4-blur assert exact values (input.value, getAttribute, spy args, projected '14:45'); R3 asserts a subtree that includes a sibling element (non-isolating, T2) | Most assertions concrete; one mis-scoped |
| Edge Case Gaps | covered | empty(''), below-min('2'), above-max('999'), in-range('45'), initial('30') all tested; clamp-notice has a real negative case (#15) | Good edge spread |
| Test Gaps | covered (re-review) | onChange live-commit / native-stepper path now pinned by new R4 live-commit test; re-mutation of jsx:312-313 FAILS it. T1 closed | was T1 BLOCK, now RESOLVED |
| UX Gaps | partial | bird's WARN resolutions accurate vs source, but all a11y/viewport PASS are static, no executed axe/contrast/Playwright | B1/B2 |
| Security Gaps | covered (n/a) | positive-integer field; no auth/IDOR/injection surface | — |
| Documentation Gaps | covered | SPEC cites canonical range 5-480 from task.schema.js; constants DUR_MIN/DUR_MAX mirror it; no doc drift | — |
| Architecture Gaps | covered (n/a) | single presentational component; no boundary/dependency change | — |
| Review Quality | partial | telly's RED-baseline rigor is real (mutations confirm R1/R2 genuine) but the completeness claim is overstated; bird is accurate-but-static | T1, B1 |
| False Passes | covered (re-review) | both prior false-passes CLOSED: T1 (R4 live-commit test fails on neutered onChange) + T2 (R3 fails on stripped caption); no new false-pass in the test edits | RESOLVED |

---

## Sign-off
Signed: Zoe — 2026-06-26T00:00:00Z (initial)
Re-signed: Zoe — 2026-06-26T22:10:00Z (re-review: T1 + T2 RESOLVED by mutation-confirmed discriminating tests; Status DONE)
