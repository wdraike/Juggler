/**
 * scheduleQueue.js — DB-backed event queue + debounced scheduler runner
 *
 * Mutation controllers call enqueueScheduleRun(userId) after their DB write.
 * This inserts a row into schedule_queue.
 *
 * A poll loop checks the DB for unclaimed rows on a short interval. For each
 * unclaimed user, it atomically claims the row (claimed_by + claimed_at), then
 * runs the scheduler if the quiet period has elapsed.
 *
 * The poll loop is DB-only-authoritative (999.952): under two Cloud Run
 * instances, an in-memory dirty set on instance A never marked instance B
 * dirty, so B's poll loop could miss a pending user entirely. The prior
 * in-memory dirty set was removed; the DB row itself is the sole pending-work
 * record, queried directly each poll (`SELECT DISTINCT user_id FROM
 * schedule_queue WHERE claimed_at IS NULL AND created_at < NOW() - INTERVAL
 * 2 SECOND`). The `_running` map remains as a single-flight in-process guard
 * (not a queue-membership hint) — see the multi-instance double-run pattern
 * in RESEARCH.md Category 2 / Pitfall 3.
 *
 * Reference pattern: cal-history-cron.js uses the same DB-based claim approach
 * (sync_locks shard leader election). The claiming here is lighter-weight —
 * a direct UPDATE on the schedule_queue row instead of an INSERT-based mutex —
 * because schedule_queue rows are per-user and naturally deduplicated.
 *
 * Single-flight per user within one instance: the `running` Map prevents one
 * instance from racing itself if the poll interval fires faster than processUser
 * completes. The DB claim prevents cross-instance races.
 *
 * Crash recovery: if an instance crashes mid-run, claimed_by stays set but
 * claimed_at stops refreshing. After CLAIM_TTL_SECONDS, another instance
 * reclaims the row and runs the scheduler. (T-07-07 mitigation)
 */

var db = require('../db');
var crypto = require('crypto');
var MysqlClockAdapter = require('../slices/scheduler/adapters/MysqlClockAdapter');
var { createLogger } = require('@raike/lib-logger');
var logger = createLogger('scheduleQueue');
// H7 (JUG-SCHEDULER-LEGACY-DB-BYPASS / 999.1532): the 12 inline
// schedule_queue/task_write_queue/tasks_v call sites route through
// ScheduleQueuePort — verbatim query moves, no behavior change.
var SchedulerQueueRepository = require('../slices/scheduler/adapters/SchedulerQueueRepository');
var _queueRepo = new SchedulerQueueRepository();

// Lazy requires to avoid circular dependency
var _flushQueueInLock;
function getFlushQueueInLock() {
  if (!_flushQueueInLock) _flushQueueInLock = require('../lib/task-write-queue').flushQueueInLock;
  return _flushQueueInLock;
}
var _runScheduleAndPersist;
function getRunScheduleAndPersist() {
  if (!_runScheduleAndPersist) _runScheduleAndPersist = require('../slices/scheduler/facade').runScheduleAndPersist;
  return _runScheduleAndPersist;
}
var _withLock;
function getWithLock() {
  if (!_withLock) _withLock = require('../lib/sync-lock').withLock;
  return _withLock;
}
var _sseEmitter;
function getSseEmitter() {
  if (!_sseEmitter) _sseEmitter = require('../lib/sse-emitter');
  return _sseEmitter;
}
// Swappable queue backend (999.627). Lazy require so the cloud-tasks client is
// only loaded when JUGGLER_QUEUE_DRIVER=cloud-tasks selects it.
var _queueBackend;
function getQueueBackend() {
  // Defensive re-resolve (test-isolation hardening): a neighboring suite's
  // jest.resetModules() can blow away the module registry while a timer/closure
  // from THIS module's pre-reset instance still holds a stale `_queueBackend`
  // whose `isCloudTasks` is no longer a function — surfacing as the cross-suite
  // "backend.isCloudTasks is not a function" crash. Validate the cached backend
  // and re-require if it is missing or half-loaded. In production this is a
  // no-op: the cache is populated once with a valid module and never invalidated.
  if (!_queueBackend || typeof _queueBackend.isCloudTasks !== 'function') {
    _queueBackend = require('./queue-backend');
  }
  return _queueBackend;
}

// ── Configuration ──
var DEBOUNCE_MS    = 2000;   // quiet period before scheduler runs
var POLL_MS        = 3000;   // how often the poll loop checks the DB (was 1s; 3s reduces idle DB load)
var LOCK_RETRY_MS  = 2000;   // wait between lock acquisition retries

// ── Per-user rate limit (999.591) ───────────────────────────────────────────
// The 2000ms debounce (processUser) coalesces bursts but does NOT bound how many
// scheduler RUNS a single user can trigger over time — a user mutating tasks
// every few seconds could drive unbounded runs. This is a per-user sliding
// window: at most RATE_LIMIT_MAX enqueues per RATE_LIMIT_WINDOW_MS. In-memory
// (matching the existing in-process _lastEnqueueTime state); a clean
// fit because the DB row is per-user-deduplicated and the real cost being
// bounded here is the local enqueue → poll → run cascade on THIS instance.
var RATE_LIMIT_MAX        = 10;     // max enqueues per window per user
var RATE_LIMIT_WINDOW_MS  = 60000;  // 60s window

// ── Multi-instance claiming constants (FIX-04) ──────────────────────────────

var POLL_LOOP_INSTANCE;
var INSTANCE_ID = crypto.randomUUID();
var POLL_ACTIVE = false;
// Track every live claim-heartbeat interval so a fire-and-forget claimAndRun that
// is still in flight at suite teardown cannot leave a 30s setInterval ticking into
// the next suite (the 999.869 cross-suite timer leak). Normally claimAndRun's
// finally clears its own heartbeat; this set is the safety net cleared by
// _resetForTests() / shutdown.
var _heartbeats = new Set();

// ── State ──
var _lastEnqueueTime = new Map();       // user_id → timestamp
var _running = new Map();             // user_id → promise (single-flight within instance)
var _lastPollTime = 0;
var _lastError = null;                // { timestamp, message } — last scheduler error, for health checks
var _rateWindows = new Map();         // user_id → array of enqueue timestamps (within the rate-limit window) (999.591)

// Injectable clock (999.1195) — every wall-clock read in this module derives
// from a ClockPort. Production wires MysqlClockAdapter (the same adapter
// RunScheduleCommand defaults to); tests swap the whole port via
// _internal.setClockPort(FakeClockAdapter) or override the ms-epoch helper
// directly via the legacy _internal.setClock(fn) seam. Module-private.
var _clock = new MysqlClockAdapter();
var _defaultNow = function () { return _clock.now().getTime(); };
var _now = _defaultNow;

/**
 * Per-user sliding-window rate-limit check (999.591). Records this enqueue and
 * returns true if it is WITHIN the allowance, false if the user has exceeded
 * RATE_LIMIT_MAX enqueues in the last RATE_LIMIT_WINDOW_MS. Pure in-memory; the
 * window array is pruned of expired timestamps on each call.
 */
function checkRateLimit(userId) {
  var now = _now();
  var windowStart = now - RATE_LIMIT_WINDOW_MS;
  var hits = _rateWindows.get(userId);
  if (!hits) { hits = []; _rateWindows.set(userId, hits); }
  // Drop timestamps older than the window.
  while (hits.length > 0 && hits[0] <= windowStart) hits.shift();
  if (hits.length >= RATE_LIMIT_MAX) {
    return false; // limit exceeded — do NOT record this attempt
  }
  hits.push(now);
  return true;
}

// Poll loop tracking for health checks
function getPollLoopState() {
  return {
    active: POLL_ACTIVE,
    lastPollTime: _lastPollTime,
    runningCount: _running.size
  };
}

// ── Public API ──

/**
 * Mark a user as needing a schedule run. Debounced: if called repeatedly
 * within DEBOUNCE_MS, only the last call matters.
 *
 * The DB row is the source of truth.
 */
async function enqueueScheduleRun(userId, source, options) {
  // ── Per-user rate limit (999.591) ──
  // The limit caps EXPENSIVE out-of-band runs (the `immediate` trigger), NOT the
  // recording of pending work. When the user exceeds the window we still mark the
  // user dirty and upsert the per-user queue row (coalesced via onConflict) so the
  // poll loop picks up the pending recompute on its next cycle — a mutation's
  // recompute is never silently dropped (elmo WARN-3). What we suppress is the
  // immediate `processUser` trigger, so a hot-looping client cannot drive unbounded
  // immediate runs. Callers fire-and-forget; the indicator is for surfacing/tests.
  var rateLimited = !checkRateLimit(userId);
  if (rateLimited) {
    logger.warn('[SCHED-QUEUE] rate-limited (immediate suppressed) for ' + userId
      + ' source=' + (source || 'unknown')
      + ' (>' + RATE_LIMIT_MAX + '/' + (RATE_LIMIT_WINDOW_MS / 1000) + 's)');
  }

  var now = _now();
  _lastEnqueueTime.set(userId, now);

  // Insert or update queue row (the actual work queue). An immediate run is
  // suppressed when rate-limited (the queued recompute still happens via poll).
  var shouldRun = options && options.immediate && !rateLimited;
  var row = {
    user_id: userId,
    source: source || 'unknown',
    created_at: _clock.now()
  };

  try {
    // Upsert: on conflict, only update if the row is old enough that we might
    // have lost a claimed worker (crash recovery), otherwise leave it alone.
    // FIX-04: Use INSERT with ON DUPLICATE KEY so we can detect conflicts cleanly.
    await _queueRepo.upsertQueueRow(db, row);
  } catch (e) {
    // Conflict resolution failed — log and continue; the poll loop will pick it up
    logger.error('[SCHED-QUEUE] Failed to enqueue for user', { userId, error: e });
  }

  // ── Cloud Tasks dispatch (999.627) ──
  // When JUGGLER_QUEUE_DRIVER=cloud-tasks, ALSO push a task to Cloud Tasks. The
  // DB row above is retained as a safety net + dedup record: the push-handler
  // and the poll loop both go through the atomic DB claim (tryClaim), so
  // whichever fires first wins and there is never a double-run. If the
  // cloud-tasks enqueue fails we have already written the DB row, so the poll
  // loop picks it up — a trigger is never dropped. Off-flag: this is a no-op.
  var dispatchedCloudTasks = false;
  var backend = getQueueBackend();
  // Call-site guard: if the registry was torn down mid-test (a leaked timer from a
  // prior suite firing after jest.resetModules), `backend` can be a half-loaded
  // module with no `isCloudTasks`. Treat that as the default (non-cloud-tasks) DB
  // path rather than throwing — the DB row is already written above, so the poll
  // loop still picks it up. Production always has a fully-loaded backend.
  if (backend && typeof backend.isCloudTasks === 'function' && backend.isCloudTasks()) {
    try {
      var d = await backend.dispatchScheduleRun(userId, source);
      dispatchedCloudTasks = !!(d && d.dispatched);
    } catch (e) {
      logger.error('[SCHED-QUEUE] cloud-tasks dispatch threw for ' + userId, { error: e });
    }
  }

  // Immediate trigger for test environments or urgent updates. Suppressed in
  // cloud-tasks mode when the task was successfully enqueued — the push-handler
  // will run it (avoids a redundant in-process run racing the push).
  if (shouldRun && !dispatchedCloudTasks) {
    processUser(userId);
  }

  logger.info('[SCHED-QUEUE] enqueued for ' + userId + ' source=' + (source || 'unknown')
    + (dispatchedCloudTasks ? ' (cloud-tasks)' : ''));
  // Return shape preserves the legacy { enqueued, rateLimited } contract for the
  // DB default path (existing tests assert it exactly). `cloudTasks` is only
  // added when a task was actually dispatched (cloud-tasks mode), so off-flag
  // behavior is byte-identical.
  var ret = { enqueued: true, rateLimited: rateLimited };
  if (dispatchedCloudTasks) ret.cloudTasks = true;
  return ret;
}

/**
 * Remove a user from the dirty set and queue.
 * Called by the scheduler when it finishes a run (success or failure).
 */
async function dequeueScheduleRun(userId) {
  _lastEnqueueTime.delete(userId);
  _running.delete(userId);

  try {
    // Delete the queue row for this user
    var swept = await _queueRepo.deleteQueueRow(db, userId);
    logger.info('[SCHED-QUEUE] swept ' + swept + ' entry(ies) for ' + userId);
  } catch (e) {
    logger.error('[SCHED-QUEUE] Failed to dequeue for user', { userId, error: e });
  }
}

// ── DB Claiming (FIX-04) ────────────────────────────────────────────────────

/**
 * Attempt to atomically claim the schedule_queue row for userId.
 * instanceId is passed explicitly so this function is testable in isolation
 * (tests pass synthetic instance identifiers without touching INSTANCE_ID).
 *
 * Returns:
 *   { claimed: true, row }                                    — won the claim
 *   { claimed: false, reason: 'already_claimed', by, since }  — lost to another instance
 *   { claimed: false, reason: 'no_row' }                      — row doesn't exist
 *   { claimed: false, reason: 'row_missing_after_claim' }     — race: row disappeared after update
 */
async function tryClaim(userId, instanceId) {
  var claimedAt = _clock.now();
  var ttlExpiry = new Date(_now() - (CLAIM_TTL_SECONDS * 1000));

  // Try to claim this user's row: either unclaimed, or an expired claim.
  // We use user_id as the WHERE to ensure atomicity (single row UPDATE).
  var updated = await _queueRepo.claimQueueRow(db, userId, instanceId, claimedAt, ttlExpiry);

  if (updated === 0) {
    var existing = await _queueRepo.getQueueRowByUser(db, userId);
    if (existing && existing.claimed_by && existing.claimed_by !== instanceId) {
      return { claimed: false, reason: 'already_claimed', by: existing.claimed_by, since: existing.claimed_at };
    }
    return { claimed: false, reason: 'no_row' };
  }

  // We claimed it — read the row back for callers that need it.
  var row = await _queueRepo.getQueueRowByUser(db, userId);
  if (!row) {
    return { claimed: false, reason: 'row_missing_after_claim' };
  }

  return { claimed: true, row: row };
}

// Claim a work item with multi-instance safety, then run the scheduler.
// Returns { claimed: true, success: true } on full success,
//         { claimed: true, success: false, error } on run failure,
//         { claimed: false, reason } if the claim was lost.
async function claimAndRun(userId) {
  var c = await tryClaim(userId, INSTANCE_ID);
  if (!c.claimed) {
    return c;
  }
  var row = c.row;

  // Start heartbeat for long-running scheduler jobs
  var heartbeat = startClaimHeartbeat(userId);
  try {
    // Emit schedule:running so the frontend toolbar shows "Scheduling..."
    try { getSseEmitter().emit(userId, 'schedule:running', {}); } catch (_e) { /* non-fatal */ }
    var runWithLock = getWithLock();
    var runScheduleAndPersist = getRunScheduleAndPersist();
    var flushQueueInLock = getFlushQueueInLock();

    var _schedResult;
    await runWithLock(userId, async function() {
      // Flush any pending writes before scheduler reads task state
      await flushQueueInLock(userId);
      // Run the scheduler
      _schedResult = await runScheduleAndPersist(userId, row.source);
    });

    // Success: sweep the queue and notify frontend with the changeset
    await dequeueScheduleRun(userId);
    try {
      var _ssePayload = {};
      if (_schedResult && _schedResult.changeset) {
        _ssePayload.changeset = _schedResult.changeset;
      }
      getSseEmitter().emit(userId, 'schedule:changed', _ssePayload);
    } catch (_e) { /* non-fatal */ }
    return { claimed: true, success: true };
  } catch (err) {
    // On failure, release the claim so someone else can retry.
    // Log the real error server-side (999.683: technical detail lives in logs;
    // the health popup shows plain language only). Without this the error went
    // ONLY to the in-memory _lastError and was never recorded anywhere.
    logger.error('scheduler run failed (claimAndRun)', { userId: userId, error: err.message, stack: err.stack });
    _lastError = { timestamp: _now(), message: err.message };
    // Emit schedule:changed to clear the "Scheduling..." indicator on error
    try { getSseEmitter().emit(userId, 'schedule:changed', {}); } catch (_e2) { /* non-fatal */ }
    await releaseClaim(userId, INSTANCE_ID);
    return { claimed: true, success: false, error: err.message };
  } finally {
    clearClaimHeartbeat(heartbeat);
  }
}

/**
 * Process a user: claim from DB, run scheduler, sweep queue.
 * This is the main entry point called by the poll loop.
 */
async function processUser(userId) {
  // Single-flight within this instance
  if (_running.has(userId)) {
    var attempt = 0;
    var MAX_LOCK_RETRIES = 5;
    while (_running.has(userId) && attempt < MAX_LOCK_RETRIES) {
      attempt++;
      logger.info('[SCHED-QUEUE] lock held for ' + userId + ', retry ' + attempt + '/' + MAX_LOCK_RETRIES);
      await new Promise(function(r) { setTimeout(r, LOCK_RETRY_MS); });
    }
    if (_running.has(userId)) {
      logger.warn('[SCHED-QUEUE] Giving up on ' + userId + ' after ' + MAX_LOCK_RETRIES + ' retries');
      return { ran: false, reason: 'lock_timeout' };
    }
  }

  // Check debounce: minimum quiet period before running
  var last = _lastEnqueueTime.get(userId);
  if (last && (_now() - last) < DEBOUNCE_MS) {
    return { ran: false, reason: 'debounce', wait: DEBOUNCE_MS - (_now() - last) };
  }

  var promise = (async function() {
    try {
      var result = await claimAndRun(userId);
      if (!result.claimed) {
        return { ran: false, reason: result.reason, details: result };
      }
      if (!result.success) {
        return { ran: false, reason: 'scheduler_failed', error: result.error };
      }
      return { ran: true };
    } catch (e) {
      logger.error('[SCHED-QUEUE] Unexpected error processing user ' + userId, { error: e });
      return { ran: false, reason: 'exception', error: e.message };
    }
  })();

  _running.set(userId, promise);
  try {
    var result = await promise;
    _running.delete(userId);
    return result;
  } catch (e) {
    _running.delete(userId);
    throw e;
  }
}

// ── Claim maintenance ──

function startClaimHeartbeat(userId) {
  var hb = setInterval(async function() {
    try {
      await _queueRepo.heartbeatClaim(db, userId, INSTANCE_ID, _clock.now());
    } catch (e) {
      logger.error('[SCHED-QUEUE] Heartbeat failed for user ' + userId, { error: e });
    }
  }, 30000); // every 30s
  // Don't let a heartbeat keep the process alive or fire during jest's forceExit
  // window (test-isolation hardening, 999.869). In production the HTTP listener
  // holds the loop open, so unref is a runtime no-op there.
  if (hb && typeof hb.unref === 'function') hb.unref();
  _heartbeats.add(hb);
  return hb;
}

function clearClaimHeartbeat(hb) {
  clearInterval(hb);
  _heartbeats.delete(hb);
}

async function releaseClaim(userId, instanceId) {
  try {
    await _queueRepo.releaseQueueClaim(db, userId, instanceId);
  } catch (e) {
    logger.error('[SCHED-QUEUE] Failed to release claim for user ' + userId, { error: e });
  }
}

// ── Poll loop ───────────────────────────────────────────────────────────────

async function pollOnce() {
  _lastPollTime = _now();

  // DB-only poll: query for unclaimed rows that have been in the queue
  // long enough to avoid racing the enqueue INSERT.
  try {
    var pending = await _queueRepo.getPendingQueueUsers(db, MAX_DIRTY_USERS_PER_POLL);

    for (var j = 0; j < pending.length; j++) {
      await processUser(pending[j].user_id);
    }

    // Idle-path short-circuit (999.955): these three diagnostic queries feed
    // ONLY the logger.info() below, whose condition is
    //   pending.length > 0 || schedPending[0].c > 0.
    // `schedPending` uses the IDENTICAL WHERE clause as the primary `pending`
    // SELECT above (whereNull('claimed_at') AND created_at < NOW()-2s); `pending`
    // merely adds orderBy/limit/select. So when pending.length === 0,
    // schedPending[0].c is necessarily 0 too, and the log condition reduces to
    // pending.length > 0. Gating on that lets the idle tick (the dominant case on
    // every POLL_MS tick of every Cloud Run instance) issue ZERO extra queries —
    // notably skipping the expensive full `tasks_v` DISTINCT scan — while the
    // SAME log fires with the SAME data whenever work actually exists.
    // Scheduling behavior is unchanged (processUser already ran above). The only
    // edge: NOW() is re-evaluated later in the schedPending COUNT, so a row aging
    // past the 2s threshold BETWEEN the two queries could have logged on the old
    // code while pending was still empty — a single diagnostic-log line, no
    // scheduling/data effect; that row is picked up on the next poll tick.
    if (pending.length > 0) {
      var schedPending = await _queueRepo.countPendingQueue(db);
      var writePending = await _queueRepo.countPendingWrites(db);
      var total = await _queueRepo.countDistinctPendingUsers(db);
      logger.info('[SCHED-QUEUE] poll: ' + total.length + ' user(s) with pending entries (schedule=' + schedPending[0].c + ' writes=' + writePending[0].c + ')');
    }
    // Sweep stuck claims: rows claimed > 2 minutes ago are from dead
    // instances (Cloud Run scaled to zero without releasing). Clear them
    // so the health check doesn't report a permanent scheduler error.
    var swept = await _queueRepo.sweepStuckClaims(db);
    if (swept > 0) {
      logger.warn('[SCHED-QUEUE] swept ' + swept + ' stuck claim(s)');
    }
  } catch (e) {
    logger.error('[SCHED-QUEUE] DB poll failed', { error: e });
  }
}

function startPollLoop() {
  // Start the scheduler poll loop. Returns cleanup function.
  POLL_ACTIVE = true;
  POLL_LOOP_INSTANCE = setInterval(pollOnce, POLL_MS);
  // Do not let the poll interval keep the process alive (or fire during jest's
  // forceExit teardown window). In production the server has the HTTP listener
  // holding the loop open, so unref does not change runtime behavior; it only
  // prevents a stray tick from outliving a torn-down test suite.
  if (POLL_LOOP_INSTANCE && typeof POLL_LOOP_INSTANCE.unref === 'function') {
    POLL_LOOP_INSTANCE.unref();
  }
  logger.info('[SCHED-QUEUE] Poll loop started (instance=' + INSTANCE_ID + ')');
  return function() {
    POLL_ACTIVE = false;
    clearInterval(POLL_LOOP_INSTANCE);
  };
}

function stopPollLoop() {
  POLL_ACTIVE = false;
  if (POLL_LOOP_INSTANCE) {
    clearInterval(POLL_LOOP_INSTANCE);
    POLL_LOOP_INSTANCE = null;
  }
}

/**
 * Full module shutdown / test-isolation reset (999.869).
 *
 * stopPollLoop() alone only stops the poll interval — it leaves the per-suite
 * module state behind: live claim-heartbeat intervals, the cached _queueBackend
 * (which a neighbouring suite's jest.resetModules() can leave pointing at a
 * torn-down module whose isCloudTasks is no longer a function), and the in-memory
 * dirty / running / rate-limit maps. Carried across runInBand suites, those leak
 * timers and bleed state into later files. This drops ALL of it so the module is
 * indistinguishable from a fresh require:
 *   - stop the poll loop and force-clear any leaked heartbeat intervals,
 *   - null the cached queue backend so the next getQueueBackend() re-resolves a
 *     valid module instead of a stale cross-suite binding,
 *   - clear every in-memory map and reset the injectable clock / last-error.
 * Idempotent and safe to call when nothing is running. Wired into the per-file
 * jest teardown (test-helpers/afterEachFile.js).
 */
function _resetForTests() {
  stopPollLoop();
  _heartbeats.forEach(function (hb) { try { clearInterval(hb); } catch (e) { /* no-op */ } });
  _heartbeats.clear();
  _queueBackend = undefined; // drop any stale cross-suite cached backend
  _lastEnqueueTime.clear();
  _running.clear();
  _rateWindows.clear();
  _lastError = null;
  _lastPollTime = 0;
  _clock = new MysqlClockAdapter();
  _now = _defaultNow;
}

// ── Constants ──
var _SOURCE_APP = 'scheduleQueue';
var MAX_DIRTY_USERS_PER_POLL = 50;
var CLAIM_TTL_SECONDS = 60; // Reclaim after 60s of no heartbeat

function getLastError() {
  return _lastError;
}

/**
 * Run the scheduler for a user in response to a Cloud Tasks push (999.627).
 *
 * The Cloud Tasks push-handler calls this. Unlike processUser() it does NOT
 * apply the in-memory DEBOUNCE quiet-period — the task itself was the debounce
 * (it sat in the queue), and the in-memory _lastEnqueueTime is per-instance so
 * it isn't meaningful on a worker that didn't receive the original mutation.
 * It still goes through claimAndRun → tryClaim, so the atomic DB claim is the
 * cross-runner mutex: if the poll loop already claimed+ran this user, the push
 * is a no-op (claimed:false), and vice-versa. No double-run.
 *
 * Returns the claimAndRun result: { claimed, success?, reason?, error? }.
 */
async function runScheduleForPush(userId) {
  // Respect single-flight within this instance.
  if (_running.has(userId)) {
    return { claimed: false, reason: 'already_running_locally' };
  }
  var promise = (async function () {
    return claimAndRun(userId);
  })();
  _running.set(userId, promise);
  try {
    var result = await promise;
    _running.delete(userId);
    return result;
  } catch (e) {
    _running.delete(userId);
    // Record the real error server-side (999.683: detail in logs, not the popup).
    logger.error('scheduler run failed (runScheduleForPush)', { userId: userId, error: e.message, stack: e.stack });
    _lastError = { timestamp: _now(), message: e.message };
    return { claimed: false, reason: 'exception', error: e.message };
  }
}

module.exports = {
  enqueueScheduleRun,
  dequeueScheduleRun,
  processUser,
  runScheduleForPush,
  startPollLoop,
  stopPollLoop,
  // Test seam (999.955): the poll tick, so a unit can assert the idle-path
  // short-circuit issues zero diagnostic queries when the queue is empty.
  pollOnce,
  _resetForTests,
  getPollLoopState,
  getLastError,
  // Internal exports for tests
  _lastEnqueueTime,
  _running,
  // Test seam: atomic-claim helpers (extracted for scheduleQueueClaiming.test.js)
  _internal: {
    tryClaim,
    releaseClaim,
    CLAIM_TTL_SECONDS,
    DEBOUNCE_MS,
    // Rate-limit test seam (999.591): injectable clock + reset + direct check.
    checkRateLimit,
    setClock: function (fn) { _now = fn || _defaultNow; },
    // ClockPort test seam (999.1195): swap the WHOLE clock (e.g. FakeClockAdapter)
    // so claimed_at/created_at stamps AND the ms-epoch helper move together.
    setClockPort: function (clock) { _clock = clock || new MysqlClockAdapter(); },
    resetRateLimit: function () { _rateWindows.clear(); },
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
    // Backend-cache test seam (999.869): inject a stale/half-loaded `_queueBackend` to
    // simulate the cross-suite registry race (a neighbour's jest.resetModules left the
    // cached backend without a valid isCloudTasks). Lets a unit pin the defensive
    // re-resolve in getQueueBackend() + the enqueue call-site guard. Test-only.
    setQueueBackendForTests: function (b) { _queueBackend = b; },
    getQueueBackendForTests: function () { return _queueBackend; }
  }
};

// 999.1198 (ScheduleTriggerPort inversion): register this module's
// enqueueScheduleRun as THE schedule trigger. slices/task/facade and
// lib/task-write-queue call scheduler/scheduleTrigger instead of requiring
// this module, which broke the facade→scheduleQueue→…→facade and
// task-write-queue↔scheduleQueue require cycles. Load-time registration:
// every production entrypoint (server.js, routes, controllers, jobs) loads
// this module before any mutation can fire a trigger.
require('./scheduleTrigger').registerScheduleTrigger(enqueueScheduleRun);
