/**
 * User-config slice facade — the ONLY public entry point (Phase H4 / W6).
 *
 * Wires adapters → ports → application: instantiates the W3 KnexConfigRepository
 * (over lib/db, ADR-0002) + the W4 PaymentServiceEntitlementAdapter (the slug-keyed
 * payment-service seam) and constructs the 20 W5 use-cases with their injected
 * dependencies, then exposes ONE facade method per the legacy 5 controllers' HTTP
 * handlers + the 3 middleware's gates — each returning the use-case's
 * `{ status, body }` (or `{ status: null }` allow→next) envelope. The thin
 * controllers/middleware (W6) map req → input and result → res/next.
 *
 * Mirrors the task slice facade wiring + JSDoc idiom (slices/task/facade.js).
 *
 * ── REFACTOR MODE — NO BEHAVIOR CHANGE EXCEPT THE P1 CORRECTION ────────────────
 * Every use-case reproduces the legacy handler/middleware step-for-step (W5). The
 * ONLY live behavior change is the human-approved P1/ADR-0003 timestamp-source
 * correction: KnexConfigRepository writes `created_at`/`updated_at` with
 * `new Date()`, never `db.fn.now()` (Scooter INBOX process-decision 2026-06-10).
 *
 * ── SLUG-KEYING (BINDING — INVARIANT EP-1) ───────────────────────────────────
 * The single PaymentServiceEntitlementAdapter instance is slug-keyed end-to-end
 * (`'juggler'`, PRODUCT_LABEL, never a UUID). The CheckEntitlement / GateFeature /
 * EnforceEntityLimit / HandleBillingWebhook use-cases inherit that invariant.
 *
 * ── ROUTE-EDGE GUARDS PRESERVED (elmo gate) ──────────────────────────────────
 * The webhook HMAC-signature verification (billing-webhooks.routes verifySignature)
 * and the impersonation admin-authz gate (impersonation.routes authenticateAdmin)
 * live in the ROUTE layer and are NOT moved here — they stay at the edge, exactly
 * as the golden-master pins (H3-9/FLAG-1, H5 admin gates). This facade never weakens
 * them.
 *
 * ── PINNED-IN-LEGACY PRIMITIVES (golden-master §4 gate) ──────────────────────
 * A handful of low-level I/O primitives are INJECTED from their legacy modules
 * rather than re-implemented, because the golden-master pins those modules' direct
 * call/source behavior (the binding §4 gate):
 *   - the plan-features payment-service fetch/cache (Surface-7 loads
 *     plan-features.middleware.js directly + asserts its source) — the
 *     PaymentServiceEntitlementAdapter reproduces the SAME behavior for the slice
 *     path, but the legacy module is retained as-is for those direct tests.
 *   - feature-gate's logFeatureEvent / checkAndIncrement / getCurrentPeriodBounds
 *     (Surface-6 mocks src/db + pins the FLAG-2 log shape) — injected from
 *     feature-gate.js so the thin middleware delegation keeps the exact DB sequence.
 *   - entity-limits' count* functions stay exported from entity-limits.js (consumed
 *     by my-plan.routes + billing-webhooks + the task facade) — but the query bodies
 *     now DELEGATE here (999.1188 delta-closure): the facade exposes count*
 *     passthroughs over the SAME wired repo instance the EnforceEntityLimit use-case
 *     counts through, so plan-limit enforcement and my-plan display run one query
 *     source instead of two verbatim copies.
 *   - billing's enforceDowngradeLimits (touches tasks_v + cal_sync_ledger, outside
 *     this slice) is injected from billing-webhooks.controller.js.
 */

'use strict';

// ── pure domain (W2) ─────────────────────────────────────────────────────────
var domain = require('./domain');

// ── adapters (W3/W4) ─────────────────────────────────────────────────────────
var KnexConfigRepository = require('./adapters/KnexConfigRepository');
var InMemoryConfigRepository = require('./adapters/InMemoryConfigRepository');
var PaymentServiceEntitlementAdapter = require('./adapters/PaymentServiceEntitlementAdapter');
var MockEntitlementAdapter = require('./adapters/MockEntitlementAdapter');
var KnexUserRepository = require('./adapters/KnexUserRepository');
var InMemoryUserRepository = require('./adapters/InMemoryUserRepository');
// ── ports (for the public type surface / named exports) ──────────────────────
var ConfigRepositoryPort = require('./domain/ports/ConfigRepositoryPort');
var EntitlementPort = require('./domain/ports/EntitlementPort');
var UserRepositoryPort = require('./domain/ports/UserRepositoryPort');

// ── application use-cases (W5) ───────────────────────────────────────────────
var app = require('./application');

// Re-export SCHED_KEYS so external adapters (e.g., MCP tools) can obtain the
// single-source policy without importing the application layer directly
// (JUG-HEX-H4/W6 boundary — facade is the sole public entry point).
var SCHED_KEYS = require('./application/commands/UpdateConfig').SCHED_KEYS;

// ── infra seams the use-cases inject (the SAME modules the legacy files used) ──
var libDb = require('../../lib/db');
var { cache } = require('../../lib/cache');
var config = require('../../lib/config');
// 999.1199: lib/tasks-write is internal to slices/task/adapters (eslint
// boundary) now. The cross-slice task-table collaborators below (renameTasks/
// importWipeTasks/importInsertTask) get the write module via the task slice
// facade's exported KnexTaskRepository class instead of requiring the raw
// module directly. Required at MODULE SCOPE (not lazily inside the functions,
// unlike the enforceDowngradeLimits seam below) — task/facade.js does not
// require this file, so there is no load-order cycle to avoid, and a top-level
// require here keeps these collaborators evaluated at the same load-time point
// the legacy `require('lib/tasks-write')` was (load-order-sensitive test doubles
// — e.g. facade.bugfix.regression.test.js's jest.isolateModules — mock the
// module graph only during that synchronous load; a lazy require deferred to
// call time would miss the mock).
var TaskKnexTaskRepository = require('../task/facade').KnexTaskRepository;
var dateHelpers = require('../../scheduler/dateHelpers');
var localToUtc = dateHelpers.localToUtc;
var toDateISO = dateHelpers.toDateISO;
var { z } = require('zod');
var { validateImportBody } = require('../../schemas/data-import.schema');
var proxyConfig = require('../../proxy-config');
var { createLogger } = require('@raike/lib-logger');
var logger = createLogger('user-config.facade');

// `getDb()` shim — returns the SAME knex the repository uses (lib/db.getDefaultDb()),
// mocked by the golden master onto its mockDb. Used by the verbatim cross-table
// collaborators below that reach tables outside the ConfigRepositoryPort.
function getDb() { return libDb.getDefaultDb(); }

// ── zod schemas (lifted verbatim — config.controller.js:18-32) ───────────────
// jug-geopoint-coord-validation (999.557): coordinates are range-validated so out-of-range
// values can't be persisted (and can't poison the weather lookup / reverse-geocode).
// The canonical wire/DB pair is `lat`/`lon` (frontend `loc.lon`, DB column `lon DECIMAL(9,6)`);
// the legacy schema validated a dead `lng` field while `lon` slipped through `.passthrough()`
// entirely unchecked. Validate the real `lon` field; lat ∈ [-90, 90], lon ∈ [-180, 180].
var locationItemSchema = z.object({
  id: z.string().max(36).optional(),
  name: z.string().min(1).max(200),
  icon: z.string().max(100).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
}).passthrough();
var locationsBodySchema = z.object({ locations: z.array(locationItemSchema).max(50) });

var toolItemSchema = z.object({
  id: z.string().min(1).max(36),
  name: z.string().min(1).max(200),
  icon: z.string().max(100).optional(),
}).passthrough();
var toolsBodySchema = z.object({ tools: z.array(toolItemSchema).max(50) });

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT WIRING (production adapters — ONE instance each, singleton semantics)
// ─────────────────────────────────────────────────────────────────────────────
var _repo = new KnexConfigRepository();            // over lib/db (ADR-0002)
var _entitlement = new PaymentServiceEntitlementAdapter(); // slug-keyed payment seam (W4)
var _userRepo = new KnexUserRepository();           // over lib/db — users table (999.1447)

// ── CROSS-TABLE / CROSS-SERVICE COLLABORATORS (lifted VERBATIM) ──────────────
// These reach tables/services the ConfigRepositoryPort does not model. Inside a
// transaction they use `trxRepo.db` (the raw trx handle the config repo carries);
// outside they use getDb().

// reverseGeocodeDisplayName — weather slice facade (replaceLocations enrichment).
// 999.1192: cross-slice call via the weather slice's own facade, not the HTTP
// controller (whose reverseGeocodeDisplayName is a re-export of this same
// facade function). Still lazily required so test mocks of the weather facade
// are honored (mirrors the prior weather.controller-mock rationale).
function reverseGeocode(lat, lon) {
  return require('../weather/facade').reverseGeocodeDisplayName(lat, lon);
}

// UpdateProject cross-table task-project rename (config.controller.js:273-277).
// Runs inside the SAME transaction via trxRepo.db (the knex trx handle), wrapped
// as a task-slice "transaction token" (999.1199 — KnexTaskRepository constructed
// over the config repo's own trx instead of a raw require('lib/tasks-write')).
// Raw passthrough via `.tasksWrite` (NOT the P1-asserting port method): this call
// site is DELIBERATELY pinned to the MySQL SERVER clock (`trxRepo.db.fn.now()`),
// not the app clock — see the B2 regression test
// (tests/slices/user-config/adapters/facade.bugfix.regression.test.js) for the
// prior bugfix this preserves. The strict port's P1 new-Date() stamp would
// silently revert that fix, so it is intentionally NOT used here.
function renameTasks(trxRepo, userId, oldName, name) {
  var taskRepo = new TaskKnexTaskRepository({ db: trxRepo.db });
  return taskRepo.tasksWrite.updateTasksWhere(trxRepo.db, userId, function (q) {
    return q.where('project', oldName);
  }, { project: name, updated_at: trxRepo.db.fn.now() });
}

// ExportData task read (999.354 promotion 2/3) — promoted behind CalSyncPort.
// The adapter delegates to the TASK SLICE FACADE (not the legacy controller) and
// uses the CORRECT 2-arg fetchTasksWithEventIds(userId, queryBuilder) signature.
// The prior code reached into controllers/task.controller AND passed getDb() as
// the first arg, which serialized to an empty (select *) subquery →
// ER_NO_TABLES_USED (999.488/489) and a silently-empty export. Fixed here.
var TaskSliceCalSyncAdapter = require('./adapters/TaskSliceCalSyncAdapter');
var _calSync = new TaskSliceCalSyncAdapter();
function exportFetchTasks(userId, orderBy) {
  return _calSync.fetchTasksWithEventIds(userId, orderBy);
}
function exportRowToTask(row, tz) {
  return _calSync.rowToTask(row, tz);
}

// ImportData task collaborators (data.controller.js:75, :128-131, :77-126).
// 999.1199: same transaction-token + raw-passthrough wrapping as renameTasks above.
function importWipeTasks(trxRepo, userId) {
  var taskRepo = new TaskKnexTaskRepository({ db: trxRepo.db });
  return taskRepo.tasksWrite.deleteTasksWhere(trxRepo.db, userId, function (q) { return q; });
}
function importInsertTask(trxRepo, row) {
  var taskRepo = new TaskKnexTaskRepository({ db: trxRepo.db });
  return taskRepo.tasksWrite.insertTask(trxRepo.db, row);
}
// MergeImportData task-id read (two-mode import / W2) — the EXISTING task ids for
// the user, read within the merge transaction. task_masters.id is the canonical id
// space (every task has a master; non-recurring master + instance share the id), so
// a merge collision check against task_masters.id covers all task kinds. Reads via
// trxRepo.db (the same knex trx handle the config repo carries), mirroring how
// importWipeTasks/importInsertTask reach the task tables outside the config port.
function mergeListTaskIds(trxRepo, userId) {
  return trxRepo.db('task_masters').where('user_id', userId).pluck('id');
}
// v7-task → DB-row mapper (data.controller.js:79-125) — verbatim, incl. trx.fn.now()
// for created_at/updated_at on the IMPORT path. The import insert is a task-table
// write outside the config repo, so its timestamps are NOT in KnexConfigRepository's
// P1 scope (it stays as the legacy did). statuses comes through as the 4th arg.
function importBuildTaskRow(t, userId, tz, statuses) {
  var loc = t.location || t.where;
  var locationArr = Array.isArray(loc) ? loc : (loc && loc !== 'anywhere' ? [loc] : []);

  var scheduledAt = null;
  if (t.date && t.date !== 'TBD') {
    var timeStr = t.time ? String(t.time).slice(0, 20) : null;
    scheduledAt = localToUtc(t.date, timeStr || '12:00 AM', tz);
  }

  var deadline = t.deadline ? toDateISO(t.deadline) || null : null;
  var earliestStartDate = (t.earliestStart || t.earliest_start) ? toDateISO(t.earliestStart || t.earliest_start) || null : null;
  var st = statuses || {};
  var status = st[t.id] || t.status || '';

  // chk_task_instances_terminal_scheduled: a terminal-status instance must carry a
  // scheduled_at (the exact status list below is the constraint's, NOT the wider
  // shared TERMINAL_STATUSES — 'pause' is terminal for cal-sync but not here).
  // Legacy exports can hold terminal tasks that were never placed; inserting them
  // verbatim aborts the whole import. Apply the SAME normalization the constraint
  // migration (20260527213906) applied to existing rows: anchor to the best
  // available timestamp, else clear the status to non-terminal.
  if (!scheduledAt && ['done', 'skip', 'cancel', 'missed'].indexOf(status) >= 0) {
    var anchor = t.completedAt ? new Date(t.completedAt) : null;
    if (anchor && !isNaN(anchor.getTime())) {
      scheduledAt = anchor;
    } else {
      status = '';
    }
  }

  return {
    id: t.id,
    user_id: userId,
    text: t.text || '',
    scheduled_at: scheduledAt,
    dur: t.dur || 30,
    time_remaining: t.timeRemaining != null ? t.timeRemaining : null,
    pri: t.pri || 'P3',
    project: t.project || null,
    status: status,
    section: t.section || null,
    notes: t.notes || null,
    deadline: deadline,
    start_after_at: earliestStartDate,
    location: JSON.stringify(locationArr),
    tools: JSON.stringify(t.tools || []),
    when: t.when || null,
    day_req: t.dayReq || 'any',
    recurring: t.recurring ? 1 : 0,
    placement_mode: t.placementMode,
    split: t.split === undefined || t.split === null ? null : (t.split ? 1 : 0),
    split_min: t.splitMin || null,
    recur: t.recur ? JSON.stringify(t.recur) : null,
    source_id: t.sourceId || null,
    generated: t.generated ? 1 : 0,
    gcal_event_id: t.gcalEventId || null,
    depends_on: JSON.stringify(t.dependsOn || []),
    // ── previously-dropped fields (import data-loss fix) ──
    // Every field rowToTask exports must round-trip through import. The original
    // buildTaskRow mapped ~28 of ~63 exported fields; the ~35 below were silently
    // dropped, causing data loss on dev→prod import. Mappings follow the same
    // camelCase→snake_case + JSON.stringify(array/object) + 1/0(boolean) patterns
    // used by taskToRow (taskMappers.js:609) and the existing lines above.
    task_type: t.taskType || 'task',
    completed_at: t.completedAt ? new Date(t.completedAt) : null,
    tz: t.tz || null,
    url: t.url || null,
    time_flex: t.timeFlex != null ? t.timeFlex : null,
    flex_when: t.flexWhen ? 1 : 0,
    travel_before: t.travelBefore != null ? t.travelBefore : null,
    travel_after: t.travelAfter != null ? t.travelAfter : null,
    weather_precip: t.weatherPrecip || 'any',
    weather_cloud: t.weatherCloud || 'any',
    weather_temp_min: t.weatherTempMin != null ? t.weatherTempMin : null,
    weather_temp_max: t.weatherTempMax != null ? t.weatherTempMax : null,
    weather_temp_unit: t.weatherTempUnit || null,
    weather_humidity_min: t.weatherHumidityMin != null ? t.weatherHumidityMin : null,
    weather_humidity_max: t.weatherHumidityMax != null ? t.weatherHumidityMax : null,
    preferred_time_mins: t.preferredTimeMins != null ? t.preferredTimeMins : null,
    desired_at: t.desiredAt ? new Date(t.desiredAt) : null,
    unscheduled: t.unscheduled ? 1 : 0,
    recur_start: t.recurStart || null,
    recur_end: t.recurEnd || null,
    end_date: t.endDate ? (toDateISO(t.endDate) || null) : null,
    next_start: t.nextStart || null,
    disabled_at: t.disabledAt ? new Date(t.disabledAt) : null,
    disabled_reason: t.disabledReason || null,
    occurrence_ordinal: t.occurrenceOrdinal != null ? t.occurrenceOrdinal : null,
    split_ordinal: t.splitOrdinal != null ? t.splitOrdinal : null,
    split_total: t.splitTotal != null ? t.splitTotal : null,
    split_group: t.splitGroup || null,
    marker: t.marker ? 1 : 0,
    msft_event_id: t.msftEventId || null,
    apple_event_id: t.appleEventId || null,
    cal_locked: t.calLocked ? 1 : 0,
    apple_calendar_name: t.appleCalendarName || null,
    cal_sync_origin: t.calSyncOrigin || null,
    cal_event_url: t.calEventUrl || null,
    slack_mins: t.slackMins != null ? t.slackMins : null,
    // ── timestamps (import path uses DB now(), per original comment) ──
    created_at: getDb().fn.now(),
    updated_at: getDb().fn.now()
  };
}

// Impersonation auth-service call (impersonation.controller.js:6-26) — verbatim.
function callAuthServiceImpersonate(adminUserId, targetUserId, reason) {
  var { authServiceUrl } = proxyConfig;
  var key = config.getString('INTERNAL_SERVICE_KEY'); // 999.1473 (requiredInProduction — throws here too, in prod; local check covers dev/test)
  if (!key) throw new Error('INTERNAL_SERVICE_KEY is not set');

  var url = authServiceUrl + '/internal/auth/impersonate';
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Key': key },
    body: JSON.stringify({ admin_user_id: adminUserId, target_user_id: targetUserId, reason: reason || null }),
    signal: AbortSignal.timeout(30000),
  }).then(function (response) {
    return response.text().then(function (text) {
      var payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        var err = new Error(payload.error || ('auth-service returned ' + response.status));
        err.status = response.status;
        err.body = payload;
        throw err;
      }
      return payload;
    });
  });
}

// billing enforceDowngradeLimits (tasks_v + cal_sync_ledger) — delegates to the
// TASK SLICE FACADE (999.994), not the legacy controller. Mirrors the
// TaskSliceCalSyncAdapter precedent above: task-domain logic reached backwards
// out of controllers/billing-webhooks.controller; it now lives in
// slices/task/adapters/DowngradeLimitsEnforcer, owned by the task slice.
function enforceDowngradeLimits(userId, planFeatures) {
  return require('../task/facade').enforceDowngradeLimits(userId, planFeatures);
}

// feature-gate I/O primitives — injected from the legacy module so the thin
// middleware delegation keeps the EXACT same DB sequence + the pinned FLAG-2 log
// shape (Surface-6 mocks src/db). These are private to feature-gate.js, so the
// facade re-derives them over the same getDb()/usage-reporter the legacy used.
var usageReporter = require('../../lib/usage-reporter');
// 999.1194: inject the adapter-based resolveProductId so usage-reporter no longer
// reaches up into plan-features.middleware (layering inversion fix).
usageReporter.setProductIdResolver(function () { return _entitlement.resolveProductId(); });
function logFeatureEvent(reqOrUserId, featureKey, eventType, value) {
  var userId = typeof reqOrUserId === 'object' ? (reqOrUserId.user && reqOrUserId.user.id) : reqOrUserId;
  var planId = typeof reqOrUserId === 'object' ? reqOrUserId.planId : 'free';
  return getDb()('feature_events').insert({
    user_id: userId,
    feature_key: featureKey,
    event_type: eventType,
    planId: planId || 'free',
    plan_id: typeof reqOrUserId === 'object' ? (reqOrUserId.planId || null) : null,
    endpoint: typeof reqOrUserId === 'object' ? (reqOrUserId.method + ' ' + (reqOrUserId.originalUrl || reqOrUserId.url)) : null,
    ip_address: typeof reqOrUserId === 'object' ? (reqOrUserId.ip || (reqOrUserId.headers && reqOrUserId.headers['x-forwarded-for']) || null) : null,
    request_id: typeof reqOrUserId === 'object' ? ((reqOrUserId.headers && reqOrUserId.headers['x-request-id']) || null) : null,
    value: value ? JSON.stringify(value) : null,
    created_at: new Date()
  }).catch(function (err) {
    logger.error('[feature-gate] Failed to log event:', { error: err });
  });
}
function getCurrentPeriodBounds(featureKey) {
  var now = new Date();
  if (featureKey.includes('per_hour')) {
    var start = new Date(Math.floor(now.getTime() / 3600000) * 3600000);
    return { start: start, end: new Date(start.getTime() + 3600000) };
  }
  if (featureKey.includes('per_month')) {
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    };
  }
  if (featureKey.includes('per_year')) {
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
      end: new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1))
    };
  }
  return { start: new Date(0), end: null };
}
// JUG-FACADE-DB-VIOLATIONS stage 2: checkAndIncrement moved VERBATIM into
// adapters/KnexPlanUsageRepository.js (single-statement ON-DUPLICATE atomicity
// preserved there) — getCurrentPeriodBounds stays here (pure date math, no DB).
var checkAndIncrement = require('./adapters/KnexPlanUsageRepository').checkAndIncrement;

// ─────────────────────────────────────────────────────────────────────────────
// USE-CASE CONSTRUCTION (wire adapters → ports → application)
// ─────────────────────────────────────────────────────────────────────────────

// config.controller handlers
var _getConfig = new app.GetConfig({ repo: _repo, cache: cache });
var _getProjects = new app.GetProjects({ repo: _repo });
var _getLocations = new app.GetLocations({ repo: _repo });
var _getTools = new app.GetTools({ repo: _repo });
var _updateConfig = new app.UpdateConfig({ repo: _repo, cache: cache });
var _updateUserTimezone = new app.UpdateUserTimezone({ userRepository: _userRepo }); // 999.1447
var _createProject = new app.CreateProject({ repo: _repo, cache: cache });
var _updateProject = new app.UpdateProject({ repo: _repo, cache: cache, renameTasks: renameTasks });
var _deleteProject = new app.DeleteProject({ repo: _repo, cache: cache });
var _reorderProjects = new app.ReorderProjects({ repo: _repo, cache: cache });
var _replaceLocations = new app.ReplaceLocations({
  repo: _repo, cache: cache,
  parseBody: function (body) { return locationsBodySchema.safeParse(body); },
  reverseGeocode: reverseGeocode
});
var _replaceTools = new app.ReplaceTools({
  repo: _repo, cache: cache,
  parseBody: function (body) { return toolsBodySchema.safeParse(body); }
});

// data.controller handlers
var _exportData = new app.ExportData({ repo: _repo, fetchTasks: exportFetchTasks, rowToTask: exportRowToTask });
var _importData = new app.ImportData({
  repo: _repo, wipeTasks: importWipeTasks, insertTask: importInsertTask, buildTaskRow: importBuildTaskRow
});
// MergeImportData (two-mode import / W2) — additive, non-destructive. Shares the
// SAME repo + task insert/row-map collaborators as ImportData; adds the
// existing-task-id read it needs to re-key colliding ids. Does NOT touch
// importData()'s behavior (mode routing is a later wave).
var _mergeImportData = new app.MergeImportData({
  repo: _repo, listTaskIds: mergeListTaskIds, insertTask: importInsertTask, buildTaskRow: importBuildTaskRow
});

// feature-catalog.controller handler
// 999.1192: CATALOG is this slice's own domain data (domain/featureCatalog.js);
// the controller re-exports it, not the other way around.
var _getFeatureCatalog = new app.GetFeatureCatalog({
  entitlement: _entitlement,
  catalog: require('./domain/featureCatalog').CATALOG
});

// impersonation.controller handlers
var _listImpersonationTargets = new app.ListImpersonationTargets({ repo: _repo });
var _getImpersonationLog = new app.GetImpersonationLog({ repo: _repo });
var _impersonate = new app.Impersonate({
  repo: _repo, callAuthServiceImpersonate: callAuthServiceImpersonate, auditLogger: logger
});
var _stopImpersonation = new app.StopImpersonation({ repo: _repo, auditLogger: logger });

// billing-webhooks.controller handler.
// The webhook's entitlement seam shares ONE cache with the LIVE entitlement gate
// via the single _entitlement adapter instance: invalidateUserPlan busts the
// adapter-instance user-plan cache and resolvePlanCatalog reads the
// adapter-instance catalog cache (which the live gate warms via checkEntitlement)
// — eliminating the split-brain / cold-legacy-catalog silent-downgrade-skip (B1 fix).
var _billingEntitlement = {
  invalidateUserPlan: function (userId) {
    _entitlement.invalidateUserPlan(userId); // bust the adapter instance cache the LIVE gate reads (restores pre-rewire coherence)
  },
  resolvePlanCatalog: function () {
    return _entitlement.resolvePlanCatalog(); // adapter-instance cache (same as the live entitlement gate)
  }
};
var _handleBillingWebhook = new app.HandleBillingWebhook({
  entitlement: _billingEntitlement, enforceDowngradeLimits: enforceDowngradeLimits, logger: logger
});

// plan-features.middleware (entitlement core — slug-keyed)
var _checkEntitlement = new app.CheckEntitlement({
  entitlement: _entitlement,
  reconcileLimits: function (userId, planFeatures) {
    return require('../../middleware/plan-features.middleware').reconcileLimitsIfNeeded(userId, planFeatures);
  },
  plansUrl: (proxyConfig.services && proxyConfig.services.billing && proxyConfig.services.billing.frontend
    ? proxyConfig.services.billing.frontend : undefined) + '/plans'
});

// feature-gate.js gates
var _gateFeature = new app.GateFeature({
  logFeatureEvent: logFeatureEvent,
  reportUsage: usageReporter.reportUsage,
  checkAndIncrement: checkAndIncrement,
  getCurrentPeriodBounds: getCurrentPeriodBounds,
  logger: logger
});

// entity-limits.js gates
var _enforceEntityLimit = new app.EnforceEntityLimit({ repo: _repo, logger: logger });

// feature-events.routes.js GET / (999.1196) — the route has no other db-mock
// coupling to preserve (unlike my-plan's entity-limits/db composition-root
// seam), so this one is wired into the DEFAULT singleton like the rest of the
// facade's use-cases.
var _getFeatureEventsReport = new app.GetFeatureEventsReport({ db: getDb() });

// ─────────────────────────────────────────────────────────────────────────────
// FACADE OPERATIONS — one per handler/gate; each returns { status, body }
// (or { status: null } for an allow→next gate).
// ─────────────────────────────────────────────────────────────────────────────

// ── config.controller ──
function getAllConfig(input) { return _getConfig.execute(input); }
function getProjects(input) { return _getProjects.execute(input); }
function getLocations(input) { return _getLocations.execute(input); }
function getTools(input) { return _getTools.execute(input); }
function updateConfig(input) { return _updateConfig.execute(input); }
function updateTimezone(input) { return _updateUserTimezone.execute(input); } // 999.1447
function createProject(input) { return _createProject.execute(input); }
function updateProject(input) { return _updateProject.execute(input); }
function deleteProject(input) { return _deleteProject.execute(input); }
function reorderProjects(input) { return _reorderProjects.execute(input); }
function replaceLocations(input) { return _replaceLocations.execute(input); }
function replaceTools(input) { return _replaceTools.execute(input); }

// ── data.controller ──
function exportData(input) { return _exportData.execute(input); }

/**
 * dispatchImport — two-mode import dispatcher (W3).
 *
 * The SINGLE entry point the `importData` facade op delegates to. It owns mode
 * routing + fail-safe resolution + schema validation, then dispatches to the
 * EXISTING replace (`_importData`) or merge (`_mergeImportData`) use-cases — whose
 * internal logic is unchanged. Returns the same `{ status, body }` envelope.
 *
 * ── ORDERING (EXACT — preserves the golden-master error messages) ─────────────
 *   1. LEGACY SHAPE GUARD FIRST: `!data || !data.extraTasks` → 400 'Invalid import
 *      data …' (H2-6 message; must run before mode + schema).
 *   2. RESOLVE MODE from input.mode (?mode) + input.confirm (?confirm):
 *        - absent/'' → LEGACY: confirm !== 'delete_all' → 400 'Import will DELETE
 *          all existing …' (H2-5/elmoB2a/b); else REPLACE.
 *        - 'merge'   → MERGE (no confirm required).
 *        - 'replace' → confirm !== 'delete_all' → SAME 400 'Import will DELETE …';
 *          else REPLACE.
 *        - anything else → 400 "Invalid import mode '<value>' …" with ZERO DB writes.
 *      An unknown mode NEVER falls through; an absent mode NEVER silently merges/wipes.
 *   3. SCHEMA VALIDATION (W1 validateImportBody) — AFTER the shape+mode guards,
 *      BEFORE any DB work, for the proceeding (merge/replace) paths. !ok → 400
 *      { error: 'Validation failed', details } with ZERO DB writes.
 *   4. DISPATCH: REPLACE → _importData (unchanged); MERGE → _mergeImportData.
 *      Replace success body is augmented with `mode: 'replace'`; merge already
 *      carries `mode: 'merge'` + `tasksRekeyed`.
 *
 * @param {Object} input
 * @param {string} input.userId
 * @param {*} input.data       the request body (v7 import shape).
 * @param {string} [input.mode]     the ?mode query value.
 * @param {string} [input.confirm]  the ?confirm query value.
 * @param {string} [input.timezoneHeader]  raw x-timezone header.
 * @returns {Promise<{ status: number, body: Object }>}
 */
/**
 * Max tasks per import (DoS defense — 999.495).
 */
var MAX_IMPORT_TASKS = 5000;

async function dispatchImport(input) {
  var data = input.data;

  // 1. LEGACY SHAPE GUARD FIRST — owns H2-6's "Invalid import data" message.
  if (!data || !data.extraTasks) {
    return { status: 400, body: { error: 'Invalid import data — expected v7 format with extraTasks' } };
  }

  // 1b. TASK COUNT CAP — DoS defense (999.495).
  if (data.extraTasks.length > MAX_IMPORT_TASKS) {
    return { status: 400, body: { error: 'Import rejected: too many tasks (' + data.extraTasks.length + '). Maximum allowed is ' + MAX_IMPORT_TASKS + '.' } };
  }

  // 2. RESOLVE MODE (fail-safe — unknown never falls through; absent never wipes/merges silently).
  var mode = input.mode;
  var resolved;
  if (mode === undefined || mode === null || mode === '') {
    // LEGACY: absent mode → REPLACE, but only with the destructive confirm.
    if (input.confirm !== 'delete_all') {
      return { status: 400, body: { error: 'Import will DELETE all existing tasks, config, and projects. Pass ?confirm=delete_all to proceed.' } };
    }
    resolved = 'replace';
  } else if (mode === 'merge') {
    resolved = 'merge';
  } else if (mode === 'replace') {
    if (input.confirm !== 'delete_all') {
      return { status: 400, body: { error: 'Import will DELETE all existing tasks, config, and projects. Pass ?confirm=delete_all to proceed.' } };
    }
    resolved = 'replace';
  } else {
    // Unknown mode — reject with ZERO DB writes; NEVER fall through to replace/merge.
    return { status: 400, body: { error: "Invalid import mode '" + mode + "' — expected 'merge' or 'replace'." } };
  }

  // 3. SCHEMA VALIDATION (W1) — after shape+mode guards, before any DB work, for the
  //    proceeding paths. ZERO DB writes on failure.
  var validation = validateImportBody(data);
  if (!validation.ok) {
    return { status: 400, body: { error: 'Validation failed', details: validation.errors } };
  }

  // 4. DISPATCH — reuse the EXISTING use-cases unchanged.
  if (resolved === 'merge') {
    return _mergeImportData.execute({
      userId: input.userId,
      data: data,
      timezoneHeader: input.timezoneHeader
    });
  }
  // REPLACE — legacy ImportData; augment its success body with mode:'replace'.
  var result = await _importData.execute({
    userId: input.userId,
    data: data,
    confirm: input.confirm,
    timezoneHeader: input.timezoneHeader
  });
  if (result.status === 200) {
    result.body.mode = 'replace';
  }
  return result;
}

function importData(input) { return dispatchImport(input); }
function mergeImportData(input) { return _mergeImportData.execute(input); }

// ── feature-catalog.controller ──
function getFeatureCatalog() { return _getFeatureCatalog.execute(); }

// ── impersonation.controller ──
function getImpersonationTargets(input) { return _listImpersonationTargets.execute(input); }
function getImpersonationLog(input) { return _getImpersonationLog.execute(input); }
function startImpersonation(input) { return _impersonate.execute(input); }
function stopImpersonation(input) { return _stopImpersonation.execute(input); }

// ── billing-webhooks.controller ──
function handleBillingWebhook(input) { return _handleBillingWebhook.execute(input); }

// ── plan-features.middleware ──
function checkEntitlement(input) { return _checkEntitlement.execute(input); }

// ── feature-gate.js ──
function requireFeature(ctx, featurePath) { return _gateFeature.requireFeature(ctx, featurePath); }
function requireFeatureIncludes(ctx, featurePath, requestedValue) {
  return _gateFeature.requireFeatureIncludes(ctx, featurePath, requestedValue);
}
function checkUsageLimit(ctx, limitKey, options) { return _gateFeature.checkUsageLimit(ctx, limitKey, options); }

// ── entity-limits.js ──
function enforceEntityLimit(ctx, limitKey, countKind, options) {
  return _enforceEntityLimit.check(ctx, limitKey, countKind, options);
}
function enforceLocationLimit(ctx, incomingCount) { return _enforceEntityLimit.checkLocation(ctx, incomingCount); }
function enforceTaskOrRecurringLimit(ctx, taskType) { return _enforceEntityLimit.checkTaskOrRecurring(ctx, taskType); }
function enforceBatchTaskLimits(ctx, items) { return _enforceEntityLimit.checkBatch(ctx, items); }

// ── feature-events.routes.js (999.1196) ──────────────────────────────────────
function getFeatureEventsReport(input) { return _getFeatureEventsReport.execute(input); }

// ── entity-limits.js count* passthroughs (999.1188 delta-closure) ────────────
// Same wired _repo instance the EnforceEntityLimit use-case counts through —
// ONE query source for plan-limit enforcement and my-plan display. Preserves
// the characterized quirk: countRecurringTemplates is effectively always 0
// (tasks_v NULL status + NOT IN exclusion) — not a bug fixed here.
function countActiveTasks(userId) { return _repo.countActiveTasks(userId); }
function countRecurringTemplates(userId) { return _repo.countRecurringTemplates(userId); }
function countProjects(userId) { return _repo.countProjects(userId); }
function countLocations(userId) { return _repo.countLocations(userId); }
// countScheduleTemplates: read the time_blocks config row, parse, count unique
// day keys with blocks (W2 countScheduleTemplatesFromBlocks) — mirrors
// EnforceEntityLimit.js:245-256's inner try/catch (parse failure → 0), reusing
// the same pure domain function rather than a third copy of the counting loop.
async function countScheduleTemplates(userId) {
  var row = await _repo.getConfigRow(userId, 'time_blocks');
  if (!row || !row.config_value) return 0;
  try {
    var blocks = typeof row.config_value === 'string'
      ? JSON.parse(row.config_value) : row.config_value;
    return domain.entityLimit.countScheduleTemplatesFromBlocks(blocks);
  } catch {
    return 0;
  }
}

module.exports = {
  // 999.1603: the guarded config-value parse, exported for external readers of
  // raw user_config rows (mcp/tools/data.js export fork) — the slice-boundary
  // rule forbids them requiring domain/entities/UserConfig directly.
  parseConfigValue: domain.UserConfig.parseConfigValue,
  // facade operations (one per handler/gate) the thin controllers/middleware delegate to
  getAllConfig: getAllConfig,
  getProjects: getProjects,
  getLocations: getLocations,
  getTools: getTools,
  updateConfig: updateConfig,
  updateTimezone: updateTimezone,
  createProject: createProject,
  updateProject: updateProject,
  deleteProject: deleteProject,
  reorderProjects: reorderProjects,
  replaceLocations: replaceLocations,
  replaceTools: replaceTools,
  exportData: exportData,
  importData: importData,
  mergeImportData: mergeImportData,
  getFeatureCatalog: getFeatureCatalog,
  getImpersonationTargets: getImpersonationTargets,
  getImpersonationLog: getImpersonationLog,
  startImpersonation: startImpersonation,
  stopImpersonation: stopImpersonation,
  handleBillingWebhook: handleBillingWebhook,
  checkEntitlement: checkEntitlement,
  requireFeature: requireFeature,
  requireFeatureIncludes: requireFeatureIncludes,
  checkUsageLimit: checkUsageLimit,
  enforceEntityLimit: enforceEntityLimit,
  enforceLocationLimit: enforceLocationLimit,
  enforceTaskOrRecurringLimit: enforceTaskOrRecurringLimit,
  enforceBatchTaskLimits: enforceBatchTaskLimits,
  countActiveTasks: countActiveTasks,
  countRecurringTemplates: countRecurringTemplates,
  countProjects: countProjects,
  countLocations: countLocations,
  countScheduleTemplates: countScheduleTemplates,
  getFeatureEventsReport: getFeatureEventsReport,

  // domain ports + adapter implementations (named exports; mirror task/weather)
  ConfigRepositoryPort: ConfigRepositoryPort,
  EntitlementPort: EntitlementPort,
  UserRepositoryPort: UserRepositoryPort,
  KnexConfigRepository: KnexConfigRepository,
  InMemoryConfigRepository: InMemoryConfigRepository,
  KnexUserRepository: KnexUserRepository,
  InMemoryUserRepository: InMemoryUserRepository,
  // use-case class export (999.1197): the jwt-auth middleware is the composition
  // root (it wires its own db handle), so it needs the CLASS via the facade —
  // the boundary rule forbids importing slices/user-config/application directly.
  ProvisionUserOnFirstLogin: app.ProvisionUserOnFirstLogin,
  // same idiom (999.1196): my-plan.routes.js is the composition root — it wires
  // GetMyPlan with its OWN db/entity-limits/payment-service collaborators so
  // its existing unit-test mock seams (middleware/entity-limits, lib/db) keep
  // intercepting the exact same calls.
  GetMyPlan: app.GetMyPlan,
  PaymentServiceEntitlementAdapter: PaymentServiceEntitlementAdapter,
  MockEntitlementAdapter: MockEntitlementAdapter,

  // pure domain re-exports (mirror task facade — consumers go through the facade)
  domain: domain,

  // schedule-key policy re-export — single source of truth (JUG-HEX-H4/W6)
  // External adapters (e.g., mcp/tools/config.js) import this instead of
  // reaching into the application layer directly.
  SCHED_KEYS: SCHED_KEYS,

  // the singleton adapter instances (so the thin middleware/controllers share state)
  _repo: _repo,
  _entitlement: _entitlement,
};
