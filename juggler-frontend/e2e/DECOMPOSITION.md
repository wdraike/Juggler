# Juggler Frontend — E2E Decomposition (backlog 999.884)

Foundation for a per-surface Playwright E2E suite mapped to
[`ui-map.json`](./ui-map.json) and measured by [`coverage/`](./coverage/).

## Run-target decision

- **Not installed, not run.** `@playwright/test` is intentionally NOT in
  `package.json`. The specs are *authored, not run*. Running requires an
  explicit David-greenlit setup (see the header of
  [`../playwright.config.js`](../playwright.config.js)):
  `npm i -D @playwright/test` → `npx playwright install` → point `baseURL` at a
  SAFE target.
- **Never dev / never the dev DB.** `baseURL` is env-driven
  (`PLAYWRIGHT_BASE_URL` / `FRONTEND_URL`, last-resort `http://localhost:3002`)
  so the safe target is supplied WITHOUT editing tracked config. The target MUST
  be an ephemeral/test stack (e.g. test-bed) — a prior live-UAT agent left 281
  junk rows in the dev DB; do not repeat that.
- **Coverage tooling is browser-free.** `coverage/ui-coverage.js` (pure
  calculator) + `coverage/collect-coverage.js` (annotation harvester) run with
  `node --test` / plain `node` — no browser, no DB, no server. Coverage is
  measured statically from `@covers` annotations, decoupled from actually
  executing the browser suite.

## Existing suite wired in

The pre-existing smoke suite under [`../tests/e2e/`](../tests/e2e/) (5 specs:
`smoke-login`, `smoke-calendar`, `smoke-task-crud`, `smoke-mcp`,
`import-mode-picker`) is NOT orphaned by the new `e2e/specs/` tree. Both trees:

- are matched by one `playwright.config.js`
  (`testMatch: ['tests/e2e/**/*.spec.js', 'e2e/specs/**/*.spec.js']`), and
- are scanned recursively by `collect-coverage.js`.

Each existing smoke spec was retrofitted with one-line `// @covers <id>`
annotations mapping it to real `ui-map.json` ids (test logic unchanged):

| spec | `@covers` |
|------|-----------|
| `tests/e2e/smoke-login.spec.js` | `screen:login`, `path:15` |
| `tests/e2e/smoke-calendar.spec.js` | `screen:month` |
| `tests/e2e/smoke-task-crud.spec.js` | `modal:quick-add`, `path:11`, `modal:task-editor` |
| `tests/e2e/import-mode-picker.spec.js` | `modal:import-export` |
| `tests/e2e/smoke-mcp.spec.js` | `none` (MCP backend integration — no UI surface; uncounted sentinel) |

These now contribute to the coverage numbers alongside `e2e/specs/`.

## Authoring the rest

Remaining per-screen / per-modal / per-path specs should follow the SAME
`@covers` pattern: add `// @covers <id>` line comments near the top of each spec
for every `ui-map.json` id it exercises. The collector aggregates both dirs, so
new specs may live in either tree (new work → `e2e/specs/`). `@covers none` is
the documented sentinel for specs that exercise no UI surface; it is never
counted and never reported as unmatched. Run
`node e2e/coverage/collect-coverage.js` to see coverage rise and to confirm
every `@covers` id resolves to a real map id (zero unmatched).
