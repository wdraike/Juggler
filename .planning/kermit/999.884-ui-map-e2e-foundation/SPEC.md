# SPEC — 999.884 UI-map + E2E coverage FOUNDATION (juggler-frontend)

## Source backlog item
999.884 [P2-nfr / high / enhancement / LARGE]: "Build a UI map for this app's frontend, then
use it to generate full E2E Playwright tests traversing EVERY screen and EVERY path for FULL
functionality. Tests must verify each screen for content, layout, instructions, help text, size,
and adherence to branding standards. Must emit a percentage UI-test-coverage report (screens/paths
covered vs. mapped) when the suite runs."

## Scope decision — FOUNDATION increment only (item is milestone-scale)
This leg delivers the FOUNDATIONAL, autonomously-safe backbone the ticket asks for FIRST, and
DECOMPOSES the remaining per-screen authoring + live-run into tracked follow-ups. It does NOT
author specs for every screen and does NOT run a live Playwright suite against the dev stack/DB.

### HARD SAFETY CONSTRAINT (prior incident)
No live Playwright/browser UAT against the dev stack or dev DB. A past live-UAT agent left 281
E2E-TEST- junk rows in the dev DB and nearly killed the dev servers. This leg AUTHORS the harness +
representative specs and DRY-validates only (e.g. `playwright test --list`, which itself requires a
David-greenlit `npm i -D @playwright/test` + browser download). Actual suite execution is a
David-greenlit step on an ephemeral/test target, not part of this leg.

## Functional requirements (foundation)
- **R1 — UI map artifact.** A committed, machine-readable inventory of juggler-frontend screens,
  modals/overlays, and primary navigation paths, each with a STABLE id, derived from actual code
  (App.js / AppLayout.jsx view-switch state, components, src/theme). Acceptance: `ui-map.json`
  parses; every entry has a unique id + source-evidence ref; counts match the human-readable
  companion `UI-MAP.md`. Mapped surface ≈ 10 screens + 12 modals + 3 admin + login/callback;
  ~15 primary paths.
- **R2 — Coverage calculator (pure logic, TDD).** A pure function `computeCoverage(uiMap,
  coveredIds)` returning per-category covered/total counts and an overall percentage
  (screens/paths covered vs mapped). Acceptance: deterministic; handles 0%, partial, 100%,
  unknown-id (covered id not in map → reported as `unmatched`, never silently dropped — no
  fallback). Unit-tested with `node --test` RED→GREEN, no browser.
- **R3 — Coverage collector + report.** A script that scans authored specs for `@covers <id>`
  tags, feeds them to R2's calculator, and prints the percentage UI-test-coverage report. Runs
  with zero browser. Acceptance: given the representative specs, prints a report listing
  covered/total per category + overall %, and the list of still-uncovered ids.
- **R4 — Playwright harness scaffold.** A `playwright.config.js` + a SMALL representative set of
  E2E specs (a few screens, NOT all), each tagging the mapped id(s) it covers via `@covers`, and
  establishing the assertion PATTERN for content / layout / help-text / branding (referencing
  `src/theme/colors.js` brand tokens + root `raike-and-sons-brand-guide.md`). Acceptance: config +
  ≥3 representative specs exist, each carries ≥1 `@covers` tag the collector can read; specs are
  authored (not executed live).
- **R5 — Decomposition.** A `DECOMPOSITION.md` splitting the remaining per-screen authoring into
  tracked increments + the run-target decision David must make (where the full suite safely runs).

## Non-functional
- Zero residual data: nothing in this leg touches a live DB or runs a live browser.
- Zero heavy install: calculator + collector run on stock Node 22 (`node --test`), no Playwright
  download. Playwright config is authored; install/list is David-greenlit.
- No unapproved fallbacks: a covered id absent from the map is surfaced as `unmatched`, not
  coerced to a default.

## Out of scope (DECOMPOSED → follow-ups)
- Authoring specs for every screen/modal/path (full traversal).
- Per-screen content/layout/help-text/branding assertions beyond the established pattern.
- Live suite execution + the real emitted coverage % from a live run.
- CI wiring / run-target provisioning (ephemeral test env).
