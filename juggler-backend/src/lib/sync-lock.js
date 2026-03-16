/**
 * Per-user lock to prevent concurrent syncs and scheduler runs.
 * Shared by calendar sync routes and scheduler routes/triggers.
 * If a sync or schedule is already running for a user, subsequent
 * requests get a 409 response or are silently skipped.
 */

var LOCK_TIMEOUT = 3 * 60 * 1000; // 3 minutes max lock hold time

var activeLocks = new Map();

function acquireLock(userId) {
  var existing = activeLocks.get(userId);
  // If a lock exists but is stale, force-clear it
  if (existing && Date.now() - existing > LOCK_TIMEOUT) {
    console.warn('[sync-lock] Force-clearing stale lock for user ' + userId + ' (held ' + Math.round((Date.now() - existing) / 1000) + 's)');
    activeLocks.delete(userId);
  }
  if (activeLocks.has(userId)) return false;
  activeLocks.set(userId, Date.now());
  return true;
}

function releaseLock(userId) {
  activeLocks.delete(userId);
}

/**
 * Express middleware that wraps a handler with a per-user lock.
 * Returns 409 if a lock is already held for this user.
 * Automatically times out after LOCK_TIMEOUT.
 */
function withSyncLock(handler) {
  return async function(req, res) {
    var userId = req.user.id;
    if (!acquireLock(userId)) {
      return res.status(409).json({ error: 'Sync already in progress' });
    }
    // Safety timeout — release lock if handler takes too long
    var timeout = setTimeout(function() {
      console.warn('[sync-lock] Handler timeout for user ' + userId + ' — releasing lock');
      releaseLock(userId);
    }, LOCK_TIMEOUT);
    try {
      await handler(req, res);
    } finally {
      clearTimeout(timeout);
      releaseLock(userId);
    }
  };
}

/**
 * Run an async function under the per-user lock.
 * Returns null if lock can't be acquired (silent skip).
 */
async function withLock(userId, fn) {
  if (!acquireLock(userId)) return null;
  var timeout = setTimeout(function() {
    console.warn('[sync-lock] Function timeout for user ' + userId + ' — releasing lock');
    releaseLock(userId);
  }, LOCK_TIMEOUT);
  try {
    return await fn();
  } finally {
    clearTimeout(timeout);
    releaseLock(userId);
  }
}

// Safety sweep: clear any stale locks every 30 seconds
setInterval(function() {
  var now = Date.now();
  var stale = [];
  activeLocks.forEach(function(timestamp, userId) {
    if (now - timestamp > LOCK_TIMEOUT) stale.push(userId);
  });
  stale.forEach(function(userId) {
    console.warn('[sync-lock] Sweeping stale lock for user ' + userId);
    activeLocks.delete(userId);
  });
}, 30000);

module.exports = { withSyncLock, withLock };
