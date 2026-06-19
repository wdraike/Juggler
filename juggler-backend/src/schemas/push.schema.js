'use strict';

/**
 * push.schema — Zod validation for Web Push subscription endpoints (999.252).
 *
 * A browser PushSubscription (from pushManager.subscribe().toJSON()) has the
 * shape { endpoint, keys: { p256dh, auth }, expirationTime? }. We validate the
 * fields we persist and ignore the rest.
 */

const { z } = require('zod');

// SSRF guard (elmo BLOCK-1, 999.252): web-push POSTs to the subscription
// endpoint, so an unvalidated endpoint lets an authenticated user drive
// server-side requests to arbitrary hosts (cloud metadata, internal services).
// Restrict to HTTPS + the known browser push-service hosts. Update if a new
// browser/push provider is supported.
const PUSH_HOST_ALLOWLIST = [
  /^fcm\.googleapis\.com$/,                 // Chrome / Chromium / Edge (FCM)
  /(^|\.)push\.services\.mozilla\.com$/,    // Firefox (autopush)
  /(^|\.)notify\.windows\.com$/,            // legacy Edge / Windows
  /(^|\.)push\.apple\.com$/,                // Safari / Apple Web Push
];

function isAllowedPushEndpoint(value) {
  let u;
  try { u = new URL(value); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  return PUSH_HOST_ALLOWLIST.some((re) => re.test(u.hostname));
}

const endpointField = z.string().url().max(2048).refine(isAllowedPushEndpoint, {
  message: 'endpoint must be an HTTPS URL on a known push-service host',
});

const subscribeSchema = z.object({
  endpoint: endpointField,
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
  }),
  // Browsers include expirationTime (usually null); accept and ignore it.
  expirationTime: z.union([z.number(), z.null()]).optional(),
}).passthrough();

const unsubscribeSchema = z.object({
  endpoint: endpointField,
});

// Manual test-send payload (POST /api/push/test) — all optional. url must be
// same-origin-relative (a path) to prevent an open-redirect / attacker-URL
// reaching the SW notificationclick openWindow (elmo WARN).
const testSendSchema = z.object({
  title: z.string().max(200).optional(),
  body: z.string().max(1000).optional(),
  url: z.string().max(2048).regex(/^\/(?!\/)/, 'url must be a same-origin path starting with /').optional(),
  taskId: z.string().max(64).optional(),
}).passthrough();

module.exports = { subscribeSchema, unsubscribeSchema, testSendSchema };
