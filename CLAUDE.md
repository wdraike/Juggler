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

## Schedule-Template Storage (999.2146)

**Canonical trio** (the schedule-template config a user edits via Settings → Templates):
`schedule_templates` (templateId → `{name, icon, system, blocks[], locOverrides}`),
`template_defaults` (Mon..Sun → templateId), `template_overrides` (YYYY-MM-DD →
templateId, for one-off date exceptions). Write validation, self-heal-on-read, the
reset endpoint, and system-template delete protection all live in
`juggler-backend/src/slices/user-config/`:
`domain/logic/scheduleTemplateValidation.js` (shape + ref validators),
`domain/defaultTemplates.js` (server-side default/fallback builders),
`application/queries/GetConfig.js` (self-heal), `application/commands/UpdateConfig.js`
(write validation, incl. the 999.2146 system:true delete guard — dropping a `system:true`
template's id from an incoming `schedule_templates` write is a 400; renaming, same id, is
fine), `application/commands/ResetScheduleTemplates.js` (`POST /config/templates/reset`
restores the two system templates, `weekday`/`weekend`).

**Legacy keys** (`time_blocks`, `loc_schedules`, `loc_schedule_defaults`,
`loc_schedule_overrides` — still in `UserConfig.VALID_KEYS`, still writable via
`PUT /config/:key`) are **derived, not user-edited**, since 999.2145: the Templates tab
(`UnifiedTemplateTab.jsx`) writes only the canonical trio; `useConfig.js`'s
`updateScheduleTemplates`/`updateTemplateDefaults`/`updateTemplateOverrides` re-derive and
persist the legacy keys as a byproduct on every edit (`deriveTimeBlocks`/
`deriveLocSchedules`). The three DIRECT legacy writers (`updateLocSchedules`/
`updateLocScheduleDefaults`/`updateLocScheduleOverrides`) were DELETED in 999.2146 (zero
remaining callers); `updateTimeBlocks` survives — `AppLayout.jsx`'s AI-ops handler
(`set_weekly`/`set_block_loc`/`set_blocks`/`clone_blocks`) edits the raw per-weekday
`time_blocks` map directly and does not map cleanly onto templateId-keyed edits.

**IMPORTANT — the legacy keys are NOT dead for the scheduler.** The Settings UI
(`initFromConfig`) re-derives `timeBlocks`/`locSchedules` fresh from the canonical trio on
every load, ignoring the raw DB rows entirely — but the BACKEND SCHEDULER does not:
`loadSchedulerConfig.js`'s `assembleSchedulerCfg` reads `cfg.timeBlocks`/`cfg.locSchedules`
straight off the legacy `time_blocks`/`loc_schedules` rows, with no re-derivation step of
its own, and `unifiedScheduleV2.js` (the real placement path, not just display) consumes
both directly. **Resolution order actually used today:**
1. `getBlocksForDate` (`shared/scheduler/timeBlockHelpers.js`) — a `template_overrides`-style
   date match (read via the legacy-named `cfg.locScheduleOverrides` field, kept
   content-identical by the frontend's dual-write) → that template's blocks.
2. Else: the raw legacy per-weekday `time_blocks` map (`blocksMap[dayName]`) — this is
   where `template_defaults` actually takes effect today, ONLY because the frontend
   pre-resolves `template_defaults` into `time_blocks` on every save. The scheduler never
   reads `cfg.templateDefaults` directly (it isn't even assembled into scheduler cfg).
3. `resolveLocationId` (`shared/scheduler/locationHelpers.js`) mirrors this for per-minute
   location: `cfg.locSchedules[templateId].hours` (date-override or
   `cfg.locScheduleDefaults[dayName]`), else the block's own `.loc`, else `"home"`.

**Unknown-ref fallback (SUB-207a):** an override date resolving to a templateId absent from
`schedule_templates` (a dangling ref — legacy pre-existing bad rows, or a since-deleted
non-system custom template; system templates can't be deleted, see above) falls through to
the day-of-week blocks rather than a zero-capacity day, and logs a `console.warn` naming the
date + dangling id (999.2146; the write-side guards only prevent *new* dangling refs, not
ones already in the DB or created by deleting a non-system template later).

**Repair migration:** `20260721120000_rebuild_stale_legacy_schedule_config.js`
one-time-rebuilds (not deletes — see its header for the evidence trail) `time_blocks`/
`loc_schedules` from the canonical trio for every user whose stored `schedule_templates`
passes validation, clearing the dev-DB-evidenced split-brain (a `loc_schedules` row from
the pre-2145 Custom-lump tab, stale next to an intact `schedule_templates`). Idempotent;
skips users with a missing/invalid `schedule_templates`; leaves
`loc_schedule_defaults`/`loc_schedule_overrides` untouched (independently load-bearing and
already dual-written on every edit, so they don't accumulate the same one-time staleness).

**Known follow-up (not fixed by 999.2146 — flagged, not improvised):** wiring
`template_defaults`/`template_overrides` directly into the scheduler's assembled cfg (so
`getBlocksForDate` consults them instead of relying on the frontend's legacy-key
dual-write side channel) would make the legacy keys genuinely dead and let a future
migration delete rather than rebuild them. Deferred — it touches the scheduler's primary
placement path (`unifiedScheduleV2.js`) and needs its own TDD + golden-master pass, not a
drive-by inside a "storage" ticket.

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
