/**
 * SSE Event Emitter — multi-instance safe via Redis pub/sub.
 *
 * Each instance holds its own in-memory client map (for response writing).
 * Events are published to Redis channel `sse:{userId}` so all instances
 * receive them regardless of which instance handled the mutation.
 *
 * Falls back to direct local-only emit if Redis is unavailable (single-instance OK).
 */

const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const CHANNEL_PREFIX = 'sse:';

// Local SSE response objects — own-instance only
var clients = {};

// Lazy subscriber client — separate connection required for Redis pub/sub
var subscriber = null;

function getSubscriber() {
  if (subscriber) return subscriber;
  subscriber = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: function(times) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    }
  });
  subscriber.on('message', function(channel, message) {
    var userId = channel.slice(CHANNEL_PREFIX.length);
    var subs = clients[userId];
    if (!subs || subs.size === 0) return;
    subs.forEach(function(res) {
      try { res.write(message); }
      catch (e) { subs.delete(res); }
    });
  });
  subscriber.on('error', function(err) {
    console.warn('[sse-emitter] Redis subscriber error (falling back to local-only):', err.message);
  });
  return subscriber;
}

// Publisher client — reuse the same connection pattern as redis.js but separate client
var publisher = null;
function getPublisher() {
  if (publisher) return publisher;
  publisher = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: function(times) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    }
  });
  publisher.on('error', function(err) {
    console.warn('[sse-emitter] Redis publisher error (falling back to local-only):', err.message);
  });
  return publisher;
}

function addClient(userId, res) {
  if (!clients[userId]) clients[userId] = new Set();
  clients[userId].add(res);

  // Subscribe to this user's channel if this is the first local client
  if (clients[userId].size === 1) {
    try { getSubscriber().subscribe(CHANNEL_PREFIX + userId); }
    catch (e) { /* Redis unavailable — local-only mode */ }
  }

  res.on('close', function() {
    if (clients[userId]) {
      clients[userId].delete(res);
      if (clients[userId].size === 0) {
        delete clients[userId];
        try { getSubscriber().unsubscribe(CHANNEL_PREFIX + userId); }
        catch (e) { /* ignore */ }
      }
    }
  });
}

function emit(userId, event, data) {
  var payload = 'event: ' + event + '\n';
  payload += 'data: ' + JSON.stringify(data || {}) + '\n\n';

  // Publish to Redis — all instances receive it (including this one via subscriber)
  var pub = getPublisher();
  if (pub && pub.status === 'ready') {
    pub.publish(CHANNEL_PREFIX + userId, payload).catch(function(err) {
      console.warn('[sse-emitter] publish failed, falling back to local:', err.message);
      _emitLocal(userId, payload);
    });
  } else {
    // Redis unavailable — direct local emit
    _emitLocal(userId, payload);
  }
}

function _emitLocal(userId, payload) {
  var subs = clients[userId];
  if (!subs || subs.size === 0) return;
  subs.forEach(function(res) {
    try { res.write(payload); }
    catch (e) { subs.delete(res); }
  });
}

function clientCount(userId) {
  return clients[userId] ? clients[userId].size : 0;
}

module.exports = { addClient, emit, clientCount };
