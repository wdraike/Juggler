/**
 * Payment Service Client — single owner of the payment-service base URL,
 * timeout, and fetch wrapper. Eliminates the 4x duplicated
 * `process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020'` pattern.
 *
 * Usage:
 *   const { paymentFetch, paymentUrl } = require('./payment-service-client');
 *   const res = await paymentFetch('/api/plans?product=juggler', { headers: {...} });
 *
 * ponytail: no class, no adapter interface — just two exports. The
 * PaymentServiceEntitlementAdapter already owns the circuit-breaker / caching
 * concerns for entitlement lookups; this helper is for the ad-hoc call sites
 * (my-plan routes, usage-reporter) that don't need caching but do need
 * consistent base-URL + timeout behavior.
 */

'use strict';

var DEFAULT_TIMEOUT_MS = 30000;

/**
 * The resolved payment-service base URL. Reads process.env at module load
 * (same as every existing call site did inline). Exported for test injection
 * via process.env before require.
 * @type {string}
 */
var paymentUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020';

/**
 * Fetch wrapper for the payment service. Prepends the base URL to a relative
 * path, applies a standard timeout, and returns the raw fetch Response.
 *
 * @param {string} path  relative path (e.g. '/api/plans?product=juggler')
 * @param {Object} [options]  fetch options (headers, method, body, etc.)
 * @param {number} [timeoutMs]  override the default 30s timeout
 * @returns {Promise<Response>}
 */
function paymentFetch(path, options, timeoutMs) {
  var url = path.startsWith('http') ? path : paymentUrl + path;
  var opts = Object.assign({}, options, {
    signal: AbortSignal.timeout(timeoutMs || DEFAULT_TIMEOUT_MS)
  });
  return fetch(url, opts);
}

module.exports = {
  paymentUrl: paymentUrl,
  paymentFetch: paymentFetch,
  // Re-export for test reset after process.env changes
  _refreshUrl: function () { paymentUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020'; }
};