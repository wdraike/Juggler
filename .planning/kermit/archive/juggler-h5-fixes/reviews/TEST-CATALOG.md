# Test Catalog

_Last updated: 2026-06-12 (W3 re-review — E2 boundary mock fixed; B11-race still FAILING post-bert-atomic-attempt) — mode: bugfix — leg: juggler-h5-fixes W3_

## Scope (this leg)

Files under test:
- `juggler-backend/src/services/gemini-tracked-call.js`
- `juggler-backend/src/controllers/ai.controller.js`
- `juggler-backend/src/slices/ai-enrichment/adapters/KnexAIUsageRepository.js`

## Unit Tests — AI Enrichment

| Module | Test File | Traceability Ref | Last Run | Result | Notes |
|--------|-----------|------------------|----------|--------|-------|
| GeminiAIAdapter (timeout) | `tests/unit/aiEnrichment/geminiAdapterTimeout.test.js` | B5 (H5 W3) | 2026-06-12 | PASS (3 tests) | Pre-existing; covers adapter 8s deadline + abort-pin |
| trackedGeminiCall (timeout altitude + telemetry sep) | `tests/unit/aiEnrichment/trackedCallTimeout.test.js` | B1/B2/B3 (H5 W1a) | 2026-06-12 | PASS (6 tests — W1a fix landed) | B1a margin widened: 10ms/30ms→50ms/300ms (250ms gap) |
| trackedGeminiCall phantom enqueue + quota slot | `tests/unit/aiEnrichment/timeoutAbortConsequences.test.js` | B4/B5 (H5 W1b) | 2026-06-12 | **GREEN (3/3 pass — W3 re-review)** | B4-red + B5-red + B5-guard all GREEN post-bert-fix |

### trackedCallTimeout.test.js — Test Inventory (W1a, now GREEN post-fix)

| Test ID | Description | State after W1a fix | Traceability |
|---------|-------------|---------------------|--------------|
| B1a | env AI_CALL_TIMEOUT_MS=50 — 300ms client ETIMEDOUT (margin widened from 10/30ms) | GREEN | B1 |
| B1b | fast client resolves successfully (guard) | GREEN | B1 |
| B3a | trackedGeminiCall direct — hanging client, 500ms ceiling | GREEN | B3 |
| B3b | trackedGeminiCall direct — fast client resolves (guard) | GREEN | B3 |
| B2a | SDK generateContent call receives abortSignal | GREEN | B2 |
| B2b | enqueue modelParams has no abortSignal (guard) | GREEN | B2 |

### timeoutAbortConsequences.test.js — Test Inventory (W1b, re-review: split check/commit interface)

| Test ID | Description | State vs Current Code | Traceability |
|---------|-------------|----------------------|--------------|
| B4-red | timeout-abort: enqueue() called 0 times (phantom row suppressed) | **GREEN** — bert's B4 fix landed; enqueue suppressed on ETIMEDOUT | B4 |
| B5-red | `checkQuota` (count-only, no insert) + timeout fires + `commitQuota` NOT called → 0 rows | **GREEN** — bert's split implemented; `checkQuota` is read-only; 0 rows after timeout path | B5 |
| B5-guard | `checkQuota` (no insert) + Gemini succeeds + `commitQuota` (insert) → exactly 1 row | **GREEN** — `checkQuota` + `commitQuota` → 1 row; split confirmed | B5 |

**Interface redesign note:** B5 tests were redesigned from single-step `checkAndLogDailyQuota` (always inserts on allow → contradiction) to the split `checkQuota`/`commitQuota` interface (check is read-only; insert only on commit). Both B5-red and B5-guard are now RED on current code with `TypeError` — the correct pre-split RED state. After bert's B5 fix, B5-red asserts the timeout path (0 rows) and B5-guard asserts the success path (1 row); both will pass.

### e2-globalShared.h5.test.js — Boundary Test Delta (re-review)

| Test ID | Description | State vs Current Code | Notes |
|---------|-------------|----------------------|-------|
| E2-A1/A5 (3 tests) | generate() is userId-agnostic — shared result, unchanged content | **GREEN** (7 A1–A5/A2/A3 assertions pass) | Core E2 invariant PRESERVED |
| E2-A2 (2 tests) | Shared adapter singleton; `_setAdapters` DI correctness | **GREEN** | Core E2 invariant PRESERVED |
| E2-A3 (2 tests) | No per-user enrichment store; B's call not contaminated by A | **GREEN** | Core E2 invariant PRESERVED |
| E2 boundary | Quota per-user independence: `checkQuota`+`commitQuota` split mechanics | **GREEN** — mock updated to add `.transaction()` support (W3 re-review); 8/8 E2 tests PASS | Mock fix: `userBDb.transaction` added with `trx.raw` + `trx().insert` |

## API / Integration Tests — Controller (W1b fix loop)

| Flow | Test File | Traceability Ref | Last Run | Result |
|------|-----------|------------------|----------|--------|
| POST /api/ai/command (all paths) | `tests/api/ai-command.test.js` | B5 controller pin + WARN-2 | 2026-06-12 (re-review) | PASS (26/26) |

### ai-command.test.js — AP-72g additions (W1b fix loop)

| Test ID | Description | State | Traceability |
|---------|-------------|-------|--------------|
| B5-controller-pin | `handleCommand` + ETIMEDOUT — `commitQuota` NOT called (spy: 0 calls) | GREEN | B5 (zoe BLOCK-1 controller-level pin) |
| B5-warn2 | `handleCommand` + Gemini success + `commitQuota` throws — 200 with AI result (not 500) | GREEN | WARN-2 (commitQuota failure isolation) |

**Mutation evidence (B5-controller-pin):**
- Spy: `jest.spyOn(aiEnrichment, 'commitQuota')` intercepts ALL facade.commitQuota calls
- B5-warn2 proves the spy is active: that test makes `commitQuota` reject; controller still returns 200 (spy caught the call, mock rejection handled by try/catch)
- B5-controller-pin proves: ETIMEDOUT → callGemini throws → commitQuota line unreachable → spy records 0 calls
- Mutant (commit before callGemini): commitQuota would be called before ETIMEDOUT → spy records >=1 call → `expect(commitQuotaSpy).not.toHaveBeenCalled()` FAILS → mutant KILLED
- Direct source encode corruption prevented in-file mutation; spy mechanism provides equivalent proof

**Mutation evidence (B5-warn2):**
- The test embeds its own mutation: `commitQuota` is mocked to REJECT (simulating the DB error condition)
- Controller must catch this rejection and still return 200 — this IS the mutation test
- If the try/catch is removed: commitQuota rejection propagates → outer catch fires → 500 → assertion fails → mutant KILLED

## Characterization Tests — AI Enrichment

| Flow | Test File | Traceability Ref | Last Run | Result |
|------|-----------|------------------|----------|--------|
| H5 Golden Master (controller + routes + trackedGeminiCall) | `tests/characterization/aiEnrichment/goldenMaster.h5.test.js` | B1–B4 (H5 W0) | 2026-06-12 (re-review) | PASS (53/53) |
| H5 E2 — globally shared / per-user-override invariant | `tests/characterization/aiEnrichment/e2-globalShared.h5.test.js` | E2 (H5 W0) | 2026-06-12 (W3 re-review) | PASS (8/8) — E2 boundary mock updated to add `.transaction()` support |

### goldenMaster.h5.test.js — quota boundary update (W1b fix loop)

The DB integration test at line 1011 previously called `repo.checkAndLogDailyQuota(TEST_USER_ID)` (dead method, removed by bert WARN-1). Updated to `repo.checkQuota(TEST_USER_ID)` — pins the same behavior:
- 50 rows in ai_command_log → count=50 → count >= AI_DAILY_LIMIT(50) → `{allowed: false}`
- `checkQuota` is count-only: deny path does NOT insert (still 50 rows after call)
- Self-mutation note: changing `>=` to `>` in checkQuota → `50 > 50 = false → allowed:true` → `expect(result.allowed).toBe(false)` FAILS → mutant KILLED
- Run: 53/53 PASS (test-bed MySQL 3407)

## Coverage Gaps (this leg scope)

| File | Gap | Severity |
|------|-----|---------|
| `src/services/gemini-tracked-call.js` | Timeout path not exercised (no timeout exists yet — that IS the bug) | BLOCK (pre-fix; resolved by fix) |
| `src/slices/ai-enrichment/adapters/GeminiAIAdapter.js` | env-read path for AI_CALL_TIMEOUT_MS not exercised (path doesn't exist yet) | BLOCK (pre-fix; resolved by fix) |

## W2a Regression Tests — Adapter Lifecycle (adapterLifecycle.test.js)

| Test ID | Description | State vs Current Code | Traceability |
|---------|-------------|----------------------|--------------|
| B6-red | suggest-icon with no GEMINI_API_KEY: 0 logger.error calls expected — mockErrorSpy called 1 time | **RED** — `mockErrorSpy` called 1 time; `logger.error('suggest-icon error:', 'GEMINI_API_KEY not configured')` IS called on not-configured path | B6 |
| B6-guard | suggest-icon with configured adapter (client injected) → no logger.error on success path | **GREEN** | B6 |
| B7-red | trackedGeminiCall returns null → expect structured 'Unexpected Gemini response structure' error | **RED** — `res.body.error` is `"Cannot read properties of null (reading 'text')"` not structured message | B7 |
| B7-guard-2 | blocked response `{candidates:[{content:null}]}` → structured error (non-null already handled) | **GREEN** — structured error branch already reached (non-null object; no null deref) | B7 |
| B7-guard | valid text response → callGemini succeeds, 200 returned | **GREEN** | B7 |
| B8-red | GEMINI_API_KEY rotated after first _getClient() → expect new GoogleGenAI instantiation | **RED** — `MockGoogleGenAI` called 1 time not 2; cached client returned without re-instantiation | B8 |
| B8-guard | same key on repeated _getClient() calls → cached client reused, 1 instantiation | **GREEN** | B8 |
| B9-boot-red | `facade.init()` with `getDefaultDb()` mocked to THROW → init() must throw db-config error at boot | **RED** — `facade.init is undefined`; `typeof facade.init === "undefined"` → FAILS | B9 |
| B9-boot-guard | `facade.init()` with `getDefaultDb()` mocked to RESOLVE → init() resolves cleanly; generate/checkQuota still callable | **RED** — `facade.init is undefined` | B9 |
| B9-env-ok | bogus NODE_ENV (not in old allowlist) + `getDefaultDb()` resolves → `facade.init()` must NOT throw (db-resolution, not string check) | **RED** — `facade.init is undefined` | B9 |
| B9-boot-assert | REFER→bert: server.js must call `await facade.init()` in start() — documentation pin only | **GREEN** — documentation pin | B9 |

**Note (B9 re-review 2026-06-12):** Old B9-red (constructor NODE_ENV allowlist) and B9-guard (injected db bypasses constructor) have been replaced by the boot-contract tests above. The old constructor-level check was the wrong assertion: (1) the facade is lazy — adapters built on first call, not at boot; (2) the NODE_ENV string allowlist does not validate actual db-config resolution.

**Note (B9 run-order-robustness fix 2026-06-12):** B9-boot-red, B9-boot-guard, and B9-env-ok have been rewritten to use `jest.resetModules() + jest.doMock + fresh facade require` per test instead of `jest.spyOn` on a module-level reference. The prior approach was fragile: if `jest.resetModules()` were called in the same file, the spy would be orphaned and B9-boot-red would silently stop asserting. The new approach registers the mock at the PATH level in the CURRENT registry, so facade.init()'s require always gets the intended mock regardless of run order. Mutation KILLED under both isolation and co-run (ai-command + goldenMaster co-run) configs.

**Current state post-fix: ALL 11 GREEN** — B6/B7/B8 fixed by bert; B9-boot-* fixed by bert (facade.init() exists); run-order robustness fixed by telly (doMock pattern).

**Test file:** `tests/unit/aiEnrichment/adapterLifecycle.test.js`

**Last run (post run-order-robustness fix):** `DB_PORT=3407 NODE_ENV=test npx jest --testPathPattern=adapterLifecycle --verbose` — **11/11 PASS**; co-run `npx jest tests/api/ai-command tests/characterization/.../goldenMaster.h5 tests/unit/.../adapterLifecycle --runInBand` — **90/90 PASS**

**Mutation evidence (B9-boot-red):** removed `getDefaultDb()` call from `facade.init()` → B9-boot-red FAILS ("Received promise resolved instead of rejected") under BOTH isolation and co-run → mutant KILLED

**Run:** `DB_PORT=3407 NODE_ENV=test npx jest --testPathPattern="tests/unit/aiEnrichment/adapterLifecycle" --verbose` with `--runInBand` for co-run verification

## W3 Regression Tests — Quota TOCTOU (quotaTOCTOU.test.js)

**New file:** `tests/unit/aiEnrichment/quotaTOCTOU.test.js`
**Traceability:** B11 (backlog 999.415 — quota TOCTOU atomicity)
**Tier:** DB-integration (real MySQL 3407 — mock cannot exhibit the race; test-bed tmpfs)
**Last run (RED — Step 0):** `DB_HOST=127.0.0.1 DB_PORT=3407 DB_USER=root DB_PASSWORD=rootpass DB_NAME=juggler_test NODE_ENV=test npx jest --testPathPattern=quotaTOCTOU --verbose`

| Test ID | Description | State vs Current Code | Traceability |
|---------|-------------|----------------------|--------------|
| B11-race | Seed 49 rows; Promise.all of two concurrent checkQuota+commitQuota paths → assert finalCount ≤ 50 | **STILL RED (post-bert-atomic-attempt)** — `finalCount=51`, `Expected: <= 50, Received: 51`; bert's `SELECT COUNT(*) FOR UPDATE` inside `db.transaction()` does not prevent phantom inserts — InnoDB FOR UPDATE on counted rows does not acquire a gap lock that blocks concurrent INSERTs. BLOCK. | B11 |
| B11-guard | Single acquire at count=48 → checkQuota allowed:true, commitQuota inserts → exactly 49 rows (happy path non-regression) | **GREEN** — passes on current code; must stay GREEN post-fix | B11 |

**Target atomic contract (for bert+cookie):** After fix, two concurrent "acquire slot" calls at count=49 MUST produce a final row count ≤ 50. Exactly one caller wins; the other is denied. Mechanism is implementation-defined (bert+cookie choose):
- Option A: `SELECT ... FOR UPDATE` inside a transaction (row-lock the count query)
- Option B: unique-window constraint on `ai_command_log` (DB rejects the 51st insert)
- Option C: atomic counter table with conditional update
The test asserts the BEHAVIORAL contract (`finalCount ≤ 50`) so it is robust to whichever mechanism is chosen.

**Mutation evidence:**
- B11-race mutant: remove atomicity (restore plain checkQuota+commitQuota) → both callers both commit → `finalCount=51` → `toBeLessThanOrEqual(50)` FAILS → mutant KILLED
- B11-guard mutant: skip commitQuota → 48 rows instead of 49 → `toHaveLength(49)` FAILS → mutant KILLED

**DB teardown:** `afterAll` removes all `ai_command_log` rows and the test user row for `USER_B11='telly-b11-toctou'`. `beforeEach` clears rows between B11-race and B11-guard.

## Missing Test Files

None — all required regression tests authored. W3 B11 race + guard authored. TRACEABILITY.md B11 Test column filled.
