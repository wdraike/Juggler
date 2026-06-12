# WBS — juggler-test-failloud-residual — bugfix — 2026-06-12

## Intent
Complete the TEST-FR-001 sweep (recorded human decision 2026-06-09): convert the 2 residual
DB-required test files still using silent `if(!dbAvailable) return` skip-pass (vacuous green)
to the existing `assertDbAvailable()` hard-fail helper. Closes ROADMAP 999.431(a).
Business acceptance: with test-bed up the suites stay GREEN; with DB down they FAIL RED
(TEST-FR-001), never green-with-zero-assertions.

Out of scope: 999.431(b) — Oscar pre-commit gates running working-tree `DB_PORT=3407 jest`
instead of committed-HEAD worktree. That is a process/agent-edit → routed to `--retro`,
backlogged separately (does NOT belong in a codebase leg).

## Scooter (binding)
TEST-FR-001 (docs/testing/TESTING-STANDARDS.md:26) — recorded human decision (W. David Raike,
2026-06-09): DB-backed test MUST throw/FAIL when DB unavailable; silent `return`-skip forbidden;
only `test.skip`/`it.skip` allowed as visible skip. Helper: requireDB.js (`requireDB`/`assertDbAvailable`).
Pattern established by 58 already-converted suites.

## Work Items
| ID | Task | Mode | Scope | Inputs | Depends on | Acceptance criteria | Agents | Wave |
|----|------|------|-------|--------|-----------|---------------------|--------|------|
| W1 | Convert `tests/unit/aiEnrichment/quotaTOCTOU.test.js`: replace the 2 per-test skip-pass sites (B11-race ~166, B11-guard ~275) with in-body `await assertDbAvailable()`; remove now-dead `beforeAll/beforeEach` `if(!dbAvailable) return` lifecycle guards (beforeAll hard-fails first). Import requireDB helper. | bugfix | juggler-backend | quotaTOCTOU.test.js, requireDB.js, TEST-FR-001 | — | (a) test-bed UP → suite still GREEN, assertions run; (b) DB DOWN → both tests FAIL RED with `[TEST-FR-001]`, zero vacuous passes; (c) no production code touched | telly, ernie | 1 |
| W2 | Convert `tests/unit/aiEnrichment/timeoutAbortConsequences.test.js`: replace the 2 per-test skip-pass sites (B5-red ~255, B5-guard ~297) in the DB-backed describe with `await assertDbAvailable()`; remove dead lifecycle guards in that describe. **B4 pure-unit describe (no DB, mocked enqueue) MUST remain DB-free — do NOT add the guard there.** | bugfix | juggler-backend | timeoutAbortConsequences.test.js, requireDB.js | — | (a) test-bed UP → both B4 + B5 describes GREEN; (b) DB DOWN → B5 tests FAIL RED `[TEST-FR-001]`, B4 still GREEN (DB-independent); (c) no production code touched | telly, ernie | 1 |

## Dependency Graph
W1, W2 independent (different files, no shared module) — both Wave 1, run concurrently.

## Dependency Determination Log
| Dep | Type | Source |
| W1↔W2 | none (independent files) | derived — separate test files, shared only the read-only requireDB helper |
| Batch vs split | split | Step 3.6 — two independent files, each its own verification (with-DB/without-DB run); concurrent in Wave 1, not serialized. Too small to batch into a single item only if they shared fixtures — they do not. |

## Waves
Wave 1: W1, W2 (concurrent — independent files)
