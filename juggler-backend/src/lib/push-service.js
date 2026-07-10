'use strict';

/**
 * push-service — Web Push (VAPID) delivery for task reminders (backlog 999.252).
 *
 * Responsibilities:
 *   - Configure web-push from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT.
 *   - Expose the public VAPID key to the client (GET /api/push/vapid-public-key).
 *   - sendPush(userId, payload): load the user's stored subscriptions, send the
 *     payload to each, and PRUNE subscriptions the push service reports as gone
 *     (HTTP 410 Gone / 404 Not Found).
 *
 * Fail-soft, NOT silent: if VAPID keys are absent, push send is a no-op that logs
 * a clear WARNING (the in-app toast path is unaffected). This is a documented,
 * approved fail-soft — a missing VAPID config is a deploy-time misconfig that we
 * surface loudly in logs rather than a silent default that hides a data bug.
 *
 * Dev key generation:  npx web-push generate-vapid-keys
 *   → set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY in the backend .env.
 *   VAPID_SUBJECT must be a mailto: or https: URL (defaults to mailto: below ONLY
 *   for the subject contact field, which the spec requires to be present; it is
 *   not a credential and carries no security weight).
 */

const webpush = require('web-push');
const { createLogger } = require('@raike/lib-logger');
const config = require('./config');
const logger = createLogger('push-service');

let _configured = null; // null = not yet checked; true/false after first check

/**
 * Read VAPID config from env and configure web-push once. Returns true if a
 * usable key pair is present, false otherwise (logged once).
 */
function ensureConfigured() {
  if (_configured !== null) { return _configured; }

  const publicKey = config.getString('VAPID_PUBLIC_KEY'); // 999.1473 ('' when unset, same falsy check below)
  const privateKey = config.getString('VAPID_PRIVATE_KEY'); // 999.1473
  // The VAPID `subject` is a contact URI (mailto: or https:) the push service
  // may use to reach the app operator. It is required by the spec but is not a
  // secret. The schema default IS the mailto fallback (999.1473) so a missing
  // subject alone never disables push.
  const subject = config.getString('VAPID_SUBJECT');

  if (!publicKey || !privateKey) {
    logger.warn(
      '[push] VAPID keys not configured (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY ' +
      'missing) — web-push delivery is DISABLED. In-app reminders still work. ' +
      'Generate keys with `npx web-push generate-vapid-keys` and set them in the ' +
      'backend environment to enable push notifications.'
    );
    _configured = false;
    return _configured;
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    _configured = true;
  } catch (err) {
    logger.error('[push] failed to configure VAPID details — push DISABLED', {
      error: err && err.message,
    });
    _configured = false;
  }
  return _configured;
}

/** Test-only: reset the memoized config check (so env changes re-apply). */
function _resetConfigForTests() {
  _configured = null;
}

/** Returns the public VAPID key, or null if push is not configured. */
function getPublicKey() {
  ensureConfigured();
  return config.getString('VAPID_PUBLIC_KEY') || null; // 999.1473
}

/** Returns true if web-push is configured and can deliver. */
function isEnabled() {
  return ensureConfigured();
}

/**
 * Send a push payload to every subscription a user has.
 *
 * @param {object}  deps               Injected dependencies.
 * @param {Function} deps.loadSubscriptions  async (userId) => [{id,endpoint,p256dh,auth}]
 * @param {Function} deps.deleteSubscription async (id) => void  (prune callback)
 * @param {object}  [deps.webpushClient]     Override for testing (defaults to web-push).
 * @param {string}  userId
 * @param {object}  payload            Arbitrary JSON; serialized and sent as-is.
 * @returns {Promise<{enabled:boolean, sent:number, pruned:number, failed:number}>}
 */
async function sendPush(deps, userId, payload) {
  const client = (deps && deps.webpushClient) || webpush;

  if (!ensureConfigured()) {
    // No-op (logged once in ensureConfigured). The in-app reminder still fires.
    return { enabled: false, sent: 0, pruned: 0, failed: 0 };
  }
  if (!deps || typeof deps.loadSubscriptions !== 'function') {
    throw new Error('sendPush requires deps.loadSubscriptions');
  }

  const subs = await deps.loadSubscriptions(userId);
  if (!subs || subs.length === 0) {
    return { enabled: true, sent: 0, pruned: 0, failed: 0 };
  }

  const body = JSON.stringify(payload || {});
  let sent = 0;
  let pruned = 0;
  let failed = 0;

  for (const sub of subs) {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    };
    try {
      await client.sendNotification(pushSubscription, body);
      sent += 1;
    } catch (err) {
      const status = err && (err.statusCode || err.status);
      // 410 Gone / 404 Not Found → the subscription is dead; prune it.
      if (status === 410 || status === 404) {
        try {
          await deps.deleteSubscription(sub.id);
          pruned += 1;
        } catch (delErr) {
          logger.error('[push] failed to prune dead subscription', {
            id: sub.id, error: delErr && delErr.message,
          });
        }
      } else {
        failed += 1;
        logger.warn('[push] send failed for subscription', {
          id: sub.id, status, error: err && err.message,
        });
      }
    }
  }

  return { enabled: true, sent, pruned, failed };
}

module.exports = {
  ensureConfigured,
  getPublicKey,
  isEnabled,
  sendPush,
  _resetConfigForTests,
};
