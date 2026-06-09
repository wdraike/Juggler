---
type: architecture
service: juggler
status: active
last_updated: 2026-06-09
tags:
  - type/architecture
  - service/juggler
  - status/active
  - hexagonal
  - review
---

# Juggler Backend — Architecture Review (June 2026)

**Date:** 2026-06-09
**Reviewer:** cookie (architecture-reviewer muppet), mode `chore`, scope `juggler-backend/src`
**Method:** Every quantitative claim below was produced by a real command run against the live code on branch `leg/juggler-hex-redesign` and the command is cited inline. The Jan-2026 `JUGGLER-HEX-REVIEW.md` (5 months stale) was **not** trusted for any number; several of its figures are confirmed wrong below (see §5).

> **Headline:** Five months after the Jan-2026 plan, hexagonal execution is still ~5%. Infra-lib scaffolding (`lib/db`, `lib/events`, `lib/logger`) was created 2026-05-28 but is mostly unadopted; the calendar slice is still a README + four empty dirs; and an ESLint boundary config (2026-05-31) guards a slice that doesn't exist. Meanwhile the two largest controllers and the scheduler **grew** in absolute size. The scheduler remains the core, highest-risk domain.

---

## 1. Verified current directory / layer map

Command:
```bash
find juggler-backend/src -maxdepth 1 -type d | sort
for d in */; do find "$d" -type f -name '*.js' | wc -l; done   # per-dir JS counts
```

```
juggler-backend/src/
├── app.js                 (305 lines)      — Express app wiring
├── server.js              (183 lines)      — HTTP bootstrap
├── db.js                  — Knex singleton (the pre-hex DB access point; 35 importers, §3)
├── controllers/   (13 .js, 7,792 lines)   — MVC controllers; bulk of business logic
├── scheduler/     (13 .js, 5,370 lines)   — CORE DOMAIN, highest risk (§6)
├── routes/        (19 .js)                — Express routers (0 direct DB calls — clean)
├── lib/           (25 .js)                — mixed infra + adapters + hex scaffolding
│   ├── db/index.js         (74 ln)        — hex DB lib, 1 consumer (dead-ish)
│   ├── events/index.js     (634 ln)       — hex event bus, 0 importers (DEAD)
│   ├── logger/index.js     (424 ln)       — hex logger, 7 importers (adopting)
│   ├── redis.js            (143 ln)       — standalone cache client, 8 importers
│   └── cal-adapters/{apple,gcal,msft}.adapter.js — real calendar adapters
├── middleware/    (7 .js)                 — jwt-auth, feature-gate, entity-limits, validate…
├── mcp/           (7 .js)                 — MCP server tools (tasks/schedule/config/data)
├── services/      (3 .js)                 — ai-usage-flusher/queue, gemini-tracked-call
├── slices/        (1 file)               — slices/calendar/README.md ONLY (§4)
├── db/            (146 migration files)   — Knex migrations (no non-migration .js)
├── cron/          (1 .js)                 — cal-history-cron (the ONLY lib/db consumer)
├── jobs/ schemas/ constants/ calendar/ keys/ scripts/ __tests__/
```

Totals (command `find src -name '*.js' ! -path '*/migrations/*' ! -path '*/__tests__/*' | wc -l` → 102 files; `… -exec cat | wc -l` → 23,614 LOC).

**Layering verdict:** Classic monolithic MVC (routes → controllers → `db.js` singleton). No domain ring, no ports, no DI. `routes/` is clean (0 `getDb(`/`trx(` — command `grep -rE "getDb\(|trx\(" routes/*.js | wc -l` → 0); all DB coupling lives in `controllers/` and `scheduler/`.

---

## 2. Per-domain current-state table (all six domains)

Line counts from `wc -l`; DB-coupling from `grep -Ec 'getDb\(|trx\('` (or `getDb\(|\bdb\(` for scheduler, which uses a `db()` accessor). All commands re-run 2026-06-09.

| Domain | Primary files | Lines | DB-coupling (getDb/trx/db) | Hex-readiness verdict |
|--------|---------------|-------|-----------------------------|------------------------|
| **Scheduler** (core) | `scheduler/runSchedule.js` (2,309), `unifiedScheduleV2.js` (1,827), `scheduleQueue.js` (368), `schedulerSession.js` (281), `scoreSchedule.js` (181), `reconcileOccurrences.js` (126), +6 | **5,370** (13 files) | **42** total (`scheduleQueue` 11, `runSchedule` 15, `schedulerSession` 7 → 33 `db()/getDb(`; +9 `trx(`) | 🟥 **0% hex.** No `ConstraintSolver`/`ScoreEngine` pure core, no `TaskProviderPort`/`CalendarProviderPort`, no DI. Procedural + DB-coupled. Highest-risk extraction (§6). |
| **Task** | `controllers/task.controller.js` (2,432), `routes/task.routes.js`, `lib/tasks-write.js`, `lib/task-write-queue.js`, `lib/task-status.js` | 2,432 (controller) | **66 `getDb(` + 12 `trx(`** in task.controller.js | 🟥 **0% hex.** No `slices/task`. Monolith controller; entity/repo-port/facade all absent. |
| **Calendar-sync** | `controllers/cal-sync.controller.js` (2,543), `apple-cal` (470), `msft-cal` (212), `gcal` (177), `cal-sync-helpers` (247); `lib/cal-adapters/{apple,gcal,msft}.adapter.js` (347/403/476), `lib/{apple,gcal,msft}-cal-api.js`, `lib/sync-lock.js`, `lib/reconcile-splits.js` | ~6,485 across cal files | **93** in the 4 cal controllers (cal-sync 33, apple-cal 40, msft-cal 11, gcal 9); adapters themselves = 0 | 🟡 **~10% — "adapters in spirit".** Real adapters isolated in `lib/cal-adapters/` (good), but imported **directly** by controllers — no `CalendarPort` interface, no `facade.js`, no DI, no `InMemoryCalendarAdapter`. Cleanest next slice. |
| **Weather** | `controllers/weather.controller.js` (279) | 279 | **5** (`getDb(`/`trx(`) | 🟥 **0% hex** but smallest/cleanest. Self-contained: Open-Meteo + Nominatim fetch + cache table. No `slices/weather`. Good first vertical-slice candidate by size. |
| **AI-enrichment** | `controllers/ai.controller.js` (169), `services/ai-usage-flusher.service.js` (103), `ai-usage-queue.service.js` (31), `gemini-tracked-call.js`, `routes/ai.routes.js`, `routes/task.routes.js` (enrich path) | ~303 + routes | **3** in ai.controller | 🟥 **0% hex + SDK leak.** `@google/genai` is instantiated **directly in `controllers/ai.controller.js:28-38` AND `routes/task.routes.js:39-48`** — model-provider SDK in the controller/route layer, no `LLMPort`. (§6, hex BLOCK-class for a real migration; WARN here as chore.) |
| **User/Config** | `controllers/config.controller.js` (407), `data.controller.js` (276), `billing-webhooks.controller.js` (222), `feature-catalog.controller.js` (202), `impersonation.controller.js` (156) | 1,263 | config 28, data 13, billing 12, impersonation 3, feature-catalog 0 | 🟥 **0% hex.** No slice. Config/entitlement logic spread across 5 controllers + middleware (`feature-gate`, `plan-features`, `entity-limits`). |

---

## 3. Infrastructure-lib adoption table

Importer counts from `grep -rln "lib/<x>" --include='*.js' src | grep -v node_modules | grep -v '<x>/index.js' | wc -l` (path-based, self excluded). Existence from `ls`.

| Lib | Exists? | Size | Non-self importers | Verdict |
|-----|---------|------|--------------------|---------|
| **lib-db** (`lib/db/index.js`) | ✅ | 74 ln / 1,838 B | **1** (`cron/cal-history-cron.js`) | 🟡 **Extraction-without-migration.** Created 2026-05-28; the legacy `src/db.js` singleton still has **35 importers** (see below). lib-db is effectively unadopted. |
| **lib-logger** (`lib/logger/index.js`) | ✅ | 424 ln / 13,011 B | **7** (`ai`/`data`/`cal-sync-helpers` controllers, `cron`, `server.js`, 2 ai-usage services) | 🟡 **Adopting.** Partial — most controllers still on ad-hoc logging. Real progress vs Jan. |
| **lib-config** | 🟥 absent | — | — | **Absent.** No `src/lib/config`. Config read directly from `process.env` across the codebase. |
| **lib-cache** | 🟥 absent | — | — | **Absent as a port.** `lib/redis.js` (143 ln, 8 importers) is a standalone client, **no CachePort** wrapping it. |
| **lib-events** (`lib/events/index.js`) | ✅ | 634 ln / 18,312 B | **0** | ☠️ **DEAD SCAFFOLDING.** Largest dead artifact — built 2026-05-28, never wired into a single consumer. Adopt-or-delete. |

**Legacy `src/db.js` singleton:** `grep -rEl "require\(['\"](\.\./)*db['\"]\)" --include='*.js' src | grep -v node_modules | wc -l` → **35 importers** (controllers ×12, routes ×5, mcp ×5, middleware ×4, scheduler ×3, lib ×4, tests ×2). This is the real DB access path; `lib/db` is the aspirational replacement with 1 consumer.

---

## 4. `src/slices/` actual contents

Command:
```bash
find juggler-backend/src/slices -type f      # → slices/calendar/README.md  (ONE file)
find juggler-backend/src/slices -type d
```
Result:
```
slices/
└── calendar/
    ├── README.md                 ← the only file
    ├── adapters/                 ← EMPTY
    └── domain/
        ├── ports/                ← EMPTY
        └── entities/             ← EMPTY
```
**No `CalendarPort.js`, no `facade.js`, no `InMemoryCalendarAdapter`, no entities.** Matches the Jan-status baseline exactly — zero forward motion in the slice itself.

---

## 5. Deltas since Jan-2026 `JUGGLER-HEX-REVIEW.md`

| Metric | Jan-2026 (REVIEW, untrusted) | June-2026 (verified) | Delta |
|--------|------------------------------|----------------------|-------|
| `task.controller.js` | 2,422 ln | **2,432 ln** | +10 (grew) |
| `task.controller.js` `getDb(` | 66 (per Hex-Status) | **66** | unchanged |
| `task.controller.js` `trx(` | 12 (per Hex-Status) | **12** | unchanged |
| `cal-sync.controller.js` (largest) | 2,547 ln | **2,543 ln** | −4 |
| `scheduler/runSchedule.js` | 2,197 ln | **2,309 ln** | **+112 (grew)** |
| `scheduler/unifiedScheduleV2.js` | 1,811 ln | **1,827 ln** | +16 |
| Scheduler total | 5,097 ln / 12 files | **5,370 ln / 13 files** | **+273 ln, +1 file** |
| Controllers total | 7,763 ln / 13 | **7,792 ln / 13** | +29 |
| Scheduler `db()/getDb(` | 33 (Hex-Status) | **33** | unchanged |
| `db.js` singleton importers | ~38 (Hex-Status) | **35** | −3 |
| `lib/db` consumers | 1 | **1** | unchanged |
| `lib/events` importers | 0 (dead) | **0** | unchanged (still dead) |
| `lib/logger` importers | 7 | **7** | unchanged |
| `lib/config`, `lib/cache` | absent | **absent** | unchanged |
| `slices/calendar` | README + empty dirs | **README + empty dirs** | unchanged |
| eslint.boundaries.config.js | orphan (guards nothing) | **wired into `lint:boundaries`+`precommit`, still guards an empty slice** | now runs in CI but enforces a non-existent slice |

**Jan REVIEW figures proven WRONG (do not cite them):** the REVIEW listed `app.js` = 11,763 lines and `server.js` = 6,103 lines. Verified `wc -l`: **app.js = 305, server.js = 183.** Those Jan numbers were byte-counts or otherwise corrupt. The REVIEW also claimed "122 direct db() calls in controllers"; current verified controller DB-coupling totals are higher when summed across all 13 (task 78, cal cluster 93, config cluster 56, weather 5, ai 3) — the 122 figure is stale and was a partial count.

**Net change in 5 months:** infra libs created (2026-05-28) + eslint boundary config wired (2026-05-31) + logger partially adopted. No domain slice implemented. The two biggest files (task controller, scheduler) **grew**, so the migration surface is now slightly larger, not smaller.

---

## 6. Ranked architecture issues

| Rank | Severity | Issue | Evidence | Action |
|------|----------|-------|----------|--------|
| 1 | **CORE / HIGHEST-RISK** | **Scheduler is the largest, most-coupled, most-fragile domain and is 0% hex.** 5,370 ln across 13 files, 42 DB touchpoints, no pure core, no ports. | `wc -l scheduler/*.js`; `grep -E 'getDb\(\|db\(\|trx\(' scheduler/*.js \| wc -l` → 42 | Per `juggler/CLAUDE.md`: *"⚠️ Scheduler bugs cascade and corrupt all task data. Test exhaustively before deploying any scheduler change."* Treat any scheduler refactor as the highest-risk leg — extract pure `ConstraintSolver`/`ScoreEngine` behind `TaskProviderPort`/`CalendarProviderPort` with characterization tests FIRST. **Do this LAST in the migration order, not first.** |
| 2 | WARN | **Dead `lib/events` scaffolding (634 ln, 0 importers).** | `grep -rln lib/events … \| wc -l` → 0 | Adopt-or-delete decision before adding more infra. Drift risk. |
| 3 | WARN | **`lib/db` extracted but not adopted — 35 files still on the `db.js` singleton.** | 35 vs 1 importer | Either migrate the 35 consumers or document the singleton as the canonical DB home; the half-state is the worst of both. |
| 4 | WARN | **Model-provider SDK leak: `@google/genai` instantiated in `controllers/ai.controller.js:28` and `routes/task.routes.js:39`.** | `grep -rn 'GoogleGenAI' src` | In a real hex migration this is a BLOCK (infra SDK in domain/route layer). Route behind an `LLMPort`/`getLLMAdapter()`. Flagged WARN under chore mode (behavior-preserving review). |
| 5 | WARN | **ESLint boundary config guards a slice that doesn't exist.** `eslint.boundaries.config.js` forbids imports from `slices/calendar/{adapters,ports,entities}` — all empty. It now runs in `precommit` but enforces nothing real. | config lines 78-105; `find slices -type f` → README only | Harmless but misleading "green" signal. Keep, but understand it asserts nothing until the calendar slice exists. |
| 6 | WARN | **No timeout on external calls** (resilience). Weather `fetch()` to Open-Meteo/Nominatim and the Gemini call have no timeout/AbortController. | `grep -nE 'timeout\|AbortController' controllers/weather.controller.js controllers/ai.controller.js services/gemini-tracked-call.js` → none | Add explicit timeouts; an open-ended external call is a cascading-stall vector under Cloud Run. (REFER→ernie for per-call-site retry/idempotency.) |
| 7 | INFO | **Config domain scattered across 5 controllers + 3 middleware**, no config slice, `lib/config` absent. | §2 User/Config row | Lowest-leverage to slice; defer. |

`INFO REFER→ernie:` `controllers/ai.controller.js` / `controllers/weather.controller.js` — per-call-site timeout/retry/idempotency is code-correctness; cookie owns only the topology verdict (issue #6).
`INFO REFER→abby:` needs an ADR recording the adopt-or-delete decision for `lib/events` + the lib-db migration plan (issues #2, #3), and a `CalendarPort` C4 once the slice is designed.

---

## 7. Hex-readiness scorecard (% done per domain, with evidence)

| Domain | % hex done | Evidence basis |
|--------|-----------|----------------|
| Scheduler | **0%** | No ports, no pure core; 42 DB touchpoints; `grep` for `ConstraintSolver`/`ScoreEngine`/`Port` → none |
| Task | **0%** | No `slices/task`; 66 `getDb(` + 12 `trx(` in one controller |
| Calendar-sync | **~10%** | Adapters extracted to `lib/cal-adapters/` (0 DB calls in adapters) BUT no `CalendarPort`/`facade.js`; controllers import adapters directly; 93 DB calls in cal controllers |
| Weather | **0%** | No slice; 5 DB calls; self-contained (easiest first slice) |
| AI-enrichment | **0% (negative — SDK leak)** | `@google/genai` `new` in controller+route; no `LLMPort` |
| User/Config | **0%** | No slice; logic across 5 controllers + middleware; `lib/config` absent |
| **Infra libs** | lib-logger ~partial (7 importers); lib-db ~adopted 1/36; lib-events 0 (dead); lib-config/cache absent | §3 table |
| **Overall** | **~5%** | Matches the 2026-06-09 Hex-Status headline; the only forward motion since Jan is partial logger adoption + the (orphan) boundary config |

**Recommended migration order (lowest-risk → highest-risk):** Weather (smallest, self-contained) → Calendar Port (adapters already isolated) → Task → User/Config → **Scheduler LAST** (cascade-risk per CLAUDE.md). Adopt-or-delete `lib/events` and finish `lib-db` migration before adding new infra.

---

## Sign-off
Signed: Cookie — 2026-06-09 (mode `chore`, scope `juggler-backend/src`). Every metric above was grep/wc/ls/find-verified on branch `leg/juggler-hex-redesign`; the stale Jan-2026 REVIEW numbers were not trusted and two of them (app.js/server.js LOC) are corrected here.
