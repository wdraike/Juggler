/**
 * EncryptionPort — driven-port contract for the AES-256-GCM credential
 * encryption module (999.1535 — lib/credential-encrypt.js).
 *
 * Mirrors the GcalApiPort/AppleCalApiPort/MsftCalApiPort idiom: a JSDoc
 * `@typedef`, a throw-not-implemented prototype base, and a frozen METHODS
 * array.
 *
 * Wraps `src/lib/credential-encrypt.js` — the AES-256-GCM encryption module
 * used to encrypt app-specific passwords (e.g. Apple CalDAV) at rest — so
 * it exposes EXACTLY that surface: `encrypt` / `decrypt`.
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT E-1 (AES-256-GCM authenticated encryption): encrypt uses
 *   aes-256-gcm with a 12-byte random IV. The auth tag is embedded in the
 *   output. decrypt verifies the tag — tampered ciphertext throws.
 *
 * INVARIANT E-2 (random IV per call): each encrypt call generates a fresh
 *   random IV. Encrypting the same plaintext twice produces different
 *   ciphertexts, both decrypting to the original.
 *
 * INVARIANT E-3 (JSON output format): encrypt returns a JSON string
 *   containing { iv, tag, ct } — all hex-encoded. decrypt accepts that JSON
 *   string (or a parsed object) and returns the plaintext string.
 *
 * INVARIANT E-4 (key from env): the 32-byte key is read at call-time from
 *   CREDENTIAL_ENCRYPTION_KEY (64-char hex string). Missing or wrong-length
 *   key throws with a clear remediation message — no fallback key.
 *
 * @typedef {Object} EncryptionPort
 *
 * @property {(plaintext: string) => string} encrypt
 *   Encrypt plaintext. Returns a JSON string { iv, tag, ct } (E-1, E-2, E-3).
 *   Throws if CREDENTIAL_ENCRYPTION_KEY is missing/wrong length (E-4).
 *
 * @property {(json: string|Object) => string} decrypt
 *   Decrypt a JSON string (or object) produced by encrypt. Returns plaintext.
 *   Throws on tampered ciphertext (GCM auth tag mismatch) or invalid JSON (E-1).
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function EncryptionPort() {}

EncryptionPort.prototype.encrypt = function encrypt(_plaintext) {
  throw new Error('EncryptionPort.encrypt not implemented');
};

EncryptionPort.prototype.decrypt = function decrypt(_json) {
  throw new Error('EncryptionPort.decrypt not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy EncryptionPort.
 * @type {ReadonlyArray<string>}
 */
var ENCRYPTION_PORT_METHODS = Object.freeze([
  'encrypt',
  'decrypt'
]);

module.exports = EncryptionPort;
module.exports.EncryptionPort = EncryptionPort;
module.exports.ENCRYPTION_PORT_METHODS = ENCRYPTION_PORT_METHODS;