# Juggler — Claude Instructions

## Stack
React (port 3002) | Node.js/Express (port 5002) | MySQL + Knex.js | MCP server (`juggler-mcp/`)

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
| `juggler-backend/docs/SCHEDULER.md` | Full design doc |
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
`juggler-mcp/` exposes juggler tasks to external MCP clients (e.g. ClimbRS). Changes here affect the ClimbRS integration.

**SDK version policy (999.1118):** `juggler-backend` and `juggler-mcp` are separate packages — juggler-mcp is a lightweight stdio client, juggler-backend is the full HTTP server. Both depend on `@modelcontextprotocol/sdk`. Keep both on the **same `^1.x` range** (currently `^1.27.1`) to prevent the version-drift class of bugs where SDK behavior differs between the two packages. When upgrading the SDK, bump both package.json files in the same commit.

## Approved Fallbacks

| Location | Fallback | Reason | Approved |
|----------|----------|--------|---------|
| `juggler-frontend/src/components/tasks/TaskDetailHeader.jsx` line 142 | `project ?? ''` | React fires a console.error if a controlled `<select>` receives `null` as value. The parent (`TaskEditForm`) always passes a string, but `??` prevents the warning if `project` is ever null/undefined (e.g., legacy task rows). `??` not `\|\|` — empty string `""` (no project) passes through unchanged. | Oscar review 2026-05-26 (zoe BLOCK-2) |
| `juggler-frontend/src/components/tasks/TaskDetailHeader.jsx` line 145 | `allProjectNames \|\| []` | `TaskDetailHeader` is a presentational component that can be rendered in test environments or outside `TaskEditForm` without the `allProjectNames` prop. The `|| []` prevents a `.map` crash in those contexts. The canonical usage path (via `TaskEditForm`) always supplies the prop. | Oscar review 2026-05-26 (ernie W1 WARN — approved, code unchanged) |
| `juggler-frontend/src/components/tasks/TaskDetailHeader.jsx` line 186 | `notes \|\| ''` | Pre-existing guard. `notes` field on legacy task rows may be null in the DB. Textarea `value` must be a string; null causes a React controlled-component warning. | Oscar review 2026-05-26 (ernie W3 — pre-existing, approved) |
| `juggler-frontend/src/components/tasks/TaskDetailHeader.jsx` line 192 | `url \|\| ''` | Pre-existing guard. Same rationale as `notes \|\| ''` — `url` may be null in legacy DB rows; input `value` must be a string. | Oscar review 2026-05-26 (ernie W3 — pre-existing, approved) |
| `juggler-backend/src/routes/billing-webhooks.routes.js` line ~15 | `BILLING_WEBHOOK_SECRET \|\| INTERNAL_SERVICE_KEY` | The webhook signature secret falls back to the shared internal service key. Juggler and payment-service share one internal HMAC secret in deployments where a dedicated `BILLING_WEBHOOK_SECRET` is not separately provisioned; the fallback lets signature verification work with either. If **neither** is set the middleware hard-fails the request (500) — no silent unverified path. | Documented here per 999.368 |

## Open Work
Canonical backlog: the monorepo `.planning/ROADMAP.md` `## Backlog` (per-service `BACKLOG.md` removed — backlog is single-source) — check before starting any new work.
