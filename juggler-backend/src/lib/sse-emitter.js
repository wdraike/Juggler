/**
 * SSE Event Emitter — manages connected clients and broadcasts events.
 *
 * Usage:
 *   const sse = require('./lib/sse-emitter');
 *   sse.addClient(userId, res);        // in SSE endpoint handler
 *   sse.emit(userId, 'tasks:changed'); // after mutation
 *   sse.emit(userId, 'schedule:changed'); // after scheduler run
 */

// Map of userId → Set of response objects
var clients = {};

function addClient(userId, res) {
  if (!clients[userId]) clients[userId] = new Set();
  clients[userId].add(res);

  res.on('close', function () {
    clients[userId].delete(res);
    if (clients[userId].size === 0) delete clients[userId];
  });
}

function emit(userId, event, data) {
  var subs = clients[userId];
  if (!subs || subs.size === 0) return;

  var payload = 'event: ' + event + '\n';
  payload += 'data: ' + JSON.stringify(data || {}) + '\n\n';

  subs.forEach(function (res) {
    try {
      res.write(payload);
    } catch (e) {
      // Client disconnected — remove on next event
      subs.delete(res);
    }
  });
}

function clientCount(userId) {
  return clients[userId] ? clients[userId].size : 0;
}

module.exports = { addClient, emit, clientCount };
