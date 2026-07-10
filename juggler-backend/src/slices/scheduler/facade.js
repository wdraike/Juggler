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
 *   deriveSchedulePlacements(userId, opts)   — read-only placement derivation from
 *     the /tasks list (DB single source); does NOT mutate tasks and does NOT read
 *     schedule_cache. (MCP get_schedule.) Sourced from
 *     `src/scheduler/deriveSchedulePlacements.js`.
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
 * ── H7 ── the legacy `src/scheduler/runSchedule.js` and
 * `src/scheduler/unifiedScheduleV2.js` files REMAIN; the facade fronts them.
 * 999.1193 closed the remaining inline infra I/O in runSchedule.js: the
 * user_config/locations config reads, the phase-1 chunk pre-insert
 * (insertTasksBatch), and the dead Redis run-lock now all route through
 * RunScheduleCommand → ScheduleRepositoryPort (or were deleted as dead code).
 * Still open H7 work: thinning/deleting the legacy files and the per-slice
 * eslint boundary rule.
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

// ── ROUTE-LOGIC EXTRACTION (999.1196) ─────────────────────────────────────────
// schedule.routes.js's admin /debug and stepper /step/:id/stop handlers had
// direct db('tasks_v') / db('scheduler_sessions') queries and inline business
// math. Neither touchpoint is modeled on ScheduleRepositoryPort (that port is
// the S5 delta-write persist seam, not a general query surface) and
// schedulerSession.js — which owns every OTHER scheduler_sessions read/write —
// is a concurrently-owned file this leg does not modify. These two small
// collaborators are lifted verbatim here, mirroring the user-config facade's
// "port doesn't model this table" cross-table-collaborator idiom.
var libDb = require('../../lib/db');
function getDb() { return libDb.getDefaultDb(); }

// admin /debug's OWN tasks_v load (schedule.routes.js ~L90) — deliberately NOT
// SchedulerTaskProvider.loadSchedulableRows, which uses a DIFFERENT filter
// for the live scheduler's working set.
function loadDebugTasks(userId) {
  return getDb()('tasks_v').where({ user_id: userId }).whereNot('status', 'disabled');
}

// stepper /step/:id/stop's raw ownership read (schedule.routes.js ~L198),
// used only when schedulerSession.getSession() already returned null.
function findStepperSessionOwner(sessionId) {
  return getDb()('scheduler_sessions').where('session_id', sessionId).first();
}

var RunSchedulerDebug = application.RunSchedulerDebug;
var _runSchedulerDebug = new RunSchedulerDebug({
  loadTasks: loadDebugTasks,
  loadConfig: require('../../scheduler/loadSchedulerConfig').loadSchedulerConfig,
  // Same import path schedule.routes.js used (999.1192 class): the task
  // slice's pure domain mapper, not the HTTP controller's re-export.
  rowToTask: require('../task/domain/mappers/taskMappers').rowToTask,
  unifiedSchedule: unifiedScheduleV2
});
function runSchedulerDebug(input) { return _runSchedulerDebug.execute(input); }

var GetStepperSessionOwner = application.GetStepperSessionOwner;
var _getStepperSessionOwner = new GetStepperSessionOwner({ findOwner: findStepperSessionOwner });
function getStepperSessionOwner(sessionId) { return _getStepperSessionOwner.execute(sessionId); }

module.exports = {
  // ── public scheduler operations (the caller-imported symbols) ──────────────
  runScheduleAndPersist: runSchedule.runScheduleAndPersist,
  deriveSchedulePlacements: deriveSchedulePlacements,
  unifiedScheduleV2: unifiedScheduleV2,
  // also surfaced by the legacy entry module; kept for parity with its exports.
  computeWindowCloseUtc: runSchedule.computeWindowCloseUtc,

  // ── application orchestrator (the SOLE delta-write persist seam, S5) ────────
  RunScheduleCommand: application.RunScheduleCommand,

  // ── route-logic extraction (999.1196) — schedule.routes.js consumers ────────
  runSchedulerDebug: runSchedulerDebug,
  getStepperSessionOwner: getStepperSessionOwner,

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
