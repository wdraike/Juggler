/**
 * maybeRedisStore — conditional RedisStore factory for express-rate-limit.
 *
 * Returns a rate-limit-redis v4 RedisStore when REDIS_URL is configured.
 * Returns undefined otherwise, which causes express-rate-limit to use its
 * default in-memory MemoryStore (fail-open for local dev / single-instance).
 *
 * The RedisStore constructor does NOT require the ioredis client to be in
 * 'ready' state at construction time — it queues commands internally until
 * the connection is established. Checking client.status at module load would
 * always see 'connecting' (ioredis connects asynchronously) and would cause
 * the store to permanently fall back to MemoryStore even when Redis is
 * correctly provisioned. (Phase 07 WR-03 fix)
 *
 * Use this ONLY for rate limiters that need shared counters across Cloud Run
 * instances — currently only the strict per-user AI limiter (max=2/min).
 * Broad API limiters (1000/min) intentionally stay per-instance (Category 4f).
 *
 * rate-limit-redis v4 API:
 *   new RedisStore({ sendCommand, prefix })
 *   sendCommand(cmd, ...args) — maps directly to ioredis .call(cmd, ...args)
 *
 * @param {string} prefix - Key prefix for Redis entries (e.g. 'jugrl-ai:')
 * @returns {import('rate-limit-redis').RedisStore | undefined}
 */

var RedisStore = require('rate-limit-redis').RedisStore;
var redisLib = require('./redis');

function maybeRedisStore(prefix) {
  if (!process.env.REDIS_URL) return undefined;

  var client = redisLib.getClient();
  if (!client) return undefined;

  return new RedisStore({
    sendCommand: function(cmd) {
      var args = Array.prototype.slice.call(arguments, 1);
      return client.call.apply(client, [cmd].concat(args));
    },
    prefix: prefix || 'jugrl:'
  });
}

module.exports = { maybeRedisStore };
