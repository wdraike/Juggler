# Traceability — 999.884-ui-map-e2e-foundation — new
| ID | Description | Design element | Code (file:sym) | Test(s) | Status |
|----|-------------|----------------|-----------------|---------|--------|
| R1 | UI map artifact (screens/modals/paths, stable ids, evidence) | static inventory | juggler-frontend/e2e/ui-map.json, e2e/UI-MAP.md | structural (collector parse) | pending |
| R2 | Pure coverage calculator (covered/total + %, unmatched surfaced) | computeCoverage() | juggler-frontend/e2e/report/ui-coverage.js:computeCoverage | juggler-frontend/e2e/report/ui-coverage.test.js — PASS 7/7 (node --test 2026-06-26) | covered |
| R3 | Coverage collector + printed % report | scan @covers + report | juggler-frontend/e2e/report/collect-coverage.js | manual node run — exit 0, printed report 2026-06-26 | covered |
| R4 | Playwright scaffold + representative coverage-tagged specs | config + specs | juggler-frontend/playwright.config.js, e2e/specs/*.spec.js | authored (not run live) | pending |
| R5 | Decomposition + run-target decision | plan doc | juggler-frontend/e2e/DECOMPOSITION.md | n/a | pending |
