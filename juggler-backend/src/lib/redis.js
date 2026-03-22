/**
 * Redis client for StriveRS
 *
 * Connects to Redis for read caching. Fails open — if Redis is unavailable,
 * all operations return null/false and the app falls through to MySQL.
 */

const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const KEY_PREFIX = 'strivers:';

let connected = false;

const client = new Redis(REDIS_URL, {
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
  console.log('[redis] Connected to', REDIS_URL);
});

client.on('error', (err) => {
  if (connected) console.warn('[redis] Error:', err.message);
  connected = false;
});

client.on('close', () => {
  connected = false;
});

function getClient() {
  return client;
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
 * Invalidate all caches for a user.
 */
async function invalidateUser(userId) {
  return del(
    `user:${userId}:tasks`,
    `user:${userId}:version`,
    `user:${userId}:placements`,
    `user:${userId}:config`
  );
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
  invalidateUser,
  invalidateTasks,
  invalidateConfig,
  quit
};
