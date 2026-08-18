/**
 * GCal push-notification webhook receiver (999.15520).
 *
 * Google Calendar POSTs to this endpoint when a watched calendar changes.
 * The request body is empty (or minimal); all metadata is in headers:
 *   X-Goog-Channel-ID      — the channel UUID we registered
 *   X-Goog-Resource-ID     — Google's resource identifier
 *   X-Goog-Resource-State  — 'exists' | 'sync' (initial) | 'not_exists'
 *   X-Goog-Message-Number   — sequential message number
 *
 * On receipt, we look up the user by the channel ID in user_config, then
 * emit an SSE event so the connected frontend initiates a cal-sync pull.
 * This replaces the polling hasChanges() check with a push trigger.
 *
 * Security: the endpoint is unauthenticated (Google is the caller), but
 * rate-limited. A channel ID is a crypto.randomUUID — unguessable. An
 * attacker would need to know the exact UUID we registered to fake a
 * notification, and the worst case is a spurious sync (no data leak).
 */

'use strict';

var express = require('express');
var router = express.Router();
var rateLimit = require('express-rate-limit');
var { maybeRedisStore } = require('../lib/rate-limit-store');
var calendarFacade = require('../slices/calendar/facade');
var sseEmitter = require('../lib/sse-emitter');
var { createLogger } = require('@raike/lib-logger');

var logger = createLogger('gcal.webhook');

var webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: maybeRedisStore('jugrl-gcal-webhook:'),
});

router.post('/', webhookLimiter, async function (req, res) {
  var channelId = req.headers['x-goog-channel-id'];
  var resourceId = req.headers['x-goog-resource-id'];
  var resourceState = req.headers['x-goog-resource-state'];
  var messageNumber = req.headers['x-goog-message-number'];

  // Google always sends these headers on a watch notification.
  if (!channelId || !resourceId) {
    return res.status(400).json({ error: 'Missing watch headers' });
  }

  // 'sync' state = initial channel confirmation, not a real change.
  // Acknowledge it so Google knows the webhook is reachable.
  if (resourceState === 'sync') {
    logger.info('GCal watch channel confirmed (sync)', { channelId: channelId });
    return res.status(200).json({ ok: true, state: 'sync' });
  }

  try {
    // Look up the user who owns this watch channel via the calendar adapter
    // (avoids a direct lib/db import — boundary rule: routes don't touch DB).
    var userId = await calendarFacade.findUserByWatchChannel(channelId, resourceId);

    if (!userId) {
      // Unknown channel — could be a stale watch we already cleared, or
      // a misrouted notification. Acknowledge to stop Google from retrying.
      logger.warn('GCal webhook for unknown channel (acknowledged)', { channelId: channelId });
      return res.status(200).json({ ok: true, unknown: true });
    }

    logger.info('GCal push notification received', {
      channelId: channelId,
      userId: userId,
      resourceState: resourceState,
      messageNumber: messageNumber
    });

    // Notify the connected frontend via SSE so it triggers a cal-sync.
    // This is the push replacement for the polling hasChanges() check.
    sseEmitter.emit(String(userId), 'calendar-changed', {
      provider: 'gcal',
      source: 'watch',
      timestamp: Date.now()
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error('GCal webhook processing error', { error: err.message });
    // 200 so Google doesn't retry — we can't do anything useful by retrying.
    res.status(200).json({ ok: true, error: 'internal' });
  }
});

module.exports = router;