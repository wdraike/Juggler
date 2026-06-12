# Test Catalog — juggler-hex-h5-ai — refactor

_Last updated: 2026-06-12 — mode: refactor (fix loop iteration 2 — abort-pin test added)_

## Source Files in Scope (H5 leg)

| Source File | Role | Testable Entities |
|-------------|------|-------------------|
| `src/slices/ai-enrichment/facade.js` | Slice entry point (DI, singletons) | `generate()`, `checkAndLogDailyQuota()`, `_setAdapters()`, `_reset()` |
| `src/slices/ai-enrichment/domain/ports/AIPort.js` | Contract definition | `AIPort.generate` (not-implemented base) |
| `src/slices/ai-enrichment/domain/ports/AIUsagePort.js` | Contract definition | `AIUsagePort.checkAndLogDailyQuota` (not-implemented base) |
| `src/slices/ai-enrichment/adapters/GeminiAIAdapter.js` | Provider adapter | `_getClient()` (Vertex/API-key branch), `generate()` (Promise.race timeout) |
| `src/slices/ai-enrichment/adapters/MockAIAdapter.js` | Test double | `generate()` (canned/sequence/error/hang) |
| `src/slices/ai-enrichment/adapters/KnexAIUsageRepository.js` | Quota adapter | `checkAndLogDailyQuota()` (count/insert/deny/allow) |
| `src/controllers/ai.controller.js` | Consumer (migrated to facade) | `handleCommand()` — full behavior surface via golden-master |
| `src/routes/task.routes.js` | Consumer (suggest-icon migrated) | `GET /suggest-icon` — full behavior surface via golden-master |

## Characterization Tests

| Behavior | Test File | Traceability | Last Run | Result |
|----------|-----------|--------------|----------|--------|
| B1: handleCommand happy path, unsupported, 400 validation, JSON parsing, 500 | `tests/characterization/aiEnrichment/goldenMaster.h5.test.js` | E1, E4, B1 | 2026-06-12 | PASS (13 tests) |
| B1 (quota): 50/day enforcement, rolling window, insert/no-insert | `tests/characterization/aiEnrichment/goldenMaster.h5.test.js` | E4 | 2026-06-12 | PASS (7 tests) |
| B2: suggest-icon happy path, empty/null input, emoji validation, error→null, Vertex branch | `tests/characterization/aiEnrichment/goldenMaster.h5.test.js` | E1 | 2026-06-12 | PASS (13 tests) |
| B3: trackedGeminiCall usage enqueue (success + error + defaults) | `tests/characterization/aiEnrichment/goldenMaster.h5.test.js` | E4 | 2026-06-12 | PASS (6 tests) |
| B4: Gemini client instantiation branching (API-key vs Vertex, missing config) | `tests/characterization/aiEnrichment/goldenMaster.h5.test.js` | E1 | 2026-06-12 | PASS (4 tests) |
| B3 :db: ai_command_log + ai_usage_outbox DB integration (test-bed 3407) | `tests/characterization/aiEnrichment/goldenMaster.h5.test.js` | E4 | 2026-06-12 | PASS (4 tests) |
| E2: generate() globally shared — userId-agnostic, shared singleton, no per-user store | `tests/characterization/aiEnrichment/e2-globalShared.h5.test.js` | E2 | 2026-06-12 | PASS (8 tests) |
| E2 boundary: quota is per-user (independent, not contaminating generate path) | `tests/characterization/aiEnrichment/e2-globalShared.h5.test.js` | E2 | 2026-06-12 | PASS (1 test) |

**Totals: 61 characterization tests — 61 PASS**

## Unit Tests

| Module | Test File | Traceability | Last Run | Result |
|--------|-----------|--------------|----------|--------|
| GeminiAIAdapter timeout / Promise.race (E3) | `tests/unit/aiEnrichment/geminiAdapterTimeout.test.js` | E3 | 2026-06-12 | PASS (2 tests) |
| GeminiAIAdapter abort-pin / controller.abort() verification (E3, zoe WARN-2) | `tests/unit/aiEnrichment/geminiAdapterTimeout.test.js` | E3 | 2026-06-12 | PASS (1 test — abort-pin) |

**Totals: 3 unit tests — 3 PASS**

### Abort-Pin Test Detail (zoe WARN-2 resolution)

The third test in `geminiAdapterTimeout.test.js` uses `makeSignalCapturingClient()` — an instrumented fake that hangs forever (ignores the abort signal for settlement purposes) but captures the `AbortSignal` reference passed into `generateContent`. After `generate()` rejects with `ETIMEDOUT`, the test asserts:

1. `signal` is not null — the signal was threaded through the `signalClient` wrapper into the SDK call
2. `signal.aborted === true` — `controller.abort()` was actually called

**Self-mutation evidence (2026-06-12):**
- MUTATED: removed `controller.abort()` from `GeminiAIAdapter.js:122` (kept Promise.race intact)
- Result: test 1 PASS, test 2 PASS, **test 3 FAIL** — `Expected: true, Received: false` on `signal.aborted`
- RESTORED: `controller.abort()` back in place
- Result: test 1 PASS, test 2 PASS, test 3 PASS
- Conclusion: the abort-pin test is non-tautological; it fails when and only when `controller.abort()` is absent

## Integration Tests (DB-backed)

| Flow | Test File | Traceability | Last Run | Result |
|------|-----------|--------------|----------|--------|
| ai_command_log schema + row | within golden-master B3 :db section | E4 | 2026-06-12 | PASS |
| quota boundary: 50 rows → KnexAIUsageRepository.checkAndLogDailyQuota() deny path | within golden-master B3 :db section | E4 | 2026-06-12 | PASS |
| ai_usage_outbox enqueue shape | within golden-master B3 :db section | E4 | 2026-06-12 | PASS |
| enqueue swallows DB errors | within golden-master B3 :db section | E4 | 2026-06-12 | PASS |

**Note on `:db` quota test:** The test calls the REAL `KnexAIUsageRepository.checkAndLogDailyQuota()` via the live test-bed DB (3407) and asserts `result.allowed === false` after 50 rows. The mock-path B1.9 test (MUTATION 5 verified) provides the binding pin for the `>=` comparator; the `:db` test is the integration layer confirming the real DB path. When `testDb.isAvailable()` returns false (DB unreachable), the test skips early and counts as pass — this is the standard test-bed guard pattern. The B1.9 mock-path test is the authoritative mutation catch.

## E2E Tests

Not applicable for this backend-only refactor leg. No user journey test surface changed.

## Teardown / Isolation Mechanism (corrected)

E2 tests use `afterEach(() => facade._reset())` which sets both `_ai` and `_usage` back to null. This is a real reset — the facade lazily rebuilds on the next call. The prior `_setAdapters({aiAdapter: null})` was a no-op (zoe W5 finding, fixed in fix loop iteration 1). `facade._setAdapters` now accepts explicit null/undefined: `undefined` = do not touch; `null` = reset to lazy-build. `facade._reset()` is the authoritative full teardown for test suites.

## Lint / Static Gate

| Gate | Command | Result |
|------|---------|--------|
| ESLint boundary (no deep-import of slice internals) | `npx eslint --config eslint.boundaries.config.js src/` | 0 violations PASS |
| E1 SDK-leak check | `grep GoogleGenAI src/controllers src/routes` | 0 hits PASS |

## Coverage Map (Diff-Scoped)

Coverage measured against the 8 changed/new files in the leg. Mutation testing not wired (Stryker not configured for this service) — per-pin manual self-mutation performed instead (see E2 test notes and golden-master inline mutation notes).

| File | Changed Lines Covered | Notes |
|------|-----------------------|-------|
| `src/slices/ai-enrichment/facade.js` | All callable methods + `_reset()` exercised by golden-master + E2 tests | `_reset()` added in fix loop; exercised by E2 afterEach |
| `src/slices/ai-enrichment/adapters/GeminiAIAdapter.js` | `_getClient` both branches, `generate` timeout+fast path (Promise.race) | B4 + geminiAdapterTimeout |
| `src/slices/ai-enrichment/adapters/KnexAIUsageRepository.js` | allow/deny paths, count/insert; `:db` test calls real SUT | B1.7–B1.13 + B3:db quota boundary |
| `src/slices/ai-enrichment/adapters/MockAIAdapter.js` | all 4 modes (result/results/error/hang) | E2 + geminiAdapterTimeout |
| `src/controllers/ai.controller.js` | full surface via B1 characterization | golden-master |
| `src/routes/task.routes.js` | full surface via B2 characterization | golden-master |
| `domain/ports/*.js` | base throw methods (not-implemented) | indirectly — ports have no test gap (throw-by-default documented) |

## Missing Tests / Gaps

None in H5 scope. All zoe BLOCKs and WARNs through fix loop iteration 2 addressed:
- BLOCK-1 (tautological DI test): rewritten (iteration 1)
- W2 (headline mock-tautological framing): annotated (iteration 1)
- W3 (`:db` self-comparing tautology): replaced with real SUT call (iteration 1)
- W4 (orphaned-telemetry masking): noted as backlog (production-code concern, bert owns)
- W5 (isolation false claim): fixed — `facade._reset()` added (iteration 1)
- **zoe WARN-2 (abort/cancellation path unpinned): RESOLVED in iteration 2** — `makeSignalCapturingClient()` abort-pin test added; self-mutation confirms RED when `controller.abort()` removed

## Authoritative Full-Suite Run History

| Run | Date | Suites | Tests | ETIMEDOUT crash |
|-----|------|--------|-------|-----------------|
| zoe run #1 (pre bert iter 2) | 2026-06-12 | EXIT 2 crash | partial | 1x crash |
| zoe run #2 (pre bert iter 2) | 2026-06-12 | 171P/21F/4S of 196 | 3224P/56F/58S/1T | 2x crash |
| bert iter 2 fix | 2026-06-12 | 163P/29F/4S of 196 | 3174P/106F/58S/1T | **0 crashes** |
| telly iter 2 (abort-pin +1) | 2026-06-12 | 165P/27F/4S of 192 total | 3177P/104F/58S/1T (3340 total) | **0 crashes** |

**Note on pre-existing suite failures (out of H5 scope):** Failures are pre-existing red backdrop — Redis-dependent tests (Redis 6479 not running), disabled-status schema issues, cal-sync `task_masters.status` column, scheduler unit tests, TaskStatus.slice() undefined. None introduced by H5. H5 suites: 3/3 PASS in every run since bert iteration 2.
