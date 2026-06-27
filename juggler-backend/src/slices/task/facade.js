/**
 * Task slice facade — the ONLY public entry point (Phase H3 / W6).
 *
 * Wires adapters → ports → application: instantiates the W3/W4 adapters
 * (KnexTaskRepository over lib/db, RedisTaskCache over lib/cache,
 * EventBusTaskEvents over lib/events) and constructs the 14 W5 use-cases with
 * their injected dependencies, then exposes ONE facade method per the legacy
 * controller's 12 HTTP handlers — each returning the use-case's `{ status, body }`
 * envelope. The thin controller (W6) maps req → input and result → res.
 *
 * Mirrors the weather/calendar facade wiring + JSDoc idiom (slices/weather/facade.js,
 * slices/calendar/facade.js).
 *
 * ── REFACTOR MODE — NO BEHAVIOR CHANGE EXCEPT THE P1 CORRECTION ────────────────
 * Every use-case reproduces the legacy handler step-for-step (W5). The ONLY live
 * behavior change is the human-approved P1/ADR-0003 timestamp-source correction:
 * KnexTaskRepository writes `created_at`/`updated_at`/`completed_at`/`scheduled_at`
 * with `new Date()`, never `db.fn.now()` (Scooter INBOX process-decision 2026-06-10,
 * "behavior-identical EXCEPT the P1-mandated timestamp-source correction"). That
 * correction is SCOPED to the task-table columns the repo write path stamps. The
 * direct-`.update()` collaborator sites on `cal_sync_ledger.synced_at` and
 * `task_masters.rolling_anchor`'s `updated_at` are OUT of P1 scope (Oscar-gated W3
 * RE-REVIEW decision) and retain the legacy `fn.now()` / `trx.fn.now()` verbatim
 * (ernie W6-1) — they are NOT routed through KnexTaskRepository.
 *
 * ── COLLABORATOR WIRING (the W5-flagged list) ────────────────────────────────
 * The use-cases inject:
 *   - infra seams: enqueueScheduleRun (the SOLE scheduler trigger — S4/S6),
 *     ensureProject, isLocked, enqueueWrite, safeTimezone, uuidv7, dateHelpers,
 *     splitFields, hasSchedulingFields, isTerminalStatus, the PLACEMENT_MODES
 *     constants, the zod schemas (batchCreate/batchUpdate/statusUpdate).
 *   - the raw-table side-effect BLOCKS the repo port does NOT model — lifted
 *     VERBATIM from the legacy handlers (recurCleanup, materializeRcInstance,
 *     handleTemplatePause (cascade pause/unpause to instances), loadMaster/isRollingMaster/applyRollingAnchor,
 *     loadSplitSiblings, triggerCalSync, reactivateDoneFrozen, loadCalSyncSettings,
 *     findProviderLedgerRow, cascadeRecurringDelete, standardDelete,
 *     lockedBatchUpdate, batchUpdateTxn, detachLedger, entity counters).
 *
 * Those blocks reach tables outside the TaskRepositoryPort (task_masters,
 * cal_sync_ledger, user_config, projects, tasks_with_sync_v). They use the SAME
 * knex the repository uses (`lib/db.getDefaultDb()`, ADR-0002 — mockable in the
 * golden master which jest.mock's both src/db AND src/lib/db onto one mockDb), and
 * inside a transaction they use the trx handle the trxRepo carries (`trxRepo.db`),
 * so the legacy `getDb().transaction(async trx => …)` boundary is preserved.
 *
 * ── S4/S6 ── enqueueScheduleRun (the SSE-emit + deferred scheduler-enqueue wrapper)
 * is lifted verbatim and remains the SOLE scheduler trigger. The lib-events publish
 * happens at the use-case seam (EventBusTaskEvents), decoupled — no self-trigger,
 * no cascade. As of 999.331 BOTH the fast path and the COMPLEX update path
 * publish TASK_UPDATED after a successful write (the fast path previously did
 * not, which made an H6 scheduler subscriber miss fast-path edits).
 */

'use strict';

// ── pure domain (W2): mappers + validation + closed-enum VOs ─────────────────
var domain = require('./domain');
var mappers = domain.mappers;        // rowToTask, taskToRow, buildSourceMap, TEMPLATE_FIELDS, safeParseJSON…
var validation = domain.validation;  // validateTaskInput, checkCalSyncEditGuard, guardFixedCalendarWhen
var PlacementMode = domain.PlacementMode;

// ── adapters (W3/W4) ─────────────────────────────────────────────────────────
var KnexTaskRepository = require('./adapters/KnexTaskRepository');
var InMemoryTaskRepository = require('./adapters/InMemoryTaskRepository');
var RedisTaskCache = require('./adapters/RedisTaskCache');
var EventBusTaskEvents = require('./adapters/EventBusTaskEvents');

// ── ports (for the public type surface / named exports) ──────────────────────
var TaskRepositoryPort = require('./domain/ports/TaskRepositoryPort');
var TaskCachePort = require('./domain/ports/TaskCachePort');
var TaskEventPort = require('./domain/ports/TaskEventPort');

// ── application use-cases (W5) ───────────────────────────────────────────────
var app = require('./application');

// ── infra seams the use-cases inject (the SAME modules the legacy controller used) ──
var { v7: uuidv7 } = require('uuid');
var { z } = require('zod');
var dateHelpers = require('../../scheduler/dateHelpers');
var safeTimezone = dateHelpers.safeTimezone;
var localToUtc = dateHelpers.localToUtc;
var utcToLocal = dateHelpers.utcToLocal;
var libDb = require('../../lib/db');
var sseEmitter = require('../../lib/sse-emitter');
var { enqueueScheduleRun: _enqueueScheduleRun } = require('../../scheduler/scheduleQueue');
var taskWriteQueue = require('../../lib/task-write-queue');
var isLocked = taskWriteQueue.isLocked;
var enqueueWrite = taskWriteQueue.enqueueWrite;
var splitFields = taskWriteQueue.splitFields;
var tasksWrite = require('../../lib/tasks-write');
var { PLACEMENT_MODES } = require('../../lib/placementModes');
var { isTerminalStatus } = require('../../lib/task-status');
var { isRollingMaster, computeRollingAnchor } = require('../../lib/rolling-anchor');
var { getNowInTimezone } = require('../../../../shared/scheduler/getNowInTimezone');
var { createLogger } = require('@raike/lib-logger');
var logger = createLogger('task.facade');

// `getDb()` shim — returns the SAME knex the repository uses (lib/db.getDefaultDb()),
// which the golden master mocks onto its mockDb. Used by the verbatim raw-table
// collaborators below for cross-table reads outside the TaskRepositoryPort.
function getDb() { return libDb.getDefaultDb(); }

// ── zod schemas (lifted verbatim — controller L1585-1609) ────────────────────
var taskPatchSchema = z.object({
  id: z.string().optional(),
  text: z.string().max(500).optional(),
  dur: z.number().int().min(1).max(480).optional(),
  pri: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  status: z.string().optional(),
  notes: z.string().max(10000).optional(),
  project: z.string().max(100).optional(),
  deadline: z.string().nullable().optional(),
  recurring: z.boolean().optional(),
}).passthrough();
var batchCreateSchema = z.object({
  tasks: z.array(taskPatchSchema).min(1).max(100),
});
var batchUpdateSchema = z.object({
  updates: z.array(taskPatchSchema.extend({ id: z.string().min(1) })).min(1).max(2000),
});
var statusUpdateSchema = z.object({
  status: z.enum(['', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed']),
  completedAt: z.string().optional(),
  direction: z.string().optional(),
}).passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT WIRING (production adapters)
// ─────────────────────────────────────────────────────────────────────────────
var _repo = new KnexTaskRepository();      // over lib/db (ADR-0002)
var _cache = new RedisTaskCache();         // over lib/cache (H2)
var _events = new EventBusTaskEvents();    // over lib/events (ADR-0001, publisher-only)

// ── enqueueScheduleRun (the mutation→schedule trigger wrapper) ───────────────
// Lifted VERBATIM from the legacy controller (L43-69). The SSE emit + deferred
// scheduler enqueue are unchanged — this remains the SOLE scheduler trigger
// (S4/S6); the lib-events publish is decoupled from it.
function enqueueScheduleRun(userId, source, ids, options) {
  options = options || {};
  var payload = { source: source, timestamp: Date.now() };
  if (Array.isArray(ids) && ids.length > 0) payload.ids = ids;
  if (!options.skipEmit) {
    sseEmitter.emit(userId, 'tasks:changed', payload);
  }
  if (options.skipScheduler) return;
  setTimeout(function () { _enqueueScheduleRun(userId, source); }, 2000);
}

// hasSchedulingFields (verbatim — controller L73-76).
function hasSchedulingFields(row) {
  if (!row) return false;
  return Object.keys(splitFields(row).schedulingFields).length > 0;
}

// ── ensureProject (999.354: promoted to ProjectsPort) ────────────────────────
// The projects-table upsert now lives behind KnexProjectsRepository (ProjectsPort).
// This free function is a thin delegate kept ONLY so the facade re-export
// (consumed by task.controller → MCP tools) keeps the same signature. The
// CreateTask/UpdateTask/BatchCreateTasks use-cases depend on the port (_projects),
// not on this function.
var KnexProjectsRepository = require('./adapters/KnexProjectsRepository');
var _projects = new KnexProjectsRepository({ getDb: getDb });
function ensureProject(userId, projectName) {
  return _projects.ensureProject(userId, projectName);
}

// ── validateTaskReferences (999.586) ─────────────────────────────────────────
// DB-backed existence validation for the three reference-array JSON columns on
// task_masters. The pure validateTaskInput() already rejected malformed SHAPES
// (non-array / non-string elements); this checks that referenced IDs actually
// EXIST and belong to the user:
//   - depends_on → every id must be one of the user's task_masters.id values.
//     (Cycle detection is OUT of scope — that is backlog item 999.587.)
//   - location   → every id must be one of the user's locations.location_id values.
//   - tools      → every id must be one of the user's tools.tool_id values.
// Returns an array of human-readable error strings (empty = valid), matching the
// validateTaskInput() contract so the use-case can merge + 400 uniformly.
// Only fields PRESENT in `body` are checked (partial updates don't re-validate
// untouched fields). Empty arrays are valid (they clear the field).
async function validateTaskReferences(userId, body) {
  var errors = [];
  var db = getDb();

  if (Array.isArray(body.dependsOn) && body.dependsOn.length > 0) {
    var depIds = body.dependsOn.slice();
    var foundDeps = await db('task_masters')
      .where('user_id', userId)
      .whereIn('id', depIds)
      .select('id');
    var foundDepSet = {};
    foundDeps.forEach(function (r) { foundDepSet[r.id] = true; });
    var missingDeps = depIds.filter(function (id) { return !foundDepSet[id]; });
    if (missingDeps.length > 0) {
      errors.push('dependsOn references unknown task ID(s): ' + missingDeps.join(', '));
    }
  }

  if (Array.isArray(body.location) && body.location.length > 0) {
    var locIds = body.location.slice();
    var foundLocs = await db('locations')
      .where('user_id', userId)
      .whereIn('location_id', locIds)
      .select('location_id');
    var foundLocSet = {};
    foundLocs.forEach(function (r) { foundLocSet[r.location_id] = true; });
    var missingLocs = locIds.filter(function (id) { return !foundLocSet[id]; });
    if (missingLocs.length > 0) {
      errors.push('location references unknown location ID(s): ' + missingLocs.join(', '));
    }
  }

  if (Array.isArray(body.tools) && body.tools.length > 0) {
    var toolIds = body.tools.slice();
    var foundTools = await db('tools')
      .where('user_id', userId)
      .whereIn('tool_id', toolIds)
      .select('tool_id');
    var foundToolSet = {};
    foundTools.forEach(function (r) { foundToolSet[r.tool_id] = true; });
    var missingTools = toolIds.filter(function (id) { return !foundToolSet[id]; });
    if (missingTools.length > 0) {
      errors.push('tools references unknown tool ID(s): ' + missingTools.join(', '));
    }
  }

  return errors;
}

// ── splitFields shim wrapper (UpdateTask expects { splitFields }) ────────────
var splitFieldsLib = { splitFields: splitFields };

// ─────────────────────────────────────────────────────────────────────────────
// RAW-TABLE SIDE-EFFECT COLLABORATORS — lifted VERBATIM from the handlers.
// These reach tables the TaskRepositoryPort does not model. Inside a transaction
// they use `trxRepo.db` (the raw trx handle) + `trxRepo.tasksWrite` (the
// master/instance write helper); outside a transaction they use getDb().
// ─────────────────────────────────────────────────────────────────────────────

// updateTask COMPLEX-PATH recurrence cleanup + template/instance routing
// (verbatim — controller L1185-1346, the body of getDb().transaction).
async function recurCleanup(ctx) {
  var trx = ctx.trxRepo.db;
  var twrite = ctx.trxRepo.tasksWrite;
  var taskType = ctx.taskType;
  var existing = ctx.existing;
  var row = ctx.row;
  var anchorDateVal = ctx.anchorDateVal;
  var tz = ctx.tz;
  var userId = ctx.userId;
  var id = ctx.id;
  var TEMPLATE_FIELDS = ctx.TEMPLATE_FIELDS;

  if (taskType === 'recurring_instance' && existing.source_id) {
    var templateUpdate = {};
    var instanceUpdate = {};

    Object.keys(row).forEach(function (k) {
      if (k === 'updated_at') return; // added to both
      if (TEMPLATE_FIELDS.indexOf(k) >= 0) {
        templateUpdate[k] = row[k];
      } else {
        instanceUpdate[k] = row[k];
      }
    });

    if (anchorDateVal) {
      templateUpdate.scheduled_at = localToUtc(anchorDateVal, null, tz) || null;
      templateUpdate.desired_at = templateUpdate.scheduled_at;
    }

    if (Object.keys(templateUpdate).length > 0) {
      await twrite.updateTaskById(trx, existing.source_id, templateUpdate, userId);
    }

    if (templateUpdate.recur !== undefined) {
      await twrite.resetRecurringInstances(trx, userId, existing.source_id, '[RECUR] cycle reset via instance edit');
    }

    if (Object.keys(instanceUpdate).length > 0) {
      await twrite.updateTaskById(trx, id, instanceUpdate, userId);
    } else {
      await twrite.updateTaskById(trx, id, {}, userId);
    }
  } else if (taskType === 'recurring_template') {
    await twrite.updateTaskById(trx, id, row, userId);

    var needsCleanup = row.recur !== undefined || row.recur_start !== undefined || row.recur_end !== undefined
      || row.recurring === 0
      // R53: a split/split_min change reshapes chunk count/size — refabricate future instances.
      || row.split !== undefined || row.split_min !== undefined;
    if (needsCleanup) {
      if (row.recurring === 0) {
        await twrite.resetRecurringInstances(trx, userId, id, '[RECUR] toggle-off: recurring=false');
        await trx('task_instances')
          .insert({
            id: id,
            master_id: id,
            user_id: userId,
            occurrence_ordinal: 1,
            split_ordinal: 1,
            split_total: 1,
            dur: existing.dur || 30,
            status: existing.status || '',
            scheduled_at: existing.scheduled_at || null,
            overdue: 0,
            generated: 0,
            created_at: new Date(),
            updated_at: new Date()
          })
          .onConflict(['master_id', 'occurrence_ordinal', 'split_ordinal']).ignore();
      } else {
        var updatedTmpl = Object.assign({}, existing, row);
        var newRecur = typeof updatedTmpl.recur === 'string' ? JSON.parse(updatedTmpl.recur || 'null') : updatedTmpl.recur;
        var oldRecur = typeof existing.recur === 'string' ? JSON.parse(existing.recur || 'null') : existing.recur;

        var recurChanged = row.recur !== undefined && (
          (oldRecur && newRecur && (
            oldRecur.type !== newRecur.type ||
            JSON.stringify(oldRecur.days) !== JSON.stringify(newRecur.days) ||
            (oldRecur.timesPerCycle || 0) !== (newRecur.timesPerCycle || 0)
          )) ||
          (!oldRecur && newRecur) ||
          (oldRecur && !newRecur)
        );

        // R53: split/split_min change also reshapes the instance set.
        var splitChanged = (row.split !== undefined && Number(row.split) !== Number(existing.split))
          || (row.split_min !== undefined && Number(row.split_min) !== Number(existing.split_min));

        if (recurChanged || splitChanged) {
          await twrite.resetRecurringInstances(trx, userId, id, '[RECUR] cycle reset (recur/split change)');
        } else {
          var _dateMatch = require('../../../shared/scheduler/dateMatchesRecurrence');
          var srcDateStr = updatedTmpl.recur_start
            ? (updatedTmpl.recur_start instanceof Date
                ? dateHelpers.formatDateKey(updatedTmpl.recur_start)
                : (function () {
                    var iso = String(updatedTmpl.recur_start).match(/^(\d{4})-(\d{2})-(\d{2})/);
                    return iso ? Number(iso[2]) + '/' + Number(iso[3]) : String(updatedTmpl.recur_start);
                  })())
            : (updatedTmpl.scheduled_at ? utcToLocal(updatedTmpl.scheduled_at, tz).date : null);

          var pendingInstances = await trx('tasks_v')
            .where({ source_id: id, user_id: userId, task_type: 'recurring_instance' })
            .where('status', '');

          var deleteIds = [];
          pendingInstances.forEach(function (inst) {
            var instDate = inst.scheduled_at ? utcToLocal(inst.scheduled_at, tz).date : null;
            if (!instDate) { deleteIds.push(inst.id); return; }
            if (!newRecur || newRecur.type === 'none' ||
                !_dateMatch.dateMatchesRecurrence(instDate, newRecur, srcDateStr, dateHelpers.parseDate)) {
              deleteIds.push(inst.id); return;
            }
            if (updatedTmpl.recur_start) {
              var hs = dateHelpers.parseDate(updatedTmpl.recur_start instanceof Date
                ? dateHelpers.formatDateKey(updatedTmpl.recur_start)
                : String(updatedTmpl.recur_start).replace(/-/g, '/').replace(/^0/, ''));
              var instD = dateHelpers.parseDate(instDate);
              if (hs && instD && instD < hs) { deleteIds.push(inst.id); return; }
            }
            if (updatedTmpl.recur_end) {
              var he = dateHelpers.parseDate(updatedTmpl.recur_end instanceof Date
                ? dateHelpers.formatDateKey(updatedTmpl.recur_end)
                : String(updatedTmpl.recur_end).replace(/-/g, '/').replace(/^0/, ''));
              var instD2 = dateHelpers.parseDate(instDate);
              if (he && instD2 && instD2 > he) { deleteIds.push(inst.id); return; }
            }
          });

          if (deleteIds.length > 0) {
            await twrite.deleteTasksWhere(trx, userId, function (q) {
              return q.whereIn('id', deleteIds);
            });
          }
        }
      }
    }
  } else {
    await twrite.updateTaskById(trx, id, row, userId);
  }
}

// updateTaskStatus rc_ on-demand materialization (verbatim — controller L1639-1668).
// Returns the materialized existing row (or null if the source is missing).
async function materializeRcInstance(ctx) {
  var id = ctx.id;
  var userId = ctx.userId;
  var tz = ctx.tz;
  var repo = ctx.repo;
  var parts = id.split('_');
  var dateDigits = parts[parts.length - 1];
  var sourceId = parts.slice(1, -1).join('_');
  var source = await repo.fetchTaskWithEventIds(sourceId, userId);
  if (!source) return null;
  var first2 = parseInt(dateDigits.substring(0, 2), 10);
  var localDate;
  if (dateDigits.length >= 3 && first2 >= 10 && first2 <= 12) {
    localDate = dateDigits.substring(0, 2) + '/' + dateDigits.substring(2);
  } else {
    localDate = dateDigits.substring(0, 1) + '/' + dateDigits.substring(1);
  }
  var srcTime = source.scheduled_at ? utcToLocal(source.scheduled_at, tz).time : null;
  var scheduledAt = localToUtc(localDate, srcTime, tz);
  // P1: created_at/updated_at via new Date() (repo asserts Dates on insert).
  await repo.insertTask({
    id: id,
    user_id: userId,
    task_type: 'recurring_instance',
    source_id: sourceId,
    generated: 0,
    recurring: 1,
    scheduled_at: scheduledAt || null,
    status: '',
    created_at: new Date(),
    updated_at: new Date()
  });
  return repo.fetchTaskWithEventIds(id, userId);
}

// updateTaskStatus recurring_template pause/unpause cascade (999.590).
// On pause: cascade pause status to all future open instances of the template.
// On unpause: cascade '' (active) status to all paused instances of the template.
// Returns { pausedCount, pausedIds } on pause or { unpausedCount, unpausedIds } on unpause.
async function handleTemplatePause(ctx) {
  var id = ctx.id;
  var userId = ctx.userId;
  var status = ctx.status;

  if (status === 'pause') {
    // Cascade pause to all open (status='') future instances of this template.
    // This keeps the instances in the system (identified as unscheduled per user
    // ruling) rather than deleting them, matching the pattern used by billing
    // downgrade's cascade of 'disabled' to instances.
    var pausedIds = [];
    var futureInstances = await getDb()('tasks_with_sync_v')
      .where({ source_id: id, user_id: userId })
      .where('status', '')
      .where('scheduled_at', '>', new Date())
      .select('id', 'gcal_event_id');
    if (!Array.isArray(futureInstances)) futureInstances = [];

    pausedIds = futureInstances.map(function (i) { return i.id; });

    if (pausedIds.length > 0) {
      // Mark cal_sync ledger entries as deleted_local so paused instances don't
      // create stale calendar events — the same cleanup the old delete path used.
      await getDb()('cal_sync_ledger')
        .where('user_id', userId)
        .whereIn('task_id', pausedIds)
        .where('status', 'active')
        .update({ status: 'deleted_local', task_id: null, synced_at: getDb().fn.now() })
        .catch(function (err) { logger.error('[silent-catch]', err.message); });

      // Cascade pause status to the instances (matching the billing downgrade pattern
      // that sets status='disabled' on instances via tasksWrite.updateInstancesWhere).
      await tasksWrite.updateInstancesWhere(getDb(), userId, function (q) {
        return q.whereIn('id', pausedIds);
      }, { status: 'pause' });
    }

    return { pausedCount: pausedIds.length, pausedIds: pausedIds };
  }

  // Unpause: re-activate all instances that were paused because the template was paused.
  // This mirrors the ReEnableTask pattern that sets status='' on disabled instances.
  if (status === '') {
    var pausedInstances = await getDb()('tasks_with_sync_v')
      .where({ source_id: id, user_id: userId })
      .where('status', 'pause')
      .select('id');
    if (!Array.isArray(pausedInstances)) pausedInstances = [];

    var unpausedIds = pausedInstances.map(function (i) { return i.id; });

    if (unpausedIds.length > 0) {
      await tasksWrite.updateInstancesWhere(getDb(), userId, function (q) {
        return q.whereIn('id', unpausedIds);
      }, { status: '' });
    }

    return { unpausedCount: unpausedIds.length, unpausedIds: unpausedIds };
  }

  return { pausedCount: 0, pausedIds: [], unpausedCount: 0, unpausedIds: [] };
}

// updateTaskStatus rolling-master load (999.354: folded into TaskRepositoryPort).
function loadMaster(masterId, userId) {
  return _repo.getMasterById(masterId, userId);
}

// updateTaskStatus rolling-anchor projection (verbatim — controller L1790-1808).
async function applyRollingAnchor(ctx) {
  var masterId = ctx.masterId;
  var userId = ctx.userId;
  var status = ctx.status;
  var existing = ctx.existing;
  var _masterForAnchor = ctx.preloadedMaster
    || await _repo.getMasterById(masterId, userId);
  if (_masterForAnchor && isRollingMaster(_masterForAnchor)) {
    var _instanceDate = existing.date ? String(existing.date).slice(0, 10) : null;
    var _currentAnchor = _masterForAnchor.rolling_anchor
      ? String(_masterForAnchor.rolling_anchor).slice(0, 10)
      : null;
    // Option B: anchor `done` to the ACTUAL completion date (today in the user's tz),
    // not the scheduled date, so a late completion pushes the next occurrence out.
    var _completionDate = getNowInTimezone(ctx.tz || _masterForAnchor.tz).todayKey;
    var _newAnchor = computeRollingAnchor(status, _instanceDate, _currentAnchor, _completionDate);
    if (_newAnchor) {
      await getDb()('task_masters')
        .where({ id: masterId, user_id: userId })
        .update({ rolling_anchor: _newAnchor, updated_at: getDb().fn.now() });
    }
  }
}

// updateTaskStatus split-chunk sibling lookup (999.354: folded into TaskRepositoryPort).
function loadSplitSiblings(ctx) {
  return _repo.getSplitSiblingIds(ctx.userId, ctx.masterId, ctx.occurrenceOrdinal, ctx.excludeId);
}

// updateTaskStatus done-frozen reactivation (verbatim — controller L1775-1777).
async function reactivateDoneFrozen(ctx) {
  await getDb()('cal_sync_ledger')
    .where({ user_id: ctx.userId, task_id: ctx.id, status: 'done_frozen' })
    .update({ status: 'active', synced_at: getDb().fn.now() });
}

// updateTaskStatus skip/cancel outbound cal-sync trigger (verbatim — controller L1843-1854).
// Exposes a `.sync({ userId })` shape the use-case calls fire-and-forget.
var triggerCalSync = {
  sync: function (args) {
    var userId = args.userId;
    try {
      var syncController = require('../../controllers/cal-sync.controller');
      if (syncController && typeof syncController.sync === 'function') {
        return syncController.sync(
          { user: { id: userId }, body: {} },
          { json: function () {}, status: function () { return { json: function () {} }; } }
        );
      }
    } catch (err) {
      logger.error('[cal-sync] trigger import failed:', err && err.message);
    }
    return Promise.resolve();
  }
};

// deleteTask cal_sync_settings read (verbatim — controller L1388-1392).
async function loadCalSyncSettings(userId) {
  var _csRow = await getDb()('user_config')
    .where({ user_id: userId, config_key: 'cal_sync_settings' }).first();
  return _csRow
    ? (typeof _csRow.config_value === 'string' ? JSON.parse(_csRow.config_value) : _csRow.config_value)
    : {};
}

// deleteTask provider-origin ledger lookup (verbatim — controller L1407-1410).
function findProviderLedgerRow(userId, id) {
  return getDb()('cal_sync_ledger')
    .where({ user_id: userId, task_id: id, status: 'active' })
    .where('origin', '!=', 'juggler')
    .first();
}

// deleteTask cascade-recurring delete block (verbatim — controller L1434-1498, the
// body of getDb().transaction). Returns { deletedCount, keptCount, pendingIds, keptIds }.
async function cascadeRecurringDelete(ctx) {
  var trx = ctx.trxRepo.db;
  var twrite = ctx.trxRepo.tasksWrite;
  var userId = ctx.userId;
  var templateId = ctx.templateId;
  var deletedCount = 0;
  var keptCount = 0;
  var pendingIds = [];
  var keptIds = [];

  var instances = await trx('tasks_with_sync_v')
    .where({ user_id: userId, source_id: templateId })
    .select('id', 'status', 'gcal_event_id', 'msft_event_id');

  // 999.844 Guard 1: a series-delete must KEEP every history-bearing instance
  // verbatim — done/cancel/skip AND pause/missed. Only genuinely-active/pending
  // instances are soft-cancelled (status='cancelled') to stop the series. Before
  // this, pause/missed were treated as pending and overwritten to 'cancelled',
  // losing the original terminal state.
  var TERMINAL_KEEP = ['done', 'cancel', 'skip', 'pause', 'missed'];

  pendingIds = instances
    .filter(function (inst) {
      return TERMINAL_KEEP.indexOf(inst.status || '') === -1;
    })
    .map(function (inst) { return inst.id; });

  if (pendingIds.length > 0) {
    await trx('cal_sync_ledger')
      .where('user_id', userId)
      .whereIn('task_id', pendingIds)
      .where('status', 'active')
      .update({ status: 'deleted_local', task_id: null, synced_at: trx.fn.now() })
      .catch(function (err) { logger.error('[silent-catch]', err.message); });

    // R55 no-hard-delete: soft-cancel (status='cancelled', keep rows as record)
    // instead of .del(). The ledger cleanup above still removes external cal events.
    await twrite.softCancelWhere(trx, userId, function (q) {
      return q.whereIn('id', pendingIds);
    });
    deletedCount = pendingIds.length;
  }

  keptIds = instances
    .filter(function (inst) {
      return TERMINAL_KEEP.indexOf(inst.status || '') !== -1;
    })
    .map(function (inst) { return inst.id; });
  // R55 + 999.844: history-bearing instances (done/cancel/skip/pause/missed) are
  // KEPT verbatim as the historical record — never deleted, never overwritten.
  // They are already terminal/frozen and excluded from the scheduler write-set,
  // so no status change is needed.
  keptCount = keptIds.length;

  var template = await trx('tasks_with_sync_v').where({ id: templateId, user_id: userId }).first();
  if (template) {
    if (template.gcal_event_id || template.msft_event_id) {
      await trx('cal_sync_ledger')
        .where({ user_id: userId, task_id: templateId })
        .where('status', 'active')
        .update({ status: 'deleted_local', task_id: null, synced_at: trx.fn.now() })
        .catch(function (err) { logger.error('[silent-catch]', err.message); });
    }
    await twrite.softCancelById(trx, templateId, userId); // R55 soft-cancel master, keep as record
  }

  return { deletedCount: deletedCount, keptCount: keptCount, pendingIds: pendingIds, keptIds: keptIds };
}

// deleteTask standard single-task delete block (verbatim — controller L1531-1564,
// the body of getDb().transaction).
async function standardDelete(ctx) {
  var trx = ctx.trxRepo.db;
  var twrite = ctx.trxRepo.tasksWrite;
  var userId = ctx.userId;
  var id = ctx.id;
  var task = ctx.task;

  var deletedDeps = typeof task.depends_on === 'string'
    ? JSON.parse(task.depends_on || '[]') : (task.depends_on || []);
  var affected = await trx('tasks_v')
    .where('user_id', userId)
    .whereRaw('JSON_CONTAINS(depends_on, ?)', [JSON.stringify(id)])
    .select('id', 'depends_on');
  if (affected.length > 0) {
    var depUpdates = affected.map(function (other) {
      var deps = typeof other.depends_on === 'string'
        ? JSON.parse(other.depends_on || '[]') : (other.depends_on || []);
      var newDeps = deps.filter(function (d) { return d !== id; });
      deletedDeps.forEach(function (d) { if (newDeps.indexOf(d) === -1) newDeps.push(d); });
      return { id: other.id, depends_on: JSON.stringify(newDeps) };
    });
    await Promise.all(depUpdates.map(function (u) {
      return twrite.updateTaskById(trx, u.id, {
        depends_on: u.depends_on, updated_at: new Date()
      }, userId);
    }));
  }

  if (task.gcal_event_id || task.msft_event_id || task.apple_event_id) {
    await trx('cal_sync_ledger')
      .where({ user_id: userId, task_id: id })
      .where('status', 'active')
      .update({ status: 'deleted_local', task_id: null, synced_at: trx.fn.now() })
      .catch(function (err) { logger.error('[silent-catch]', err.message); });
  }

  await twrite.softCancelById(trx, id, userId); // R55 no-hard-delete: soft-cancel single task, keep as record
}

// deleteTask this_and_future delete block (999.680). For recurring templates: deletes
// the current instance (the one matching `id`), plus all future (pending, status='')
// instances, plus the template master. Completed/past instances are kept.
// Returns { deletedCount, keptCount, pendingIds, keptIds }.
async function thisAndFutureDelete(ctx) {
  var trx = ctx.trxRepo.db;
  var twrite = ctx.trxRepo.tasksWrite;
  var userId = ctx.userId;
  var id = ctx.id;
  var templateId = ctx.templateId;
  var _task = ctx.task;
  var deletedCount = 0;
  var keptCount = 0;
  var pendingIds = [];
  var keptIds = [];

  // Fetch all instances of this template
  var instances = await trx('tasks_with_sync_v')
    .where({ user_id: userId, source_id: templateId })
    .select('id', 'status', 'gcal_event_id', 'msft_event_id');

  // Instances that are open/pending (not done/cancel/skip) — these are "future"
  pendingIds = instances
    .filter(function (inst) {
      if (inst.id === id) return true; // always include the current instance
      var st = inst.status || '';
      return st !== 'done' && st !== 'cancel' && st !== 'skip';
    })
    .map(function (inst) { return inst.id; });

  if (pendingIds.length > 0) {
    // Clean ledger for deleted instances
    await trx('cal_sync_ledger')
      .where('user_id', userId)
      .whereIn('task_id', pendingIds)
      .where('status', 'active')
      .update({ status: 'deleted_local', task_id: null, synced_at: trx.fn.now() })
      .catch(function (err) { logger.error('[silent-catch]', err.message); });

    // R55 no-hard-delete: soft-cancel (status='cancelled', keep rows as record)
    // instead of .del(). The ledger cleanup above still removes external cal events.
    await twrite.softCancelWhere(trx, userId, function (q) {
      return q.whereIn('id', pendingIds);
    });
    deletedCount = pendingIds.length;
  }

  // Kept instances (completed/past)
  keptIds = instances
    .filter(function (inst) {
      return pendingIds.indexOf(inst.id) === -1;
    })
    .map(function (inst) { return inst.id; });
  keptCount = keptIds.length;

  // Delete the template master itself
  var template = await trx('tasks_with_sync_v').where({ id: templateId, user_id: userId }).first();
  if (template) {
    if (template.gcal_event_id || template.msft_event_id) {
      await trx('cal_sync_ledger')
        .where({ user_id: userId, task_id: templateId })
        .where('status', 'active')
        .update({ status: 'deleted_local', task_id: null, synced_at: trx.fn.now() })
        .catch(function (err) { logger.error('[silent-catch]', err.message); });
    }
    await twrite.softCancelById(trx, templateId, userId); // R55 soft-cancel master, keep as record
  }

  return { deletedCount: deletedCount, keptCount: keptCount, pendingIds: pendingIds, keptIds: keptIds };
}

// batchUpdateTasks LOCKED-path block (verbatim — controller L1990-2050). Returns
// { updatedCount, queuedCount, idsToCheck, calSyncGuard? }.
async function lockedBatchUpdate(ctx) {
  var userId = ctx.userId;
  var updates = ctx.updates;
  var tz = ctx.tz;
  var updatedCount = 0;
  var queuedCount = 0;

  var idsToCheck = updates.map(function (u) { return u.id; }).filter(Boolean);
  var existCheck = await getDb()('tasks_with_sync_v')
    .where('user_id', userId)
    .whereIn('id', idsToCheck)
    .select('id', 'task_type', 'source_id', 'scheduled_at', 'status',
            'when', 'gcal_event_id', 'msft_event_id');
  var existById = {};
  existCheck.forEach(function (r) { existById[r.id] = r; });

  var _lockedLedger = await getDb()('cal_sync_ledger')
    .whereIn('task_id', idsToCheck)
    .where('status', 'active')
    .select('task_id', 'origin');
  var _lockedOriginById = {};
  _lockedLedger.forEach(function (r) {
    if (!_lockedOriginById[r.task_id] || _lockedOriginById[r.task_id] === 'juggler') {
      _lockedOriginById[r.task_id] = r.origin || null;
    }
  });
  existCheck.forEach(function (r) { r.cal_sync_origin = _lockedOriginById[r.id] || null; });

  for (var qi = 0; qi < updates.length; qi++) {
    var qUpdate = updates[qi];
    var qId = qUpdate.id;
    if (!qId) continue;
    var qExisting = existById[qId];
    if (qExisting && qExisting.status === 'disabled') continue;

    var qFields = {};
    Object.keys(qUpdate).forEach(function (k) { if (k !== 'id') qFields[k] = qUpdate[k]; });
    var qGuard = validation.checkCalSyncEditGuard(qExisting, qFields);
    if (qGuard) return { calSyncGuard: qGuard };

    var qTz = qFields._timezone || tz;
    delete qFields._timezone;
    delete qFields.anchorDate;
    var qRow = mappers.taskToRow(qFields, userId, qTz, qExisting);
    delete qRow.user_id;
    delete qRow.created_at;
    delete qRow._pendingTimeOnly;

    validation.guardFixedCalendarWhen(qRow, qExisting, { allowUnfix: !!qFields._allowUnfix });

    var qSplit = splitFields(qRow);
    var schedulingFields = qSplit.schedulingFields;
    var nonSchedulingFields = qSplit.nonSchedulingFields;

    if (Object.keys(nonSchedulingFields).length > 0) {
      // P1: omit updated_at — repo stamps new Date() (legacy passed fn.now()).
      await ctx.repo.updateTaskById(qId, nonSchedulingFields, userId);
      updatedCount++;
    }

    if (Object.keys(schedulingFields).length > 0) {
      await enqueueWrite(userId, qId, 'update', schedulingFields, 'api:batchUpdateTasks');
      queuedCount++;
    }
  }

  return { updatedCount: updatedCount, queuedCount: queuedCount, idsToCheck: idsToCheck };
}

// batchUpdateTasks UNLOCKED transactional per-item routing (verbatim — controller
// L2068-2240, the body of getDb().transaction). Returns { updatedCount,
// anySchedulingInBatch }; throws an err with `.calSyncGuard` on a blocked item.
async function batchUpdateTxn(ctx) {
  var trx = ctx.trxRepo.db;
  var twrite = ctx.trxRepo.tasksWrite;
  var userId = ctx.userId;
  var updates = ctx.updates;
  var tz = ctx.tz;
  var TEMPLATE_FIELDS = mappers.TEMPLATE_FIELDS;
  var updatedCount = 0;
  var anySchedulingInBatch = false;

  var idsToUpdate = updates.map(function (u) { return u.id; }).filter(Boolean);
  var existingRows = await trx('tasks_with_sync_v')
    .where('user_id', userId)
    .whereIn('id', idsToUpdate)
    .select('id', 'task_type', 'source_id', 'scheduled_at', 'status',
            'when', 'gcal_event_id', 'msft_event_id');
  var existingById = {};
  existingRows.forEach(function (r) { existingById[r.id] = r; });

  var _batchLedger = await trx('cal_sync_ledger')
    .whereIn('task_id', idsToUpdate)
    .where('status', 'active')
    .select('task_id', 'origin');
  var _batchOriginById = {};
  _batchLedger.forEach(function (r) {
    if (!_batchOriginById[r.task_id] || _batchOriginById[r.task_id] === 'juggler') {
      _batchOriginById[r.task_id] = r.origin || null;
    }
  });
  existingRows.forEach(function (r) { r.cal_sync_origin = _batchOriginById[r.id] || null; });

  var srcIds = [];
  existingRows.forEach(function (r) {
    if (r.task_type === 'recurring_instance' && r.source_id && srcIds.indexOf(r.source_id) < 0) {
      srcIds.push(r.source_id);
    }
  });
  var templateById = {};
  if (srcIds.length > 0) {
    var tmplRows = await trx('tasks_with_sync_v')
      .where('user_id', userId)
      .whereIn('id', srcIds)
      .select('id', 'when', 'gcal_event_id', 'msft_event_id');
    tmplRows.forEach(function (r) { templateById[r.id] = r; });
  }

  for (var i = 0; i < updates.length; i++) {
    var update = updates[i];
    var id = update.id;
    if (!id) continue;

    var fields = {};
    Object.keys(update).forEach(function (k) { if (k !== 'id') fields[k] = update[k]; });
    var updateTz = fields._timezone || tz;
    delete fields._timezone;
    var anchorDateVal = fields.anchorDate;
    delete fields.anchorDate;
    var existing = existingById[id];
    var _batchGuard = validation.checkCalSyncEditGuard(existing, fields);
    if (_batchGuard) {
      var _batchErr = new Error('CAL_SYNCED_READONLY');
      _batchErr.calSyncGuard = _batchGuard;
      throw _batchErr;
    }

    var row = mappers.taskToRow(fields, userId, updateTz, existing);
    delete row.user_id;
    delete row.created_at;
    if (!anySchedulingInBatch && hasSchedulingFields(row)) anySchedulingInBatch = true;

    if (existing && existing.status === 'disabled') continue;

    if (row._pendingTimeOnly && existing && existing.scheduled_at) {
      var existingDt = new Date(existing.scheduled_at);
      var existingLocal = utcToLocal(existingDt, updateTz);
      if (existingLocal) {
        var existingDate = existingLocal.date;
        row.scheduled_at = localToUtc(existingDate, row._pendingTimeOnly, updateTz) || null;
        if (row.desired_at === undefined) row.desired_at = row.scheduled_at;
      }
    }
    delete row._pendingTimeOnly;

    if (row.scheduled_at && existing && existing.scheduled_at
        && update.date !== undefined && update.time === undefined) {
      var existLocal = utcToLocal(existing.scheduled_at, updateTz);
      if (existLocal && existLocal.time) {
        var newDate = update.date;
        row.scheduled_at = localToUtc(newDate, existLocal.time, updateTz) || row.scheduled_at;
        if (row.desired_at === undefined) row.desired_at = row.scheduled_at;
      }
    }

    if (existing && (existing.task_type === 'recurring_template' || existing.task_type === 'recurring_instance')) {
      delete row.depends_on;
    }

    var taskType = existing ? (existing.task_type || 'task') : 'task';

    if (taskType === 'recurring_template' && row.status !== undefined) {
      delete row.status;
    }

    if (row.when !== undefined && existing) {
      var _bGuardOpts = { allowUnfix: !!update._allowUnfix };
      if (taskType === 'recurring_instance' && existing.source_id) {
        validation.guardFixedCalendarWhen(row, templateById[existing.source_id], _bGuardOpts);
      } else {
        validation.guardFixedCalendarWhen(row, existing, _bGuardOpts);
      }
    }

    if (taskType === 'recurring_instance' && existing && existing.source_id) {
      var templateUpdate = {};
      var instanceUpdate = {};
      Object.keys(row).forEach(function (k) {
        if (k === 'updated_at') return;
        if (TEMPLATE_FIELDS.indexOf(k) >= 0) {
          templateUpdate[k] = row[k];
        } else {
          instanceUpdate[k] = row[k];
        }
      });
      if (anchorDateVal) {
        templateUpdate.scheduled_at = localToUtc(anchorDateVal, null, updateTz) || null;
        templateUpdate.desired_at = templateUpdate.scheduled_at;
      }

      if (Object.keys(templateUpdate).length > 0) {
        await twrite.updateTaskById(trx, existing.source_id, templateUpdate, userId);
      }
      if (templateUpdate.recur !== undefined || templateUpdate.recurring === 0) {
        await twrite.resetRecurringInstances(trx, userId, existing.source_id, '[BATCH] cycle reset');
      }
      if (Object.keys(instanceUpdate).length > 0) {
        await twrite.updateTaskById(trx, id, instanceUpdate, userId);
      } else {
        await twrite.updateTaskById(trx, id, {}, userId);
      }
    } else {
      if (anchorDateVal && taskType === 'recurring_template') {
        row.scheduled_at = localToUtc(anchorDateVal, null, updateTz) || null;
        row.desired_at = row.scheduled_at;
      }
      await twrite.updateTaskById(trx, id, row, userId);
      if (taskType === 'recurring_template' && (row.recur !== undefined || row.recurring === 0)) {
        await twrite.resetRecurringInstances(trx, userId, id, '[BATCH] cycle reset on template');
      }
    }
    updatedCount++;
  }

  return { updatedCount: updatedCount, anySchedulingInBatch: anySchedulingInBatch };
}

// takeOwnership ledger detach (verbatim — controller L2403-2405).
async function detachLedger(ctx) {
  await ctx.trxRepo.db('cal_sync_ledger')
    .where({ task_id: ctx.id, user_id: ctx.userId, status: 'active' })
    .update({ status: 'deleted_local', synced_at: ctx.trxRepo.db.fn.now() });
}

// reEnableTask disabled-instance counter (verbatim — controller L2314-2317).
async function countDisabledInstances(userId, id) {
  var disabledInstances = await getDb()('tasks_v')
    .where({ source_id: id, user_id: userId, status: 'disabled' })
    .count('* as count').first();
  return parseInt(disabledInstances.count, 10);
}

// entity-limit counters — resolved LAZILY (the legacy reEnableTask did
// `require('../middleware/entity-limits')` INSIDE the handler, L2300). Lazy
// indirection matches that call-time resolution and tolerates partial test mocks
// of entity-limits that omit the counters (the import surface stays unchanged).
function countActiveTasks(userId) {
  return require('../../middleware/entity-limits').countActiveTasks(userId);
}
function countRecurringTemplates(userId) {
  return require('../../middleware/entity-limits').countRecurringTemplates(userId);
}

// deadlock-retry backoff (verbatim — controller L2247).
function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

// ─────────────────────────────────────────────────────────────────────────────
// USE-CASE CONSTRUCTION (wire adapters → ports → application)
// ─────────────────────────────────────────────────────────────────────────────
var _listTasks = new app.ListTasks({ repo: _repo, cache: _cache, mappers: mappers });
var _getTask = new app.GetTask({ repo: _repo, mappers: mappers });
var _getVersion = new app.GetVersion({ repo: _repo, cache: _cache });
var _getDisabledTasks = new app.GetDisabledTasks({ repo: _repo, mappers: mappers });
var _searchTasks = new app.SearchTasks({ repo: _repo, mappers: mappers });

// ── 999.681: Action logging for undo ──────────────────────────────────────────
var KnexActionLogRepository = require('./adapters/KnexActionLogRepository');
var _actionLog = new KnexActionLogRepository();

var _recordAction = new app.RecordAction({
  actionLog: _actionLog,
  uuidv7: uuidv7
});

var _createTask = new app.CreateTask({
  repo: _repo, cache: _cache, events: _events,
  enqueueScheduleRun: enqueueScheduleRun,
  mappers: mappers, validation: validation,
  validateReferences: validateTaskReferences,
  projects: _projects, isLocked: isLocked, enqueueWrite: enqueueWrite,
  uuidv7: uuidv7, safeTimezone: safeTimezone, placementModes: PLACEMENT_MODES,
  logger: logger
});

var _updateTask = new app.UpdateTask({
  repo: _repo, cache: _cache, events: _events,
  enqueueScheduleRun: enqueueScheduleRun,
  mappers: mappers, validation: validation,
  validateReferences: validateTaskReferences,
  hasSchedulingFields: hasSchedulingFields, splitFieldsLib: splitFieldsLib,
  projects: _projects, isLocked: isLocked, enqueueWrite: enqueueWrite,
  safeTimezone: safeTimezone, dateHelpers: dateHelpers, placementModes: PLACEMENT_MODES,
  recurCleanup: recurCleanup, logger: logger
});

var _updateTaskStatus = new app.UpdateTaskStatus({
  repo: _repo, cache: _cache, events: _events,
  enqueueScheduleRun: enqueueScheduleRun,
  mappers: mappers, statusUpdateSchema: statusUpdateSchema,
  safeTimezone: safeTimezone, dateHelpers: dateHelpers, isTerminalStatus: isTerminalStatus,
  materializeRcInstance: materializeRcInstance, handleTemplatePause: handleTemplatePause,
  loadMaster: loadMaster, isRollingMaster: isRollingMaster, applyRollingAnchor: applyRollingAnchor,
  loadSplitSiblings: loadSplitSiblings, triggerCalSync: triggerCalSync,
  reactivateDoneFrozen: reactivateDoneFrozen, logger: logger,
  recordAction: _recordAction
});

var _completeTask = new app.CompleteTask({ updateTaskStatus: _updateTaskStatus });
var _splitTask = new app.SplitTask({ createTask: _createTask, updateTask: _updateTask });

var _deleteTask = new app.DeleteTask({
  repo: _repo, cache: _cache, enqueueScheduleRun: enqueueScheduleRun,
  loadCalSyncSettings: loadCalSyncSettings, findProviderLedgerRow: findProviderLedgerRow,
  cascadeRecurringDelete: cascadeRecurringDelete, standardDelete: standardDelete,
  thisAndFutureDelete: thisAndFutureDelete
});

var _batchCreateTasks = new app.BatchCreateTasks({
  repo: _repo, cache: _cache, enqueueScheduleRun: enqueueScheduleRun,
  mappers: mappers, validation: validation, batchCreateSchema: batchCreateSchema,
  projects: _projects, isLocked: isLocked, enqueueWrite: enqueueWrite,
  safeTimezone: safeTimezone, sleep: sleep
});

var _batchUpdateTasks = new app.BatchUpdateTasks({
  repo: _repo, cache: _cache, enqueueScheduleRun: enqueueScheduleRun,
  validation: validation, batchUpdateSchema: batchUpdateSchema, safeTimezone: safeTimezone,
  isLocked: isLocked, lockedBatchUpdate: lockedBatchUpdate, batchUpdateTxn: batchUpdateTxn,
  sleep: sleep
});

var _reEnableTask = new app.ReEnableTask({
  repo: _repo, cache: _cache, enqueueScheduleRun: enqueueScheduleRun, mappers: mappers,
  countActiveTasks: countActiveTasks, countRecurringTemplates: countRecurringTemplates,
  countDisabledInstances: countDisabledInstances
});

var _takeOwnership = new app.TakeOwnership({
  repo: _repo, cache: _cache, enqueueScheduleRun: enqueueScheduleRun, mappers: mappers,
  detachLedger: detachLedger, placementModes: PLACEMENT_MODES
});

// ── 999.681: Undo Last Action ─────────────────────────────────────────────────
var _undoTask = new app.UndoTask({
  actionLog: _actionLog,
  repo: _repo, cache: _cache,
  enqueueScheduleRun: enqueueScheduleRun,
  mappers: mappers, isTerminalStatus: isTerminalStatus,
  logger: logger
});

// ─────────────────────────────────────────────────────────────────────────────
// FACADE OPERATIONS — one per controller handler; each returns { status, body }
// (queries that returned bare payloads in W5 are wrapped to a 200 envelope here so
// the controller maps every operation uniformly).
// ─────────────────────────────────────────────────────────────────────────────

/** getAllTasks → ListTasks (200 { tasks, version }). */
async function getAllTasks(input) {
  var result = await _listTasks.execute(input);
  return { status: 200, body: result };
}

/** getTask → GetTask ({ status, body } incl. 404). */
function getTask(input) { return _getTask.execute(input); }

/** getVersion → GetVersion (200 { version }). */
async function getVersion(input) {
  var result = await _getVersion.execute(input);
  return { status: 200, body: result };
}

/** getDisabledTasks → GetDisabledTasks (200 { tasks }). */
async function getDisabledTasks(input) {
  var result = await _getDisabledTasks.execute(input);
  return { status: 200, body: result };
}

/** searchTasks → SearchTasks (200 { tasks }). */
async function searchTasks(input) {
  var result = await _searchTasks.execute(input);
  return { status: 200, body: result };
}

/** createTask → CreateTask ({ status, body }). */
function createTask(input) { return _createTask.execute(input); }

/** updateTask → UpdateTask ({ status, body }). */
function updateTask(input) { return _updateTask.execute(input); }

/** deleteTask → DeleteTask ({ status, body }). */
function deleteTask(input) { return _deleteTask.execute(input); }

/** updateTaskStatus → UpdateTaskStatus ({ status, body }). */
function updateTaskStatus(input) { return _updateTaskStatus.execute(input); }

/** batchCreateTasks → BatchCreateTasks ({ status, body }). */
function batchCreateTasks(input) { return _batchCreateTasks.execute(input); }

/** batchUpdateTasks → BatchUpdateTasks ({ status, body }). */
function batchUpdateTasks(input) { return _batchUpdateTasks.execute(input); }

/** reEnableTask → ReEnableTask ({ status, body }). */
function reEnableTask(input) { return _reEnableTask.execute(input); }

/** takeOwnership → TakeOwnership ({ status, body }). */
function takeOwnership(input) { return _takeOwnership.execute(input); }

/** completeTask → CompleteTask (WBS-named; status forced 'done'). */
function completeTask(input) { return _completeTask.execute(input); }

/** splitTask → SplitTask (WBS-named; split forced true). */
function splitTask(input) { return _splitTask.execute(input); }

/** recordAction → RecordAction (999.681: logs a state-changing action for undo). */
function recordAction(input) { return _recordAction.execute(input); }

/** undoTask → UndoTask (999.681: reverses the last action on a task). */
function undoTask(input) { return _undoTask.execute(input); }

// ── pure helper re-exports the controller MUST keep (consumed by scheduler,
// mcp tools, schedule.routes, task-write-queue, and the golden master's direct
// `require('../../src/controllers/task.controller').rowToTask` etc.). Sourced
// from the W2 domain (mappers/validation) — same byte-identical functions. The
// DB-touching helpers (ensureProject/expandToAllInstanceIds/fetchTasksWithEventIds)
// are bound here over the slice repo so the controller stays free of getDb/trx. ──
function expandToAllInstanceIds(userId, ids) { return _repo.expandToAllInstanceIds(userId, ids); }
function fetchTasksWithEventIds(userId, queryBuilder) {
  return _repo.fetchTasksWithEventIds(userId, queryBuilder);
}
async function applySplitDefault(row, userId) {
  if (row.split === undefined || row.split === null) {
    var prefs = await _repo.getUserSplitPreference(userId);
    var splitDefault = prefs
      ? (typeof prefs.config_value === 'string' ? JSON.parse(prefs.config_value) : prefs.config_value).splitDefault
      : false;
    row.split = splitDefault ? 1 : 0;
  }
}

module.exports = {
  // facade operations (one per handler) the controller delegates to
  getAllTasks: getAllTasks,
  getTask: getTask,
  getVersion: getVersion,
  getDisabledTasks: getDisabledTasks,
  searchTasks: searchTasks,
  createTask: createTask,
  updateTask: updateTask,
  deleteTask: deleteTask,
  updateTaskStatus: updateTaskStatus,
  batchCreateTasks: batchCreateTasks,
  batchUpdateTasks: batchUpdateTasks,
  reEnableTask: reEnableTask,
  takeOwnership: takeOwnership,
  // WBS-named commands (not separate routes; exposed for completeness/tests)
  completeTask: completeTask,
  splitTask: splitTask,
  // 999.681: undo operations
  recordAction: recordAction,
  undoTask: undoTask,

  // pure helper re-exports the controller keeps for its external consumers
  rowToTask: mappers.rowToTask,
  taskToRow: mappers.taskToRow,
  buildSourceMap: mappers.buildSourceMap,
  safeParseJSON: mappers.safeParseJSON,
  TEMPLATE_FIELDS: mappers.TEMPLATE_FIELDS,
  validateTaskInput: validation.validateTaskInput,
  checkCalSyncEditGuard: validation.checkCalSyncEditGuard,
  guardFixedCalendarWhen: validation.guardFixedCalendarWhen,
  ensureProject: ensureProject,
  applySplitDefault: applySplitDefault,
  expandToAllInstanceIds: expandToAllInstanceIds,
  fetchTasksWithEventIds: fetchTasksWithEventIds,

  // domain ports + adapter implementations (named exports; mirror weather/calendar)
  TaskRepositoryPort: TaskRepositoryPort,
  TaskCachePort: TaskCachePort,
  TaskEventPort: TaskEventPort,
  ActionLogPort: require('./domain/ports/ActionLogPort'),
  KnexTaskRepository: KnexTaskRepository,
  InMemoryTaskRepository: InMemoryTaskRepository,
  RedisTaskCache: RedisTaskCache,
  EventBusTaskEvents: EventBusTaskEvents,
  KnexActionLogRepository: KnexActionLogRepository,
  InMemoryActionLogRepository: require('./adapters/InMemoryActionLogRepository'),
  ProjectsPort: require('./domain/ports/ProjectsPort'),
  KnexProjectsRepository: KnexProjectsRepository,
  InMemoryProjectsRepository: require('./adapters/InMemoryProjectsRepository'),
  PlacementMode: PlacementMode,
};
