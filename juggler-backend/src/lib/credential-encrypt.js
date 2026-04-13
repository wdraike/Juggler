/**
 * credential-encrypt.js — AES-256-GCM encryption for stored credentials.
 *
 * Used to encrypt app-specific passwords (e.g., Apple CalDAV) at rest.
 * Key is read from CREDENTIAL_ENCRYPTION_KEY env var (64-char hex = 32 bytes).
 *
 * Generate a key: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

var crypto = require('crypto');

var ALGORITHM = 'aes-256-gcm';
var IV_LENGTH = 12;
var TAG_LENGTH = 16;

function getKey() {
  var hex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be a 64-char hex string (32 bytes). Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt plaintext. Returns a JSON string containing iv, tag, and ciphertext (all hex).
 */
function encrypt(plaintext) {
  var key = getKey();
  var iv = crypto.randomBytes(IV_LENGTH);
  var cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  var encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  var tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ct: encrypted.toString('hex')
  });
}

/**
 * Decrypt a JSON string produced by encrypt(). Returns plaintext.
 */
function decrypt(json) {
  var key = getKey();
  var data = typeof json === 'string' ? JSON.parse(json) : json;
  var iv = Buffer.from(data.iv, 'hex');
  var tag = Buffer.from(data.tag, 'hex');
  var ct = Buffer.from(data.ct, 'hex');
  var decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  var decrypted = Buffer.concat([decipher.update(ct), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt };
