/**
 * Scheduler slice facade — the single public entry point (Phase H6 / W4).
 *
 * The scheduler slice's ONLY sanctioned import surface. External callers — the
 * MCP schedule tools (`src/mcp/tools/schedule.js`) and the schedule HTTP routes
 * (`src/routes/schedule.routes.js`) — require THIS module instead of reaching
 * into `src/scheduler/*` internals. It exposes the three public scheduler
 * operations those callers use:
 *
 *   runScheduleAndPersist(userId, ids, opts) — run the scheduler, persist the
 *     changed-row delta (S5), return { dayPlacements, unplaced, … }. (POST /run,
 *     MCP run_schedule.) Sourced from `src/scheduler/runSchedule.js`.
 *   deriveSchedulePlacements(userId, opts)   — read-only placement view DERIVED
 *     from the task read model (GET /api/tasks); does NOT mutate tasks. (MCP
 *     get_schedule.) Sourced from `src/scheduler/deriveSchedulePlacements.js`.
 *     Replaces the removed getSchedulePlacements + schedule_cache read path (W3/W4).
 *   unifiedScheduleV2(...)                   — the pure scheduling entry point
 *     used by the admin debug route to surface phase snapshots. Sourced from
 *     `src/scheduler/unifiedScheduleV2.js`.
 *
 * ── REFACTOR MODE — NO BEHAVIOR CHANGE ───────────────────────────────────────
 * This facade is THIN. It re-exports the existing entry-point functions verbatim
 * (same functions, same signatures) — it does NOT rewrite the scheduler. The
 * golden-master characterization suite pins schedule OUTPUT bit-for-bit; routing
 * the callers through the facade changes the IMPORT PATH only, never behavior.
 *
 * Mirrors the task/weather/calendar facade idiom (slices/task/facade.js,
 * slices/weather/facade.js): the slice's domain core, application orchestrator,
 * ports, and adapters are also surfaced as named exports for tests and any
 * future in-slice wiring.
 *
 * ── INVARIANT S4/S6 (facade does NOT pull scheduleQueue into the core) ────────
 * The facade fronts `runScheduleAndPersist` / `deriveSchedulePlacements` /
 * `unifiedScheduleV2` and the `RunScheduleCommand` application seam — NONE of
 * which import `scheduleQueue`. The mutation→schedule trigger (scheduleQueue)
 * stays OUTSIDE this surface; the golden-master S4/S6 static require-closure
 * asserts that `RunScheduleCommand` is not in the scheduleQueue closure, and the
 * facade does not introduce that edge. The schedule routes still import
 * `enqueueScheduleRun` directly from `scheduler/scheduleQueue` for the /nudge
 * endpoint — that is the trigger seam, deliberately NOT routed through this
 * facade (it is not a scheduler-core operation).
 *
 * ── H7 (not this wave) ── the legacy `src/scheduler/runSchedule.js` and
 * `src/scheduler/unifiedScheduleV2.js` files REMAIN; the facade fronts them.
 * Thinning/deleting those files, the per-slice eslint boundary rule, and closing
 * the remaining inline writes in runSchedule.js are H7 boundary-hardening work.
 */

'use strict';

// ── legacy entry points the facade fronts (re-exported verbatim) ─────────────
var runSchedule = require('../../scheduler/runSchedule');
var unifiedScheduleV2 = require('../../scheduler/unifiedScheduleV2');
var { deriveSchedulePlacements } = require('../../scheduler/deriveSchedulePlacements');

// ── slice layers (named exports — mirror task/weather facade surface) ────────
var domain = require('./domain');
var application = require('./application');
var adapters = require('./adapters');

var CalendarProviderPort = require('./domain/ports/CalendarProviderPort');
var ClockPort = require('./domain/ports/ClockPort');
var ScheduleRepositoryPort = require('./domain/ports/ScheduleRepositoryPort');
var ScheduleCachePort = require('./domain/ports/ScheduleCachePort');
var TaskProviderPort = require('./domain/ports/TaskProviderPort');
var WeatherProviderPort = require('./domain/ports/WeatherProviderPort');

module.exports = {
  // ── public scheduler operations (the caller-imported symbols) ──────────────
  runScheduleAndPersist: runSchedule.runScheduleAndPersist,
  // W3/W4: read-only placement view is now DERIVED from the task read model
  // (GET /api/tasks) instead of the deleted getSchedulePlacements + schedule_cache.
  deriveSchedulePlacements: deriveSchedulePlacements,
  unifiedScheduleV2: unifiedScheduleV2,
  // also surfaced by the legacy entry module; kept for parity with its exports.
  computeWindowCloseUtc: runSchedule.computeWindowCloseUtc,

  // ── application orchestrator (the SOLE delta-write persist seam, S5) ────────
  RunScheduleCommand: application.RunScheduleCommand,

  // ── pure domain core (solvers + entities + value objects) ──────────────────
  ConstraintSolver: domain.ConstraintSolver,
  ConflictResolver: domain.ConflictResolver,
  ScoreEngine: domain.ScoreEngine,
  Schedule: domain.Schedule,
  ScheduledTask: domain.ScheduledTask,
  ScoredSchedule: domain.ScoredSchedule,
  Constraint: domain.Constraint,
  Priority: domain.Priority,
  TimeWindow: domain.TimeWindow,
  Deadline: domain.Deadline,
  PlacementMode: domain.PlacementMode,

  // ── domain ports (the slice's contract surface) ────────────────────────────
  CalendarProviderPort: CalendarProviderPort,
  ClockPort: ClockPort,
  ScheduleRepositoryPort: ScheduleRepositoryPort,
  ScheduleCachePort: ScheduleCachePort,
  TaskProviderPort: TaskProviderPort,
  WeatherProviderPort: WeatherProviderPort,

  // ── adapter implementations (named exports; mirror task/weather facade) ─────
  SchedulerTaskProvider: adapters.SchedulerTaskProvider,
  SchedulerCalendarProvider: adapters.SchedulerCalendarProvider,
  SchedulerWeatherProvider: adapters.SchedulerWeatherProvider,
  KnexScheduleRepository: adapters.KnexScheduleRepository,
  InMemoryScheduleRepository: adapters.InMemoryScheduleRepository,
  MysqlClockAdapter: adapters.MysqlClockAdapter,
  RedisScheduleCache: adapters.RedisScheduleCache,
};
