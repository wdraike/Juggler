# Telly Review — bugreporter-libdb-vendor — bugfix — 2026-06-12

## Status: ISSUES

_Leg 999.441, branch leg/bugreporter-libdb-vendor in bug-reporter-service. STEP 0 only: RED regression guard authored and confirmed. Fix NOT applied (per step instructions). BLOCK: 1 (unresolved — RED guard must go GREEN after the fix is applied). WARN: 0._

---

## Proof of Work

| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | verified --mode bugfix, TRACEABILITY.md at .planning/kermit/bugreporter-libdb-vendor/TRACEABILITY.md | all present |
| Read template | Read juggler-backend/tests/unit/vendor-deps.test.js | 6-test template read; pattern understood |
| Scope detect | Read bug-reporter-backend/src/db.js, package.json, Dockerfile, vendor/ | @raike/lib-db required in db.js; declared file:../../packages/lib-db; vendor/ has no lib-db; Dockerfile copies vendor/ only |
| Resolution probe | node -e "require.resolve('@raike/lib-db', { paths: [BACKEND_DIR] })" | Resolves to DEV/packages/lib-db/src/index.js (OUTSIDE BACKEND_DIR — confirmed RED) |
| Resolution probe | node -e "require.resolve('mysql2', { paths: [BACKEND_DIR] })" | Resolves to bug-reporter-backend/node_modules/mysql2/index.js (within BACKEND_DIR — GREEN) |
| Resolution probe | node -e "require.resolve('knex', { paths: [BACKEND_DIR] })" | Resolves to bug-reporter-backend/node_modules/knex/knex.js (within BACKEND_DIR — GREEN) |
| git diff HEAD | package.json | Committed HEAD: @raike/lib-db absent. Working tree: "file:../../packages/lib-db" (both RED for pin test) |
| mkdir | mkdir -p bug-reporter-backend/tests/unit/ | Created |
| Test authored | Write tests/unit/vendor-deps.test.js (4 tests) | Written — 1 path-scope test (@raike/lib-db), 1 path-scope test (mysql2), 1 path-scope test (knex), 1 package.json pin test |
| Suite run (RED confirm) | cd bug-reporter-backend && npx jest tests/unit/vendor-deps.test.js --no-coverage | 2 failed, 2 passed, 4 total — RED confirmed |
| TEST-CATALOG.md updated | Appended bugreporter-libdb-vendor section | Done |
| TRACEABILITY.md | 999.441 row: Test column pre-seeded by Kermit with tests/unit/vendor-deps.test.js reference | No update needed (already references correct path) |

---

## Proof Checklist

- [x] Required inputs present (--mode bugfix, TRACEABILITY.md) — present and read
- [x] Mode confirmed as bugfix; entry gate: regression test RED on broken tree — confirmed
- [x] Scope detected — bug-reporter-backend/src/db.js, package.json, Dockerfile, vendor/ read
- [x] TEST-CATALOG.md built/updated — bugreporter-libdb-vendor section appended
- [x] For mode=bugfix: regression test authored that FAILS pre-fix — 2/4 tests RED on current tree; captured in TEST-CATALOG.md
- [x] STEP 0 only — fix not applied. PASSES post-fix will be verified in the GREEN step by telly --re-review
- [x] Missing test files authored — tests/unit/vendor-deps.test.js created (no prior test for vendor resolution existed in bug-reporter-backend)
- [x] Suite run; results captured — 2 failed, 2 passed, 0.591 s
- [ ] Coverage measured — not applicable (--coverage not passed; pure unit resolution test, no coverage metric meaningful)
- [x] Changed-line coverage — STEP 0 authored the test file; the fixed code lines will be covered by the regression test when it goes GREEN after the fix
- [x] Mutation testing — not-wired (Stryker not configured for bug-reporter-backend); per-pin self-mutation: path-startsWith assertion is live (flipping resolved.startsWith to `false` trivially kills the assertion); package.json toMatch is live (changing the regex kills it)
- [x] Flake/determinism — suite run once; no Date.now/Math.random/network/FS in test (pure require.resolve + JSON read); deterministic by construction
- [x] Test-data isolation — no DB, no test-bed, no teardown needed (pure resolution test)
- [x] Contract tests — no inter-service seam touched by this leg (vendor resolution is internal to bug-reporter-backend build)
- [x] Security-regression tests — no SECURITY-REVIEW.md REFER→telly lines for this leg
- [x] Test-pyramid balance — 1 unit test file added; no integration/E2E; pyramid not inverted; all tests sub-second (0.591 s total)
- [x] TRACEABILITY.md Test column — 999.441 row pre-seeded by Kermit with correct test path reference; consistent
- [x] Findings carry file:line + severity
- [x] Flag-and-refer lines emitted where applicable
- [x] Rubric Coverage Map emitted (see below)
- [x] TEST-CATALOG.md written to .planning/kermit/reviews/
- [x] TEST-REVIEW.md written to .planning/kermit/reviews/
- [x] Status line: ISSUES (1 unresolved BLOCK — RED guard must go GREEN after fix; expected, STEP 0 by design)

---

## Findings

| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| 1 | BLOCK | bug-reporter-backend/package.json line 17 (working tree) | @raike/lib-db declared as `file:../../packages/lib-db` — outside Docker COPY context; Docker build crashes `Cannot find module '@raike/lib-db'` at boot | Vendor lib-db into bug-reporter-backend/vendor/lib-db/; update package.json to `file:./vendor/lib-db`; regenerate package-lock; rebuild node_modules. Regression test (tests/unit/vendor-deps.test.js) must go GREEN. |

---

## RED Test Summary

| Test | File | Expected on pre-fix tree | Actual |
|------|------|--------------------------|--------|
| @raike/lib-db resolves from within bug-reporter-backend (not hoisted DEV/packages) | tests/unit/vendor-deps.test.js:72 | FAIL | FAIL — resolved to `/Users/david/Offline Coding/Raike & Sons /DEV/packages/lib-db/src/index.js` (outside BACKEND_DIR) |
| mysql2 resolves from within bug-reporter-backend | tests/unit/vendor-deps.test.js:84 | GREEN (already local) | PASS — resolves to bug-reporter-backend/node_modules/mysql2/index.js |
| knex resolves from within bug-reporter-backend | tests/unit/vendor-deps.test.js:96 | GREEN (already local) | PASS — resolves to bug-reporter-backend/node_modules/knex/knex.js |
| package.json declares @raike/lib-db as file:./vendor/lib-db | tests/unit/vendor-deps.test.js:110 | FAIL | FAIL — received `"file:../../packages/lib-db"`, does not match `/^file:\.\/vendor\//` |

**2/4 RED. 2/4 GREEN.** The GREEN tests (mysql2, knex) are correct guards against future removal — they stay GREEN on the broken tree because those deps are already local, as expected.

---

## Coverage Map

| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Tier Coverage | covered | 1 pure unit test file (resolution + JSON assertions); no DB/network | Correct tier for a dep-resolution guard; no integration/E2E needed |
| Assertion Quality | covered | `startsWith(BACKEND_DIR)` — concrete path boundary; `toMatch(/^file:\.\/vendor\//)` — concrete regex pin; `toBeDefined()` — presence check | Non-tautological: assertions fail on the actual broken state |
| Edge Case Coverage | partial | Covers: wrong path (file:../../), absent key (committed HEAD). Not covered yet: correct vendor/ path post-fix (GREEN path — will be confirmed in --re-review step) | Edge cases for this guard are the pre/post states; GREEN path verified on fix |
| Determinism | covered | No Date.now/Math.random/network/FS; pure require.resolve + JSON.parse; deterministic across runs | No mocking needed; resolution is deterministic |
| Test Maintainability | covered | BACKEND_DIR computed via path.resolve(__dirname) — robust to cwd; comments document pre/post states; mirrors proven juggler template | Low maintenance burden |
| E2E Depth | gap | No E2E tests for this leg — not applicable (Docker build verification is manual/CI, not a Jest E2E) | Docker boot verification is the true E2E; out of Jest scope |
| Performance Testing | gap | Not applicable for a dep-resolution unit test | 0.591 s total; no performance concern |
| Coverage Metrics | partial | --coverage not passed; changed-line coverage: the test file itself is the new code; the src/db.js line under bug (`require('@raike/lib-db')`) is indirectly covered by the resolution guard | Stryker not wired; manual self-mutation confirms assertions are live |
| Security Testing | gap | No security surface on this leg (dep vendoring; no auth/authz/injection vectors) | No REFER→telly lines from elmo |

---

## Sign-off

Signed: Telly — 2026-06-12T00:00:00Z

_STEP 0 complete. Regression guard authored at `bug-reporter-service/bug-reporter-backend/tests/unit/vendor-deps.test.js`. 2/4 tests RED on broken tree as expected. Awaiting fix (vendor lib-db, update package.json, regenerate lock) then telly --re-review to confirm all 4 GREEN._
