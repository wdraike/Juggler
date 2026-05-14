/**
 * maybeRedisStore — conditional RedisStore factory for express-rate-limit.
 *
 * Returns a rate-limit-redis v4 RedisStore when REDIS_URL is configured AND
 * the shared ioredis client is in 'ready' state. Returns undefined otherwise,
 * which causes express-rate-limit to use its default in-memory MemoryStore
 * (fail-open for local dev and single-instance deployments).
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
  if (!client || client.status !== 'ready') return undefined;

  return new RedisStore({
    sendCommand: function(cmd) {
      var args = Array.prototype.slice.call(arguments, 1);
      return client.call.apply(client, [cmd].concat(args));
    },
    prefix: prefix || 'jugrl:'
  });
}

module.exports = { maybeRedisStore };
