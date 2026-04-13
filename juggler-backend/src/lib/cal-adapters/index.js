/**
 * Calendar adapter registry.
 * Each adapter implements the unified provider interface.
 */

var gcalAdapter = require('./gcal.adapter');
var msftAdapter = require('./msft.adapter');
var appleAdapter = require('./apple.adapter');

var adapters = {
  gcal: gcalAdapter,
  msft: msftAdapter,
  apple: appleAdapter
};

/**
 * Get all registered adapters as an array.
 */
function getAllAdapters() {
  return Object.values(adapters);
}

/**
 * Get adapters that are connected for a given user.
 */
function getConnectedAdapters(user) {
  return getAllAdapters().filter(function(a) { return a.isConnected(user); });
}

/**
 * Get a specific adapter by provider ID.
 */
function getAdapter(providerId) {
  return adapters[providerId] || null;
}

/**
 * Register a new adapter (for future providers like Apple, Yahoo).
 */
function registerAdapter(adapter) {
  adapters[adapter.providerId] = adapter;
}

module.exports = {
  getAllAdapters,
  getConnectedAdapters,
  getAdapter,
  registerAdapter
};
