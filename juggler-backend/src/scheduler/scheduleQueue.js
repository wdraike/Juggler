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

// Lazy requires to avoid circular dependency
var _flushQueueInLock;
function getFlushQueueInLock() {
  if (!_flushQueueInLock) _flushQueueInLock = require('../lib/task-write-queue').flushQueueInLock;
  return _flushQueueInLock;
}
var _runScheduleAndPersist;
function getRunScheduleAndPersist() {
  if (!_runScheduleAndPersist) _runScheduleAndPersist = require('./runSchedule').runScheduleAndPersist;
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

// ── Configuration ──
var DEBOUNCE_MS = 2000;   // quiet period before scheduler runs
var POLL_MS     = 3000;   // how often the poll loop checks the DB (was 1s; 3s reduces idle DB load)

// ── Multi-instance claiming constants (FIX-04) ──────────────────────────────
//
// INSTANCE_ID uniquely identifies this process across Cloud Run replicas.
//   - Cloud Run sets K_REVISION (e.g. "juggler-backend-00042-abc") — preferred
//     because it's stable for the lifetime of the process and human-readable.
//   - HOSTNAME is the fallback for local dev / non-Cloud-Run environments.
//   - Random hex is the final fallback when neither env var is set.
//   (T-07-09: INSTANCE_ID is not a secret — it's operator-visible in DB only)
//
// CLAIM_TTL_SECONDS: how long a claim can sit without being released before
// another instance considers it stale. 60s is long enough for a slow scheduler
// run (which includes a Knex transaction + SSE emit) but short enough that a
// crashed instance's claim is reclaimable promptly.
// Matches the shape of MAX_LOCK_AGE in sync-lock.js (5 min) scaled to the
// much shorter schedule_queue lifecycle. (T-07-07 mitigation)
var INSTANCE_ID = process.env.K_REVISION || process.env.HOSTNAME || crypto.randomBytes(8).toString('hex');
var CLAIM_TTL_SECONDS = 60;

// ── In-memory state ──
var dirty = {};            // { userId: true } — advisory hint: check this user on next poll
var running = {};          // { userId: true } — within-instance single-flight guard
var startupScanDone = false;
var _lastError = null;     // { message, timestamp } — set in processUser catch; read by health routes

// ── DB-based atomic claiming (FIX-04) ───────────────────────────────────────
//
// Reference: RESEARCH.md Category 2 / Pitfall 3; cal-history-cron.js tick()
// is the canonical reference pattern for DB-based leader election in this
// codebase (uses sync_locks shard keys; we adapt that pattern to per-user rows).
//
// tryClaim: atomically sets claimed_by + claimed_at on the user's schedule_queue
// row. The WHERE guard ensures only an unclaimed row (or a stale-claimed row past
// TTL) is updated. MySQL's UPDATE is atomic per row — no transaction needed.
//
// Returns { claimed: true } if this instance won the claim (affectedRows === 1).
// Returns { claimed: false } if another instance already owns it (affectedRows === 0).
// A false return is normal multi-instance behavior — log nothing (not an error).

async function tryClaim(userId, instanceId) {
  var id = instanceId !== undefined ? instanceId : INSTANCE_ID;
  var result = await db.raw(
    'UPDATE schedule_queue ' +
    'SET claimed_by = ?, claimed_at = NOW() ' +
    'WHERE user_id = ? ' +
    'AND (claimed_by IS NULL OR claimed_at < DATE_SUB(NOW(), INTERVAL ? SECOND))',
    [id, userId, CLAIM_TTL_SECONDS]
  );
  var affectedRows = (result[0] && result[0].affectedRows) || 0;
  return { claimed: affectedRows >= 1 };
}

// Only releases if claimed_by still matches this instance (guards against TTL
// reclaim racing with a late release). Transient DB errors are swallowed —
// CLAIM_TTL_SECONDS safety net handles the failure case (T-07-08).

async function releaseClaim(userId, instanceId) {
  var id = instanceId !== undefined ? instanceId : INSTANCE_ID;
  await db.raw(
    'UPDATE schedule_queue SET claimed_by = NULL, claimed_at = NULL ' +
    'WHERE user_id = ? AND claimed_by = ?',
    [userId, id]
  ).catch(function(err) {
    console.warn('[SCHED-QUEUE] releaseClaim failed for ' + userId + ':', err.message);
  });
}

/**
 * Enqueue a scheduler run for a user.
 * Inserts a queue row into the DB and marks the user dirty (advisory hint).
 * Fire-and-forget from the caller's perspective.
 */
async function enqueueScheduleRun(userId, source) {
  dirty[userId] = true;  // advisory hint — triggers immediate poll on this instance
  try {
    await db('schedule_queue').insert({
      user_id: userId,
      source: source || 'unknown'
    });
    console.log('[SCHED-QUEUE] enqueued for ' + userId + ' source=' + (source || 'unknown'));
  } catch (err) {
    // Queue insert failed — dirty flag still set, so the poll loop will
    // check the DB anyway. Log but don't throw — the task write already
    // committed, and the startup scan will catch orphaned work.
    console.error('[SCHED-QUEUE] queue insert failed for ' + userId + ':', err.message);
  }
}

/**
 * Process a single user: check if their queue has gone quiet,
 * sweep entries, run the scheduler, emit SSE.
 *
 * Precondition: caller (pollLoop) has already atomically claimed the DB row
 * for this userId. The running{} Map provides a secondary within-instance
 * single-flight guard in case the poll interval fires faster than processUser
 * completes (which would only happen under extreme DB slowness).
 */
async function processUser(userId) {
  if (running[userId]) return; // within-instance single-flight guard

  try {
    // Read the newest queue entry for this user
    var newest = await db('schedule_queue')
      .where('user_id', userId)
      .orderBy('created_at', 'desc')
      .first();

    if (!newest) {
      // Queue is empty — clear dirty hint
      delete dirty[userId];
      return;  // finally will releaseClaim
    }

    // Check if quiet period has elapsed since the newest entry.
    // MySQL returns `created_at` as a tz-less string (dateStrings: true in
    // knexfile) representing UTC wall time; `new Date(str)` without a tz
    // designator parses as LOCAL time, which makes elapsed perpetually
    // negative on non-UTC hosts. Append 'Z' to force UTC parsing.
    var createdAt = newest.created_at;
    if (typeof createdAt === 'string' && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(createdAt)) {
      createdAt = createdAt.replace(' ', 'T') + 'Z';
    }
    var newestTime = new Date(createdAt).getTime();
    var elapsed = Date.now() - newestTime;
    if (elapsed < DEBOUNCE_MS) {
      // Still within quiet period — leave dirty hint so the next poll
      // tick reclaims and re-checks. finally will releaseClaim.
      return;
    }

    // Quiet period elapsed — sweep and run
    running[userId] = true;

    // Signal start so the toolbar can show a "Scheduling…" indicator.
    getSseEmitter().emit(userId, 'schedule:running', { timestamp: Date.now() });

    // Sweep: delete all queue entries for this user up to the current DB time.
    // Using NOW() avoids JS/TZ drift between the Node server and MySQL UTC storage.
    // Entries that arrive after this point will be caught by the next cycle.
    var sweptResult = await db.raw(
      'DELETE FROM schedule_queue WHERE user_id = ? AND created_at <= NOW()',
      [userId]
    );
    var swept = sweptResult[0] && sweptResult[0].affectedRows !== undefined
      ? sweptResult[0].affectedRows : 0;
    console.log('[SCHED-QUEUE] swept ' + swept + ' entry(ies) for ' + userId);

    // Resolve the user's timezone so the scheduler computes todayKey and
    // caches placements under the correct timezone.
    var userRow = await db('users').where('id', userId).select('timezone').first();
    var tz = (userRow && userRow.timezone) || 'America/New_York';

    // Run the scheduler with sync lock
    var MAX_LOCK_RETRIES = 3;
    var result = null;
    for (var attempt = 0; attempt < MAX_LOCK_RETRIES; attempt++) {
      result = await getWithLock()(userId, async function() {
        await getFlushQueueInLock()(userId);
        return getRunScheduleAndPersist()(userId, undefined, { timezone: tz });
      }, { flushOnRelease: false });
      if (result !== null) break;
      console.log('[SCHED-QUEUE] lock held for ' + userId + ', retry ' + (attempt + 1) + '/' + MAX_LOCK_RETRIES);
      await new Promise(function(r) { setTimeout(r, 2000); });
    }

    if (result === null) {
      console.warn('[SCHED-QUEUE] could not acquire lock for ' + userId + ' after ' + MAX_LOCK_RETRIES + ' attempts');
      getSseEmitter().emit(userId, 'schedule:changed', {
        timestamp: Date.now(),
        changeset: null
      });
    } else {
      getSseEmitter().emit(userId, 'schedule:changed', {
        timestamp: Date.now(),
        changeset: result.changeset || null
      });
    }

    // Check if new entries arrived during the run
    var remaining = await db('schedule_queue')
      .where('user_id', userId)
      .count('id as cnt')
      .first();
    if (!remaining || parseInt(remaining.cnt, 10) === 0) {
      delete dirty[userId];
    }
    // else: still dirty — next poll cycle will handle it

  } catch (err) {
    _lastError = { message: err && err.message ? err.message : String(err), timestamp: Date.now() };
    console.error('[SCHED-QUEUE] error processing user ' + userId + ':', err);
    try {
      getSseEmitter().emit(userId, 'schedule:changed', { timestamp: Date.now(), changeset: null });
    } catch (_) { /* ignore */ }
  } finally {
    running[userId] = false;
    // If releaseClaim throws, the CLAIM_TTL_SECONDS=60 safety net cleans up.
    await releaseClaim(userId);
  }
}

/**
 * Poll loop — runs on a fixed interval. Queries the DB for unclaimed
 * schedule_queue rows and attempts to claim + process each one.
 *
 * The DB claim (tryClaim) is the cross-instance gate. The running{} Map is
 * the within-instance single-flight guard. Both are needed:
 *   - tryClaim prevents Instance A and Instance B from both running processUser
 *   - running{} prevents one instance from running processUser twice if poll
 *     fires while a previous run is still in progress
 */
async function pollLoop() {
  // On first run, scan DB for any users with pending queue entries
  // (covers crash recovery / restart). Each instance does this independently;
  // the DB claim ensures only one processes each row.
  if (!startupScanDone) {
    startupScanDone = true;
    try {
      var [schedPending, writePending] = await Promise.all([
        db('schedule_queue').distinct('user_id'),
        db('task_write_queue').distinct('user_id')
      ]);
      var seen = {};
      schedPending.forEach(function(row) { dirty[row.user_id] = true; seen[row.user_id] = true; });
      writePending.forEach(function(row) { dirty[row.user_id] = true; seen[row.user_id] = true; });
      var total = Object.keys(seen).length;
      if (total > 0) {
        console.log('[SCHED-QUEUE] startup scan: ' + total + ' user(s) with pending entries (schedule=' + schedPending.length + ' writes=' + writePending.length + ')');
      }
    } catch (err) {
      console.error('[SCHED-QUEUE] startup scan failed:', err.message);
    }
  }

  // Query DB for users with unclaimed (or stale-claimed) queue rows.
  // This is the authoritative work list — the dirty{} Map is advisory only
  // and may have stale entries from the startup scan or from other instances.
  var pendingRows;
  try {
    pendingRows = await db('schedule_queue')
      .whereRaw('(claimed_by IS NULL OR claimed_at < DATE_SUB(NOW(), INTERVAL ? SECOND))', [CLAIM_TTL_SECONDS])
      .distinct('user_id')
      .pluck('user_id');
  } catch (err) {
    // DB unavailable — fall back to in-memory dirty set as advisory
    console.error('[SCHED-QUEUE] poll DB query failed:', err.message);
    pendingRows = Object.keys(dirty);
  }

  if (!pendingRows || pendingRows.length === 0) return;

  // For each candidate user: atomically claim the row, then process if claimed.
  // Process all candidates concurrently — single-flight per user is enforced
  // by running{} within this instance and by the DB claim across instances.
  await Promise.all(pendingRows.map(async function(userId) {
    // Mark dirty (advisory hint for future polls on this instance)
    dirty[userId] = true;

    // Atomic cross-instance claim — if another instance won, skip silently.
    var claim = await tryClaim(userId);
    if (!claim.claimed) {
      // Normal multi-instance behavior: another instance owns this row.
      // Do NOT log — this is not an error, it's the happy path for N>1 instances.
      return;
    }

    // This instance owns the claim — proceed to processUser.
    // processUser's finally block calls releaseClaim().
    await processUser(userId);
  }));
}

// Start the poll loop
var pollInterval = setInterval(function() {
  pollLoop().catch(function(err) {
    console.error('[SCHED-QUEUE] poll loop error:', err);
  });
}, POLL_MS);

// Allow graceful shutdown
function stopPollLoop() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

/**
 * Returns the most recent unhandled processUser error, or null if no error
 * has occurred. Pure read — does not clear _lastError.
 * Shape: { message: string, timestamp: number } | null
 */
function getLastError() {
  return _lastError;
}

module.exports = {
  enqueueScheduleRun,
  stopPollLoop,
  getLastError,
  // Internals exposed for test access — do not import in production code.
  _internal: {
    tryClaim: tryClaim,
    releaseClaim: releaseClaim,
    CLAIM_TTL_SECONDS: CLAIM_TTL_SECONDS,
    INSTANCE_ID: INSTANCE_ID
  }
};
