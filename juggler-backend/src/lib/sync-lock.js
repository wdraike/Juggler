/**
 * Per-user sync lock to prevent concurrent calendar syncs.
 * If a sync is already running for a user, subsequent requests
 * get a 409 response instead of running in parallel.
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
 * Express middleware that wraps a sync handler with a per-user lock.
 * Returns 409 if a sync is already in progress for this user.
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

// Safety: clear stale locks after 5 minutes (in case of crash/timeout)
setInterval(function() {
  var now = Date.now();
  for (var [userId, timestamp] of activeLocks) {
    if (now - timestamp > 5 * 60 * 1000) {
      activeLocks.delete(userId);
    }
  }
}, 60000);

module.exports = { withSyncLock };
