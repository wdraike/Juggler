# Juggler — Claude Instructions

## Stack
React (port 3002) | Node.js/Express (port 5002) | MySQL + Knex.js | MCP served by `juggler-backend` (Streamable HTTP, `/api/mcp` + `/mcp`)

## Port Configuration
- **Local Dev:** `DB_PORT=3308` (Docker MySQL, see `dev-bed/`)
- **Test:** `DB_PORT=3407` (Docker MySQL via `test-bed/`, tmpfs)
- **Production:** `DB_PORT=3307` (via GCP Cloud SQL Proxy)

## Key Commands
```bash
npm run lint && npm test              # Quality gate
# Start services individually from juggler-backend/ and juggler-frontend/
npm run migrate                       # knex migrate:latest (prod-guarded — see below)
npm run migrate:rollback              # knex migrate:rollback (prod-guarded)
npm run test:coverage:unit            # (juggler-backend/) coverage on the mock-based no-DB
                                      # subset — no test-bed needed; emits coverage/lcov.info
                                      # + coverage-summary.json and prints the baseline %.
                                      # DB-backed suites are excluded (TEST-FR-001 fail-loud);
                                      # full-suite coverage still comes from test-bed runs.
                                      # Selector/denylist: scripts/coverage-unit.js (999.1206)
node ../scripts/generate-traceability.js   # (from juggler/: scripts/generate-traceability.js)
                                      # regenerate docs/TRACEABILITY-MATRIX.md from
                                      # REQUIREMENTS.md Tests columns, verified against the
                                      # live filesystem; --check exits 1 on stale refs (999.1213)
```

**Production migrate guard (999.302):** `migrate` and `migrate:rollback` run through
`juggler-backend/scripts/migrate-guard.js`, which **refuses** to migrate when it detects a
production target — specifically when `DB_PORT=3307` (GCP Cloud SQL Proxy) **or**
`CLOUD_SQL_CONNECTION_NAME` is set. The guard exits 1 with a remediation message and never
spawns knex. To migrate intentionally against such a target, opt in with `ALLOW_PROD_MIGRATE=1`
(only the exact string `1` is accepted): `ALLOW_PROD_MIGRATE=1 npm run migrate`. The guard lives
in the CLI wrapper, not `knexfile.js` (which the running app imports and must never throw on import).
`migrate:status` is **not** guarded (read-only).

### Migrations — transitional views & editing applied migrations (999.733)
- **`20260509000300_add_missed_status_and_completed_at.js`** is a *transitional view* migration:
  besides adding the `missed` status to the `task_instances`/`task_masters` CHECK constraints and a
  `completed_at` column (+ backfill from `updated_at` for terminal rows), its `up()` **drops and
  recreates the `tasks_v` view** so the unified template+instance read model exposes the new
  `completed_at` column. Schema changes that alter the shape of `tasks_v` MUST recreate the view in
  the same migration (DROP VIEW IF EXISTS → CREATE VIEW) so the read model never lags the tables.
- **Policy: never edit an already-applied migration.** Migrations are immutable once they have run
  in any shared environment. To change a schema, add a **new** migration — editing an applied file
  leaves environments that already ran the old version silently inconsistent (knex records it as
  applied and will not re-run it). Beware idempotent rename/`hasColumn` guards: they silently no-op
  if the table/column name is wrong, so verify the target exists rather than assuming the guard ran.
- **View migrations (999.1189/999.1096):** migrations that reshape `tasks_v`/`tasks_with_sync_v`
  must `require('../migration-helpers')` for `portableViewSql`/`replaceAll`/`countOccurrences`
  (do NOT paste another copy; the shared helper also preserves the view's `SQL SECURITY` clause),
  string-patch the LIVE definition (never restate the full SELECT — the five-times-recurred
  silent-column-drop trap), and then regenerate the canonical view SSOT
  (`juggler-backend/src/db/views/`, via `node scripts/regenerate-canonical-views.js` against a
  freshly migrated `*_test` DB). `tests/migrations/view-column-contract.test.js` FAILS until the
  migrated schema and the SSOT agree, and the per-test-file view restore reads the same SSOT.

## Scheduler — Critical Architecture

**Core principle:** See R11 for the complete scheduling algorithm (slack-sorted single-pass with 6 placement modes, 7 phases, 4-level fallback ladder).

**Task type terminology** (use these exact terms):
| Term | Meaning |
|------|---------|
| `one-off` | Single standalone task |
| `chain member` | Task linked in a dependency chain |
| `recurring instance` | One occurrence of a repeating task |
| `split chunk` | A piece of a task split across time blocks |

**Recurring tasks:** See R32 (instance lifecycle, incl. day-lock placement) and R33 (rolling anchor) for complete behavior rules.

**⚠️ Caution:** Scheduler bugs cascade and corrupt all task data. Test exhaustively before deploying any scheduler change. The `unifiedScheduleV2.js` is the main entry point.

## Scheduler Key Files
| File | Purpose |
|------|---------|
| `src/scheduler/unifiedScheduleV2.js` | Main scheduler entry point |
| `src/scheduler/runSchedule.js` | Schedule execution runner |
| `src/scheduler/scheduleQueue.js` | Event queue |
| `src/scheduler/reconcileOccurrences.js` | Recurring instance reconciliation |
| `src/scheduler/dependencyHelpers.js` | Chain/dependency resolution |
| `juggler-backend/docs/SCHEDULER-SPEC.md` | Full design doc (SCHEDULER.md is superseded) |
| `juggler-backend/docs/architecture/SCHEDULER-RULES.md` | Behavior rules |
| `juggler-backend/docs/TASK-PROPERTIES.md` | All task fields |
| `juggler-backend/docs/TASK-STATE-MATRIX.md` | Valid state transitions |

## Calendar Sync
GCal, MSFT, and Apple (CalDAV) sync are implemented. Known remaining issues: DB contention on simultaneous syncs, split task part sync.

Soak test docs:
- `juggler-backend/docs/SYNC-SOAK-TEST-GCAL.md` — GCal (completed 2026-04-25)
- `juggler-backend/docs/SYNC-SOAK-TEST-MSFT.md` — MSFT (A-section completed 2026-04-26; B–D pending manual Outlook)
- `juggler-backend/docs/SYNC-SOAK-TEST-APPLE.md` — Apple (partial 2026-04-26; blocked by repush loop bug — do **not** use the Family Calendar)

**Apple soak status (2026-04-26):**
- Bug #1 (UUID rows): FIXED — 121 old-format rows deleted.
- Bug #2 (repush loop): FIXED — `miss_count >= 1` guard added to C2-fix path.
- B1 (pull): ✅ PASS. B5 (MISS_THRESHOLD for native tasks): ✅ PASS. D (stability): ✅ PASS.
- Open: B2/B3/B4 (CDN lag + multi-provider interference), C1/C2/C4 (pending).
- New bugs: #4 multi-provider MISS_THRESHOLD interference, #5 concurrent-sync duplicate active rows.

**Fix applied 2026-04-26:** `buildMsftEventBody` and `buildAppleEventBody` now include `task.url` as "Link: …" (matched GCal behavior)

Integration test credentials go in `juggler-backend/.env.test` (gitignored).
See `juggler-backend/.env.test.example` for required vars.

**Running tests directly (`DB_PORT=3407 jest`):** `.env.test` is per-dev and gitignored —
copy `juggler-backend/.env.test.example` → `juggler-backend/.env.test` first. The test-bed
MySQL root password is `rootpass` (already set in the example). Without a `.env.test` that
reaches the DB, DB-backed suites fail the TEST-FR-001 reachability guard. (`make test-juggler`
provisions this for you; the manual copy is only needed for direct `jest` runs.) (999.355)

## AI Enrichment
See R15 for AI feature requirements (natural-language commands, emoji/icon suggestions, bulk project creation).

## MCP Server
MCP is served by `juggler-backend` over Streamable HTTP — `POST /api/mcp` (canonical, path-consistent with resume-optimizer) and `POST /mcp` (legacy alias; the prod claude.ai StriveRS connector is registered there — keep until that registration is repointed). Two auth doors (999.2158 ruling): OAuth access-JWTs exclusively for claude.ai remote connectors; auth-service `mcp` API keys for local clients (Claude Code / Desktop / scripts). Server + tools: `juggler-backend/src/mcp/`; contract tests: `juggler-backend/tests/mcp-api-alias-parity.test.js`.

The former `juggler-mcp/` standalone stdio client was DELETED (999.2158, 2026-07-21): it called the REST API, which accepts JWKS-verified JWTs only, so MCP API keys 401'd on every tool call, and its tool surface duplicated the backend MCP's. The 999.1118 two-package SDK version policy died with it — `@modelcontextprotocol/sdk` now lives in juggler-backend alone.

## Approved Fallbacks

| Location | Fallback | Reason | Approved |
|----------|----------|--------|---------|
| `juggler-frontend/src/components/tasks/TaskDetailHeader.jsx` line 142 | `project ?? ''` | React fires a console.error if a controlled `<select>` receives `null` as value. The parent (`TaskEditForm`) always passes a string, but `??` prevents the warning if `project` is ever null/undefined (e.g., legacy task rows). `??` not `\|\|` — empty string `""` (no project) passes through unchanged. | Oscar review 2026-05-26 (zoe BLOCK-2) |
| `juggler-backend/src/slices/user-config/facade.js` `importBuildTaskRow` | terminal status + no placement → `scheduled_at = completedAt`, else `status = ''` | Import normalization for legacy exports holding terminal-status tasks that were never placed — inserting verbatim violates `chk_task_instances_terminal_scheduled` and 500s the whole import. Reproduces the constraint migration's (20260527213906) backfill policy exactly. Status list matches the CHECK constraint, NOT shared TERMINAL_STATUSES ('pause' excluded). | harrison+law review 2026-07-13 (both clean) |
| `juggler-frontend/src/components/tasks/TaskDetailHeader.jsx` line 145 | `allProjectNames \|\| []` | `TaskDetailHeader` is a presentational component that can be rendered in test environments or outside `TaskEditForm` without the `allProjectNames` prop. The `|| []` prevents a `.map` crash in those contexts. The canonical usage path (via `TaskEditForm`) always supplies the prop. | Oscar review 2026-05-26 (ernie W1 WARN — approved, code unchanged) |
| `juggler-frontend/src/components/tasks/TaskDetailHeader.jsx` line 186 | `notes \|\| ''` | Pre-existing guard. `notes` field on legacy task rows may be null in the DB. Textarea `value` must be a string; null causes a React controlled-component warning. | Oscar review 2026-05-26 (ernie W3 — pre-existing, approved) |
| `juggler-frontend/src/components/tasks/TaskDetailHeader.jsx` line 192 | `url \|\| ''` | Pre-existing guard. Same rationale as `notes \|\| ''` — `url` may be null in legacy DB rows; input `value` must be a string. | Oscar review 2026-05-26 (ernie W3 — pre-existing, approved) |
| `juggler-backend/src/routes/billing-webhooks.routes.js` line ~15 | `BILLING_WEBHOOK_SECRET \|\| INTERNAL_SERVICE_KEY` | The webhook signature secret falls back to the shared internal service key. Juggler and payment-service share one internal HMAC secret in deployments where a dedicated `BILLING_WEBHOOK_SECRET` is not separately provisioned; the fallback lets signature verification work with either. If **neither** is set the middleware hard-fails the request (500) — no silent unverified path. | Documented here per 999.368 |
| `juggler-backend/src/lib/audit-context.js` `getActor()` | armed test-default actor `'jest'` (TEST-ONLY) | The 999.1576 strict who-attribution flip makes every stamped write throw without an ambient actor. Jest sandboxes arm a module-level default actor (`test-helpers/armAuditTestActor.js`, setupFilesAfterEnv) so test-driven writes attribute `'jest'` instead of exploding in every suite — synchronous module state, NO AsyncLocalStorage propagation (three ALS designs disproven under jest's sequencer, inc.4b; do not retry them). Production is unaffected: `_armTestDefaultActor` throws outside a jest sandbox (`JEST_WORKER_ID` gate), so no-actor writes still fail loudly. `_runWithoutActor` suppresses the default for production-behavior assertions. | David sign-off 2026-07-19 (999.1576 inc.4 approved test-only fallback) |
| `juggler-backend/src/slices/user-config/application/queries/GetConfig.js` self-heal block | missing/invalid `schedule_templates` (whole trio) or an independently invalid `template_defaults`/`template_overrides` → served AND persisted as the server-side defaults (`domain/defaultTemplates.js`), not the legacy `\|\| null` | UpdateConfig previously guarded only key-name + 100KB size — any JSON shape landed in the schedule-template trio unchecked (dev-DB evidence: `schedule_templates.weekday.blocks` collapsed to a `loc`-less block, `locOverrides` wiped, accepted+persisted without complaint). Rather than serve/re-serve corrupt or absent config forever, GetConfig heals it to the defaults ONE TIME per corruption and persists the repair (`repo.upsertConfig` + `cache.invalidateConfig`) — the corruption is fixed, not masked. | David directive 2026-07-21 (999.2144) |

## Open Work
Canonical backlog: the monorepo JSON store `.planning/backlog/backlog.json` (query via jq; mutate ONLY via `~/.claude/skills/_backlog/backlog-add.sh`). The old `.planning/ROADMAP.md` `## Backlog` section is just a pointer now; per-service `BACKLOG.md` files are removed. Check before starting any new work.
