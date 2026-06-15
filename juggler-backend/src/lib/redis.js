/**
 * Redis client for StriveRS
 *
 * Connects to Redis for read caching. Fails open — if Redis is unavailable,
 * all operations return null/false and the app falls through to MySQL.
 *
 * Lazy initialization — the connection is only created on first use,
 * not on require(). This prevents open handles in test environments.
 */

const Redis = require('ioredis');
const { loggers } = require('./logger');
const libRedisLogger = loggers.libRedis;

const KEY_PREFIX = 'strivers:';

let client = null;
let connected = false;

function ensureClient() {
  if (client) return client;
  if (!process.env.REDIS_URL) return null;  // no-op when Redis not configured
  client = new Redis(process.env.REDIS_URL, {
    keyPrefix: KEY_PREFIX,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    }
  });

  client.on('connect', () => {
    connected = true;
    libRedisLogger.info('Redis connected', { url: process.env.REDIS_URL });
  });

  client.on('error', (err) => {
    if (connected) libRedisLogger.warn('Redis error', { error: err });
    connected = false;
  });

  client.on('close', () => {
    connected = false;
  });

  return client;
}

function getClient() {
  return ensureClient();
}

function isConnected() {
  return connected && client && client.status === 'ready';
}

/**
 * Get a cached value. Returns null if not found or Redis unavailable.
 */
async function get(key) {
  if (!isConnected()) return null;
  try {
    const val = await client.get(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
}

/**
 * Set a cached value with optional TTL (seconds).
 */
async function set(key, value, ttlSeconds) {
  if (!isConnected()) return false;
  try {
    const json = JSON.stringify(value);
    if (ttlSeconds) {
      await client.setex(key, ttlSeconds, json);
    } else {
      await client.set(key, json);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete one or more keys (supports glob patterns with del, or exact keys).
 */
async function del(...keys) {
  if (!isConnected()) return false;
  try {
    if (keys.length === 1) {
      await client.del(keys[0]);
    } else {
      await client.del(...keys);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire a short-lived dedupe lock (SET key value NX EX ttl). Returns true only
 * if THIS caller set the key (i.e. no other instance currently holds it), false
 * if the key already exists OR Redis is unavailable. Fail-soft: a false on a Redis
 * outage lets the caller fall back to its local guard — it never throws.
 *
 * Used by the cross-instance reconciliation dedupe (999.385): only one Cloud Run
 * instance should run enforceDowngradeLimits per debounce window.
 *
 * @param {string} key
 * @param {number} ttlSeconds  lock lifetime (auto-expires; also acts as the debounce window)
 * @returns {Promise<boolean>} true if the lock was acquired by this caller
 */
async function acquireLock(key, ttlSeconds) {
  if (!isConnected()) return false;
  try {
    // ioredis: set(key, value, 'EX', ttl, 'NX') → 'OK' when set, null when key exists.
    const res = await client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return res === 'OK';
  } catch {
    return false;
  }
}

/**
 * Invalidate task-related caches (tasks + version + placements).
 */
async function invalidateTasks(userId) {
  return del(
    `user:${userId}:tasks`,
    `user:${userId}:version`,
    `user:${userId}:placements`
  );
}

/**
 * Invalidate config cache.
 */
async function invalidateConfig(userId) {
  return del(`user:${userId}:config`);
}

/**
 * Graceful shutdown.
 */
async function quit() {
  if (client) {
    await client.quit().catch(() => {});
    client = null;
    connected = false;
  }
}

module.exports = {
  getClient,
  isConnected,
  get,
  set,
  del,
  acquireLock,
  invalidateTasks,
  invalidateConfig,
  quit
};
