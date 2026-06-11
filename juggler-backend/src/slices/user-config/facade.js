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
 *     by my-plan.routes + billing-webhooks + the task facade) — the EnforceEntityLimit
 *     use-case counts via the repo (same tasks_v/projects/locations queries).
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

// ── ports (for the public type surface / named exports) ──────────────────────
var ConfigRepositoryPort = require('./domain/ports/ConfigRepositoryPort');
var EntitlementPort = require('./domain/ports/EntitlementPort');

// ── application use-cases (W5) ───────────────────────────────────────────────
var app = require('./application');

// ── infra seams the use-cases inject (the SAME modules the legacy files used) ──
var libDb = require('../../lib/db');
var { cache } = require('../../lib/cache');
var tasksWrite = require('../../lib/tasks-write');
var dateHelpers = require('../../scheduler/dateHelpers');
var localToUtc = dateHelpers.localToUtc;
var toDateISO = dateHelpers.toDateISO;
var { z } = require('zod');
var proxyConfig = require('../../proxy-config');
var { createLogger } = require('@raike/lib-logger');
var logger = createLogger('user-config.facade');

// `getDb()` shim — returns the SAME knex the repository uses (lib/db.getDefaultDb()),
// mocked by the golden master onto its mockDb. Used by the verbatim cross-table
// collaborators below that reach tables outside the ConfigRepositoryPort.
function getDb() { return libDb.getDefaultDb(); }

// ── zod schemas (lifted verbatim — config.controller.js:18-32) ───────────────
var locationItemSchema = z.object({
  id: z.string().max(36).optional(),
  name: z.string().min(1).max(200),
  icon: z.string().max(100).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
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

// ── CROSS-TABLE / CROSS-SERVICE COLLABORATORS (lifted VERBATIM) ──────────────
// These reach tables/services the ConfigRepositoryPort does not model. Inside a
// transaction they use `trxRepo.db` (the raw trx handle the config repo carries);
// outside they use getDb().

// reverseGeocodeDisplayName — weather controller (replaceLocations enrichment).
// Lazily required so the golden-master's weather.controller mock is honored.
function reverseGeocode(lat, lon) {
  return require('../../controllers/weather.controller').reverseGeocodeDisplayName(lat, lon);
}

// UpdateProject cross-table task-project rename (config.controller.js:273-277).
// Runs inside the SAME transaction via trxRepo.db (the knex trx handle).
function renameTasks(trxRepo, userId, oldName, name) {
  return tasksWrite.updateTasksWhere(trxRepo.db, userId, function (q) {
    return q.where('project', oldName);
  }, { project: name, updated_at: new Date() });
}

// ExportData task read (data.controller.js:218-220) — task slice's
// fetchTasksWithEventIds over getDb(). rowToTask is the task mapper.
function exportFetchTasks(userId, orderBy) {
  var taskController = require('../../controllers/task.controller');
  return taskController.fetchTasksWithEventIds(getDb(), userId, orderBy);
}
function exportRowToTask(row, tz) {
  return require('../../controllers/task.controller').rowToTask(row, tz);
}

// ImportData task collaborators (data.controller.js:75, :128-131, :77-126).
function importWipeTasks(trxRepo, userId) {
  return tasksWrite.deleteTasksWhere(trxRepo.db, userId, function (q) { return q; });
}
function importInsertTask(trxRepo, row) {
  return tasksWrite.insertTask(trxRepo.db, row);
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
  var startAfterDate = (t.startAfter || t.start_after) ? toDateISO(t.startAfter || t.start_after) || null : null;
  var st = statuses || {};

  return {
    id: t.id,
    user_id: userId,
    text: t.text || '',
    scheduled_at: scheduledAt,
    dur: t.dur || 30,
    time_remaining: t.timeRemaining != null ? t.timeRemaining : null,
    pri: t.pri || 'P3',
    project: t.project || null,
    status: st[t.id] || t.status || '',
    section: t.section || null,
    notes: t.notes || null,
    deadline: deadline,
    start_after_at: startAfterDate,
    location: JSON.stringify(locationArr),
    tools: JSON.stringify(t.tools || []),
    when: t.when || null,
    day_req: t.dayReq || 'any',
    recurring: t.recurring ? 1 : 0,
    placementMode: t.placementMode,
    split: t.split === undefined || t.split === null ? null : (t.split ? 1 : 0),
    split_min: t.splitMin || null,
    recur: t.recur ? JSON.stringify(t.recur) : null,
    source_id: t.sourceId || null,
    generated: t.generated ? 1 : 0,
    gcal_event_id: t.gcalEventId || null,
    depends_on: JSON.stringify(t.dependsOn || []),
    created_at: getDb().fn.now(),
    updated_at: getDb().fn.now()
  };
}

// Impersonation auth-service call (impersonation.controller.js:6-26) — verbatim.
function callAuthServiceImpersonate(adminUserId, targetUserId, reason) {
  var { authServiceUrl } = proxyConfig;
  var key = process.env.INTERNAL_SERVICE_KEY;
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

// billing enforceDowngradeLimits (tasks_v + cal_sync_ledger, outside this slice) —
// injected from the legacy controller (the golden-master + my-plan also call it).
function enforceDowngradeLimits(userId, planFeatures) {
  return require('../../controllers/billing-webhooks.controller').enforceDowngradeLimits(userId, planFeatures);
}

// feature-gate I/O primitives — injected from the legacy module so the thin
// middleware delegation keeps the EXACT same DB sequence + the pinned FLAG-2 log
// shape (Surface-6 mocks src/db). These are private to feature-gate.js, so the
// facade re-derives them over the same getDb()/usage-reporter the legacy used.
var usageReporter = require('../../lib/usage-reporter');
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
async function checkAndIncrement(userId, usageKey, limit, periodStart, periodEnd) {
  var db = getDb();
  // `await` (not `.then`) — db.raw resolves to a query that is awaited, exactly as
  // the legacy feature-gate.js:133-140 did (the mock's raw returns a plain value).
  await db.raw(
    'INSERT INTO plan_usage (user_id, usage_key, period_start, period_end, `count`, limit_value, updated_at)\n' +
    '    VALUES (?, ?, ?, ?, 1, ?, NOW())\n' +
    '    ON DUPLICATE KEY UPDATE\n' +
    '      `count` = `count` + 1,\n' +
    '      limit_value = ?,\n' +
    '      updated_at = NOW()',
    [userId, usageKey, periodStart, periodEnd, limit, limit]
  );

  var row = await db('plan_usage')
    .where('user_id', userId)
    .where('usage_key', usageKey)
    .where('period_start', periodStart)
    .first();

  return { allowed: row.count <= limit, currentCount: row.count, limit: limit };
}

// ─────────────────────────────────────────────────────────────────────────────
// USE-CASE CONSTRUCTION (wire adapters → ports → application)
// ─────────────────────────────────────────────────────────────────────────────

// config.controller handlers
var _getConfig = new app.GetConfig({ repo: _repo, cache: cache });
var _getProjects = new app.GetProjects({ repo: _repo });
var _getLocations = new app.GetLocations({ repo: _repo });
var _getTools = new app.GetTools({ repo: _repo });
var _updateConfig = new app.UpdateConfig({ repo: _repo, cache: cache });
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

// feature-catalog.controller handler
var _getFeatureCatalog = new app.GetFeatureCatalog({
  entitlement: _entitlement,
  catalog: require('../../controllers/feature-catalog.controller').CATALOG
});

// impersonation.controller handlers
var _listImpersonationTargets = new app.ListImpersonationTargets({ repo: _repo });
var _getImpersonationLog = new app.GetImpersonationLog({ repo: _repo });
var _impersonate = new app.Impersonate({
  repo: _repo, callAuthServiceImpersonate: callAuthServiceImpersonate, auditLogger: logger
});
var _stopImpersonation = new app.StopImpersonation({ repo: _repo, auditLogger: logger });

// billing-webhooks.controller handler.
// The webhook invalidates / reads the LIVE plan-features cache (the same cache
// resolvePlanFeatures uses — which stays inline in plan-features.middleware.js,
// pinned by the golden-master Surface-7). So the webhook's entitlement seam
// delegates invalidateUserPlan → invalidateUserPlanCache and resolvePlanCatalog →
// getCachedPlanFeatures (the live module fns), NOT the slice adapter's parallel
// cache — preserving the legacy behavior verbatim (golden-master H3-6/H3-7).
var _billingEntitlement = {
  invalidateUserPlan: function (userId) {
    _entitlement.invalidateUserPlan(userId); // bust the adapter instance cache the LIVE gate reads (restores pre-rewire coherence)
    return require('../../middleware/plan-features.middleware').invalidateUserPlanCache(userId); // legacy module-level cache (other consumers)
  },
  resolvePlanCatalog: function () {
    return require('../../middleware/plan-features.middleware').getCachedPlanFeatures();
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
function createProject(input) { return _createProject.execute(input); }
function updateProject(input) { return _updateProject.execute(input); }
function deleteProject(input) { return _deleteProject.execute(input); }
function reorderProjects(input) { return _reorderProjects.execute(input); }
function replaceLocations(input) { return _replaceLocations.execute(input); }
function replaceTools(input) { return _replaceTools.execute(input); }

// ── data.controller ──
function exportData(input) { return _exportData.execute(input); }
function importData(input) { return _importData.execute(input); }

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

module.exports = {
  // facade operations (one per handler/gate) the thin controllers/middleware delegate to
  getAllConfig: getAllConfig,
  getProjects: getProjects,
  getLocations: getLocations,
  getTools: getTools,
  updateConfig: updateConfig,
  createProject: createProject,
  updateProject: updateProject,
  deleteProject: deleteProject,
  reorderProjects: reorderProjects,
  replaceLocations: replaceLocations,
  replaceTools: replaceTools,
  exportData: exportData,
  importData: importData,
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

  // domain ports + adapter implementations (named exports; mirror task/weather)
  ConfigRepositoryPort: ConfigRepositoryPort,
  EntitlementPort: EntitlementPort,
  KnexConfigRepository: KnexConfigRepository,
  InMemoryConfigRepository: InMemoryConfigRepository,
  PaymentServiceEntitlementAdapter: PaymentServiceEntitlementAdapter,
  MockEntitlementAdapter: MockEntitlementAdapter,

  // pure domain re-exports (mirror task facade — consumers go through the facade)
  domain: domain,

  // the singleton adapter instances (so the thin middleware/controllers share state)
  _repo: _repo,
  _entitlement: _entitlement,
};
