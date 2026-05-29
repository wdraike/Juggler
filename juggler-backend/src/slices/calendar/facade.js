/**
 * facade.js
 * Calendar slice facade - main entry point for calendar operations.
 *
 * Provides a unified interface to all calendar adapters.
 * Follows hexagonal architecture: domain logic in slice, adapters implement ports.
 *
 * Usage:
 *   const calendar = require('./slices/calendar/facade');
 *   await calendar.initialize();
 *
 *   // Get adapters
 *   const gcal = calendar.getAdapter('gcal');
 *   const msft = calendar.getAdapter('msft');
 *   const apple = calendar.getAdapter('apple');
 *
 *   // Check if user has calendar connected
 *   if (gcal.isConnected(user)) {
 *     const events = await gcal.getEvents(token, start, end, user.id);
 *   }
 */

const { validateCalendarPort } = require('./domain/ports/CalendarPort');

// Adapter imports
const GoogleCalendarAdapter = require('./adapters/GoogleCalendarAdapter');
const MicrosoftCalendarAdapter = require('./adapters/MicrosoftCalendarAdapter');
const AppleCalendarAdapter = require('./adapters/AppleCalendarAdapter');
const InMemoryCalendarAdapter = require('./adapters/InMemoryCalendarAdapter');

// Registry of adapters
const adapters = new Map();

/**
 * Initialize the calendar slice.
 * Loads all adapters and verifies they implement the required interface.
 * @param {Object} deps - Optional dependencies override for DI
 * @returns {Object} - The initialized facade
 */
function initialize(deps = {}) {
  // Initialize adapters with dependencies
  if (GoogleCalendarAdapter.initialize) {
    GoogleCalendarAdapter.initialize(deps);
  }
  if (MicrosoftCalendarAdapter.initialize) {
    MicrosoftCalendarAdapter.initialize(deps);
  }
  if (AppleCalendarAdapter.initialize) {
    AppleCalendarAdapter.initialize(deps);
  }

  // Register adapters
  registerAdapter(GoogleCalendarAdapter);
  registerAdapter(MicrosoftCalendarAdapter);
  registerAdapter(AppleCalendarAdapter);
  registerAdapter(InMemoryCalendarAdapter);

  return facade;
}

/**
 * Register a calendar adapter.
 * Validates that it implements the required ports.
 * @param {Object} adapter - The adapter to register
 * @throws {Error} If adapter doesn't implement required methods
 */
function registerAdapter(adapter) {
  const missing = validateCalendarPort(adapter);
  if (missing.length > 0) {
    throw new Error(`Adapter "${adapter.providerId}" missing required methods: ${missing.join(', ')}`);
  }

  adapters.set(adapter.providerId, adapter);
}

/**
 * Unregister an adapter.
 * @param {string} providerId - The provider ID
 */
function unregisterAdapter(providerId) {
  adapters.delete(providerId);
}

/**
 * Get an adapter by provider ID.
 * @param {string} providerId - 'gcal', 'msft', 'apple', or 'memory'
 * @returns {Object|null} - The adapter or null if not found
 */
function getAdapter(providerId) {
  return adapters.get(providerId) || null;
}

/**
 * Get all registered adapters.
 * @returns {Array} - Array of adapters
 */
function getAllAdapters() {
  return Array.from(adapters.values());
}

/**
 * Get adapters that are connected for a given user.
 * @param {Object} user - User record from database
 * @returns {Array} - Array of connected adapters
 */
function getConnectedAdapters(user) {
  return Array.from(adapters.values()).filter(a => a.isConnected(user));
}

/**
 * Get provider IDs for connected calendars.
 * @param {Object} user - User record from database
 * @returns {Array<string>} - Array of provider IDs
 */
function getConnectedProviderIds(user) {
  return getConnectedAdapters(user).map(a => a.providerId);
}

/**
 * Check if any calendar is connected.
 * @param {Object} user - User record from database
 * @returns {boolean}
 */
function hasAnyCalendar(user) {
  return getConnectedAdapters(user).length > 0;
}

/**
 * Sync all connected calendars.
 * @param {Object} user - User record from database
 * @returns {Promise<Object>} - Results per provider
 */
async function syncAll(user) {
  const results = {};
  const connected = getConnectedAdapters(user);

  for (const adapter of connected) {
    try {
      const token = await adapter.getValidAccessToken(user);
      const syncResult = await adapter.sync(token, user);
      results[adapter.providerId] = {
        success: true,
        hasChanges: syncResult.hasChanges,
        tokenInvalid: syncResult.tokenInvalid || false
      };
    } catch (err) {
      results[adapter.providerId] = {
        success: false,
        error: err.message
      };
    }
  }

  return results;
}

/**
 * Create an event in the first available calendar.
 * Tries providers in order: gcal -> msft -> apple -> memory
 * @param {Object} user - User record
 * @param {Object} event - Event data
 * @param {Object} options - Options { year, tz, opts }
 * @returns {Promise<{providerId: string, providerEventId: string, raw: Object}>}
 */
async function createEvent(user, event, options = {}) {
  const { year = new Date().getFullYear(), tz = 'UTC', opts = {} } = options;
  const connected = getConnectedAdapters(user);

  if (connected.length === 0) {
    throw new Error('No calendar connected');
  }

  // Try each provider in order
  const errors = [];
  for (const adapter of connected) {
    try {
      const token = await adapter.getValidAccessToken(user);
      const result = await adapter.createEvent(token, event, user.id, year, tz, opts);
      return {
        providerId: adapter.providerId,
        providerEventId: result.providerEventId,
        raw: result.raw
      };
    } catch (err) {
      errors.push(`${adapter.providerId}: ${err.message}`);
    }
  }

  throw new Error(`Failed to create event in all calendars: ${errors.join('; ')}`);
}

/**
 * Delete an event from its provider calendar.
 * @param {Object} user - User record
 * @param {string} providerId - The provider ID
 * @param {string} eventId - The event ID
 * @returns {Promise<void>}
 */
async function deleteEvent(user, providerId, eventId) {
  const adapter = getAdapter(providerId);
  if (!adapter) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  if (!adapter.isConnected(user)) {
    throw new Error(`Provider not connected: ${providerId}`);
  }

  const token = await adapter.getValidAccessToken(user);
  return adapter.deleteEvent(token, eventId, user.id);
}

// The facade object
const facade = {
  // Initialization
  initialize,
  registerAdapter,
  unregisterAdapter,

  // Adapter access
  getAdapter,
  getAllAdapters,
  getConnectedAdapters,
  getConnectedProviderIds,

  // Utility
  hasAnyCalendar,

  // Operations
  syncAll,
  createEvent,
  deleteEvent
};

module.exports = facade;
