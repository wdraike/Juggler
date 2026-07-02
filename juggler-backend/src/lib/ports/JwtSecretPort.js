/**
 * JwtSecretPort — driven-port contract for the shared OAuth-state JWT secret
 * (999.944 H7 — lib/jwt-secret.js).
 *
 * Mirrors the LockPort/RedisPort idiom: a JSDoc `@typedef`, a
 * throw-not-implemented prototype base, and a frozen METHODS array.
 *
 * Wraps `src/lib/jwt-secret.js` — used by the calendar OAuth controllers
 * (gcal, msft) to sign/verify short-lived state tokens — so it exposes
 * EXACTLY that surface: `getJwtSecret` / `verifyStateToken`.
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT JS-1 (production requires a real secret): in NODE_ENV=production,
 *   an unset secret MUST throw rather than fall back to a dev default
 *   (the concrete adapter enforces this; a Port implementation must not
 *   weaken it).
 *
 * INVARIANT JS-2 (algorithm pinning): verifyStateToken MUST pin the
 *   algorithms allowlist to HS256 (999.318) — never accept `alg:none` or an
 *   attacker-chosen algorithm.
 *
 * @typedef {Object} JwtSecretPort
 *
 * @property {() => Uint8Array} getJwtSecret
 *   Return the encoded secret key material used to sign/verify state tokens.
 *
 * @property {(state: string) => Promise<{payload: Object, protectedHeader: Object}>} verifyStateToken
 *   Verify an OAuth-state JWT, pinned to HS256 (INVARIANT JS-2). Rejects on
 *   an invalid signature, expired token, or disallowed algorithm.
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function JwtSecretPort() {}

/**
 * @returns {Uint8Array}
 */
JwtSecretPort.prototype.getJwtSecret = function getJwtSecret() {
  throw new Error('JwtSecretPort.getJwtSecret not implemented');
};

/**
 * @param {string} state
 * @returns {Promise<{payload: Object, protectedHeader: Object}>}
 */
JwtSecretPort.prototype.verifyStateToken = function verifyStateToken(_state) {
  throw new Error('JwtSecretPort.verifyStateToken not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy JwtSecretPort.
 * @type {ReadonlyArray<string>}
 */
var JWT_SECRET_PORT_METHODS = Object.freeze(['getJwtSecret', 'verifyStateToken']);

module.exports = JwtSecretPort;
module.exports.JwtSecretPort = JwtSecretPort;
module.exports.JWT_SECRET_PORT_METHODS = JWT_SECRET_PORT_METHODS;
