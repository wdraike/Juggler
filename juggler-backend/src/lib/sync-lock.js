/**
 * Per-user sync lock backed by the database.
 *
 * Uses INSERT with duplicate-key rejection so the first writer wins
 * atomically — no check-then-set race. Expired locks are cleaned up
 * on acquire attempts and by a periodic sweep.
 *
 * The lock owner can call refreshLock(userId, token) to extend the
 * expiry while long-running work is still in progress.
 */

var crypto = require('crypto');
var db = require('../db');

var LOCK_TTL = 5 * 60 * 1000;       // default 5 minutes
var REFRESH_TTL = 5 * 60 * 1000;    // each refresh extends by 5 minutes
var SWEEP_INTERVAL = 30 * 1000;     // sweep expired locks every 30s

// ── core primitives ────────────────────────────────────────────────

/**
 * Try to acquire the lock for a user.
 * Returns { acquired: true, token } on success,
 *         { acquired: false } if someone else holds a live lock.
 */
async function acquireLock(userId) {
  var token = crypto.randomUUID();
  var now = new Date();
  var expiresAt = new Date(now.getTime() + LOCK_TTL);

  // Single atomic statement: delete any expired row, then insert.
  // We run inside a transaction so the delete + insert are serialised.
  return db.transaction(async function(trx) {
    // Clear expired lock for this user (if any)
    await trx('sync_locks')
      .where('user_id', userId)
      .where('expires_at', '<=', now)
      .del();

    // Try to insert — the PRIMARY KEY constraint rejects duplicates
    try {
      await trx('sync_locks').insert({
        user_id: userId,
        lock_token: token,
        acquired_at: now,
        expires_at: expiresAt,
      });
      return { acquired: true, token: token };
    } catch (err) {
      // Duplicate key = someone else holds a live lock
      if (err.code === 'ER_DUP_ENTRY') {
        return { acquired: false };
      }
      throw err;
    }
  });
}

/**
 * Release the lock, but only if the token matches (prevents one
 * handler from releasing another handler's lock).
 */
async function releaseLock(userId, token) {
  await db('sync_locks')
    .where('user_id', userId)
    .where('lock_token', token)
    .del();
}

/**
 * Extend the lock expiry. Only succeeds if the caller still owns
 * the lock (token must match). Returns true if refreshed.
 */
async function refreshLock(userId, token) {
  var newExpiry = new Date(Date.now() + REFRESH_TTL);
  var updated = await db('sync_locks')
    .where('user_id', userId)
    .where('lock_token', token)
    .update({ expires_at: newExpiry });
  return updated > 0;
}

// ── middleware / wrappers ──────────────────────────────────────────

/**
 * Express middleware that wraps a handler with a per-user DB lock.
 * Returns 409 if a lock is already held for this user.
 *
 * The handler receives req.syncLock = { token, refresh() } so it
 * can extend the lock during long operations.
 */
function withSyncLock(handler) {
  return async function(req, res) {
    var userId = req.user.id;
    var result = await acquireLock(userId);
    if (!result.acquired) {
      // Tell the client how long to back off
      var lock = await db('sync_locks').where('user_id', userId).first();
      var retryAfter = lock
        ? Math.max(1, Math.ceil((new Date(lock.expires_at).getTime() - Date.now()) / 1000))
        : 60;
      return res.status(409).json({ error: 'Sync already in progress', retryAfter: retryAfter });
    }
    var token = result.token;
    // Expose refresh helper on the request
    req.syncLock = {
      token: token,
      refresh: function() { return refreshLock(userId, token); },
    };
    try {
      await handler(req, res);
    } finally {
      await releaseLock(userId, token);
    }
  };
}

/**
 * Run an async function under the per-user lock.
 * Returns null if lock can't be acquired (silent skip).
 */
async function withLock(userId, fn) {
  var result = await acquireLock(userId);
  if (!result.acquired) return null;
  var token = result.token;
  try {
    return await fn({
      refresh: function() { return refreshLock(userId, token); },
    });
  } finally {
    await releaseLock(userId, token);
  }
}

// ── background sweep ───────────────────────────────────────────────

setInterval(function() {
  db('sync_locks')
    .where('expires_at', '<=', new Date())
    .del()
    .then(function(count) {
      if (count > 0) console.warn('[sync-lock] Swept ' + count + ' expired lock(s)');
    })
    .catch(function(err) {
      console.error('[sync-lock] Sweep error:', err.message);
    });
}, SWEEP_INTERVAL);

module.exports = { withSyncLock, withLock, acquireLock, releaseLock, refreshLock };
