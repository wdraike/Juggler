'use strict';

/**
 * push.routes — Web Push subscription management (backlog 999.252).
 *
 * Mounted under the JWT-guarded /api tree (see app.js). All routes require a
 * valid JWT; subscriptions are scoped to req.user.id (tenancy).
 *
 *   GET  /api/push/vapid-public-key   → { publicKey, enabled }
 *   POST /api/push/subscribe          → store a PushSubscription for the user
 *   POST /api/push/unsubscribe        → remove a subscription by endpoint
 *   POST /api/push/test               → manual test-send (dev/QA): fires a reminder
 *                                       through BOTH the in-app SSE path and push.
 */

const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/jwt-auth');
const { validate } = require('../middleware/validate');
const { subscribeSchema, unsubscribeSchema, testSendSchema } = require('../schemas/push.schema');
const pushService = require('../lib/push-service');
const pushSubs = require('../lib/push-subscriptions');
const { dispatchTaskReminder } = require('../lib/notify-reminder');
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('push.routes');

router.use(authenticateJWT);

/**
 * GET /api/push/vapid-public-key
 * Returns the public VAPID key the client needs for pushManager.subscribe().
 * `enabled:false` (publicKey null) tells the client push is unavailable so it
 * can disable the opt-in UI rather than fail mid-subscribe.
 */
router.get('/vapid-public-key', (req, res) => {
  const publicKey = pushService.getPublicKey();
  return res.json({ publicKey, enabled: !!publicKey });
});

/**
 * POST /api/push/subscribe
 * Body: a browser PushSubscription JSON ({ endpoint, keys:{p256dh,auth} }).
 * Stores (upserts) the subscription for the authenticated user.
 */
router.post('/subscribe', validate(subscribeSchema), async (req, res) => {
  try {
    const result = await pushSubs.upsertSubscription(req.user.id, req.body);
    return res.status(result.created ? 201 : 200).json({ ok: true, id: result.id });
  } catch (err) {
    logger.error('[push] subscribe failed', { userId: req.user.id, error: err && err.message });
    return res.status(500).json({ error: 'Failed to store subscription' });
  }
});

/**
 * POST /api/push/unsubscribe
 * Body: { endpoint }. Removes the subscription (scoped to the user).
 */
router.post('/unsubscribe', validate(unsubscribeSchema), async (req, res) => {
  try {
    const deleted = await pushSubs.removeSubscription(req.user.id, req.body.endpoint);
    return res.json({ ok: true, removed: deleted });
  } catch (err) {
    logger.error('[push] unsubscribe failed', { userId: req.user.id, error: err && err.message });
    return res.status(500).json({ error: 'Failed to remove subscription' });
  }
});

/**
 * POST /api/push/test
 * Manual test-send for dev/QA and for verifying the end-to-end push path without
 * a real reminder trigger (juggler has no server-side reminder scheduler yet —
 * see notify-reminder.js). Fires a reminder through BOTH channels for the caller.
 */
router.post('/test', validate(testSendSchema), async (req, res) => {
  // Dev/QA only — NEVER expose the manual send-to-self vector in production
  // (elmo WARN, 999.252). A real reminder trigger uses dispatchTaskReminder directly.
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'not found' });
  }
  try {
    const result = await dispatchTaskReminder(req.user.id, {
      taskId: req.body.taskId || null,
      title: req.body.title || 'Test reminder',
      body: req.body.body || 'This is a test push from Juggler.',
      url: req.body.url || '/',
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('[push] test-send failed', { userId: req.user.id, error: err && err.message });
    return res.status(500).json({ error: 'Failed to send test notification' });
  }
});

module.exports = router;
