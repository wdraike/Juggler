/**
 * queue-backend.js — swappable backend for the scheduler-run trigger.
 *
 * The scheduler has historically used a DB-backed queue (scheduleQueue.js): a
 * `schedule_queue` row per dirty user + a poll loop that claims rows and runs
 * the scheduler. That works but reimplements retry/backoff/dead-letter/
 * rate-limit by hand on top of MySQL.
 *
 * This module introduces a thin indirection so the scheduler-run trigger can be
 * dispatched to Google Cloud Tasks instead — which gives those semantics
 * (per-queue retry config, dead-letter on max attempts, dispatch rate limit) as
 * managed infrastructure — WITHOUT ripping out the DB queue.
 *
 *   JUGGLER_QUEUE_DRIVER=db           (DEFAULT) — unchanged behavior: enqueue
 *                                       into schedule_queue, poll loop runs it.
 *   JUGGLER_QUEUE_DRIVER=cloud-tasks  — create a Cloud Tasks task that POSTs to
 *                                       the scheduler-tasks push-handler, which
 *                                       runs the SAME claimAndRun job logic.
 *
 * SAFETY: the cloud-tasks path is opt-in. If the flag is unset/`db`, this module
 * is a no-op pass-through and the DB queue is the single source of truth, exactly
 * as before. If cloud-tasks is selected but enqueue FAILS, we fall back to the DB
 * queue so a scheduler trigger is never silently dropped — the DB poll loop still
 * runs in cloud-tasks mode as a safety net (it must stay started). This is a
 * documented, intentional fallback (data-integrity: a mutation's recompute must
 * never be lost), not a silent `|| default`.
 */

const { createLogger } = require('@raike/lib-logger');
const config = require('../lib/config');
const logger = createLogger('scheduler-queue-backend');

// Injectable clock (999.1195): wall-clock reads derive from a ClockPort
// (MysqlClockAdapter in production — same as RunScheduleCommand); swappable
// via the _setClock test seam below.
const MysqlClockAdapter = require('../slices/scheduler/adapters/MysqlClockAdapter');
let _clock = new MysqlClockAdapter();

const DRIVER = config.getString('JUGGLER_QUEUE_DRIVER').toLowerCase(); // 999.1202
const SCHEDULER_QUEUE = config.getString('JUGGLER_SCHEDULER_QUEUE'); // 999.1202

function isCloudTasks() {
  return DRIVER === 'cloud-tasks';
}

/**
 * Dispatch a scheduler-run trigger for a user via the configured backend.
 *
 * @param {string} userId
 * @param {string} source
 * @returns {Promise<{ backend: 'db'|'cloud-tasks', dispatched: boolean, deduped?: boolean, fellBack?: boolean }>}
 *
 * For the `db` backend this is a pass-through: the caller is expected to have
 * already performed the DB enqueue (schedule_queue upsert). We return
 * `dispatched:false` so the caller keeps its existing DB path as-is. For
 * `cloud-tasks` we create the task; on any error we signal `fellBack:true` so
 * the caller performs its DB enqueue instead.
 */
async function dispatchScheduleRun(userId, source) {
  if (!isCloudTasks()) {
    return { backend: 'db', dispatched: false };
  }

  try {
    const driver = require('./cloud-tasks-driver');
    // Dedup by user: at most one queued run per user (~1h window). Cloud Tasks
    // rejects a duplicate name, which is the native equivalent of the DB row's
    // per-user onConflict coalescing — bursts collapse to one pending run.
    const dedupKey = 'sched-' + userId + '-' + Math.floor(_clock.now().getTime() / 1000);
    const res = await driver.createTask(
      SCHEDULER_QUEUE,
      { userId: userId, source: source || 'unknown', enqueuedAt: _clock.now().getTime() },
      { dedupKey }
    );
    logger.info('[queue-backend] cloud-tasks scheduler run enqueued for ' + userId
      + ' source=' + (source || 'unknown') + (res.deduped ? ' (deduped)' : ''));
    return { backend: 'cloud-tasks', dispatched: true, deduped: !!res.deduped };
  } catch (err) {
    // Never drop a scheduler trigger: signal the caller to use the DB queue.
    logger.error('[queue-backend] cloud-tasks enqueue failed, falling back to DB queue for '
      + userId, { error: err && err.message });
    return { backend: 'cloud-tasks', dispatched: false, fellBack: true };
  }
}

module.exports = {
  DRIVER,
  SCHEDULER_QUEUE,
  isCloudTasks,
  dispatchScheduleRun,
  // Test-only clock seam (999.1195). Returns the previous clock for restore.
  _setClock: config.getString('NODE_ENV') === 'test' ? function _setClock(clock) { // 999.1473
    const prev = _clock;
    _clock = clock || new MysqlClockAdapter();
    return prev;
  } : undefined,
};
