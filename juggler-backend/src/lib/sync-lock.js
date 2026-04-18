/**
 * Per-user lock backed by the database.
 *
 * Gates all scheduling-relevant writers: the scheduler, cal-sync,
 * and (via task-write-queue) user/MCP task mutations. Only one of
 * these can modify scheduling-relevant task fields at a time.
 *
 * Uses INSERT with duplicate-key rejection so the first writer wins
 * atomically. All time comparisons use MySQL NOW() to avoid timezone
 * mismatches between JS Date and the dateStrings knex config.
 *
 * Safety cap: heartbeat stops after MAX_LOCK_AGE so a stuck handler
 * can't hold the lock forever.
 */

var crypto = require('crypto');
var db = require('../db');

var LOCK_TTL_SECONDS = 30;           // short TTL — heartbeat keeps it alive
var REFRESH_TTL_SECONDS = 30;        // each heartbeat extends by 30s
var SWEEP_INTERVAL = 15 * 1000;      // sweep expired locks every 15s
var MAX_LOCK_AGE = 5 * 60 * 1000;    // stop heartbeat after 5 min

// ── core primitives ────────────────────────────────────────────────

async function acquireLock(userId) {
  var token = crypto.randomUUID();

  return db.transaction(async function(trx) {
    // Clear expired lock using MySQL's own clock — no JS Date timezone issues
    await trx.raw(
      'DELETE FROM sync_locks WHERE user_id = ? AND expires_at <= NOW()',
      [userId]
    );

    try {
      await trx.raw(
        'INSERT INTO sync_locks (user_id, lock_token, acquired_at, expires_at) VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND))',
        [userId, token, LOCK_TTL_SECONDS]
      );
      return { acquired: true, token: token };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return { acquired: false };
      }
      throw err;
    }
  });
}

async function releaseLock(userId, token) {
  await db('sync_locks')
    .where('user_id', userId)
    .where('lock_token', token)
    .del();
}

async function refreshLock(userId, token) {
  var updated = await db.raw(
    'UPDATE sync_locks SET expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE user_id = ? AND lock_token = ?',
    [REFRESH_TTL_SECONDS, userId, token]
  );
  return (updated[0].affectedRows || 0) > 0;
}

/**
 * Fast non-blocking check: is the lock currently held for this user?
 * PK lookup on a single-row table — sub-millisecond.
 */
async function isLocked(userId) {
  var row = await db.raw(
    'SELECT 1 FROM sync_locks WHERE user_id = ? AND expires_at > NOW() LIMIT 1',
    [userId]
  );
  return (row[0] && row[0].length > 0);
}

// ── middleware / wrappers ──────────────────────────────────────────

function withSyncLock(handler) {
  return async function(req, res) {
    var userId = req.user.id;
    var result = await acquireLock(userId);
    if (!result.acquired) {
      return res.status(409).json({ error: 'Sync already in progress', retryAfter: LOCK_TTL_SECONDS });
    }
    var token = result.token;
    var lockStart = Date.now();
    var lockLost = false;
    var heartbeat = setInterval(function() {
      if (Date.now() - lockStart > MAX_LOCK_AGE) {
        clearInterval(heartbeat);
        lockLost = true;
        console.warn('[sync-lock] Heartbeat stopped — lock held over ' + Math.round(MAX_LOCK_AGE / 1000) + 's, allowing expiry');
        return;
      }
      refreshLock(userId, token).then(function(ok) {
        if (!ok) {
          lockLost = true;
          clearInterval(heartbeat);
          console.warn('[sync-lock] Lock lost — refresh returned 0 rows (expired or stolen)');
        }
      }).catch(function(err) {
        lockLost = true;
        clearInterval(heartbeat);
        console.error('[sync-lock] Lock refresh failed:', err.message);
      });
    }, 10 * 1000);
    req.syncLock = {
      token: token,
      get lost() { return lockLost; },
      refresh: function() { return refreshLock(userId, token); },
    };
    try {
      await handler(req, res);
    } finally {
      clearInterval(heartbeat);
      await releaseLock(userId, token);
    }
  };
}

async function withLock(userId, fn, opts) {
  var result = await acquireLock(userId);
  if (!result.acquired) return null;
  var token = result.token;
  var lockStart = Date.now();
  var lockLost = false;
  var heartbeat = setInterval(function() {
    if (Date.now() - lockStart > MAX_LOCK_AGE) {
      clearInterval(heartbeat);
      lockLost = true;
      return;
    }
    refreshLock(userId, token).then(function(ok) {
      if (!ok) {
        lockLost = true;
        clearInterval(heartbeat);
        console.warn('[sync-lock] Lock lost in withLock — refresh returned 0 rows');
      }
    }).catch(function(err) {
      lockLost = true;
      clearInterval(heartbeat);
      console.error('[sync-lock] Lock refresh failed in withLock:', err.message);
    });
  }, 10 * 1000);
  try {
    return await fn({
      get lost() { return lockLost; },
      refresh: function() { return refreshLock(userId, token); },
    });
  } finally {
    clearInterval(heartbeat);
    // Flush pending task writes BEFORE releasing the lock so the scheduler
    // can't grab the lock between release and flush.
    if (!opts || opts.flushOnRelease !== false) {
      try {
        var twq = require('./task-write-queue');
        await twq.flushQueueInLock(userId);
      } catch (err) {
        console.error('[sync-lock] pre-release flush error:', err.message);
      }
    }
    await releaseLock(userId, token);
  }
}

// ── background sweep using MySQL clock ─────────────────────────────

var sweepTimer = setInterval(function() {
  db.raw('DELETE FROM sync_locks WHERE expires_at <= NOW()')
    .then(function(result) {
      var count = result[0].affectedRows || 0;
      if (count > 0) console.warn('[sync-lock] Swept ' + count + ' expired lock(s)');
    })
    .catch(function(err) {
      console.error('[sync-lock] Sweep error:', err.message);
    });
}, SWEEP_INTERVAL);
sweepTimer.unref();

module.exports = { withSyncLock, withLock, acquireLock, releaseLock, refreshLock, isLocked };
