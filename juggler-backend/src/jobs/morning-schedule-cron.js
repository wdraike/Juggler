// Morning Schedule Cron — 999.1408
//
// unifiedScheduleV2's nowSlot gate (src/scheduler/unifiedScheduleV2.js:1758-1761)
// correctly refuses to place anytime-flexible tasks before "now" — but a
// schedule run only ever fires on user-mutation (scheduleQueue.js:
// "Mutation controllers call enqueueScheduleRun(userId) after their DB
// write"). A user who makes no task edit until midday never gets a run
// while their morning work block is still open, so nowSlot's snapshot at
// that first-of-the-day run permanently excludes the morning for every
// anytime task, even though the gate itself is behaving correctly.
//
// Fix: proactively enqueue one schedule run per user shortly after their
// OWN local midnight (getNowInTimezone(user.timezone)), so the day's first
// run happens before any work block opens and morning slots are available
// to place into. This does not touch placement logic — it only ensures the
// existing, correct algorithm gets invoked early enough in the day.

const db = require('../db');
const { createLogger } = require('../lib/logger');
const { getNowInTimezone } = require('../../../shared/scheduler/getNowInTimezone');
const { acquireLock, releaseLock } = require('../cron/cal-history-cron');

const logger = createLogger('cron.morning-schedule');

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const TRIGGER_WINDOW_MINS = 15;          // fire within the first 15 min of local midnight
const LOCK_NAME = 'morning-schedule-cron:tick';

class MorningScheduleCron {
  // Injectable collaborators (test seam, matching getNowInTimezone's own
  // injectable-clock convention — R50.8): defaults are the real implementations.
  constructor(opts) {
    this.running = false;
    this.timer = null;
    // userId -> last local todayKey a run was already enqueued for (in-process;
    // worst case on restart is one skipped/duplicate day, self-heals next day —
    // same tolerance as cal-history-cron's plain setTimeout scheduling).
    this._lastTriggeredKey = new Map();
    this._getNowInTimezone = (opts && opts.getNowInTimezone) || getNowInTimezone;
    this._enqueueScheduleRun = (opts && opts.enqueueScheduleRun) || null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.tick();
    this.timer = setInterval(() => this.tick(), CHECK_INTERVAL_MS);
  }

  stop() {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async tick() {
    if (!await acquireLock(LOCK_NAME, 240)) {
      return; // another instance is already sweeping this tick
    }
    try {
      await this.sweep();
    } catch (error) {
      logger.error('morning-schedule-cron sweep error', { error: error.message });
    } finally {
      await releaseLock(LOCK_NAME);
    }
  }

  async sweep() {
    const users = await db('users').select('id', 'timezone');
    // Lazy: avoid a circular require at module load (scheduleQueue does not
    // require this file, but jobs/ is wired from server.js alongside it).
    const enqueue = this._enqueueScheduleRun || require('../scheduler/scheduleQueue').enqueueScheduleRun;
    for (const user of users) {
      const { todayKey, nowMins } = this._getNowInTimezone(user.timezone);
      if (nowMins >= TRIGGER_WINDOW_MINS) continue;
      if (this._lastTriggeredKey.get(user.id) === todayKey) continue;
      this._lastTriggeredKey.set(user.id, todayKey);
      logger.info('morning-schedule-cron: enqueueing early run', { userId: user.id, todayKey, nowMins });
      enqueue(user.id, 'morning-cron', { immediate: true });
    }
  }
}

module.exports = MorningScheduleCron;
