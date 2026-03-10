/**
 * Per-user lock to prevent concurrent syncs and scheduler runs.
 * Shared by calendar sync routes and scheduler routes/triggers.
 * If a sync or schedule is already running for a user, subsequent
 * requests get a 409 response or are silently skipped.
 */

var activeLocks = new Map();

function acquireLock(userId) {
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
 */
function withSyncLock(handler) {
  return async function(req, res) {
    var userId = req.user.id;
    if (!acquireLock(userId)) {
      return res.status(409).json({ error: 'Sync already in progress' });
    }
    try {
      await handler(req, res);
    } finally {
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
  try {
    return await fn();
  } finally {
    releaseLock(userId);
  }
}

// Safety: clear stale locks after 5 minutes (in case of crash/timeout)
setInterval(function() {
  var now = Date.now();
  for (var [userId, timestamp] of activeLocks) {
    if (now - timestamp > 5 * 60 * 1000) {
      activeLocks.delete(userId);
    }
  }
}, 60000);

module.exports = { withSyncLock, withLock };
