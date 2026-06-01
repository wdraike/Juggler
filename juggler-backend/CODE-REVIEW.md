# Code Review — JUG-HEX-P7 (db.js + eslint.boundaries.config.js + package.json) — 2026-05-31

## Summary
Three clean, scoped changes. No critical issues. One warning: `migrations/**` in the boundary config ignores list only matches the top-level `migrations/` directory, not `src/db/migrations/`. This is harmless today (migrations never import slice internals), but the pattern is misleading. One info note on the `console.warn` not using the project's structured logger.

## Critical Findings (must fix before merge)
_None._

## Warning Findings (fix this sprint)
| # | Finding | File:Line | Remediation |
|---|---------|-----------|-------------|
| W1 | `ignores` entry `'migrations/**'` matches only top-level `migrations/` dir, not `src/db/migrations/**`. Migrations live under `src/db/migrations/` — the ignore is misdirected. Harmless today (no slice imports in migrations), but future migrations that do import would be silently linted rather than excluded. | `eslint.boundaries.config.js:39` | Change to `'src/db/migrations/**'` or use `'**/migrations/**'` to match both locations. |

## Info / Suggestions
| # | Finding | File:Line | Suggestion |
|---|---------|-----------|-------------|
| I1 | `console.warn` used directly in `db.js` rather than the project's structured logger (`lib-logger`). The module-load context makes the structured logger awkward here (circular dep risk), so `console.warn` is acceptable — but a comment explaining why the logger isn't used would prevent future "fix" PRs from switching it. | `src/db.js:23` | Add inline comment: `// logger not used here — module loads at require-time before logger is wired` |
| I2 | The `eslint.boundaries.config.js` ignores `_*.js`, `check*.js`, `debug*.js`, and `test-*.js` — but these are root-relative glob patterns. In flat config, `ignores` patterns without a leading `**/` only match from the config root. A file like `scripts/debug_foo.js` would NOT be matched by `debug*.js`. This is fine for now (none of those scripts import slice internals either), but the comment says they cover "debug/scratch scripts" implying broader coverage. | `eslint.boundaries.config.js:47–51` | Either use `'**/debug*.js'` etc. for broader coverage, or add a comment noting the patterns are root-level only. Not urgent given no slice imports exist in those scripts. |

## Checklist Status
- [x] Complexity — PASS (all files < 50 lines)
- [x] Error handling — PASS (no async, no error paths in scope)
- [x] Test coverage — PASS (db.js deprecation warn is suppressed in test env; no new logic to test)
- [x] Observability — PASS (deprecation warning is intentional console.warn)
- [x] Scalability — N/A
- [x] API design — N/A (no routes changed)
- [x] Dead code — PASS
- [x] Boundary lint passes — PASS (exit 0, zero violations on full src/**/*.js)

## Status: PASS
_Signed: Ernie — 2026-05-31T00:00:00Z_
