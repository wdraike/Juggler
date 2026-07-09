/**
 * BatchCreateTasks — application command use-case (Phase H3 / W5).
 *
 * Reproduces the legacy `batchCreateTasks` HTTP handler (task.controller.js ~1879)
 * step-for-step, over the W3/W4 ports + injected collaborators:
 *
 *   1. zod batchCreateSchema.safeParse (injected schema) → 400 on failure.
 *   2. array guards (empty → 400; > 500 → 400).
 *   3. per-task validateTaskInput (pure) → 400 'Task <i>: ...' on first error.
 *   4. split-default: getUserSplitPreference (repo) → splitDefault.
 *   5. taskToRow (pure) each task; created_at = new Date() (P1); split default.
 *   6. ensureProject (injected) for each distinct project name.
 *   7. lock check (injected isLocked): if locked → enqueueWrite each row,
 *      invalidateTasks, enqueueScheduleRun({ skipEmit: true }), 201 queued.
 *   8. unlocked → repo.runInTransaction(insertTask each) (T-TX boundary),
 *      invalidateTasks, enqueueScheduleRun (SOLE trigger, S4/S6), 201 created.
 *
 * ── T-TX ─────────────────────────────────────────────────────────────────────
 * The bulk insert runs inside `repo.runInTransaction(...)` — the SAME
 * `getDb().transaction(async trx => …)` boundary the handler had (commit on
 * resolve, rollback on reject), with each insert going through the trx-bound repo.
 *
 * ── DEADLOCK RETRY (999.589) ──────────────────────────────────────────────────
 * The transaction is wrapped in a MAX_RETRIES deadlock-retry loop, mirroring
 * BatchUpdateTasks: an InnoDB ER_LOCK_DEADLOCK (which MySQL resolves by rolling
 * back one of the contending transactions) is retried up to MAX_RETRIES times
 * with linear backoff; any non-deadlock error is re-thrown immediately, and a
 * deadlock that survives all retries is re-thrown after the loop. The happy
 * path is unchanged: a transaction that succeeds on the first attempt commits
 * once and the loop exits.
 *
 * ── S4/S6 ────────────────────────────────────────────────────────────────────
 * enqueueScheduleRun is the SOLE scheduler trigger; there is NO event publish in
 * this handler (the legacy batchCreate does not publish), so nothing to decouple —
 * the trigger is a single direct call after the write, no cascade.
 *
 * ── P1 ── created_at = new Date() per row (matches taskToRow's updated_at).
 * ── NO NEW FALLBACKS ── every default preserved verbatim from the handler.
 *
 * @typedef {Object} BatchCreateTasksDeps
 * @property {import('../../domain/ports/TaskRepositoryPort')} repo
 * @property {import('../../domain/ports/TaskCachePort')} cache
 * @property {Function} enqueueScheduleRun
 * @property {Object} mappers  (taskToRow)
 * @property {Object} validation  (validateTaskInput)
 * @property {Object} batchCreateSchema  zod schema (safeParse).
 * @property {Function} validateReferences (userId, body) — DB-backed
 *   dependsOn/location/tools existence check (999.1394: batch matches single).
 * @property {import('../../domain/ports/ProjectsPort')} projects  projects-table port
 * @property {Function} isLocked
 * @property {Function} enqueueWrite
 * @property {Function} safeTimezone
 * @property {Function} sleep  async backoff for the deadlock-retry loop (999.589).
 */

'use strict';

var assertDeps = require('../_assertDeps');

var MAX_RETRIES = 3;

/** @param {BatchCreateTasksDeps} deps */
function BatchCreateTasks(deps) {
  var required = ['repo', 'cache', 'enqueueScheduleRun', 'mappers', 'validation',
    'batchCreateSchema', 'validateReferences', 'projects', 'isLocked', 'enqueueWrite',
    'safeTimezone', 'sleep'];
  assertDeps('BatchCreateTasks', deps, required);
  this.repo = deps.repo;
  this.cache = deps.cache;
  this.enqueueScheduleRun = deps.enqueueScheduleRun;
  this.mappers = deps.mappers;
  this.validation = deps.validation;
  this.batchCreateSchema = deps.batchCreateSchema;
  this.validateReferences = deps.validateReferences;
  this.projects = deps.projects;
  this.isLocked = deps.isLocked;
  this.enqueueWrite = deps.enqueueWrite;
  this.safeTimezone = deps.safeTimezone;
  this.sleep = deps.sleep;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @param {Object} input.body  `{ tasks: [...] }`.
 * @param {string} [input.timezoneHeader]
 * @returns {Promise<{ status: number, body: Object }>}
 */
BatchCreateTasks.prototype.execute = async function execute(input) {
  var userId = input.userId;
  var body = input.body;

  // 1. zod schema (handler L1880-1881)
  var batchParsed = this.batchCreateSchema.safeParse(body);
  if (!batchParsed.success) {
    return { status: 400, body: { error: 'Invalid batch payload', details: batchParsed.error.issues } };
  }

  var tasks = body.tasks;
  // 2. array guards (handler L1884-1890)
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { status: 400, body: { error: 'Tasks array required' } };
  }
  if (tasks.length > 500) {
    return { status: 400, body: { error: 'Batch limited to 500 items' } };
  }

  // 3. per-task validate (handler L1892-1899)
  // 999.1394: batch now matches single-item CreateTask — the same
  // _requireRecurStartIfAnchor flag (anchor-dependent recur needs a recurStart)
  // and the same DB-backed reference existence check (dependsOn/location/tools
  // must reference IDs the user owns; dependsOn skipped for recurring tasks,
  // whose deps are stripped downstream — mirrors CreateTask.js step 1b).
  for (var i = 0; i < tasks.length; i++) {
    var t = tasks[i];
    var batchCreateErrs = this.validation.validateTaskInput(
      Object.assign({ _requireText: true, _requireRecurStartIfAnchor: true }, t));
    if (batchCreateErrs.length > 0) {
      return { status: 400, body: { error: 'Task ' + i + ': ' + batchCreateErrs.join('; ') } };
    }
    var refBody = t;
    if (t.recurring) {
      refBody = Object.assign({}, t);
      delete refBody.dependsOn;
    }
    var referenceErrors = await this.validateReferences(userId, refBody);
    if (referenceErrors.length > 0) {
      return { status: 400, body: { error: 'Task ' + i + ': ' + referenceErrors.join('; ') } };
    }
  }

  var tz = this.safeTimezone(input.timezoneHeader);

  // 4. split default (handler L1903-1904)
  var prefs = await this.repo.getUserSplitPreference(userId);
  var splitDefault = prefs
    ? (typeof prefs.config_value === 'string' ? JSON.parse(prefs.config_value) : prefs.config_value).splitDefault
    : false;

  // 5. shape rows (handler L1906-1913)
  var self = this;
  var rows = tasks.map(function (t) {
    var row = self.mappers.taskToRow(t, userId, tz);
    row.created_at = new Date(); // P1
    if (row.split === undefined || row.split === null) {
      row.split = splitDefault ? 1 : 0;
    }
    return row;
  });

  // 6. ensureProject for distinct names (handler L1915-1922)
  var projectNames = [];
  var seen = {};
  tasks.forEach(function (t) {
    if (t.project && !seen[t.project]) { projectNames.push(t.project); seen[t.project] = true; }
  });
  for (var pi = 0; pi < projectNames.length; pi++) {
    await this.projects.ensureProject(userId, projectNames[pi]);
  }

  // 7. lock check (handler L1924-1934)
  var locked = await this.isLocked(userId);
  if (locked) {
    for (var qi = 0; qi < rows.length; qi++) {
      rows[qi].user_id = userId;
      await this.enqueueWrite(userId, rows[qi].id, 'create', rows[qi], 'api:batchCreateTasks');
    }
    await this.cache.invalidateTasks(userId);
    this.enqueueScheduleRun(userId, 'api:batchCreateTasks', rows.map(function (r) { return r.id; }), { skipEmit: true });
    return { status: 201, body: { created: rows.length, queued: true } };
  }

  // 8. unlocked: transactional bulk insert with deadlock-retry (handler L1936-1945; 999.589)
  for (var attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await this.repo.runInTransaction(async function (trxRepo) {
        for (var ti = 0; ti < rows.length; ti++) {
          await trxRepo.insertTask(rows[ti]);
        }
      });
      break;
    } catch (err) {
      if (err && err.code === 'ER_LOCK_DEADLOCK' && attempt < MAX_RETRIES) {
        await this.sleep(200 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }

  await this.cache.invalidateTasks(userId);
  this.enqueueScheduleRun(userId, 'api:batchCreateTasks', rows.map(function (r) { return r.id; }));
  return { status: 201, body: { created: rows.length } };
};

module.exports = BatchCreateTasks;
module.exports.MAX_RETRIES = MAX_RETRIES;
