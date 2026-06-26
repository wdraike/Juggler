/**
 * scheduleQueue.js — DB-backed event queue + debounced scheduler runner
 *
 * Mutation controllers call enqueueScheduleRun(userId) after their DB write.
 * This inserts a row into schedule_queue and marks the user dirty in memory.
 *
 * A poll loop checks the DB for unclaimed rows on a short interval. For each
 * unclaimed user, it atomically claims the row (claimed_by + claimed_at), then
 * runs the scheduler if the quiet period has elapsed.
 *
 * The dirty set is retained as a write-side advisory hint: enqueue() marks the
 * user dirty so the poll loop checks immediately on this instance. It is NOT the
 * authoritative gate for processing — the DB claim is. This prevents the
 * multi-instance double-run described in RESEARCH.md Category 2 / Pitfall 3.
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
var { createLogger } = require('@raike/lib-logger');
var logger = createLogger('scheduleQueue');

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
// (matching the existing in-process _dirty / _lastEnqueueTime state); a clean
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
var _dirty = new Set();               // users with pending changes (write-side hint)
var _lastEnqueueTime = new Map();       // user_id → timestamp
var _running = new Map();             // user_id → promise (single-flight within instance)
var _lastPollTime = 0;
var _lastError = null;                // { timestamp, message } — last scheduler error, for health checks
var _rateWindows = new Map();         // user_id → array of enqueue timestamps (within the rate-limit window) (999.591)

// Injectable clock — tests pass a synthetic now() so they never sleep; production
// uses Date.now. Kept module-private; set via _internal.setClock for tests.
var _now = function () { return Date.now(); };

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
    runningCount: _running.size,
    dirtyCount: _dirty.size
  };
}

// ── Public API ──

/**
 * Mark a user as needing a schedule run. Debounced: if called repeatedly
 * within DEBOUNCE_MS, only the last call matters.
 *
 * The DB row is the source of truth; the _dirty set is just an optimization
 * so we don't have to poll the DB for every local mutation.
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
  _dirty.add(userId);
  _lastEnqueueTime.set(userId, now);

  // Insert or update queue row (the actual work queue). An immediate run is
  // suppressed when rate-limited (the queued recompute still happens via poll).
  var shouldRun = options && options.immediate && !rateLimited;
  var row = {
    user_id: userId,
    source: source || 'unknown',
    created_at: new Date()
  };

  try {
    // Upsert: on conflict, only update if the row is old enough that we might
    // have lost a claimed worker (crash recovery), otherwise leave it alone.
    // FIX-04: Use INSERT with ON DUPLICATE KEY so we can detect conflicts cleanly.
    await db('schedule_queue')
      .insert(row)
      .onConflict('user_id')
      .merge(['source', 'created_at']);
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
  _dirty.delete(userId);
  _lastEnqueueTime.delete(userId);
  _running.delete(userId);

  try {
    // Delete the queue row for this user
    var swept = await db('schedule_queue')
      .where('user_id', userId)
      .del();
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
  var claimedAt = new Date();
  var ttlExpiry = new Date(Date.now() - (CLAIM_TTL_SECONDS * 1000));

  // Try to claim this user's row: either unclaimed, or an expired claim.
  // We use user_id as the WHERE to ensure atomicity (single row UPDATE).
  var updated = await db('schedule_queue')
    .where('user_id', userId)
    .andWhere(function() {
      this.whereNull('claimed_by')
          .orWhere('claimed_at', '<', ttlExpiry);
    })
    .update({
      claimed_by: instanceId,
      claimed_at: claimedAt
    });

  if (updated === 0) {
    var existing = await db('schedule_queue').where('user_id', userId).first();
    if (existing && existing.claimed_by && existing.claimed_by !== instanceId) {
      return { claimed: false, reason: 'already_claimed', by: existing.claimed_by, since: existing.claimed_at };
    }
    return { claimed: false, reason: 'no_row' };
  }

  // We claimed it — read the row back for callers that need it.
  var row = await db('schedule_queue').where('user_id', userId).first();
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
    var runWithLock = getWithLock();
    var runScheduleAndPersist = getRunScheduleAndPersist();
    var flushQueueInLock = getFlushQueueInLock();

    await runWithLock(userId, async function() {
      // Flush any pending writes before scheduler reads task state
      await flushQueueInLock(userId);
      // Run the scheduler
      await runScheduleAndPersist(userId, row.source);
    });

    // Success: sweep the queue and notify frontend
    await dequeueScheduleRun(userId);
    try { getSseEmitter().emit(userId, 'schedule:changed', {}); } catch (_e) { /* non-fatal */ }
    return { claimed: true, success: true };
  } catch (err) {
    // On failure, release the claim so someone else can retry.
    // Log the real error server-side (999.683: technical detail lives in logs;
    // the health popup shows plain language only). Without this the error went
    // ONLY to the in-memory _lastError and was never recorded anywhere.
    logger.error('scheduler run failed (claimAndRun)', { userId: userId, error: err.message, stack: err.stack });
    _lastError = { timestamp: Date.now(), message: err.message };
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
  if (last && (Date.now() - last) < DEBOUNCE_MS) {
    return { ran: false, reason: 'debounce', wait: DEBOUNCE_MS - (Date.now() - last) };
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
      await db('schedule_queue')
        .where('user_id', userId)
        .where('claimed_by', INSTANCE_ID)
        .update({ claimed_at: new Date() });
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
    await db('schedule_queue')
      .where('user_id', userId)
      .where('claimed_by', instanceId)
      .update({ claimed_by: null, claimed_at: null });
  } catch (e) {
    logger.error('[SCHED-QUEUE] Failed to release claim for user ' + userId, { error: e });
  }
}

// ── Poll loop ───────────────────────────────────────────────────────────────

async function pollOnce() {
  _lastPollTime = Date.now();

  // Fast path: process dirty users first (local optimization)
  var dirtyUsers = Array.from(_dirty).slice(0, MAX_DIRTY_USERS_PER_POLL);
  for (var i = 0; i < dirtyUsers.length; i++) {
    await processUser(dirtyUsers[i]);
  }

  // Safety sweep: also poll the DB for any unclaimed rows that might have
  // been left behind if this instance crashed and restarted.
  try {
    var stale = new Date(Date.now() - (CLAIM_TTL_SECONDS * 1000));
    var pending = await db('schedule_queue')
      .whereNull('claimed_by')
      .orWhere('claimed_at', '<', stale)
      .orderBy('created_at', 'asc')
      .limit(MAX_DIRTY_USERS_PER_POLL)
      .select('user_id');

    for (var j = 0; j < pending.length; j++) {
      var user = pending[j].user_id;
      _dirty.add(user); // Mark dirty so we process it next poll
    }

    var schedPending = await db('schedule_queue').whereNull('claimed_by').orWhere('claimed_at', '<', stale).count('* as c');
    var writePending = await db('task_write_queue').count('* as c');
    var total = await db('tasks_v').distinct('user_id');
    if (pending.length > 0 || schedPending[0].c > 0) {
      logger.info('[SCHED-QUEUE] startup scan: ' + total.length + ' user(s) with pending entries (schedule=' + schedPending[0].c + ' writes=' + writePending[0].c + ')');
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
  _dirty.clear();
  _lastEnqueueTime.clear();
  _running.clear();
  _rateWindows.clear();
  _lastError = null;
  _lastPollTime = 0;
  _now = function () { return Date.now(); };
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
    _lastError = { timestamp: Date.now(), message: e.message };
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
  _resetForTests,
  getPollLoopState,
  getLastError,
  // Internal exports for tests
  _dirty,
  _lastEnqueueTime,
  _running,
  // Test seam: atomic-claim helpers (extracted for scheduleQueueClaiming.test.js)
  _internal: {
    tryClaim,
    releaseClaim,
    CLAIM_TTL_SECONDS,
    // Rate-limit test seam (999.591): injectable clock + reset + direct check.
    checkRateLimit,
    setClock: function (fn) { _now = fn || function () { return Date.now(); }; },
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
