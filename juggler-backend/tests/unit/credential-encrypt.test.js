/**
 * Unit tests for credential-encrypt.js
 *
 * Source: src/lib/credential-encrypt.js
 *
 * Uses AES-256-GCM. Key is read at call-time from CREDENTIAL_ENCRYPTION_KEY
 * (64-char hex string = 32 bytes). We set the env var before requiring the
 * module so that the key is available for all test calls.
 *
 * Contract:
 *   encrypt(plaintext) → JSON string (iv, tag, ct all hex-encoded)
 *   decrypt(json)      → plaintext string
 *   decrypt on a tampered ciphertext → throws (GCM auth tag fails)
 */

// Set the env var BEFORE requiring the module. The module reads it at call
// time (inside getKey()), so it's sufficient to have it set before any test
// executes — but we set it at module-load time to be safe.
process.env.CREDENTIAL_ENCRYPTION_KEY = 'a'.repeat(64); // 32-byte valid hex key

const { encrypt, decrypt } = require('../../src/lib/credential-encrypt');

describe('credential-encrypt', () => {
  // ── Round-trip ─────────────────────────────────────────────────────────────
  test('decrypt(encrypt(plaintext)) returns the original plaintext', () => {
    const plain = 'my-secret-apple-password';
    const ciphertext = encrypt(plain);
    const recovered = decrypt(ciphertext);
    expect(recovered).toBe(plain);
  });

  // ── Output is not plaintext ────────────────────────────────────────────────
  test('encrypt output differs from the input plaintext', () => {
    const plain = 'another-secret-token';
    const ciphertext = encrypt(plain);
    // The output is a JSON string containing iv/tag/ct — definitely not equal.
    expect(ciphertext).not.toBe(plain);
  });

  // ── Each encryption produces a different ciphertext (random IV) ───────────
  test('encrypting the same plaintext twice produces different ciphertexts (random IV)', () => {
    const plain = 'idempotency-test';
    const c1 = encrypt(plain);
    const c2 = encrypt(plain);
    expect(c1).not.toBe(c2);
    // But both decrypt to the same value.
    expect(decrypt(c1)).toBe(plain);
    expect(decrypt(c2)).toBe(plain);
  });

  // ── Tampered ciphertext is rejected ───────────────────────────────────────
  test('decryption of a tampered ciphertext throws (GCM auth tag mismatch)', () => {
    const plain = 'tamper-me';
    const ciphertextJson = encrypt(plain);
    const data = JSON.parse(ciphertextJson);
    // Flip a byte in the ciphertext (ct) to trigger GCM authentication failure.
    const ctBuf = Buffer.from(data.ct, 'hex');
    ctBuf[0] ^= 0xff;
    data.ct = ctBuf.toString('hex');
    const tampered = JSON.stringify(data);
    expect(() => decrypt(tampered)).toThrow();
  });

  // ── Invalid JSON input rejected ────────────────────────────────────────────
  test('decryption of non-JSON string throws', () => {
    expect(() => decrypt('not-valid-json-at-all')).toThrow();
  });

  // ── Key validation — wrong length throws ──────────────────────────────────
  test('encrypt throws when CREDENTIAL_ENCRYPTION_KEY is missing or wrong length', () => {
    const original = process.env.CREDENTIAL_ENCRYPTION_KEY;
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'tooshort';
    try {
      expect(() => encrypt('anything')).toThrow(/CREDENTIAL_ENCRYPTION_KEY/);
    } finally {
      // Restore so subsequent tests in this file are not affected.
      process.env.CREDENTIAL_ENCRYPTION_KEY = original;
    }
  });
});
