/**
 * CreateTask — application command use-case (Phase H3 / W5).
 *
 * Reproduces the legacy `createTask` HTTP handler (task.controller.js ~873)
 * step-for-step. The orchestration is moved out of the express handler; the row
 * shaping + validation use the W2 pure domain, persistence/version/cache go
 * through the W3/W4 ports, and the cross-table side-effects the repo port does
 * NOT model (projects upsert, scheduler-lock write-queue) enter as INJECTED
 * collaborators — exactly the seam pattern `enqueueScheduleRun` already uses.
 *
 * ── STEP-FOR-STEP (matches the handler) ──────────────────────────────────────
 *   1. validate (validateTaskInput with _requireText + _requireRecurStartIfAnchor),
 *      400 on errors.
 *   2. taskToRow (pure) → row; default id (uuidv7), task_type ('task'),
 *      created_at = new Date() (P1).
 *   3. fixed-mode date/time guard (400), all-day backstop (D-14),
 *      recurring strips depends_on.
 *   4. applySplitDefault — getUserSplitPreference (repo) → split default.
 *   5. ensureProject (injected — projects table is outside the repo port).
 *   6. lock check (injected isLocked): if locked → enqueueWrite (injected),
 *      invalidateTasks, enqueueScheduleRun({ skipEmit: true }), return 201 queued.
 *   7. unlocked → repo.insertTask, repo.fetchTaskWithEventIds read-back (500 if
 *      null), invalidateTasks, enqueueScheduleRun (the SOLE scheduler trigger —
 *      S4/S6: a direct call, never via the event publisher), publishTaskCreated
 *      (fire-and-forget — does NOT trigger the scheduler), return 201.
 *
 * ── S4/S6 (binding) ──────────────────────────────────────────────────────────
 * The scheduler trigger is the DIRECT injected `enqueueScheduleRun(...)` call,
 * placed exactly where the handler placed it (after the successful write). The
 * `events.publishTaskCreated(...)` call is decoupled: publishing emits a
 * lib-events event and has ZERO edge to the schedule trigger — no self-trigger,
 * no cascade. (The scheduler subscribing to events is H6, not H3.)
 *
 * ── P1 ───────────────────────────────────────────────────────────────────────
 * created_at is stamped `new Date()` here (matching taskToRow's updated_at); the
 * repository asserts JS Dates and never writes db.fn.now().
 *
 * ── NO NEW FALLBACKS ─────────────────────────────────────────────────────────
 * Every `||`/`??`/default below is preserved verbatim from the handler
 * (e.g. `existing.dur || 30` lives in the domain; `row.task_type = 'task'` is the
 * same literal). No new fallback is introduced.
 *
 * @typedef {Object} CreateTaskDeps
 * @property {import('../../domain/ports/TaskRepositoryPort')} repo
 * @property {import('../../domain/ports/TaskCachePort')} cache
 * @property {import('../../domain/ports/TaskEventPort')} events
 * @property {Function} enqueueScheduleRun (userId, source, ids, options) — the
 *   SOLE scheduler trigger (S4/S6); injected so W6 wires the real one.
 * @property {Object} mappers  W2 pure mappers (taskToRow, rowToTask).
 * @property {Object} validation  W2 pure validation (validateTaskInput).
 * @property {Function} ensureProject (userId, projectName) — projects-table upsert
 *   (outside the repo port; injected).
 * @property {Function} isLocked (userId) — scheduler-lock check (injected).
 * @property {Function} enqueueWrite (userId, id, op, row, source) — write-queue
 *   enqueue during a lock (injected).
 * @property {Function} uuidv7 () — id generator (injected for determinism in tests).
 * @property {Function} safeTimezone (raw) — timezone normalizer (pure; injected).
 * @property {Object} placementModes  PLACEMENT_MODES constants (pure).
 */

'use strict';

/** @param {CreateTaskDeps} deps */
function CreateTask(deps) {
  var required = ['repo', 'cache', 'events', 'enqueueScheduleRun', 'mappers',
    'validation', 'ensureProject', 'isLocked', 'enqueueWrite', 'uuidv7',
    'safeTimezone', 'placementModes'];
  for (var i = 0; i < required.length; i++) {
    if (!deps || deps[required[i]] === undefined || deps[required[i]] === null) {
      throw new Error('CreateTask: missing dependency "' + required[i] + '"');
    }
  }
  this.repo = deps.repo;
  this.cache = deps.cache;
  this.events = deps.events;
  this.enqueueScheduleRun = deps.enqueueScheduleRun;
  this.mappers = deps.mappers;
  this.validation = deps.validation;
  this.ensureProject = deps.ensureProject;
  this.isLocked = deps.isLocked;
  this.enqueueWrite = deps.enqueueWrite;
  this.uuidv7 = deps.uuidv7;
  this.safeTimezone = deps.safeTimezone;
  this.PLACEMENT_MODES = deps.placementModes;
  this.logger = deps.logger || { error: function () {} };
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @param {Object} input.body  request body (mutated locally for the _require*
 *   validation flags, exactly as the handler did).
 * @param {string} [input.timezoneHeader] raw `x-timezone` header value.
 * @returns {Promise<{ status: number, body: Object }>}
 */
CreateTask.prototype.execute = async function execute(input) {
  var userId = input.userId;
  var body = input.body;
  var PLACEMENT_MODES = this.PLACEMENT_MODES;

  // 1. validate (handler L876-883)
  body._requireText = true;
  body._requireRecurStartIfAnchor = true;
  var validationErrors = this.validation.validateTaskInput(body);
  delete body._requireText;
  delete body._requireRecurStartIfAnchor;
  if (validationErrors.length > 0) {
    return { status: 400, body: { error: validationErrors.join('; ') } };
  }

  // 2. shape row (handler L885-889)
  var tz = this.safeTimezone(input.timezoneHeader);
  var row = this.mappers.taskToRow(body, userId, tz);
  if (!row.id) row.id = this.uuidv7();
  if (!row.task_type) row.task_type = 'task';
  row.created_at = new Date(); // P1: new Date(), never db.fn.now()

  // 3. fixed-mode date/time guard (handler L891-897)
  if (row.placement_mode === PLACEMENT_MODES.FIXED) {
    var _hasDate = body.date !== undefined || body.scheduledAt !== undefined;
    var _hasTime = body.time !== undefined || body.scheduledAt !== undefined;
    if (!_hasDate || !_hasTime) {
      return { status: 400, body: { error: 'Fixed mode requires a date and time.' } };
    }
  }
  // all-day backstop D-14 (handler L898-905)
  var timeWasSet = body.time !== undefined || body.scheduledAt !== undefined;
  if (!timeWasSet && body.allDay === true && row.placement_mode === undefined) {
    row.placement_mode = PLACEMENT_MODES.ALL_DAY;
    if (row.when === undefined) row.when = 'allday';
  }
  // recurrings cannot have dependencies (handler L906-909)
  if (row.recurring || row.task_type === 'recurring_template' || row.task_type === 'recurring_instance') {
    delete row.depends_on;
  }

  // 4. applySplitDefault — getUserSplitPreference (repo) (handler L910 → L737-743)
  if (row.split === undefined || row.split === null) {
    var prefs = await this.repo.getUserSplitPreference(userId);
    var splitDefault = prefs
      ? (typeof prefs.config_value === 'string' ? JSON.parse(prefs.config_value) : prefs.config_value).splitDefault
      : false;
    row.split = splitDefault ? 1 : 0;
  }

  // 5. ensureProject (injected — projects table) (handler L911)
  await this.ensureProject(userId, body.project);

  // 6. lock check (handler L913-921)
  var locked = await this.isLocked(userId);
  if (locked) {
    row.user_id = userId;
    await this.enqueueWrite(userId, row.id, 'create', row, 'api:createTask');
    await this.cache.invalidateTasks(userId);
    this.enqueueScheduleRun(userId, 'api:createTask', [row.id], { skipEmit: true });
    return { status: 201, body: { task: this.mappers.rowToTask(row, null), queued: true } };
  }

  // 7. unlocked write path (handler L923-934)
  await this.repo.insertTask(row);
  var created = await this.repo.fetchTaskWithEventIds(row.id, userId);
  if (!created) {
    this.logger.error('Create task: fetchTaskWithEventIds returned null for id=' + row.id + ' type=' + row.task_type);
    return { status: 500, body: { error: 'Task created but could not be read back' } };
  }
  await this.cache.invalidateTasks(userId);
  // SOLE scheduler trigger (S4/S6) — direct call, never via the event publisher.
  this.enqueueScheduleRun(userId, 'api:createTask', [row.id]);
  // lib-events: fire-and-forget; does NOT trigger the scheduler.
  this.events.publishTaskCreated({ id: created.id, userId: userId, status: created.status });
  return { status: 201, body: { task: this.mappers.rowToTask(created, null) } };
};

module.exports = CreateTask;
