/**
 * MCP API-Key Authentication — juggler-backend
 *
 * Implements the `apiKeyValidator` contract expected by the shared
 * `authenticateMcpRequest()` (auth-client/mcp-auth.js — WI-1's fixed module):
 * an async function `(token) => authResult-shaped-object | null`.
 *
 * Flow (devmcp SPEC R3):
 *   1. Introspect the raw bearer token against auth-service's WI-2 endpoint
 *      `POST /internal/api-keys/introspect` (via the shared service-auth
 *      client — same ServiceJWT mechanism `usage-reporter.js` already uses
 *      to call payment-service). `{valid:false}` or a `key_type` other than
 *      `'mcp'` → invalid key → return null.
 *   2. Resolve payment-service entitlement for `product=<APP_ID>` via the
 *      EXISTING, already-reviewed `GET /internal/users/:userId/entitlement`
 *      endpoint (no payment-service changes). Checked FRESH on every call —
 *      no caching — fail closed per SPEC R3.
 *   3. Not entitled (or the entitlement call itself fails) → return null.
 *   4. Entitled → return an authResult-shaped object matching the JWT
 *      branch's shape (`_authenticateJwt` in mcp-auth.js), with
 *      `plans[APP_ID]` set truthy.
 *
 * Design note — where the entitlement check lives (apiKeyValidator vs
 * planCheck), and why both failure modes (invalid key / not entitled)
 * collapse to the SAME `return null`:
 *
 * transport.js's `planCheck` is JWT-claims-only: it reads
 * `authResult.plans[APP_ID]`, a value populated at JWT-mint time from the
 * token's own `plans` claim — it never calls payment-service itself. An
 * API-key auth result carries no JWT claims, so there is nothing for that
 * planCheck to read unless this validator supplies it. The real
 * payment-service entitlement call therefore has to happen HERE, not in
 * planCheck — doing it in both places would be a redundant network call
 * for every single MCP request.
 *
 * Given that, a rejected (not-entitled) key could either (a) be encoded as
 * `plans[APP_ID]` staying falsy and letting the existing planCheck's 402
 * "Active subscription required" throw fire, or (b) reject directly here.
 * This module takes (b) — returns null directly for "not entitled" — because
 * `authenticateMcpRequest`'s catch around the apiKeyValidator call only
 * re-throws a caught error when `e.status === 402`; every OTHER thrown
 * status (e.g. a deliberate 403) is silently swallowed into the function's
 * final `return null` anyway (see mcp-auth.js, which WI-4 must not modify).
 * Threading a 403 through that swallowed path would collapse to the exact
 * same observable 401 as returning null directly — so returning null here
 * is the simpler, equally-correct choice, and keeps both call sites (401 for
 * "invalid key", 401 for "not entitled") satisfying SPEC R3's "401/403"
 * requirement without relying on a status code that gets discarded.
 * `plans[APP_ID] = true` is set ONLY on the success path, so the unmodified
 * planCheck still passes without a second entitlement round-trip.
 */

'use strict';

var { APP_ID } = require('../service-identity');
var serviceAuth = require('../../vendor/service-auth');

var _serviceAuthReady = false;
var _initPromise = null;

function ensureServiceAuth() {
  if (!_initPromise) {
    _initPromise = serviceAuth.initServiceAuth({ serviceName: APP_ID })
      .then(function () { _serviceAuthReady = true; })
      .catch(function () {
        _serviceAuthReady = false;
        // Do not memoize a failed init permanently: clear _initPromise so the
        // NEXT ensureServiceAuth() call retries initServiceAuth() instead of
        // returning this same resolved-but-failed promise forever. Any request
        // that arrives WHILE this promise is in flight/just-failed still sees
        // _serviceAuthReady === false and fails closed (unchanged); only the
        // NEXT call gets a fresh retry.
        _initPromise = null;
      });
  }
  return _initPromise;
}

/**
 * apiKeyValidator(token) — see module docblock for the full flow.
 * @param {string} token — raw bearer token presented on POST /mcp
 * @returns {Promise<Object|null>}
 */
async function apiKeyValidator(token) {
  if (!token) return null;

  await ensureServiceAuth();
  if (!_serviceAuthReady) {
    // Can't sign a service JWT to call auth-service — fail closed.
    return null;
  }

  var introspection;
  try {
    introspection = await serviceAuth.serviceRequest('auth-service', '/internal/api-keys/introspect', {
      method: 'POST',
      body: { key: token }
    });
  } catch (err) {
    // auth-service unreachable / non-2xx — fail closed, same as an invalid key.
    return null;
  }

  if (!introspection || introspection.valid !== true || introspection.key_type !== 'mcp') {
    return null;
  }

  var userId = introspection.user_id;
  if (!userId) return null;

  var entitlementResp;
  try {
    entitlementResp = await serviceAuth.serviceRequest(
      'payment-service',
      '/internal/users/' + encodeURIComponent(userId) + '/entitlement?product=' + encodeURIComponent(APP_ID),
      { method: 'GET' }
    );
  } catch (err) {
    // Fail closed — cannot confirm entitlement, treat as not authenticated.
    return null;
  }

  var entitled = !!(entitlementResp && entitlementResp.entitlement && entitlementResp.entitlement.entitled);
  if (!entitled) {
    return null;
  }

  var plans = {};
  plans[APP_ID] = true; // mirrors the JWT branch's plans[APP_ID] shape for the shared, unmodified planCheck

  return {
    userId: userId,
    email: null,
    name: null,
    keyId: 'apikey:' + userId,
    keyName: 'MCP API Key',
    authServiceId: userId,
    plans: plans
  };
}

module.exports = { apiKeyValidator: apiKeyValidator };
