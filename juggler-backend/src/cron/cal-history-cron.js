/**
 * cal-history-cron — sharded background sweep for juggler-cal-history phase.
 *
 * Two passes per shard tick (every minute, shard = currentMinute % SHARD_COUNT):
 *   1. Mark past-window pending recurring instances as `missed` (D-05/D-07).
 *   2. Purge terminal-state instances older than 12 months (D-01/D-02/D-04).
 *
 * Distributed safety: each tick acquires a sentinel-user-id lock in sync_locks
 * (`__hist_${shard}`) before writing. Multiple Cloud Run instances coexist safely.
 *
 * Pending tasks NEVER purged (D-04). Recurring templates NEVER touched.
 *
 * See .planning/phases/juggler-cal-history/juggler-cal-history-D-PLAN.md
 */

var helpers = require('../../../shared/scheduler/missedHelpers');
var { TERMINAL_STATUSES } = require('../lib/task-status');
var syncLock = require('../lib/sync-lock');
var { isRollingMaster, computeRollingAnchor } = require('../lib/rolling-anchor');

var SHARD_COUNT = 60;          // 1 shard/minute → full pass each hour
var RETENTION_DAYS = 365;      // 12 months
var TICK_MS = 60 * 1000;

// Sentinel user_id strings used as namespaced lock keys (sync_locks.user_id is
// VARCHAR(36) — fits an 11-char prefix-${shard}).
function lockKeyForShard(shard) {
  return '__hist_' + shard;
}

var _timer = null;
var _deps = null;
var _started = false;

async function processMissedMark(deps, shard, now) {
  // Find pending recurring instances on this shard whose flex window has closed.
  // tasks_v exposes time_flex from the master via the instance arm; reading from
  // the view keeps the join logic in one place. status='' is the pending state.
  var rows = await deps.db('tasks_v')
    .where('task_type', 'recurring_instance')
    .where('status', '')
    .whereRaw('user_id % ? = ?', [SHARD_COUNT, shard])
    .whereNotNull('scheduled_at')
    // Perf: only scan instances whose window could plausibly have closed.
    // Pending instances scheduled in the future cannot be missed yet; filtering
    // them here dramatically shrinks the scan on the tasks_v view.
    .whereRaw('scheduled_at < NOW() - INTERVAL 1 HOUR')
    .select('id', 'user_id', 'scheduled_at', 'time_flex', 'master_id', 'date');

  var toFlip = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var task = { scheduled_at: r.scheduled_at, timeFlex: r.time_flex };
    if (helpers.isPastWindow(task, now)) {
      toFlip.push(r);
    }
  }
  if (toFlip.length === 0) return { flipped: 0, users: [] };

  var byUser = {};
  for (var j = 0; j < toFlip.length; j++) {
    var f = toFlip[j];
    var wc = helpers.windowCloseUtc({ scheduled_at: f.scheduled_at, timeFlex: f.time_flex });
    // WHERE status='' guards against concurrent user write (race T-D-3).
    await deps.db('task_instances')
      .where({ id: f.id, status: '' })
      .update({ status: 'missed', completed_at: wc, updated_at: deps.db.fn.now() });
    byUser[f.user_id] = true;

    // Rolling anchor: nudge forward +1 day on auto-miss
    if (f.master_id) {
      var masterRow = await deps.db('task_masters').where({ id: f.master_id }).first();
      if (masterRow && isRollingMaster(masterRow)) {
        var instanceDate = f.date ? String(f.date).slice(0, 10) : null;
        var currentAnchor = masterRow.rolling_anchor ? String(masterRow.rolling_anchor).slice(0, 10) : null;
        var newAnchor = computeRollingAnchor('missed', instanceDate, currentAnchor);
        if (newAnchor) {
          await deps.db('task_masters')
            .where({ id: f.master_id })
            .update({ rolling_anchor: newAnchor, updated_at: deps.db.fn.now() });
        }
      }
    }
  }

  var userIds = Object.keys(byUser);
  await notifyUsers(deps, userIds);
  return { flipped: toFlip.length, users: userIds };
}

async function processPurge(deps, shard, now) {
  var cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  var affectedRows = await deps.db('task_instances')
    .whereIn('status', TERMINAL_STATUSES)
    .where('completed_at', '<', cutoff)
    .whereRaw('user_id % ? = ?', [SHARD_COUNT, shard])
    .distinct('user_id')
    .pluck('user_id');

  if (affectedRows.length === 0) return { deleted: 0, users: [] };

  var deleted = await deps.db('task_instances')
    .whereIn('status', TERMINAL_STATUSES)
    .where('completed_at', '<', cutoff)
    .whereRaw('user_id % ? = ?', [SHARD_COUNT, shard])
    .del();

  await notifyUsers(deps, affectedRows);
  return { deleted: deleted, users: affectedRows };
}

async function notifyUsers(deps, userIds) {
  // Concurrent: serial awaits per user add per-user Redis round-trip latency.
  await Promise.all(userIds.map(async function(u) {
    if (deps.cache && deps.cache.invalidateTasks) {
      try { await deps.cache.invalidateTasks(u); } catch (e) { /* swallow */ }
    }
    if (deps.sseEmitter && deps.sseEmitter.emit) {
      try { deps.sseEmitter.emit(u, 'schedule:changed', { timestamp: Date.now(), changeset: null }); } catch (e) { /* swallow */ }
    }
  }));
}

async function tick() {
  if (!_deps) return;
  var now = new Date();
  var shard = now.getMinutes() % SHARD_COUNT;
  var lockKey = lockKeyForShard(shard);

  var got;
  try {
    got = await syncLock.acquireLock(lockKey);
  } catch (err) {
    console.error('[cal-history-cron] lock acquire failed shard=' + shard, err && err.message);
    return;
  }
  if (!got || !got.acquired) return; // another instance owns this shard tick

  var token = got.token;
  try {
    var missed = await processMissedMark(_deps, shard, now);
    var purged = await processPurge(_deps, shard, now);
    if (missed.flipped > 0) {
      console.log('[cal-history-cron] shard=' + shard + ' flipped ' + missed.flipped + ' to missed (users=' + missed.users.length + ')');
    }
    if (purged.deleted > 0) {
      console.log('[cal-history-cron] shard=' + shard + ' purged ' + purged.deleted + ' rows >' + RETENTION_DAYS + 'd (users=' + purged.users.length + ')');
    }
  } catch (err) {
    console.error('[cal-history-cron] tick failed shard=' + shard, err && err.message);
  } finally {
    try { await syncLock.releaseLock(lockKey, token); } catch (e) { /* swallow */ }
  }
}

function start(deps) {
  if (_started) return; // idempotent boot
  _deps = deps;
  _started = true;
  // Stagger initial run by 0–60s so a fresh deploy across N instances spreads load.
  setTimeout(function() { tick().catch(function() {}); }, Math.floor(Math.random() * TICK_MS));
  _timer = setInterval(function() { tick().catch(function() {}); }, TICK_MS);
}

function stop() {
  if (_timer) clearInterval(_timer);
  _timer = null;
  _started = false;
  _deps = null;
}

module.exports = {
  start: start,
  stop: stop,
  // Internals exposed for test access — do not import in production code.
  _internal: {
    tick: tick,
    processMissedMark: processMissedMark,
    processPurge: processPurge,
    notifyUsers: notifyUsers,
    lockKeyForShard: lockKeyForShard,
    SHARD_COUNT: SHARD_COUNT,
    RETENTION_DAYS: RETENTION_DAYS,
    TICK_MS: TICK_MS
  }
};
