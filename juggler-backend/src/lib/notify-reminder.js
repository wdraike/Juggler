'use strict';

/**
 * notify-reminder — the single task-reminder dispatch point (backlog 999.252).
 *
 * A task reminder must reach the user through BOTH delivery channels:
 *   1. In-app: an SSE `reminder` event to any open tabs (drives the existing
 *      ToastNotification UI). This is the pre-existing behavior and is preserved.
 *   2. Web Push: an OS-level notification via the service worker, so the user is
 *      reached even with no tab open.
 *
 * Push is best-effort and fail-soft: a push failure (or absent VAPID config)
 * NEVER prevents the in-app event from firing.
 *
 * ── TRIGGER WIRING (needs review) ────────────────────────────────────────────
 * Juggler has no existing server-side reminder scheduler — the in-app toast is
 * driven entirely client-side, and "reminders" in the data model are a task
 * `marker`, not a scheduled server event. There is therefore no pre-existing
 * cron/queue that "a task reminder fired" to hook into. This module is the ready
 * dispatch seam: whoever builds the reminder-firing trigger (a future Cloud Task
 * / poll loop that computes due reminders) should call dispatchTaskReminder().
 * Until then it is exercised via the manual test-send route (POST /api/push/test).
 */

const sseEmitter = require('./sse-emitter');
const pushService = require('./push-service');
const pushSubs = require('./push-subscriptions');
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('notify-reminder');

/**
 * Fire a task reminder to a user across both channels.
 *
 * @param {string} userId
 * @param {object} reminder  { taskId?, title, body?, url? }
 * @returns {Promise<{inApp:boolean, push:object}>}
 */
async function dispatchTaskReminder(userId, reminder) {
  const payload = {
    type: 'task-reminder',
    taskId: reminder.taskId || null,
    title: reminder.title || 'Task reminder',
    body: reminder.body || '',
    url: reminder.url || '/',
  };

  // 1. In-app SSE (existing path). Never throws — emit is fire-and-forget.
  let inApp = false;
  try {
    sseEmitter.emit(userId, 'reminder', payload);
    inApp = true;
  } catch (err) {
    logger.warn('[notify-reminder] in-app emit failed', { userId, error: err && err.message });
  }

  // 2. Web Push (best-effort; fail-soft).
  let push = { enabled: false, sent: 0, pruned: 0, failed: 0 };
  try {
    push = await pushService.sendPush(
      {
        loadSubscriptions: pushSubs.loadSubscriptions,
        deleteSubscription: pushSubs.deleteById,
      },
      userId,
      payload,
    );
  } catch (err) {
    logger.error('[notify-reminder] push dispatch threw (non-fatal)', {
      userId, error: err && err.message,
    });
  }

  return { inApp, push };
}

module.exports = { dispatchTaskReminder };
