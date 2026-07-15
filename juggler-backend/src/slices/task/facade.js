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
 * `task_masters.next_start`'s `updated_at` are OUT of P1 scope (Oscar-gated W3
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
var sseEmitter = require('../../lib/sse-emitter');
// 999.1198 (ScheduleTriggerPort inversion): the schedule trigger comes from the
// dependency-free scheduler/scheduleTrigger seam (scheduleQueue registers itself
// there at load). Requiring scheduleQueue here closed the require cycle
// task facade → scheduleQueue → scheduler facade → runSchedule → task facade.
var { enqueueScheduleRun: _enqueueScheduleRun } = require('../../scheduler/scheduleTrigger');
var taskWriteQueue = require('../../lib/task-write-queue');
var isLocked = taskWriteQueue.isLocked;
var enqueueWrite = taskWriteQueue.enqueueWrite;
var splitFields = taskWriteQueue.splitFields;
// 999.1199: lib/tasks-write is now internal to slices/task/adapters (eslint
// boundary). The two non-transactional write call sites below that used to
// require() it directly now go through `_repo` (the module's own
// KnexTaskRepository instance, defined further down) instead. The many
// in-transaction `ctx.trxRepo.tasksWrite.X(...)` call sites elsewhere in this
// file are unaffected — they already obtain the module via the repo's own
// `.tasksWrite` property (not a require()), the documented T-TX pass-through
// pattern this facade has used since W3/W6.
var { PLACEMENT_MODES } = require('../../lib/placementModes');
var { isTerminalStatus } = require('../../lib/task-status');
var { isRollingMaster, computeRollingAnchor, ANCHOR_PROJECTION_STATUSES } = require('../../lib/rolling-anchor');
var { isPatternRecurMaster, computeNextOccurrenceAnchor } = require('../../lib/next-occurrence-anchor');
var { getNowInTimezone } = require('juggler-shared/scheduler/getNowInTimezone');
// FR-4/FR-5 (juggler-recur-lifecycle-redesign, W5): the material-edit
// reconciliation engine reuses the scheduler's own TPC cycle-boundary +
// fulfillment-counting primitives (999.1372) rather than reimplementing
// cycle-counting (telly TELLY-W5-REVIEW.md prior-art note #2).
var expandRecurringShared = require('juggler-shared/scheduler/expandRecurring');
// 999.1198: the R50.0 implied-deadline boundary fn — pure scheduler domain
// logic (recurringPeriod.js), NOT runSchedule (whose lazy require this replaces).
var { recurringPeriodEndKey } = require('../scheduler/domain/logic/recurringPeriod');
var { createLogger } = require('@raike/lib-logger');
var logger = createLogger('task.facade');

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
  status: z.enum(['', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled']),
  completedAt: z.string().optional(),
  direction: z.string().optional(),
}).passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT WIRING (production adapters)
// ─────────────────────────────────────────────────────────────────────────────
var KnexLedgerWrites = require('./adapters/KnexLedgerWrites');
var _repo = new KnexTaskRepository();      // over lib/db (ADR-0002)
// JUG-FACADE-DB-VIOLATIONS stage 4: cal_sync_ledger/task_masters.next_start
// fn.now()-stamped writes — kept OFF KnexTaskRepository (INVARIANT P1 forbids
// fn.now() there); see adapters/KnexLedgerWrites.js header.
var _ledgerWrites = new KnexLedgerWrites();
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
// JUG-FACADE-DB-VIOLATIONS stage 4: no explicit getDb dep — the adapter's own
// default (lib/db.getDefaultDb(), same singleton) applies.
var _projects = new KnexProjectsRepository();
function ensureProject(userId, projectName) {
  return _projects.ensureProject(userId, projectName);
}

// ── validateTaskReferences (999.586) ─────────────────────────────────────────
// JUG-FACADE-DB-VIOLATIONS stage 4: the DB-backed existence-validation body
// moved VERBATIM into adapters/KnexReferenceValidator.js (see its header for
// the full contract — dependsOn/location/tools existence checks). The facade
// keeps this name bound to the adapter's export so the three EXISTING
// validateReferences dep seams below (CreateTask/UpdateTask/BatchCreateTasks)
// are unchanged.
var KnexReferenceValidator = require('./adapters/KnexReferenceValidator');
var validateTaskReferences = KnexReferenceValidator.validateReferences;

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

    // 999.967 (RC3): the sibling batchUpdateTxn parity block (below,
    // "[BATCH] cycle reset") already guards on `|| templateUpdate.recurring
    // === 0` — this single-task path was missing it, so editing via a
    // recurring_instance row (rather than the template directly) with
    // {recurring:false} skipped resetRecurringInstances entirely.
    if (templateUpdate.recur !== undefined || templateUpdate.recurring === 0) {
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
      || row.split !== undefined || row.split_min !== undefined
      // FR-5 (juggler-recur-lifecycle-redesign, W5): `dur`/`placement_mode` are
      // material fields too — must reach this branch so the classifier below
      // can fire reconciliation for a dur-only/placement_mode-only edit.
      || row.dur !== undefined || row.placement_mode !== undefined;
    if (needsCleanup) {
      if (row.recurring === 0) {
        // 999.967(a) (David ruling 2026-07-01: done instances keep status='done',
        // NOT 'archived' — see 999.833 test (b)). Ledger cleanup therefore
        // EXCLUDES done instances too: their calendar-sync history is left
        // alone, matching "preserved" (999.833 test (e)). Only clean the
        // ledger for non-done instances (pending ones resetRecurringInstances
        // doesn't otherwise touch).
        var _allToggleIds = await trx('task_instances')
          .where({ master_id: id, user_id: userId })
          .whereNot('status', 'done')
          .pluck('id');
        if (_allToggleIds.length > 0) {
          await trx('cal_sync_ledger')
            .where('user_id', userId)
            .whereIn('task_id', _allToggleIds)
            .where('status', 'active')
            .update({ status: 'deleted_local', task_id: null, synced_at: trx.fn.now() })
            .catch(function (err) { logger.error('[silent-catch]', err.message); });
        }

        // 999.967(b) (David ruling: done instances stay 'done', not
        // 'archived' — no archival step; this was removed).

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
            // W3 (sched-drop-overdue-column, M-5): `overdue` is no longer a
            // stored column/insert-time default — computed-on-read only.
            generated: 0,
            created_at: new Date(),
            updated_at: new Date()
          })
          .onConflict(['master_id', 'occurrence_ordinal', 'split_ordinal']).ignore();
      } else {
        var updatedTmpl = Object.assign({}, existing, row);
        var newRecur = typeof updatedTmpl.recur === 'string' ? JSON.parse(updatedTmpl.recur || 'null') : updatedTmpl.recur;
        var oldRecur = typeof existing.recur === 'string' ? JSON.parse(existing.recur || 'null') : existing.recur;

        // FR-5 material field list (SPEC.md): recur.type/days/every/intervalDays/
        // monthDays/timesPerCycle are ALL material — the pre-existing classifier
        // only compared type/days/timesPerCycle (telly TELLY-W5-REVIEW.md
        // prior-art note #1); every/intervalDays/monthDays are added here.
        var recurChanged = row.recur !== undefined && (
          (oldRecur && newRecur && (
            oldRecur.type !== newRecur.type ||
            JSON.stringify(oldRecur.days) !== JSON.stringify(newRecur.days) ||
            (oldRecur.timesPerCycle || 0) !== (newRecur.timesPerCycle || 0) ||
            (oldRecur.every || 0) !== (newRecur.every || 0) ||
            (oldRecur.intervalDays || 0) !== (newRecur.intervalDays || 0) ||
            JSON.stringify(oldRecur.monthDays || null) !== JSON.stringify(newRecur.monthDays || null)
          )) ||
          (!oldRecur && newRecur) ||
          (oldRecur && !newRecur)
        );

        // R53: split/split_min change also reshapes the instance set.
        var splitChanged = (row.split !== undefined && Number(row.split) !== Number(existing.split))
          || (row.split_min !== undefined && Number(row.split_min) !== Number(existing.split_min));

        // FR-5: `dur` and `placement_mode` are material fields too.
        var durChanged = row.dur !== undefined && Number(row.dur) !== Number(existing.dur);
        var placementModeChanged = row.placement_mode !== undefined && row.placement_mode !== existing.placement_mode;

        // FR-4: any material field change reconciles the instance set — done
        // untouched, skip/cancel removed, open pruned/fabricated to the new
        // cycle target, immediate effect (see reconcileMaterialEdit below).
        // When the recurrence has no active timesPerCycle target, the
        // remaining_needed math has nothing to reconcile against — fall back
        // to the pre-existing blunt resetRecurringInstances (unchanged
        // behavior for non-TPC recurrence, protected by
        // facade.collaborators.db.test.js's "recurChanged=true" regression).
        var materialChanged = recurChanged || splitChanged || durChanged || placementModeChanged;

        if (materialChanged) {
          var _tpc = newRecur && newRecur.timesPerCycle ? Number(newRecur.timesPerCycle) : 0;
          if (_tpc > 0 && newRecur && newRecur.type !== 'rolling') {
            await reconcileMaterialEdit({
              trx: trx, twrite: twrite, userId: userId, masterId: id,
              updatedTmpl: updatedTmpl, newRecur: newRecur, tz: tz
            });
          } else {
            // FR-4 (cookie W5-ARCH-2 / ernie ernie-w5-skipcancel-breadth): the
            // non-TPC/rolling fallback must ALSO honor FR-4's unconditional
            // "skip/cancel instances are pruned" rule, scoped to the
            // in-progress cycle only (consistent with the TPC path's
            // now-fixed cycle-scoped prune below). resetRecurringInstances
            // itself is UNCHANGED — still only touches status='' open
            // instances — so its other call sites (toggle-off at line ~331,
            // the two [BATCH] resets, the instance-edit cascade at line
            // ~288) are byte-identical; this is a sibling step local to only
            // this call site. Guarded on `newRecur` truthiness: a null
            // newRecur here (recur cleared while recurring stays truthy) has
            // no cycle to scope against, so it falls back to the pre-existing
            // no-skip/cancel-touch behavior for that edge case.
            if (newRecur) {
              var _cycleWin = computeCycleWindow(updatedTmpl, newRecur, tz);
              await pruneCycleSkipCancel({
                trx: trx, twrite: twrite, userId: userId, masterId: id,
                cycleStart: _cycleWin.cycleStart, cycleEnd: _cycleWin.cycleEnd, tz: tz
              });
            }
            await twrite.resetRecurringInstances(trx, userId, id, '[RECUR] cycle reset (recur/split/dur/placement change)');
          }
        } else {
          var _dateMatch = require('juggler-shared/scheduler/dateMatchesRecurrence');
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

// FR-4/FR-5 (juggler-recur-lifecycle-redesign, W5): material-edit
// reconciliation engine. Called from recurCleanup's recurring_template branch
// (above) instead of the blunt resetRecurringInstances(...) whenever the
// edited master has an active timesPerCycle target — the remaining_needed
// math this function implements is only meaningful when there IS a per-cycle
// target to reconcile against; recurrence with no timesPerCycle (or rolling)
// keeps the pre-existing resetRecurringInstances fallback (see call site).
//
// Reuses the SAME cycle-boundary + fulfillment primitives the scheduler's TPC
// picker uses (999.1372, expandRecurring.js getStableEpoch/
// enumerateBookedDatesInCycle/matchesRecurrenceDay) so this immediate
// reconciliation and the next scheduler run's own TPC accounting can never
// structurally disagree about where a cycle starts/ends.
//
// Per FR-4/AC5: `done` instances are NEVER touched. `skip`/`cancel` instances
// are unconditionally removed (AC5's literal wording — a hard delete, not
// scoped to the in-progress cycle). Open (status='') instances ARE scoped to
// the in-progress cycle: remaining_needed = new_timesPerCycle - done_this_cycle;
// surplus is pruned furthest-date-first; a deficit is fabricated immediately
// on the earliest non-colliding in-cycle pattern day, searched forward from
// "today" (never a past date) — the locally-applied form of FR-4's "advance
// anchor to today" ordering for this reconciliation's own placement search.
//
// NOTE (scope): this function does not itself write task_masters.next_start.
// FR-1's anchor-advance triggers (AC2) are the terminal-status write and the
// scheduler-run sweep; telly's W5 test suite does not assert a next_start
// write from a material edit, and no other FR-4 acceptance criterion requires
// one. Flagged as an open question in BUILD-LOG.md rather than guessed.
// Effective date key for an instance row (ernie-w5-datecol-exclusive
// WARN-2): prefer the `date` column; fall back to a tz-local key derived
// from `scheduled_at` when `date` is NULL, so a status='' (or skip/cancel)
// row that only carries scheduled_at is not invisible to cycle accounting —
// the sibling non-material branch (facade.js:409/417) already keys off
// scheduled_at this same way. Returns null when neither field carries a
// usable date signal.
function effectiveDateKey(r, tz) {
  if (r.date) return String(r.date).slice(0, 10);
  if (r.scheduled_at) return utcToLocal(r.scheduled_at, tz).date;
  return null;
}

// Shared cal_sync_ledger soft-clear for an array of instance ids — used by
// both the cycle-scoped skip/cancel prune and reconcileMaterialEdit's own
// open-instance surplus prune, so calendar-sync history clears identically
// in both call paths.
async function softClearLedgerFor(trx, userId, ids) {
  if (!ids || ids.length === 0) return;
  await trx('cal_sync_ledger')
    .where('user_id', userId)
    .whereIn('task_id', ids)
    .where('status', 'active')
    .update({ status: 'deleted_local', task_id: null, synced_at: trx.fn.now() })
    .catch(function (err) { logger.error('[silent-catch]', err.message); });
}

// Cycle-boundary math (999.1372 primitives) — the cycle containing TODAY,
// computed tz-aware (ernie-w5-tznaive-today WARN-1): "today" comes from
// ctx.tz via getNowInTimezone, matching the sibling non-material branch's
// utcToLocal(...,tz) convention, not server-local `new Date()`. Shared by
// reconcileMaterialEdit (TPC path) and the non-TPC/rolling fallback's
// sibling skip/cancel-prune step so both compute the identical window.
function computeCycleWindow(updatedTmpl, newRecur, tz) {
  var timeInfo = getNowInTimezone(tz);
  var today = timeInfo.todayDate;
  var cycleDays = newRecur.type === 'biweekly' ? 14 : (newRecur.type === 'monthly' ? 30 : 7);
  var stableEpoch = expandRecurringShared.getStableEpoch(
    { recurStart: updatedTmpl.recur_start, date: updatedTmpl.date },
    today
  );
  var daysFromEpoch = Math.floor((today.getTime() - stableEpoch.getTime()) / 86400000);
  var cycleIndex = Math.floor(daysFromEpoch / cycleDays);
  var cycleStart = new Date(stableEpoch);
  cycleStart.setDate(cycleStart.getDate() + cycleIndex * cycleDays);
  var cycleEnd = new Date(cycleStart);
  cycleEnd.setDate(cycleEnd.getDate() + cycleDays);
  return { today: today, stableEpoch: stableEpoch, cycleDays: cycleDays, cycleStart: cycleStart, cycleEnd: cycleEnd };
}

// FR-4 (SPEC.md): "skip/cancel instances are pruned" — scoped to the
// IN-PROGRESS cycle [cycleStart, cycleEnd) ONLY, NOT master-wide across all
// history (cookie W5-ARCH-1/W5-ARCH-2, ernie ernie-w5-skipcancel-breadth:
// the prior unscoped delete purged acted-on skip/cancel rows from PRIOR
// cycles on every routine material edit, incl. count-neutral dur-only
// edits). Shared by BOTH the TPC engine (reconcileMaterialEdit) and the
// non-TPC/rolling fallback's sibling step so both paths honor the identical
// rule. A skip/cancel row with no determinable date signal (neither `date`
// nor `scheduled_at`) is left untouched — cannot confirm in-cycle
// membership, and preserving un-scopable history is the safer default over
// risking an out-of-cycle hard-delete.
async function pruneCycleSkipCancel(ctx2) {
  var trx = ctx2.trx;
  var twrite = ctx2.twrite;
  var userId = ctx2.userId;
  var masterId = ctx2.masterId;
  var cycleStart = ctx2.cycleStart;
  var cycleEnd = ctx2.cycleEnd;
  var tz = ctx2.tz;
  var allInstances = await trx('task_instances').where({ master_id: masterId, user_id: userId });
  var skipCancelIds = allInstances
    .filter(function (r) {
      if (r.status !== 'skip' && r.status !== 'cancel') return false;
      var key = effectiveDateKey(r, tz);
      if (!key) return false;
      var d = dateHelpers.parseDate(key);
      return !!(d && d >= cycleStart && d < cycleEnd);
    })
    .map(function (r) { return r.id; });
  if (skipCancelIds.length === 0) return;
  await softClearLedgerFor(trx, userId, skipCancelIds);
  await twrite.deleteInstancesWhere(trx, userId, function (q) { return q.whereIn('id', skipCancelIds); });
}

async function reconcileMaterialEdit(ctx) {
  var trx = ctx.trx;
  var twrite = ctx.twrite;
  var userId = ctx.userId;
  var masterId = ctx.masterId;
  var updatedTmpl = ctx.updatedTmpl;
  var newRecur = ctx.newRecur;
  var tz = ctx.tz;

  var cycleWin = computeCycleWindow(updatedTmpl, newRecur, tz);
  var today = cycleWin.today;
  var stableEpoch = cycleWin.stableEpoch;
  var cycleStart = cycleWin.cycleStart;
  var cycleEnd = cycleWin.cycleEnd;

  // AC5: skip/cancel instances are removed — cycle-scoped (see
  // pruneCycleSkipCancel doc above for the scope-fix rationale).
  await pruneCycleSkipCancel({
    trx: trx, twrite: twrite, userId: userId, masterId: masterId,
    cycleStart: cycleStart, cycleEnd: cycleEnd, tz: tz
  });

  // Re-query post skip/cancel-removal; build the ACTUAL-date map
  // enumerateBookedDatesInCycle needs (999.1372 — widened, real-date
  // fulfillment lookup, not a pattern-day walk). Keyed off effectiveDateKey
  // (ernie-w5-datecol-exclusive WARN-2) so a NULL-date/scheduled_at-only
  // status='' row is counted rather than silently excluded.
  var remaining = await trx('task_instances').where({ master_id: masterId, user_id: userId });
  var byDate = {};
  remaining.forEach(function (r) {
    var k = effectiveDateKey(r, tz);
    if (k) byDate[k] = r;
  });
  var datesBySourceAll = {};
  datesBySourceAll[masterId] = remaining
    .map(function (r) { return effectiveDateKey(r, tz); })
    .filter(function (k) { return k; });
  var widened = expandRecurringShared.enumerateBookedDatesInCycle(masterId, cycleStart, cycleEnd, datesBySourceAll);

  var doneInCycle = widened.filter(function (w) { var r = byDate[w.key]; return r && r.status === 'done'; });
  var openInCycle = widened
    .filter(function (w) { var r = byDate[w.key]; return r && r.status === ''; })
    .sort(function (a, b) { return a.date.getTime() - b.date.getTime(); })
    .map(function (w) { return byDate[w.key]; });

  var tpc = Number(newRecur.timesPerCycle) || 0;
  var remainingNeeded = Math.max(0, tpc - doneInCycle.length);

  if (openInCycle.length > remainingNeeded) {
    // Surplus — prune furthest-date-first (openInCycle is date-ascending, so
    // the LAST `surplus` entries are the furthest dates).
    var surplus = openInCycle.length - remainingNeeded;
    var toPrune = openInCycle.slice(openInCycle.length - surplus);
    var pruneIds = toPrune.map(function (r) { return r.id; });
    await softClearLedgerFor(trx, userId, pruneIds);
    await twrite.deleteInstancesWhere(trx, userId, function (q) { return q.whereIn('id', pruneIds); });
  } else if (openInCycle.length < remainingNeeded) {
    // Deficit — fabricate immediately, in-cycle, on a non-colliding pattern day.
    var deficit = remainingNeeded - openInCycle.length;
    var bookedDates = {};
    remaining.forEach(function (r) {
      var k = effectiveDateKey(r, tz);
      if (k) bookedDates[k] = true;
    });
    var maxOrdRow = await trx('task_instances').where({ master_id: masterId, user_id: userId }).max('occurrence_ordinal as m').first();
    // 999.1490: guard against date-derived ordinal corruption — a prior run may
    // have written occurrence_ordinal values in the 20M range (YYYYMMDD dates).
    // Cap at MAX_PLAUSIBLE_ORDINAL so new fabricated occurrences get sane
    // sequential ordinals instead of inheriting the corrupted date-like values.
    var MAX_PLAUSIBLE_ORDINAL = 10000000;
    var rawMaxOrd = (maxOrdRow && maxOrdRow.m) ? Number(maxOrdRow.m) : 0;
    var nextOrd = rawMaxOrd > MAX_PLAUSIBLE_ORDINAL ? 0 : rawMaxOrd;
    var dayMap = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };
    var cursor = new Date(Math.max(cycleStart.getTime(), today.getTime()));
    var fabricated = 0;
    var toInsert = [];
    while (fabricated < deficit && cursor < cycleEnd) {
      var key = dateHelpers.formatDateKey(cursor);
      if (!bookedDates[key] && expandRecurringShared.matchesRecurrenceDay(cursor, newRecur, stableEpoch, dayMap)) {
        nextOrd += 1;
        toInsert.push({
          id: uuidv7(),
          master_id: masterId,
          user_id: userId,
          occurrence_ordinal: nextOrd,
          split_ordinal: 1,
          split_total: 1,
          scheduled_at: null,
          dur: updatedTmpl.dur != null ? updatedTmpl.dur : 30,
          date: key,
          status: '',
          generated: 0,
          created_at: new Date(),
          updated_at: new Date()
        });
        bookedDates[key] = true;
        fabricated++;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    if (toInsert.length > 0) {
      await trx('task_instances').insert(toInsert);
    }
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
  // sched-drop-overdue-column follow-up (bert-rollgate-2/3): materialize
  // implied_deadline at insert time here too — SAME recurringPeriodEndKey(recur,
  // occurrenceDateKey) call shape runSchedule.js already uses at every other
  // recurring_instance creation/write site (Phase-1 chunk pre-insert :~1407-1408;
  // the 999.990 recompute-on-write :~1805-1834). `localDate` (already computed
  // above from the rc_ id's date digits, M/D form) IS this row's occurrence date
  // key — parseDate (shared/scheduler/dateHelpers) accepts M/D directly, same as
  // it does for localToUtc just above. Without this, a row materialized through
  // this on-demand path can never compute overdue:true via computeOverdueForRow's
  // hasHardCommitment branch (taskMappers.js), which short-circuits to false
  // whenever impliedDeadlineISO is null — regressing the standing "past+incomplete
  // dated MUST stay pinned past-due" invariant now that the write-side overdue
  // persistence that used to mask this gap is gone (W3, this leg).
  // 999.1198: recurringPeriodEndKey now lives in the pure
  // slices/scheduler/domain/logic/recurringPeriod module (top-level required
  // below with the other imports) — the former mid-function lazy require of
  // runSchedule.js, which papered over the facade↔scheduler require cycle, is
  // gone. Same function, same SSOT delegation (runSchedule re-exports it).
  var impliedDeadline = source.recur ? recurringPeriodEndKey(source.recur, localDate) : null;
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
    implied_deadline: impliedDeadline,
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
    var futureInstances = await _repo.getFutureOpenInstances(id, userId);
    if (!Array.isArray(futureInstances)) futureInstances = [];

    pausedIds = futureInstances.map(function (i) { return i.id; });

    if (pausedIds.length > 0) {
      // Mark cal_sync ledger entries as deleted_local so paused instances don't
      // create stale calendar events — the same cleanup the old delete path used.
      await _ledgerWrites.clearActiveLedgerForTasks(userId, pausedIds)
        .catch(function (err) { logger.error('[silent-catch]', err.message); });

      // Cascade pause status to the instances (matching the billing downgrade pattern
      // that sets status='disabled' on instances via tasksWrite.updateInstancesWhere).
      // 999.1199: raw passthrough via _repo.tasksWrite (NOT the P1-asserting port
      // method) — preserves the exact no-updated_at-write behavior byte-identical
      // (the strict port's withTimestamp() would inject a new updated_at write
      // that this call site never had).
      await _repo.tasksWrite.updateInstancesWhere(_repo.db, userId, function (q) {
        return q.whereIn('id', pausedIds);
      }, { status: 'pause' });
    }

    return { pausedCount: pausedIds.length, pausedIds: pausedIds };
  }

  // Unpause: re-activate all instances that were paused because the template was paused.
  // This mirrors the ReEnableTask pattern that sets status='' on disabled instances.
  if (status === '') {
    var pausedInstances = await _repo.getPausedInstances(id, userId);
    if (!Array.isArray(pausedInstances)) pausedInstances = [];

    var unpausedIds = pausedInstances.map(function (i) { return i.id; });

    if (unpausedIds.length > 0) {
      // 999.1199: raw passthrough — see the pause-cascade comment above.
      await _repo.tasksWrite.updateInstancesWhere(_repo.db, userId, function (q) {
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
// Also projects the GENERALIZED anchor (999.1091 C1) for every OTHER recurring
// type (daily/weekly/biweekly/monthly/interval) via computeNextOccurrenceAnchor
// (see juggler-backend/src/lib/next-occurrence-anchor.js header) — both branches
// write the same `next_start` unified anchor column (rolling_anchor /
// next_occurrence_anchor were dropped — juggler-anchor-column-cleanup), just
// computed differently per recur type. Both branches share the same preloaded
// master row to avoid a second DB read.
//
// ctx.db (optional): the active knex transaction handle to write through. When the
// caller runs inside a transaction (batchUpdateTxn), it MUST pass its `trx` here so
// the next_start UPDATE participates in the same commit/
// rollback boundary as the rest of the batch — otherwise a base-pool write
// autocommit connection escapes the transaction (WARN ernie-w1-anchor-trx-escape /
// cookie-C1, 2026-07-04): a later rollback would leave the anchor advanced while the
// status change it was derived from reverts. Callers outside a transaction
// (UpdateTaskStatus.js, lockedBatchUpdate — both already non-transactional, matching
// this function's pre-existing base-pool default) omit ctx.db and are unaffected.
// JUG-FACADE-DB-VIOLATIONS stage 4: the actual UPDATE (GREATEST/COALESCE monotonic
// guard) moved to adapters/KnexLedgerWrites.js's updateNextStartAnchor (kept OFF
// KnexTaskRepository — see that adapter's header for why); the `ctx.db || _repo.db`
// trx-threading choice below is PRESERVED EXACTLY (same conditional, same default
// source — _repo.db is the identical lib/db.getDefaultDb() singleton the removed
// getDb() shim returned) — the adapter method takes the resolved handle as a
// required param rather than re-defaulting internally, so this call site remains
// the single place that decides base-pool vs caller-trx.
// Test-only clock seam (999.1440, same pattern as runSchedule.js _setClock /
// 999.1427): applyRollingAnchor's `done` branch derives the completion date
// from "today in the user's tz" — wall-clock-boundary-sensitive for tests
// (UTC day ≠ local day between 20:00 and 24:00 EDT). getNowInTimezone already
// takes an optional injectable clock (R50.8); production always passes null
// (real clock). Set via the NODE_ENV=test-gated `_setAnchorClock` export.
var _anchorTestClock = null;

async function applyRollingAnchor(ctx) {
  var masterId = ctx.masterId;
  var userId = ctx.userId;
  var status = ctx.status;
  var existing = ctx.existing;
  var _db = ctx.db || _repo.db;
  var _masterForAnchor = ctx.preloadedMaster
    || await _repo.getMasterById(masterId, userId);
  if (_masterForAnchor && isRollingMaster(_masterForAnchor)) {
    var _instanceDate = existing.date ? String(existing.date).slice(0, 10) : null;
    var _currentAnchor = _masterForAnchor.next_start
      ? String(_masterForAnchor.next_start).slice(0, 10)
      : null;
    // Option B: anchor `done` to the ACTUAL completion date (today in the user's tz),
    // not the scheduled date, so a late completion pushes the next occurrence out.
    var _completionDate = getNowInTimezone(ctx.tz || _masterForAnchor.tz, _anchorTestClock).todayKey;
    var _newAnchor = computeRollingAnchor(status, _instanceDate, _currentAnchor, _completionDate);
    if (_newAnchor) {
      // next_start is the single unified anchor column. The legacy
      // rolling_anchor / next_occurrence_anchor columns have been dropped.
      // Monotonic guard: GREATEST(COALESCE(...)) computes the max SERVER-SIDE
      // to prevent a concurrent terminal write from regressing the anchor.
      await _ledgerWrites.updateNextStartAnchor(_db, masterId, userId, _newAnchor);
    }
  } else if (_masterForAnchor && isPatternRecurMaster(_masterForAnchor)) {
    var _pInstanceDate = existing.date ? String(existing.date).slice(0, 10) : null;
    var _pCurrentAnchor = _masterForAnchor.next_start
      ? String(_masterForAnchor.next_start).slice(0, 10)
      : null;
    var _pNewAnchor = computeNextOccurrenceAnchor(status, _pInstanceDate, _pCurrentAnchor, _masterForAnchor.recur);
    if (_pNewAnchor) {
      // next_start is the single unified anchor column. The legacy
      // next_occurrence_anchor column has been dropped.
      // Monotonic guard: same GREATEST(COALESCE(...)) as the rolling branch.
      await _ledgerWrites.updateNextStartAnchor(_db, masterId, userId, _pNewAnchor);
    }
  }
}

// 999.1098 — SINGLE shared gate + master-id resolution for the terminal-event
// recurrence-anchor projection (covers BOTH anchor computations, both writing
// the same `next_start` unified anchor column: computeRollingAnchor for
// rolling masters and computeNextOccurrenceAnchor for pattern-recur masters,
// both inside applyRollingAnchor above).
//
// Every terminal-status write path must funnel through here instead of
// hand-copying the status gate: the previous hand-copied ['done','skip']
// gates (lockedBatchUpdate, batchUpdateTxn) had drifted from the 2026-07-06
// ruling (resolves 999.844) that 'missed' is terminal and reanchors to the
// instance date — computeRollingAnchor/computeNextOccurrenceAnchor already
// handled 'missed' (rollingAnchor.test.js / schedulerScenarios.test.js pins),
// but the stale caller gates never let a 'missed' event reach them.
//
// The gate itself lives in lib/rolling-anchor.js ANCHOR_PROJECTION_STATUSES
// (see its header for why the gate is load-bearing — 'pause'/'cancelled' are
// terminal but must NOT advance anchors).
//
// ctx: { status, existing, userId, masterId?, preloadedMaster?, db?, tz? }
//   masterId defaults to existing.master_id || existing.source_id.
//   db: optional trx handle — threaded through to applyRollingAnchor (see its
//   header for the transaction-escape hazard).
async function applyRecurrenceAnchors(ctx) {
  var _mid = ctx.masterId != null
    ? ctx.masterId
    : (ctx.existing ? (ctx.existing.master_id || ctx.existing.source_id) : null);
  if (!_mid) return;
  if (ANCHOR_PROJECTION_STATUSES.indexOf(ctx.status) === -1) return;
  await applyRollingAnchor({
    masterId: _mid,
    userId: ctx.userId,
    status: ctx.status,
    existing: ctx.existing,
    preloadedMaster: ctx.preloadedMaster || null,
    db: ctx.db,
    tz: ctx.tz
  });
}

// updateTaskStatus split-chunk sibling lookup (999.354: folded into TaskRepositoryPort).
function loadSplitSiblings(ctx) {
  return _repo.getSplitSiblingIds(ctx.userId, ctx.masterId, ctx.occurrenceOrdinal, ctx.excludeId);
}

// updateTaskStatus done-frozen reactivation (verbatim — controller L1775-1777).
async function reactivateDoneFrozen(ctx) {
  await _ledgerWrites.reactivateDoneFrozenLedger(ctx.userId, ctx.id);
}

// updateTaskStatus skip/cancel outbound cal-sync trigger.
// Exposes a `.sync({ userId })` shape the use-case calls fire-and-forget.
// 999.1192 (CalSyncTriggerPort inversion): the facade no longer lazy-requires
// controllers/cal-sync.controller with a fake express req/res from inside the
// domain layer — cal-sync.controller registers its HTTP-shaped sync entry into
// lib/cal-sync-trigger at load (fake req/res construction now controller-side),
// and this facade calls the seam. Failure contract unchanged: fire-and-forget,
// all trigger errors swallowed + logged inside the seam.
var calSyncTrigger = require('../../lib/cal-sync-trigger');
var triggerCalSync = {
  sync: function (args) {
    return calSyncTrigger.triggerSync(args);
  }
};

// deleteTask cal_sync_settings read (verbatim — controller L1388-1392).
async function loadCalSyncSettings(userId) {
  var _csRow = await _repo.getCalSyncSettingsConfig(userId);
  return _csRow
    ? (typeof _csRow.config_value === 'string' ? JSON.parse(_csRow.config_value) : _csRow.config_value)
    : {};
}

// deleteTask provider-origin ledger lookup (verbatim — controller L1407-1410).
function findProviderLedgerRow(userId, id) {
  return _repo.findActiveProviderLedgerRow(userId, id);
}

// FR-6 (juggler-recur-lifecycle-redesign): series-delete cal_locked gate. The
// existing provider-origin block (findProviderLedgerRow, above) is explicitly
// SKIPPED for scope=series (DeleteTask.js `isSeriesDelete` guard) — so a
// series-delete today runs with ZERO cal_locked/provider-origin checking on
// ANY instance in the series. This is a genuinely new check: does ANY
// instance (or the template itself) under `templateId` have an ACTIVE
// cal_sync_ledger row whose origin is a real calendar provider (not
// 'juggler')? Mirrors KnexTaskRepository.fetchTaskWithEventIds's own
// cal_locked derivation (adapters/KnexTaskRepository.js:176-194), just scoped
// to an entire series instead of a single task.
//
// FIX bert (cookie ARCH-REVIEW-W2.json W2-ARCH-W3, 2026-07-09): the
// status/origin predicate below previously re-implemented (as raw `.where()`
// calls) the same "active, non-juggler-origin" rule KnexTaskRepository
// already derives inline for a single task — two copies of the same rule with
// no shared home, a divergence risk on a security-adjacent guard. Now both
// call `domain/calLockedPredicate` — see that module's header.
function findCalLockedSeriesInstance(userId, templateId) {
  return _repo.findCalLockedSeriesLedgerRow(userId, templateId);
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
  // verbatim — done/cancel/skip/pause. Only genuinely-active/pending
  // instances are soft-cancelled (status='cancelled') to stop the series.
  // (999.1086: 'missed' removed — retired by 999.1044.)
  var TERMINAL_KEEP = ['done', 'cancel', 'skip', 'pause'];

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
  // R55 + 999.844: history-bearing instances (done/cancel/skip/pause) are
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
    // 999.1399 RESOLVED by-design: provider_event_id is INTENTIONALLY RETAINED here
    // (unlike the old pre-migration MCP delete_task, which nulled it). The sync loop
    // explicitly loads deleted_local rows that still hold a provider_event_id and
    // uses it to push the DELETE to the external provider, nulling it only after
    // the provider event is gone (cal-sync.controller.js ~332-341, ~731-737).
    // Nulling it here would strand the external calendar event forever.
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
  var existCheck = await _repo.fetchTasksForLockedBatchCheck(userId, idsToCheck);
  var existById = {};
  existCheck.forEach(function (r) { existById[r.id] = r; });

  var _lockedLedger = await _repo.fetchActiveLedgerOriginsForTasks(idsToCheck);
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
      // 999.1422 (residue of 999.1398): count this item only when the write
      // actually touched rows — repo.updateTaskById returns tasks-write's
      // { masterUpdated, instanceUpdated } affected-row counts, and a
      // foreign/nonexistent id correctly writes 0 rows (user_id scoping), so
      // it must not inflate the { updated: N } count callers see (same
      // truthful-count contract batchUpdateTxn already enforces).
      var qWriteRes = await ctx.repo.updateTaskById(qId, nonSchedulingFields, userId);
      if (qWriteRes.masterUpdated + qWriteRes.instanceUpdated > 0) updatedCount++;
    }

    if (Object.keys(schedulingFields).length > 0) {
      await enqueueWrite(userId, qId, 'update', schedulingFields, 'api:batchUpdateTasks');
      queuedCount++;
    }

    // BUG1 (W1, leg sched-anchor-split-bugs) fix: rolling-anchor projection —
    // mirrors UpdateTaskStatus's anchor step, which the LOCKED batch path never
    // called (only the single-item status-update use-case did).
    // 999.1098: gate + master-id resolution consolidated into
    // applyRecurrenceAnchors (also brings this path in line with the
    // 2026-07-06 'missed is terminal, reanchors' ruling).
    if (qExisting && qExisting.task_type === 'recurring_instance') {
      await applyRecurrenceAnchors({
        userId: userId,
        status: qRow.status,
        existing: qExisting,
        preloadedMaster: null
      });
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
    .select('id', 'task_type', 'source_id', 'master_id', 'scheduled_at', 'status',
            'when', 'date', 'gcal_event_id', 'msft_event_id');
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
    // 999.1398: count an item as updated only when its writes actually touched
    // rows. tasks-write.js updateTaskById returns { masterUpdated,
    // instanceUpdated } affected-row counts; a foreign/nonexistent id correctly
    // writes 0 rows (user_id scoping) and must not inflate the reported count.
    var itemAffected = 0;
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
        var _tmplRes = await twrite.updateTaskById(trx, existing.source_id, templateUpdate, userId);
        itemAffected += _tmplRes.masterUpdated + _tmplRes.instanceUpdated;
      }
      if (templateUpdate.recur !== undefined || templateUpdate.recurring === 0) {
        await twrite.resetRecurringInstances(trx, userId, existing.source_id, '[BATCH] cycle reset');
      }
      if (Object.keys(instanceUpdate).length > 0) {
        var _instRes = await twrite.updateTaskById(trx, id, instanceUpdate, userId);
        itemAffected += _instRes.masterUpdated + _instRes.instanceUpdated;
      } else {
        await twrite.updateTaskById(trx, id, {}, userId);
      }

      // BUG1 (W1, leg sched-anchor-split-bugs) fix: rolling-anchor projection —
      // mirrors UpdateTaskStatus's anchor step, which the UNLOCKED batch txn
      // path never called (only the single-item status-update use-case did).
      // 999.1098: gate + master-id resolution consolidated into
      // applyRecurrenceAnchors (also brings this path in line with the
      // 2026-07-06 'missed is terminal, reanchors' ruling).
      // WARN ernie-w1-anchor-trx-escape / cookie-C1 (2026-07-04): this call site runs
      // inside batchUpdateTxn's own `trx` — thread it through so the anchor UPDATE
      // commits/rolls back atomically with the rest of the batch (see applyRollingAnchor
      // header for the escape hazard this closes). lockedBatchUpdate's call site is
      // non-transactional already and is intentionally left on the base-pool default.
      await applyRecurrenceAnchors({
        userId: userId,
        status: row.status,
        existing: existing,
        preloadedMaster: null,
        db: trx
      });
    } else {
      if (anchorDateVal && taskType === 'recurring_template') {
        row.scheduled_at = localToUtc(anchorDateVal, null, updateTz) || null;
        row.desired_at = row.scheduled_at;
      }
      var _rowRes = await twrite.updateTaskById(trx, id, row, userId);
      itemAffected += _rowRes.masterUpdated + _rowRes.instanceUpdated;
      if (taskType === 'recurring_template' && (row.recur !== undefined || row.recurring === 0)) {
        // 999.967(a/b): same ledger cleanup as the single-task toggle-off path
        // (David ruling 2026-07-01: done instances keep status='done' and their
        // ledger rows are preserved — no archive step, ledger cleanup excludes them).
        if (row.recurring === 0) {
          var _batchToggleIds = await trx('task_instances')
            .where({ master_id: id, user_id: userId })
            .whereNot('status', 'done')
            .pluck('id');
          if (_batchToggleIds.length > 0) {
            await trx('cal_sync_ledger')
              .where('user_id', userId)
              .whereIn('task_id', _batchToggleIds)
              .where('status', 'active')
              .update({ status: 'deleted_local', task_id: null, synced_at: trx.fn.now() })
              .catch(function (err) { logger.error('[silent-catch]', err.message); });
          }
        }
        await twrite.resetRecurringInstances(trx, userId, id, '[BATCH] cycle reset on template');
      }
    }
    // 999.1398: increment only when this item's writes affected rows — a
    // foreign/nonexistent id (0 rows, user_id-scoped) no longer inflates
    // the { updated: N } count callers see.
    if (itemAffected > 0) updatedCount++;
  }

  return { updatedCount: updatedCount, anySchedulingInBatch: anySchedulingInBatch };
}

// takeOwnership ledger detach (verbatim — controller L2403-2405).
// JUG-FACADE-DB-VIOLATIONS final stage (999.1516): the UPDATE moved to
// adapters/KnexLedgerWrites.js's detachTaskLedger. ctx.trxRepo.db is still
// threaded through as the trx handle (same trx-escape-hazard discipline as
// applyRollingAnchor above), so the write stays atomic with the rest of the
// caller's runInTransaction block.
async function detachLedger(ctx) {
  await _ledgerWrites.detachTaskLedger(ctx.trxRepo.db, ctx.userId, ctx.id);
}

// reEnableTask disabled-instance counter (verbatim — controller L2314-2317).
function countDisabledInstances(userId, id) {
  return _repo.countDisabledInstances(userId, id);
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
  reactivateDoneFrozen: reactivateDoneFrozen, logger: logger
});

var _completeTask = new app.CompleteTask({ updateTaskStatus: _updateTaskStatus });
var _splitTask = new app.SplitTask({ createTask: _createTask, updateTask: _updateTask });

var _deleteTask = new app.DeleteTask({
  repo: _repo, cache: _cache, enqueueScheduleRun: enqueueScheduleRun,
  loadCalSyncSettings: loadCalSyncSettings, findProviderLedgerRow: findProviderLedgerRow,
  findCalLockedSeriesInstance: findCalLockedSeriesInstance,
  cascadeRecurringDelete: cascadeRecurringDelete, standardDelete: standardDelete,
  thisAndFutureDelete: thisAndFutureDelete
});

var _batchCreateTasks = new app.BatchCreateTasks({
  repo: _repo, cache: _cache, enqueueScheduleRun: enqueueScheduleRun,
  mappers: mappers, validation: validation, batchCreateSchema: batchCreateSchema,
  validateReferences: validateTaskReferences,
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

// ── updateTaskAndStatus (999.1570) ───────────────────────────────────────────
// MCP's update_task tool used to issue TWO independently-committed facade
// calls when a single caller-supplied body carries BOTH non-status fields AND
// a `status` field: facade.updateTask (non-status fields) runs and commits,
// THEN facade.updateTaskStatus (the status transition) runs separately. If
// the second call failed, the first call's write had ALREADY committed,
// leaving the task row half-updated with no rollback (formerly pinned as an
// ACCEPTED tradeoff — ernie E3 / David ruling 2026-07-07 — now superseded:
// 999.1570 fixes the atomicity while preserving the D-B ruling's observable
// ORDERING, non-status fields land before the status transition is
// evaluated, e.g. so a same-call {date, status:'done'} schedules-and-
// completes together).
//
// Mechanism: ONE `repo.runInTransaction` wraps BOTH use-cases' execute()
// calls. `withTrxRepo` clones the module's singleton `_updateTask`/
// `_updateTaskStatus` instances (Object.assign over the existing prototype)
// with `.repo` swapped for the trx-scoped repo `runInTransaction` hands back —
// reusing the SAME dependency wiring the "USE-CASE CONSTRUCTION" block above
// already assembled (no second copy of the dep list to drift). Every DB call
// each use-case makes through `this.repo.*` (fetchTaskWithEventIds,
// updateTaskById, and UpdateTask's complex-path recurCleanup via its own
// nested `repo.runInTransaction`, which knex resolves as a SAVEPOINT inside
// this outer transaction) participates in the SAME commit/rollback boundary.
// A `status >= 400` result from EITHER step throws `FacadeStepError` to
// unwind the transaction (rollback) while carrying the {status,body} result
// back out to the caller unchanged.
//
// SCOPE (documented, not silently assumed): the anchor projection
// (applyRollingAnchor) IS threaded onto this transaction — it writes the
// same task_masters row step 1 locks, so leaving it on the base pool
// self-deadlocks (harrison 999.1570 BLOCK-1). Two side-effect collaborators
// that were ALREADY non-transactional for a single facade.updateTaskStatus
// call remain outside: handleTemplatePause's instance cascade
// (recurring_template pause/unpause — hardcoded to `_repo`/`_ledgerWrites`,
// no db param) and reactivateDoneFrozen's ledger write (KnexLedgerWrites,
// base pool) — both touch rows this trx does not lock. Threading a trx
// through those would mean changing collaborators SHARED with
// lockedBatchUpdate/batchUpdateTxn/the plain single-call path — a materially
// larger port change than this ticket's lane, and those side effects carried
// no atomicity guarantee even for a single non-composed call. The row write
// itself (the specific "half-updated task" the ticket reports) is what this
// closes.
function FacadeStepError(result) {
  Error.call(this, 'updateTaskAndStatus: step rejected (status ' + result.status + ')');
  this.result = result;
}
FacadeStepError.prototype = Object.create(Error.prototype);
FacadeStepError.prototype.constructor = FacadeStepError;

function withTrxRepo(instance, trxRepo) {
  var bound = Object.create(Object.getPrototypeOf(instance));
  Object.assign(bound, instance, { repo: trxRepo });
  return bound;
}

/**
 * updateTaskAndStatus → composed UpdateTask + UpdateTaskStatus in ONE
 * transaction (999.1570). Called by the MCP update_task tool ONLY when a
 * single body carries both non-status fields AND a status; the plain
 * updateTask/updateTaskStatus facade calls remain the path when only one
 * kind of field is present (no second call exists there to race).
 * @param {Object} input
 * @param {string} input.id
 * @param {string} input.userId
 * @param {Object} input.nonStatusBody  fields for facade.updateTask (status excluded)
 * @param {string} input.status        the status for facade.updateTaskStatus
 * @param {string} [input.timezoneHeader]
 * @returns {Promise<{ status: number, body: Object }>} the LAST step's result
 *   (mirrors the pre-999.1570 two-call `lastResult` the MCP tool re-read from).
 */
async function updateTaskAndStatus(input) {
  var id = input.id;
  var userId = input.userId;
  var nonStatusBody = input.nonStatusBody;
  var status = input.status;
  var timezoneHeader = input.timezoneHeader;
  var lastResult = null;

  try {
    await _repo.runInTransaction(async function (trxRepo) {
      var trxUpdateTask = withTrxRepo(_updateTask, trxRepo);
      lastResult = await trxUpdateTask.execute({
        id: id, userId: userId, body: nonStatusBody, timezoneHeader: timezoneHeader
      });
      if (lastResult.status >= 400) throw new FacadeStepError(lastResult);

      var trxUpdateTaskStatus = withTrxRepo(_updateTaskStatus, trxRepo);
      // Thread THIS transaction into the anchor projection (harrison 999.1570
      // BLOCK-1): step 1 X-locks the template task_masters row whenever the
      // body carries a TEMPLATE_FIELD (updateTaskById(source_id) runs inside
      // this trx). UpdateTaskStatus's own call site omits ctx.db, so the
      // anchor UPDATE would go out on the BASE POOL against that same locked
      // row — an application-level deadlock InnoDB can't break (blocks until
      // innodb_lock_wait_timeout, then rolls the whole call back). Same
      // ctx.db threading batchUpdateTxn uses (ernie-w1-anchor-trx-escape).
      var _anchorDep = trxUpdateTaskStatus.applyRollingAnchor;
      trxUpdateTaskStatus.applyRollingAnchor = function (ctx) {
        return _anchorDep(Object.assign({}, ctx, { db: trxRepo.db }));
      };
      lastResult = await trxUpdateTaskStatus.execute({
        id: id, userId: userId, body: { status: status }, timezoneHeader: timezoneHeader
      });
      if (lastResult.status >= 400) throw new FacadeStepError(lastResult);
    });
  } catch (err) {
    if (err instanceof FacadeStepError) return err.result;
    throw err;
  }

  return lastResult;
}

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
  // 999.1570: composed one-transaction updateTask+updateTaskStatus — see the
  // function's own header (above `batchCreateTasks`) for the full contract.
  updateTaskAndStatus: updateTaskAndStatus,
  batchCreateTasks: batchCreateTasks,
  batchUpdateTasks: batchUpdateTasks,
  reEnableTask: reEnableTask,
  takeOwnership: takeOwnership,
  // WBS-named commands (not separate routes; exposed for completeness/tests)
  completeTask: completeTask,
  splitTask: splitTask,

  // Test-only clock seam (999.1440; pattern: runSchedule.js _setClock /
  // 999.1427). Swaps the clock feeding applyRollingAnchor's completion-date
  // getNowInTimezone call. Returns the previous clock so tests can restore
  // it in a finally block. Never call from production code.
  _setAnchorClock: process.env.NODE_ENV === 'test' ? function _setAnchorClock(clock) {
    var prev = _anchorTestClock;
    _anchorTestClock = clock;
    return prev;
  } : undefined,

  // pure helper re-exports the controller keeps for its external consumers
  rowToTask: mappers.rowToTask,
  taskToRow: mappers.taskToRow,
  buildSourceMap: mappers.buildSourceMap,
  safeParseJSON: mappers.safeParseJSON,
  TEMPLATE_FIELDS: mappers.TEMPLATE_FIELDS,
  // W1/W3 (sched-drop-overdue-column, M-5): the SAME computed-overdue
  // predicate rowToTask uses internally, re-exported so runSchedule.js (W3)
  // can replace its raw rawRow.overdue/r.overdue continuity reads with a call
  // to this single source of truth instead of duplicating the rule.
  computeOverdueForRow: mappers.computeOverdueForRow,
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
  KnexTaskRepository: KnexTaskRepository,
  InMemoryTaskRepository: InMemoryTaskRepository,
  RedisTaskCache: RedisTaskCache,
  EventBusTaskEvents: EventBusTaskEvents,
  ProjectsPort: require('./domain/ports/ProjectsPort'),
  KnexProjectsRepository: KnexProjectsRepository,
  InMemoryProjectsRepository: require('./adapters/InMemoryProjectsRepository'),
  PlacementMode: PlacementMode,

  // Plan-downgrade enforcement (999.994) — tasks_v + cal_sync_ledger mutation,
  // the task slice's own home for logic that used to live backwards in
  // controllers/billing-webhooks.controller.js.
  enforceDowngradeLimits: require('./adapters/DowngradeLimitsEnforcer').enforceDowngradeLimits,
};

// 999.1628 (TaskRepositoryTriggerPort inversion): register KnexTaskRepository
// with the dependency-free lib/task-repository-trigger seam. lib/task-write-queue
// reads it from there instead of lazy-requiring this facade — that lazy require
// was still a graph edge (check-require-cycles.js counts them) and closed the
// cycle task-write-queue -> slices/task/facade -> task-write-queue. Load-time
// registration: every production entrypoint loads this facade before any
// write-queue flush can fire (e.g. controllers/cal-sync.controller.js requires
// it directly for its own KnexTaskRepository use).
require('../../lib/task-repository-trigger').registerKnexTaskRepository(KnexTaskRepository);
