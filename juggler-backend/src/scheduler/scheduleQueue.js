/**
 * scheduleQueue.js — Event queue + single-flight scheduler runner
 *
 * Replaces the scheduleAfterMutation middleware. Mutation controllers
 * call enqueueScheduleRun(userId) after their DB write succeeds.
 * The queue ensures:
 *   - At most one scheduler run per user at a time (single-flight)
 *   - Events that arrive during a run are picked up in a follow-up run
 *   - The scheduler's own DB writes never enqueue new events
 */

// Lazy requires to avoid circular dependency:
// scheduleQueue → runSchedule → task.controller → scheduleQueue
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

// In-memory event queue per user
var queue = {};    // { userId: [{ timestamp, source }] }
var running = {};  // { userId: true } — single-flight flag

/**
 * Enqueue a scheduler run for a user. Fire-and-forget — the single-flight
 * runner picks it up. Safe to call from any mutation path.
 */
function enqueueScheduleRun(userId, source) {
  if (!queue[userId]) queue[userId] = [];
  queue[userId].push({ timestamp: Date.now(), source: source || 'unknown' });
  console.log('[SCHED-QUEUE] enqueued for ' + userId + ' source=' + (source || 'unknown') + ' queueLen=' + queue[userId].length);
  processScheduleQueue(userId);
}

/**
 * Single-flight queue processor. Only one instance runs per user at a time.
 * After each scheduler run, checks if new events arrived and loops if so.
 */
async function processScheduleQueue(userId) {
  if (running[userId]) return;
  running[userId] = true;
  var MAX_LOCK_RETRIES = 3;
  try {
    while (queue[userId] && queue[userId].length > 0) {
      var runTimestamp = Date.now();
      var drained = queue[userId].length;
      // Drain all entries with timestamp <= runTimestamp
      queue[userId] = queue[userId].filter(function(e) { return e.timestamp > runTimestamp; });
      console.log('[SCHED-QUEUE] processing ' + drained + ' event(s) for ' + userId);

      // Acquire sync lock, run scheduler — retry if lock is held
      var result = null;
      for (var attempt = 0; attempt < MAX_LOCK_RETRIES; attempt++) {
        result = await getWithLock()(userId, function() {
          return getRunScheduleAndPersist()(userId);
        });
        if (result !== null) break;
        console.log('[SCHED-QUEUE] lock held for ' + userId + ', retry ' + (attempt + 1) + '/' + MAX_LOCK_RETRIES);
        await new Promise(function(r) { setTimeout(r, 2000); });
      }
      if (result === null) {
        console.warn('[SCHED-QUEUE] could not acquire lock for ' + userId + ' after ' + MAX_LOCK_RETRIES + ' attempts');
      }
      // Loop back to check if new entries arrived during the run
    }
  } catch (err) {
    console.error('[SCHED-QUEUE] error for user ' + userId + ':', err);
  } finally {
    running[userId] = false;
  }
}

module.exports = { enqueueScheduleRun };
