/**
 * CredentialEncryptPort — driven-port contract for at-rest credential
 * encryption (999.944 H7 — lib/credential-encrypt.js).
 *
 * Mirrors the LockPort/RedisPort idiom: a JSDoc `@typedef`, a
 * throw-not-implemented prototype base, and a frozen METHODS array.
 *
 * Wraps `src/lib/credential-encrypt.js` — the AES-256-GCM implementation
 * used to encrypt app-specific passwords (e.g. Apple CalDAV) before they are
 * persisted — so it exposes EXACTLY that surface: `encrypt` / `decrypt`.
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT CE-1 (key source): the key is derived from a 32-byte (64-char
 *   hex) secret supplied out-of-band (the concrete adapter reads
 *   CREDENTIAL_ENCRYPTION_KEY); a Port implementation MUST throw rather than
 *   silently encrypt/decrypt with a weak or absent key.
 *
 * INVARIANT CE-2 (round-trip): decrypt(encrypt(x)) === x for any UTF-8
 *   string x; encrypt() output is opaque (implementation-defined shape) and
 *   MUST NOT be assumed to be anything but a value decrypt() accepts back.
 *
 * INVARIANT CE-3 (authenticated encryption): a tampered/corrupted ciphertext
 *   MUST cause decrypt() to throw, never return garbage plaintext silently
 *   (the concrete adapter uses AES-GCM's auth tag for this).
 *
 * @typedef {Object} CredentialEncryptPort
 *
 * @property {(plaintext: string) => string} encrypt
 *   Encrypt plaintext, returning an opaque string safe to persist.
 *
 * @property {(ciphertext: string) => string} decrypt
 *   Decrypt a value produced by encrypt(). Throws on a missing/invalid key
 *   or a tampered ciphertext (INVARIANT CE-3).
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function CredentialEncryptPort() {}

/**
 * @param {string} plaintext
 * @returns {string}
 */
CredentialEncryptPort.prototype.encrypt = function encrypt(_plaintext) {
  throw new Error('CredentialEncryptPort.encrypt not implemented');
};

/**
 * @param {string} ciphertext
 * @returns {string}
 */
CredentialEncryptPort.prototype.decrypt = function decrypt(_ciphertext) {
  throw new Error('CredentialEncryptPort.decrypt not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy CredentialEncryptPort.
 * @type {ReadonlyArray<string>}
 */
var CREDENTIAL_ENCRYPT_PORT_METHODS = Object.freeze(['encrypt', 'decrypt']);

module.exports = CredentialEncryptPort;
module.exports.CredentialEncryptPort = CredentialEncryptPort;
module.exports.CREDENTIAL_ENCRYPT_PORT_METHODS = CREDENTIAL_ENCRYPT_PORT_METHODS;
