---
type: changelog
status: active
Last-updated: 2026-07-02
version: leg/juggy4 @ 2026-07-02
---

# Changelog

All notable changes to juggler-backend are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Docs

- **Scheduler doc supersession sweep** (sched-audit L1, 2026-07-02): reconciled 8 scheduler docs that
  still described pre-juggy4 or otherwise-superseded behavior as current. Corrected stale "dual-placed
  on grid" / "force-placed at original date" claims in `SCHEDULER-RULES.md` and
  `TASK-CONFIGURATION-MATRIX.md` to match the unscheduled-overdue contract; banner-marked
  `SCHEDULER-VISUAL.md` as a v1 design-reference and flagged its "bump lower-priority task"
  mechanism REJECTED-in-v2; fixed `SCHEDULER-SPEC.md`'s stale "no R32.7" note (R32.7/R32.8 are now
  real, per `docs/REQUIREMENTS.md`), its stale weather fail-open contradiction note (code + tests are
  already fail-closed), and its stale auto-miss description (removed 2026-06-24 per David's ruling —
  scheduler no longer auto-applies terminal `status:'missed'`; past-incomplete recurring instances now
  stay non-terminal via `overdue`/`unscheduled` flags); added a requirement-ID namespace disclaimer to
  `RECURRING-SPACING-REQUIREMENTS.md` (its local R1–R8 collide with canonical `REQUIREMENTS.md` R1–R8;
  not renumbered per scope); added a STALE banner to `SCHEDULER-TRACEABILITY-REPORT.md` (cites 5
  deleted test files, 6 wrongly-"MISSING" requirements now covered — full regeneration deferred to
  after the L4 test-repair leg); fixed `TASK-STATE-MATRIX.md`'s stale "pause deletes future instances"
  claim (pause cascades `status='pause'`, keeps instances); retired `SCHEDULER-AUDIT-REQUIREMENTS.md`
  (orphaned pre-v2 requirements register, superseded by `SCHEDULER-SPEC.md`/`REQUIREMENTS.md`). No
  code changes. Full per-file detail: `.planning/kermit/sched-audit/reviews/L1-DOCS-CHANGELOG.md`.

- **Final sched-audit docs alignment — David's D-A/D-B/D-C rulings + REG-26 registered** (leg
  sched-audit, L5, 2026-07-02): `docs/REQUIREMENTS.md` R50.1 gets a second amendment closing REG-12/Q1
  (David's D-A ruling: a never-placed one-off with a real deadline now follows the SAME
  pin-to-deadline/never-roll-forward rule juggy4 already gave recurring/split, `unifiedScheduleV2.js:
  1479-1483,2670-2695` + `runSchedule.js:2118-2130`, `tests/scheduler/sched-audit-da-oneoff.test.js`
  8/8 GREEN); 3 new sub-requirements registered — **R50.9** (D-B: Unscheduled-lane rows are resolvable
  in place, done/skip/cancel enabled directly; frontend confirmed shipped, **a backend gap was found
  during this verification pass and is NOT fixed here** — `UpdateTaskStatus.js`'s
  `TERMINAL_REQUIRES_SCHEDULE` guard still 400s for any non-`rolling`-cadence unscheduled row, referred
  to ernie/backlog), **R50.10** (D-C: force-placed rigid/FIXED slots now reserved against scheduler
  intrusion, reminders coexist, rigid-vs-rigid explicit double-book still allowed, overdue rigid stays
  pinned + listed — `unifiedScheduleV2.js:2590-2627`, closes REG-24/a3-02, `tests/scheduler/
  sched-audit-dc-rigid.test.js` 8/8 GREEN), and **R50.11** (the previously-unregistered OVD-1..4
  forward-roll subsystem, REG-17 — fully shipped, live product behavior; REG-26's roam-retry fix
  folded in: `unifiedScheduleV2.js:1934-1978` scopes the Phase-3 dead-end to `!isFlexibleTpc` so
  flexible-TPC items roam forward within their cycle instead of dead-ending, and
  `computeEffectiveDeadline` (`runSchedule.js:235-241`) was flipped from `max()` to the locked `min()`,
  closing the F9 doc↔code contradiction — `tests/scheduler/sched-audit-reg26-roam.test.js` +
  `tests/unit/scheduler/effective-deadline.test.js` + `tests/scheduler/instance-date-rules.test.js`,
  all GREEN as of 2026-07-02). Added an "OPEN QUESTIONS" subsection under R50 listing 4 still-unruled
  empty cells A1 flagged (all_day+overdue, chain-member+overdue, weather-blocked+deadline-passed,
  cal-sync-lock+overdue) — deliberately NOT authored as requirements pending David's ruling.
  `docs/architecture/SCHEDULER-SPEC.md` §C (Overdue/Forward-Roll subsystem) reconciled to match: the
  `min()` effective-deadline text was already correct (code was wrong, now fixed — no more doc↔code
  contradiction to annotate); the OVD-1–OVD-4 entries and their WIP/OPEN-BLOCK statuses (stale since
  the `60835fe` research pass) updated to IMPLEMENTED/CLOSED with a RESOLVED note preserving the
  original research trace; the Phase-3 (missed-preferred-time) and Phase-6 (rigid-forced) sections
  updated with the REG-26 re-present mechanism and the D-C reservation semantics respectively. No code
  changes from this leg (docs-only; the code changes it documents were made by prior sched-audit
  legs/bert runs, cited above). Full detail: `.planning/kermit/sched-audit/reviews/L5-DOCS-CHANGELOG.md`.

### Fixed

- **Overdue recurring/split tasks no longer bunch/overlap on the grid** (leg juggy4, ROADMAP, 2026-07-02): the scheduler's Phase 4 (`missedWindowItems`) and Phase 5 (`pastAnchoredRecurrings`) rescue passes previously force-placed overdue recurring tasks straight onto the calendar with zero occupancy check, so two unrelated overdue tasks could land at the identical date+time and render as overlapping/bunched entries. Per David's product ruling, once a recurring or split task's flex window/anchor date has passed (it cannot move forward anymore), it now shows as **unscheduled-overdue, pinned to its deadline date** instead of being force-placed on the grid — never rolled forward. Overdue split-task chunks each persist as their own DB row (no merge/delete, per the existing separate-rows ruling); the calendar UI already merges same-master chunks into one visible entry. Fixed/ingested calendar events and rigid/fixed recurring tasks are unaffected — this only changes flexible/TIME_WINDOW recurring and split tasks once they go overdue.

### Added

- **Server time endpoint** (`GET /api/now`, ROADMAP 999.809): returns the server's canonical current time as `{ epochMs, iso }`. The frontend uses this to compute a clock offset and pass it into `getNowInTimezone`'s injectable clock, eliminating client-clock skew from overdue-status calculations (R50.8 family). Requires JWT; not rate-limited. See `docs/api/README.md` §"Server Time" for full reference.

- **CSV export** (`GET /api/data/export?format=csv`, ROADMAP 999.254): the export endpoint now accepts an optional `format=csv` query parameter. The response is `text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="juggler-tasks.csv"`. The body is the authenticated user's tasks as RFC-4180 CSV (18 fixed columns; array fields joined with `;`; `\r\n` line endings). The default behaviour (`format=json` or no parameter) is unchanged — the v7 JSON backup envelope is returned exactly as before. The CSV path reuses the same `authenticateJWT` + `requireFeature('data.export')` gate and `userId`-scoped data fetch as the JSON path; no new route or data source is added.

- **CSV import** (`POST /api/data/import` with `Content-Type: text/csv` or `?format=csv`, ROADMAP 999.255): the import endpoint now accepts an RFC-4180 CSV body in the same 18-column format produced by the CSV export. Import is always **additive (merge mode)** — mode is hard-forced to `merge` in the controller; existing tasks and configuration are never wiped. Imported rows are inserted as new tasks with freshly fabricated ids (no collision). Malformed CSV (unbalanced quotes, ragged row, missing `text` header column) returns `400` with `{ "error": "Invalid CSV: … " }` and zero DB writes. No feature gate — available on all plans. 2 MB body cap (shared with the JSON path). **Known limitation:** a `location` or `tools` name containing `;` is not round-trip-safe (the `;` is the array separator). See `docs/api/README.md` §"POST /api/data/import — CSV path" for full reference.
