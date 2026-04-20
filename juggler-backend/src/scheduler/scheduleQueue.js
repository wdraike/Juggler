/**
 * scheduleQueue.js — DB-backed event queue + debounced scheduler runner
 *
 * Mutation controllers call enqueueScheduleRun(userId) after their DB write.
 * This inserts a row into schedule_queue and marks the user dirty in memory.
 *
 * A poll loop checks the dirty set on a short interval. For each dirty user,
 * it reads the queue from DB: if the newest entry is older than DEBOUNCE_MS,
 * the user's writes have gone quiet — sweep (delete) all entries, run the
 * scheduler, and emit per-task SSE signals.
 *
 * The dirty set defaults to ALL on startup, so any queue entries that survived
 * a crash/restart are picked up without needing to scan the DB continuously.
 *
 * Single-flight per user: only one scheduler run at a time. If the user is
 * still dirty after a run (new writes arrived), the next poll picks it up.
 */

var db = require('../db');

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
var POLL_MS     = 1000;   // how often the poll loop checks the dirty set

// ── In-memory state ──
var dirty = {};            // { userId: true } — users with pending queue entries
var running = {};          // { userId: true } — single-flight flag
var startupScanDone = false;

/**
 * Enqueue a scheduler run for a user.
 * Inserts a queue row into the DB and marks the user dirty in memory.
 * Fire-and-forget from the caller's perspective.
 */
async function enqueueScheduleRun(userId, source) {
  dirty[userId] = true;
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
 * Process a single dirty user: check if their queue has gone quiet,
 * sweep entries, run the scheduler, emit SSE.
 */
async function processUser(userId) {
  if (running[userId]) return; // already running — next poll picks it up

  try {
    // Read the newest queue entry for this user
    var newest = await db('schedule_queue')
      .where('user_id', userId)
      .orderBy('created_at', 'desc')
      .first();

    if (!newest) {
      // Queue is empty — clear dirty flag
      delete dirty[userId];
      return;
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
      // Still within quiet period — leave dirty, poll will re-check
      return;
    }

    // Quiet period elapsed — sweep and run
    running[userId] = true;

    // Signal start so the toolbar can show a "Scheduling…" indicator.
    // `schedule:changed` (emitted on completion below) is the paired end
    // signal; on lock-failure paths we also emit `schedule:changed` with a
    // null changeset so the indicator always clears.
    getSseEmitter().emit(userId, 'schedule:running', { timestamp: Date.now() });

    // Sweep: delete all queue entries for this user up to the snapshot time.
    // Entries that arrive after this point will be caught by the next cycle.
    var snapshotTime = new Date();
    var swept = await db('schedule_queue')
      .where('user_id', userId)
      .where('created_at', '<=', snapshotTime)
      .del();
    console.log('[SCHED-QUEUE] swept ' + swept + ' entry(ies) for ' + userId);

    // Resolve the user's timezone so the scheduler computes todayKey and
    // caches placements under the correct timezone — without this, the
    // default 'America/New_York' can mismatch the browser-initiated cache,
    // causing placements to flicker/disappear on the frontend.
    var userRow = await db('users').where('id', userId).select('timezone').first();
    var tz = (userRow && userRow.timezone) || 'America/New_York';

    // Run the scheduler with sync lock
    var MAX_LOCK_RETRIES = 3;
    var result = null;
    for (var attempt = 0; attempt < MAX_LOCK_RETRIES; attempt++) {
      result = await getWithLock()(userId, async function() {
        // Flush any pending task writes before scheduling so the
        // scheduler reads the latest user-intended state.
        await getFlushQueueInLock()(userId);
        return getRunScheduleAndPersist()(userId, undefined, { timezone: tz });
      }, { flushOnRelease: false });
      if (result !== null) break;
      console.log('[SCHED-QUEUE] lock held for ' + userId + ', retry ' + (attempt + 1) + '/' + MAX_LOCK_RETRIES);
      await new Promise(function(r) { setTimeout(r, 2000); });
    }

    if (result === null) {
      console.warn('[SCHED-QUEUE] could not acquire lock for ' + userId + ' after ' + MAX_LOCK_RETRIES + ' attempts');
      // Still emit schedule:changed so the "Scheduling..." indicator clears
      // on the frontend even when we failed to run the scheduler.
      getSseEmitter().emit(userId, 'schedule:changed', {
        timestamp: Date.now(),
        changeset: null
      });
    } else {
      // Emit per-task update signal so the frontend can do surgical repaints
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
    console.error('[SCHED-QUEUE] error processing user ' + userId + ':', err);
    // Make sure the "Scheduling..." indicator clears even on unexpected errors.
    try {
      getSseEmitter().emit(userId, 'schedule:changed', { timestamp: Date.now(), changeset: null });
    } catch (_) { /* ignore */ }
  } finally {
    running[userId] = false;
  }
}

/**
 * Poll loop — runs on a fixed interval. Checks each dirty user and
 * processes them if their quiet period has elapsed.
 */
async function pollLoop() {
  // On first run, scan DB for any users with pending queue entries
  // (covers crash recovery / restart)
  if (!startupScanDone) {
    startupScanDone = true;
    try {
      // Check both queues: schedule_queue (pending scheduler runs) and
      // task_write_queue (pending task writes that survived a crash)
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

  var dirtyUsers = Object.keys(dirty);
  if (dirtyUsers.length === 0) return;

  // Process all dirty users concurrently (single-flight per user is
  // enforced inside processUser)
  await Promise.all(dirtyUsers.map(processUser));
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

module.exports = { enqueueScheduleRun, stopPollLoop };
