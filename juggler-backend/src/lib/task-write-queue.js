/**
 * task-write-queue.js — Durable queue for scheduling-relevant task writes.
 *
 * Implements WriteQueuePort (contract doc removed as dead code, 999.1179).
 *
 * When the per-user lock is held (scheduler or cal-sync running), mutation
 * endpoints queue scheduling-relevant field changes here instead of writing
 * directly to the tasks table. Non-scheduling fields (text, notes, project)
 * always write directly.
 *
 * The queue flushes when the lock releases: entries are coalesced per task,
 * applied in a single transaction, and a schedule run is enqueued.
 */

var db = require('../db');
var { createLogger } = require('@raike/lib-logger');
var logger = createLogger('task-write-queue');
// 999.1199: lib/tasks-write is internal to slices/task/adapters (eslint
// boundary) now — obtained via the task slice facade's exported
// KnexTaskRepository class (getKnexTaskRepository() below), NOT a direct
// require(). Lazy require (same idiom as getAcquireLock/getSseEmitter/getCache
// below) because task/facade.js itself requires THIS module at load time
// (taskWriteQueue.isLocked/enqueueWrite/splitFields) — a top-level require
// here would close a load-order cycle.
var _KnexTaskRepository;
function getKnexTaskRepository() {
  if (!_KnexTaskRepository) _KnexTaskRepository = require('../slices/task/facade').KnexTaskRepository;
  return _KnexTaskRepository;
}
// 999.1198: the mutation→schedule trigger comes from the dependency-free
// scheduleTrigger seam (scheduleQueue registers itself there at load), not a
// lazy require of scheduler/scheduleQueue — that lazy require papered over the
// task-write-queue ↔ scheduleQueue require cycle.
var { enqueueScheduleRun } = require('../scheduler/scheduleTrigger');
// 999.1192: recurring-family id expansion lives in lib/task-instances (shared
// with KnexTaskRepository) — no more reach into controllers/task.controller.
var { expandToAllInstanceIds } = require('./task-instances');

// Lazy require to avoid circular dependency
var _acquireLock, _releaseLock, _refreshLock;
function getAcquireLock() {
  if (!_acquireLock) _acquireLock = require('./sync-lock').acquireLock;
  return _acquireLock;
}
function getReleaseLock() {
  if (!_releaseLock) _releaseLock = require('./sync-lock').releaseLock;
  return _releaseLock;
}
function getRefreshLock() {
  if (!_refreshLock) _refreshLock = require('./sync-lock').refreshLock;
  return _refreshLock;
}

var _sseEmitter;
function getSseEmitter() {
  if (!_sseEmitter) _sseEmitter = require('./sse-emitter');
  return _sseEmitter;
}

var _cache;
function getCache() {
  if (!_cache) _cache = require('./redis');
  return _cache;
}

// ── Field classification ─────────────────────────────────────────────
// Non-scheduling fields: safe to write while lock is held.
// Everything else is considered scheduling-relevant (conservative default).
var NON_SCHEDULING_FIELDS = new Set([
  'text', 'notes', 'project', 'section',
  'gcal_event_id', 'msft_event_id',
  'tz', 'updated_at'
]);

/**
 * Split a DB row fragment into scheduling and non-scheduling fields.
 * Any field NOT in NON_SCHEDULING_FIELDS is classified as scheduling.
 */
function splitFields(row) {
  var scheduling = {};
  var nonScheduling = {};
  Object.keys(row).forEach(function(k) {
    if (NON_SCHEDULING_FIELDS.has(k)) {
      nonScheduling[k] = row[k];
    } else {
      scheduling[k] = row[k];
    }
  });
  return { schedulingFields: scheduling, nonSchedulingFields: nonScheduling };
}

// ── Lock check ───────────────────────────────────────────────────────

/**
 * Fast check: is the per-user lock currently held?
 * PK lookup on a single-row table — sub-millisecond.
 */
async function isLocked(userId) {
  var row = await db.raw(
    'SELECT 1 FROM sync_locks WHERE user_id = ? AND expires_at > NOW() LIMIT 1',
    [userId]
  );
  return (row[0] && row[0].length > 0);
}

// ── Queue operations ─────────────────────────────────────────────────

/**
 * Insert a pending write into the queue.
 * `fields` is a pre-converted DB row fragment (output of taskToRow with
 * user_id/created_at stripped). All timezone conversion and template
 * routing must happen BEFORE calling this.
 */
async function enqueueWrite(userId, taskId, operation, fields, source) {
  await db('task_write_queue').insert({
    user_id: userId,
    task_id: taskId,
    operation: operation,
    fields: JSON.stringify(fields),
    source: source || 'unknown'
  });
  logger.info('[WRITE-QUEUE] enqueued ' + operation + ' for task ' + taskId + ' user ' + userId + ' source=' + (source || 'unknown'));
}

// ── Coalescing ───────────────────────────────────────────────────────

async function hasQueuedWrites(userId) {
  var result = await db('task_write_queue')
    .where('user_id', userId)
    .count('id as cnt')
    .first();
  return result && parseInt(result.cnt, 10) > 0;
}

/**
 * Coalesce queue entries into a minimal set of DB operations.
 * Input: array of { id, task_id, operation, fields } ordered by created_at ASC.
 * Output: array of { taskId, operation, fields } ready to execute.
 */
function coalesceEntries(entries) {
  // Group by task_id, preserving order within each group
  var groups = {};
  var order = [];
  entries.forEach(function(e) {
    if (!groups[e.task_id]) {
      groups[e.task_id] = [];
      order.push(e.task_id);
    }
    groups[e.task_id].push(e);
  });

  var results = [];
  order.forEach(function(taskId) {
    var ops = groups[taskId];
    var finalOp = null;
    var mergedFields = {};

    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      var fields = typeof op.fields === 'string' ? JSON.parse(op.fields) : op.fields;

      if (op.operation === 'delete') {
        // Delete cancels any prior create; otherwise delete wins
        if (finalOp === 'create') {
          finalOp = null; // create + delete = no-op
          mergedFields = {};
        } else {
          finalOp = 'delete';
          mergedFields = fields; // may contain { cascade: 'recurring' }
        }
      } else if (op.operation === 'create') {
        finalOp = 'create';
        mergedFields = fields;
      } else {
        // update — merge into whatever we have
        if (finalOp === null) finalOp = 'update';
        Object.assign(mergedFields, fields);
      }
    }

    if (finalOp !== null) {
      results.push({ taskId: taskId, operation: finalOp, fields: mergedFields });
    }
  });

  return results;
}

// ── Flush (with lock acquisition) ────────────────────────────────────

/**
 * Flush all pending writes for a user. Acquires the lock first.
 * Returns true if flushed, false if lock couldn't be acquired.
 */
async function flushQueue(userId) {
  // Quick check: anything to flush?
  var pending = await hasQueuedWrites(userId);
  if (!pending) return true;

  var lockResult = await getAcquireLock()(userId);
  if (!lockResult.acquired) return false;

  var token = lockResult.token;
  var lockStart = Date.now();
  var heartbeat = setInterval(function() {
    if (Date.now() - lockStart > 60000) { clearInterval(heartbeat); return; }
    getRefreshLock()(userId, token).catch(function() {});
  }, 10000);

  try {
    await _doFlush(userId);
  } finally {
    clearInterval(heartbeat);
    await getReleaseLock()(userId, token);
  }
  return true;
}

/**
 * Flush all pending writes for a user. Caller already holds the lock.
 * Used by scheduler and cal-sync inside their lock callbacks.
 */
async function flushQueueInLock(userId) {
  return _doFlush(userId);
}

/**
 * Internal flush implementation. Reads queue, coalesces, applies, cleans up.
 */
async function _doFlush(userId) {
  var entries = await db('task_write_queue')
    .where('user_id', userId)
    .orderBy('created_at', 'asc')
    .select('id', 'task_id', 'operation', 'fields', 'source');

  if (entries.length === 0) return;

  var entryIds = entries.map(function(e) { return e.id; });
  var coalesced = coalesceEntries(entries);
  var affectedIds = [];

  logger.info('[WRITE-QUEUE] flushing ' + entries.length + ' entries → ' + coalesced.length + ' ops for user ' + userId);

  await db.transaction(async function(trx) {
    // 999.1199: raw passthrough via a KnexTaskRepository transaction token
    // (constructed over this SAME trx) instead of a direct require('./tasks-write').
    // Kept as raw passthrough (not the P1-asserting port methods) because this
    // loop stamps created_at/updated_at with `db.fn.now()` (MySQL server clock),
    // not a JS Date — the strict port would reject that.
    var tasksWrite = new (getKnexTaskRepository())({ db: trx }).tasksWrite;
    for (var i = 0; i < coalesced.length; i++) {
      var op = coalesced[i];
      var fields = op.fields;
      // Fields came out of JSON, so datetime columns are ISO strings. MySQL
      // rejects those literally; rehydrate to Date so the driver formats them.
      var DATETIME_FIELDS = ['scheduled_at', 'desired_at', 'deadline', 'start_after_at', 'disabled_at', 'recur_start', 'recur_end'];
      for (var dfi = 0; dfi < DATETIME_FIELDS.length; dfi++) {
        var f = DATETIME_FIELDS[dfi];
        if (fields && typeof fields[f] === 'string' && fields[f].length > 0) {
          var parsed = new Date(fields[f]);
          if (!isNaN(parsed.getTime())) fields[f] = parsed;
        }
      }

      if (op.operation === 'create') {
        fields.created_at = db.fn.now();
        fields.updated_at = db.fn.now();
        await tasksWrite.insertTask(trx, fields);
        affectedIds.push(op.taskId);

      } else if (op.operation === 'update') {
        fields.updated_at = db.fn.now();
        await tasksWrite.updateTaskById(trx, op.taskId, fields, userId);
        affectedIds.push(op.taskId);

      } else if (op.operation === 'delete') {
        var cascade = fields && fields.cascade;
        if (cascade === 'recurring') {
          // Delete template + pending instances
          var task = await trx('tasks_v').where({ id: op.taskId, user_id: userId }).first();
          if (task) {
            var templateId = task.source_id || op.taskId;
            // Delete pending instances + the template master (FK SET NULL preserves completed)
            await tasksWrite.deleteInstancesWhere(trx, userId, function(q) {
              return q.where({ master_id: templateId, status: '' });
            });
            await tasksWrite.deleteTaskById(trx, templateId, userId);
            affectedIds.push(templateId);
          }
        } else {
          await tasksWrite.deleteTaskById(trx, op.taskId, userId);
          affectedIds.push(op.taskId);
        }
      }
    }

    // Delete processed queue entries (by id, not user_id — new entries may have arrived)
    await trx('task_write_queue').whereIn('id', entryIds).del();
  });

  // Post-flush: invalidate cache, notify frontend, trigger schedule run
  if (affectedIds.length > 0) {
    getCache().invalidateTasks(userId).catch(function(err) {
      logger.error('[WRITE-QUEUE] cache invalidation error:', err.message);
    });
    // If any flushed id belongs to a recurring template or one of its
    // instances, broadcast a refresh for every sibling so the frontend
    // doesn't keep stale rows cached. 999.1192: expansion comes from
    // lib/task-instances (top-level require — the cycle through
    // task.controller is gone); the same-shape try/catch keeps the legacy
    // broadcast-the-unexpanded-ids contract on expansion errors.
    var broadcastIds = affectedIds;
    try {
      broadcastIds = await expandToAllInstanceIds(db, userId, affectedIds);
    } catch (_e) { /* fall back to affectedIds */ }
    var payload = { source: 'write-queue-flush', timestamp: Date.now() };
    payload.ids = broadcastIds;
    getSseEmitter().emit(userId, 'tasks:changed', payload);
    enqueueScheduleRun(userId, 'write-queue-flush');
  }
}

module.exports = {
  isLocked: isLocked,
  enqueueWrite: enqueueWrite,
  flushQueue: flushQueue,
  flushQueueInLock: flushQueueInLock,
  splitFields: splitFields,
  NON_SCHEDULING_FIELDS: NON_SCHEDULING_FIELDS
};
