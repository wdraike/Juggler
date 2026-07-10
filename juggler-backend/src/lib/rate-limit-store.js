/**
 * maybeRedisStore — conditional RedisStore factory for express-rate-limit.
 *
 * Returns a rate-limit-redis v4 RedisStore when REDIS_URL is configured.
 * Returns undefined otherwise, which causes express-rate-limit to use its
 * default in-memory MemoryStore (fail-open for local dev / single-instance).
 *
 * RedisStore v4 runs SCRIPT LOAD at construction time. To avoid running that
 * at module load (before ioredis has connected), we defer construction until
 * the Redis client reaches 'ready' state, then swap the store in on first use.
 * This fixes WR-03: the previous status check always saw 'connecting' at module
 * load and permanently fell back to MemoryStore even when Redis was correctly
 * provisioned. (Phase 07 WR-03 fix)
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
var config = require('./config');

function maybeRedisStore(prefix) {
  if (!config.getString('REDIS_URL')) return undefined; // 999.1473

  var client = redisLib.getClient();
  if (!client) return undefined;

  // Defer RedisStore construction until the ioredis client is ready.
  // RedisStore v4 calls SCRIPT LOAD at construction — doing this at module
  // load (when client.status is 'connecting') would race the TCP handshake
  // and cause "unexpected reply" errors. Instead, return a lazy wrapper that
  // builds the real store on first use after Redis is ready, then delegates
  // all subsequent calls to the real store.
  var realStore = null;
  var initOptions = null; // captured from express-rate-limit's init(); replayed when the store builds lazily

  function buildRealStore() {
    if (realStore) return realStore;
    if (client.status !== 'ready') return null;
    realStore = new RedisStore({
      sendCommand: function(cmd) {
        var args = Array.prototype.slice.call(arguments, 1);
        return client.call.apply(client, [cmd].concat(args));
      },
      prefix: prefix || 'jugrl:'
    });
    // CRITICAL: RedisStore needs init(options) to set windowMs. When Redis is not 'ready' at
    // express-rate-limit's init() call (the common async-connect race), the store builds later
    // inside increment() — so replay the captured options here. Without this, RedisStore.increment
    // throws `Cannot read properties of undefined (reading 'toString')` on this.windowMs.toString(),
    // 500-ing every rate-limited route (all of /api/*).
    if (initOptions && realStore.init) realStore.init(initOptions);
    return realStore;
  }

  // Return a store-shaped object that lazily delegates to the real RedisStore.
  // express-rate-limit v6+ calls store.increment(key), store.decrement(key),
  // store.resetKey(key), store.resetAll(), and store.init(options).
  return {
    init: function(options) {
      // Called by express-rate-limit at setup. Capture options so a lazily-built real store
      // (Redis not ready yet) still gets init'd with windowMs when it's constructed later.
      initOptions = options;
      var s = buildRealStore();
      if (s && s.init) s.init(options);
    },
    increment: async function(key) {
      var s = buildRealStore();
      if (!s) {
        // Redis not ready yet — fall back to an ephemeral in-memory response
        // so the limiter doesn't crash on the first few requests during startup.
        return { totalHits: 1, resetTime: new Date(Date.now() + 60000) };
      }
      return s.increment(key);
    },
    decrement: async function(key) {
      var s = buildRealStore();
      if (s) return s.decrement(key);
    },
    resetKey: async function(key) {
      var s = buildRealStore();
      if (s) return s.resetKey(key);
    },
    resetAll: async function() {
      var s = buildRealStore();
      if (s) return s.resetAll();
    }
  };
}

module.exports = { maybeRedisStore };
