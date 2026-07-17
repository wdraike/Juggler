/**
 * PushNotificationPort — driven-port contract for the web-push delivery
 * service (999.1535 — lib/push-service.js).
 *
 * Mirrors the GcalApiPort/AppleCalApiPort/MsftCalApiPort idiom: a JSDoc
 * `@typedef`, a throw-not-implemented prototype base, and a frozen METHODS
 * array.
 *
 * Wraps `src/lib/push-service.js` — the VAPID web-push delivery module
 * consumed by the reminder pipeline — so it exposes EXACTLY that surface:
 * `ensureConfigured` / `getPublicKey` / `isEnabled` / `sendPush`.
 *
 * NOTE: `_resetConfigForTests` is a test-only utility and is deliberately
 * excluded from the port contract (same rationale as AppleCalApiPort
 * excluding DEFAULT_SERVER_URL — a test helper has no port contract to
 * satisfy).
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT PN-1 (fail-soft, NOT silent): if VAPID keys are absent,
 *   sendPush is a no-op that returns { enabled: false, sent: 0, ... } and
 *   ensureConfigured logs a WARNING once. This is a documented, approved
 *   fail-soft — a missing VAPID config is a deploy-time misconfig surfaced
 *   loudly in logs, not a silent default that hides a data bug.
 *
 * INVARIANT PN-2 (prune dead subscriptions): sendPush deletes subscriptions
 *   the push service reports as gone (HTTP 410 Gone / 404 Not Found) via
 *   the deps.deleteSubscription callback. Non-410/404 errors increment
 *   `failed` but do not prune.
 *
 * INVARIANT PN-3 (dependency injection for testability): sendPush accepts a
 *   `deps` object with loadSubscriptions, deleteSubscription, and optional
 *   webpushClient — the production wiring injects real DB loaders + the
 *   web-push module, tests inject fakes. No `|| default` fallbacks.
 *
 * @typedef {Object} PushNotificationPort
 *
 * @property {() => boolean} ensureConfigured
 *   Read VAPID config from env and configure web-push once. Returns true if
 *   a usable key pair is present, false otherwise (logged once, PN-1).
 *
 * @property {() => (string|null)} getPublicKey
 *   Return the public VAPID key, or null if push is not configured.
 *
 * @property {() => boolean} isEnabled
 *   True if web-push is configured and can deliver.
 *
 * @property {(deps: Object, userId: string, payload: Object) => Promise<{enabled: boolean, sent: number, pruned: number, failed: number}>} sendPush
 *   Send a push payload to every subscription a user has. Prunes dead
 *   subscriptions (PN-2). Requires deps.loadSubscriptions (PN-3).
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function PushNotificationPort() {}

PushNotificationPort.prototype.ensureConfigured = function ensureConfigured() {
  throw new Error('PushNotificationPort.ensureConfigured not implemented');
};

PushNotificationPort.prototype.getPublicKey = function getPublicKey() {
  throw new Error('PushNotificationPort.getPublicKey not implemented');
};

PushNotificationPort.prototype.isEnabled = function isEnabled() {
  throw new Error('PushNotificationPort.isEnabled not implemented');
};

PushNotificationPort.prototype.sendPush = function sendPush(_deps, _userId, _payload) {
  throw new Error('PushNotificationPort.sendPush not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy PushNotificationPort.
 * @type {ReadonlyArray<string>}
 */
var PUSH_NOTIFICATION_PORT_METHODS = Object.freeze([
  'ensureConfigured',
  'getPublicKey',
  'isEnabled',
  'sendPush'
]);

module.exports = PushNotificationPort;
module.exports.PushNotificationPort = PushNotificationPort;
module.exports.PUSH_NOTIFICATION_PORT_METHODS = PUSH_NOTIFICATION_PORT_METHODS;