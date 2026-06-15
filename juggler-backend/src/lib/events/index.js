/**
 * lib-events - In-process event bus for cross-slice communication
 *
 * Provides an EventBus pattern for decoupled communication between
 * domain slices. Events are delivered synchronously in-process.
 *
 * @module lib/events
 */

/**
 * Event types used throughout Juggler
 *
 * @readonly
 * @enum {string}
 */
const EventTypes = {
  // Task lifecycle events
  TASK_CREATED: 'task.created',
  TASK_UPDATED: 'task.updated',
  TASK_COMPLETED: 'task.completed',
  TASK_DELETED: 'task.deleted',
  TASK_PLACED: 'task.placed',

  // Schedule events
  SCHEDULE_RAN: 'schedule.ran',
  SCHEDULE_SESSION_STARTED: 'schedule.session.started',
  SCHEDULE_SESSION_COMPLETED: 'schedule.session.completed',
  SCHEDULE_CONFLICT_DETECTED: 'schedule.conflict.detected',

  // Calendar sync events
  CALENDAR_SYNCED: 'calendar.synced',
  CALENDAR_SYNC_STARTED: 'calendar.sync.started',
  CALENDAR_SYNC_FAILED: 'calendar.sync.failed',

  // Cache events
  CACHE_INVALIDATED: 'cache.invalidated',
  CACHE_ENTRY_EVICTED: 'cache.entry.evicted',

  // Dependency chain events
  CHAIN_BLOCKED: 'chain.blocked',
  CHAIN_UNBLOCKED: 'chain.unblocked',

  // User preference events
  USER_PREFERENCES_UPDATED: 'user.preferences.updated',
  USER_CALENDAR_CONNECTED: 'user.calendar.connected',
  USER_CALENDAR_DISCONNECTED: 'user.calendar.disconnected',
};

/**
 * Event payload structures for documentation purposes.
 * Actual payloads should match these shapes.
 *
 * RECONCILIATION (999.333): the task-lifecycle typedefs below document the
 * FLAT/MINIMAL shape that `taskEvents.js` actually emits and that subscribers
 * actually read. This matches ADR-0001 invariant E-3 ("minimal payload:
 * { taskId, userId, status, timestamp }"). The earlier typedef documented a
 * richer `{ task, changes }` shape that NO publisher emitted and NO consumer
 * read — the sole subscriber (taskEventLogger.js) reads only taskId/userId/
 * status, and the H6 scheduler subscriber keys off task identity (taskId/
 * userId) to enqueue a schedule run, not the full task object. The typedef was
 * corrected to the flat reality rather than enriching the publisher, because
 * no consumer needs the richer fields and E-3 binds the contract to minimal.
 * `status` is a serializable string scalar (never a knex/Date handle), and
 * `timestamp` is `Date.now()` (a number), matching the publisher.
 *
 * @typedef {Object} TaskCreatedPayload
 * @property {string} taskId - The task identifier
 * @property {string} userId - The user who owns the task
 * @property {string} status - The task status at create time (serializable scalar)
 * @property {number} timestamp - When the event occurred (Date.now() epoch ms)
 *
 * @typedef {Object} TaskUpdatedPayload
 * @property {string} taskId - The task identifier
 * @property {string} userId - The user who owns the task
 * @property {string} status - The task status after the update (serializable scalar)
 * @property {number} timestamp - When the event occurred (Date.now() epoch ms)
 *
 * @typedef {Object} TaskCompletedPayload
 * @property {string} taskId - The task identifier
 * @property {string} userId - The user who owns the task
 * @property {string} status - The task status (typically 'done'; serializable scalar)
 * @property {number} timestamp - When the event occurred (Date.now() epoch ms)
 *
 * @typedef {Object} TaskPlacedPayload
 * @property {string} taskId - The task identifier
 * @property {string} userId - The user who owns the task
 * @property {Date} startTime - When the task is scheduled
 * @property {Date} endTime - When the task ends
 * @property {string} placementMode - How the task was placed (suggested, manual, etc.)
 * @property {Date} timestamp - When the event occurred
 *
 * @typedef {Object} ScheduleRanPayload
 * @property {string} userId - The user whose schedule was run
 * @property {number} taskCount - Number of tasks processed
 * @property {number} placedCount - Number of tasks placed
 * @property {number} durationMs - How long the scheduling took
 * @property {Date} timestamp - When the event occurred
 *
 * @typedef {Object} CalendarSyncedPayload
 * @property {string} userId - The user whose calendar was synced
 * @property {string} provider - The calendar provider (gcal, msft, apple)
 * @property {number} eventsSynced - Number of events synced
 * @property {Date} timestamp - When the event occurred
 *
 * @typedef {Object} CacheInvalidatedPayload
 * @property {string} key - The cache key that was invalidated
 * @property {string} [pattern] - Pattern if multiple keys were invalidated
 * @property {string} reason - Why the cache was invalidated
 * @property {Date} timestamp - When the event occurred
 */

/**
 * EventBus class for in-process event publishing/subscribing.
 *
 * Events are delivered synchronously to all subscribers.
 * Errors in handlers do not bubble up (logged but don't stop other handlers).
 */
class EventBus {
  /**
   * Create a new EventBus instance
   * @param {Object} [config] - Configuration options
   * @param {Function} [config.logger] - Logger function for errors
   * @param {boolean} [config.captureStackTraces] - Whether to capture stack traces for debugging
   */
  constructor(config = {}) {
    this._handlers = new Map();
    this._logger = config.logger || null;
    this._captureStackTraces = config.captureStackTraces || false;
  }

  /**
   * Subscribe to an event type
   *
   * @param {string} eventType - The event type to subscribe to (use EventTypes constants)
   * @param {Function} handler - The handler function (receives payload as argument)
   * @param {Object} [options] - Subscription options
   * @param {string} [options.id] - Optional subscription ID for later unsubscribe
   * @returns {Function} Unsubscribe function
   *
   * @example
   * const unsubscribe = eventBus.subscribe(EventTypes.TASK_CREATED, (payload) => {
   *   console.log('Task created:', payload.taskId);
   * });
   *
   * // Later:
   * unsubscribe();
   */
  subscribe(eventType, handler, options = {}) {
    if (typeof eventType !== 'string') {
      throw new TypeError('eventType must be a string');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('handler must be a function');
    }

    if (!this._handlers.has(eventType)) {
      this._handlers.set(eventType, new Map());
    }

    const subscriptionId = options.id || this._generateId();
    const handlers = this._handlers.get(eventType);

    // Store with metadata
    const subscription = {
      handler,
      id: subscriptionId,
      subscribedAt: new Date(),
    };

    handlers.set(subscriptionId, subscription);

    // Return unsubscribe function
    return () => {
      this.unsubscribe(eventType, subscriptionId);
    };
  }

  /**
   * Unsubscribe a handler by subscription ID
   *
   * @param {string} eventType - The event type
   * @param {string} subscriptionId - The subscription ID returned from subscribe
   * @returns {boolean} Whether a handler was removed
   */
  unsubscribe(eventType, subscriptionId) {
    const handlers = this._handlers.get(eventType);
    if (!handlers) return false;

    return handlers.delete(subscriptionId);
  }

  /**
   * Unsubscribe all handlers for an event type
   *
   * @param {string} eventType - The event type to clear
   * @returns {number} Number of handlers removed
   */
  unsubscribeAll(eventType) {
    if (!eventType) {
      // Clear all handlers for all event types
      let count = 0;
      for (const handlers of this._handlers.values()) {
        count += handlers.size;
      }
      this._handlers.clear();
      return count;
    }

    const handlers = this._handlers.get(eventType);
    if (!handlers) return 0;

    const count = handlers.size;
    this._handlers.delete(eventType);
    return count;
  }

  /**
   * Publish an event
   *
   * Events are delivered synchronously to all subscribers.
   * Errors in handlers are logged but do not prevent other handlers from running.
   *
   * @param {string} eventType - The event type (use EventTypes constants)
   * @param {Object} payload - The event payload
   * @returns {Object} Result with { delivered, failed } counts
   *
   * @example
   * // Task-lifecycle payloads are flat + minimal (ADR-0001 E-3 / 999.333):
   * eventBus.publish(EventTypes.TASK_CREATED, {
   *   taskId: 'abc123',
   *   userId: 'user-456',
   *   status: '',
   *   timestamp: Date.now()
   * });
   */
  publish(eventType, payload) {
    if (typeof eventType !== 'string') {
      throw new TypeError('eventType must be a string');
    }

    const handlers = this._handlers.get(eventType);

    if (!handlers || handlers.size === 0) {
      return { delivered: 0, failed: 0 };
    }

    // Attach metadata to payload
    const enrichedPayload = {
      ...payload,
      _eventMeta: {
        type: eventType,
        publishedAt: new Date(),
        ...(this._captureStackTraces && { stackTrace: new Error().stack }),
      },
    };

    let delivered = 0;
    let failed = 0;

    for (const [id, subscription] of handlers) {
      try {
        subscription.handler(enrichedPayload);
        delivered++;
      } catch (err) {
        failed++;
        if (this._logger) {
          this._logger('error', 'Event handler failed', {
            eventType,
            subscriptionId: id,
            error: err.message,
          });
        }
      }
    }

    return { delivered, failed };
  }

  /**
   * Publish an event asynchronously (handlers run in next tick)
   *
   * @param {string} eventType - The event type
   * @param {Object} payload - The event payload
   * @returns {Promise<Object>} Resolves when all handlers complete
   */
  async publishAsync(eventType, payload) {
    return new Promise((resolve) => {
      process.nextTick(() => {
        const result = this.publish(eventType, payload);
        resolve(result);
      });
    });
  }

  /**
   * Get the count of subscribers for an event type
   *
   * @param {string} [eventType] - The event type (returns total if omitted)
   * @returns {number} Number of subscribers
   */
  subscriberCount(eventType) {
    if (eventType) {
      const handlers = this._handlers.get(eventType);
      return handlers ? handlers.size : 0;
    }

    let total = 0;
    for (const handlers of this._handlers.values()) {
      total += handlers.size;
    }
    return total;
  }

  /**
   * Get all event types that have subscribers
   *
   * @returns {string[]} Array of event types
   */
  getSubscribedEventTypes() {
    return Array.from(this._handlers.keys());
  }

  /**
   * Check if an event type has subscribers
   *
   * @param {string} eventType - The event type
   * @returns {boolean}
   */
  hasSubscribers(eventType) {
    const handlers = this._handlers.get(eventType);
    return !!(handlers && handlers.size > 0);
  }

  /**
   * Wait for an event to occur (returns a promise that resolves on next event)
   *
   * @param {string} eventType - The event type to wait for
   * @param {number} [timeoutMs] - Optional timeout in milliseconds
   * @returns {Promise<Object>} Resolves with the event payload
   */
  once(eventType, timeoutMs = null) {
    return new Promise((resolve, reject) => {
      let unsubscribe = null;
      let timeoutId = null;

      const handler = (payload) => {
        if (timeoutId) clearTimeout(timeoutId);
        if (unsubscribe) unsubscribe();
        resolve(payload);
      };

      unsubscribe = this.subscribe(eventType, handler);

      if (timeoutMs) {
        timeoutId = setTimeout(() => {
          unsubscribe();
          reject(new Error(`Timeout waiting for event: ${eventType}`));
        }, timeoutMs);
      }
    });
  }

  /**
   * Generate a unique subscription ID
   * @private
   * @returns {string}
   */
  _generateId() {
    return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * InMemoryEventBus - Test-friendly EventBus implementation
 *
 * Extends EventBus with additional capabilities for testing:
 * - Event history tracking
 * - Assertions about published events
 * - Wait-for-event helpers
 */
class InMemoryEventBus extends EventBus {
  /**
   * Create a new InMemoryEventBus for testing
   * @param {Object} [config] - Configuration options
   * @param {boolean} [config.trackHistory] - Whether to keep event history (default: true)
   * @param {number} [config.maxHistorySize] - Maximum events to keep in history (default: 1000)
   */
  constructor(config = {}) {
    super(config);
    this._trackHistory = config.trackHistory !== false;
    this._maxHistorySize = config.maxHistorySize || 1000;
    this._history = [];
  }

  /**
   * Publish an event and track it in history
   * @param {string} eventType - The event type
   * @param {Object} payload - The event payload
   * @returns {Object} Result with { delivered, failed } counts
   */
  publish(eventType, payload) {
    // First add to history so waitForEvent can find it during synchronous handlers
    const historyEntry = {
      eventType,
      payload,
      result: { delivered: 0, failed: 0 },
      timestamp: new Date(),
    };

    if (this._trackHistory) {
      this._history.push(historyEntry);

      // Trim history if it exceeds max size
      if (this._history.length > this._maxHistorySize) {
        this._history = this._history.slice(-this._maxHistorySize);
      }
    }

    const result = super.publish(eventType, payload);

    // Update the history entry with actual results
    if (this._trackHistory) {
      historyEntry.result = result;
    }

    return result;
  }

  /**
   * Get the event history
   *
   * @param {Object} [filter] - Optional filter criteria
   * @param {string} [filter.eventType] - Filter by event type
   * @param {string} [filter.after] - Filter events after this timestamp
   * @param {string} [filter.before] - Filter events before this timestamp
   * @returns {Array} Event history
   */
  getHistory(filter = {}) {
    let history = [...this._history];

    if (filter.eventType) {
      history = history.filter(e => e.eventType === filter.eventType);
    }
    if (filter.after) {
      const after = new Date(filter.after);
      history = history.filter(e => e.timestamp > after);
    }
    if (filter.before) {
      const before = new Date(filter.before);
      history = history.filter(e => e.timestamp < before);
    }

    return history;
  }

  /**
   * Clear the event history
   */
  clearHistory() {
    this._history = [];
  }

  /**
   * Assert that an event was published
   *
   * @param {string} eventType - The event type to check for
   * @param {Object} [expectedPayload] - Optional payload to match (partial match)
   * @param {number} [expectedCount] - Expected number of times event was published
   * @returns {Object|null} The matched event or null
   * @throws {Error} If assertions fail
   */
  assertPublished(eventType, expectedPayload = null, expectedCount = null) {
    const events = this._history.filter(e => e.eventType === eventType);

    if (expectedCount !== null && events.length !== expectedCount) {
      throw new Error(
        `Expected event "${eventType}" to be published ${expectedCount} time(s), ` +
        `but was published ${events.length} time(s)`
      );
    }

    if (events.length === 0) {
      throw new Error(`Expected event "${eventType}" to be published, but it was not`);
    }

    if (expectedPayload) {
      const match = events.find(e =>
        this._partialMatch(e.payload, expectedPayload)
      );

      if (!match) {
        throw new Error(
          `Event "${eventType}" was published ${events.length} time(s), ` +
          `but none matched the expected payload`
        );
      }

      return match;
    }

    return events[0];
  }

  /**
   * Assert that an event was NOT published
   *
   * @param {string} eventType - The event type to check for
   * @throws {Error} If the event was published
   */
  assertNotPublished(eventType) {
    const events = this._history.filter(e => e.eventType === eventType);
    if (events.length > 0) {
      throw new Error(
        `Expected event "${eventType}" NOT to be published, ` +
        `but it was published ${events.length} time(s)`
      );
    }
  }

  /**
   * Check if payload partially matches expected (all expected keys match)
   * @private
   * @param {Object} actual - The actual payload
   * @param {Object} expected - The expected subset of payload
   * @returns {boolean}
   */
  _partialMatch(actual, expected) {
    for (const [key, value] of Object.entries(expected)) {
      if (actual[key] !== value) {
        return false;
      }
    }
    return true;
  }

  /**
   * Wait for an event to be published (with timeout)
   *
   * @param {string} eventType - The event type to wait for
   * @param {number} [timeoutMs=5000] - Timeout in milliseconds
   * @param {Object} [matchPayload] - Optional payload to match
   * @returns {Promise<Object>} Resolves with the matched event
   */
  waitForEvent(eventType, timeoutMs = 5000, matchPayload = null) {
    return new Promise((resolve, reject) => {
      // Check if event already in history
      const existing = this._history.find(e =>
        e.eventType === eventType &&
        (!matchPayload || this._partialMatch(e.payload, matchPayload))
      );

      if (existing) {
        resolve(existing);
        return;
      }

      // Set up subscription and timeout
      let unsubscribe = null;
      const timeoutId = setTimeout(() => {
        if (unsubscribe) unsubscribe();
        reject(new Error(`Timeout waiting for event "${eventType}"`));
      }, timeoutMs);

      const handler = (payload) => {
        if (matchPayload && !this._partialMatch(payload, matchPayload)) {
          return; // Not a match, keep waiting
        }

        clearTimeout(timeoutId);
        if (unsubscribe) unsubscribe();

        // Find the event in history (it was just added)
        const event = this._history[this._history.length - 1];
        resolve(event);
      };

      unsubscribe = this.subscribe(eventType, handler);
    });
  }

  /**
   * Get statistics about published events
   *
   * @returns {Object} Statistics by event type
   */
  getStats() {
    const stats = {};
    for (const entry of this._history) {
      if (!stats[entry.eventType]) {
        stats[entry.eventType] = {
          count: 0,
          delivered: 0,
          failed: 0,
        };
      }
      stats[entry.eventType].count++;
      stats[entry.eventType].delivered += entry.result.delivered;
      stats[entry.eventType].failed += entry.result.failed;
    }
    return stats;
  }
}

// Global event bus instance (singleton for the application)
let globalEventBus = null;

/**
 * Get or create the global EventBus instance
 *
 * @param {Object} [config] - Configuration options
 * @returns {EventBus}
 */
function getEventBus(config) {
  if (!globalEventBus) {
    globalEventBus = new EventBus(config);
  }
  return globalEventBus;
}

/**
 * Reset the global EventBus (useful for testing)
 */
function resetEventBus() {
  globalEventBus = null;
}

/**
 * Create a new EventBus instance
 *
 * @param {Object} [config] - Configuration options
 * @returns {EventBus}
 */
function createEventBus(config) {
  return new EventBus(config);
}

module.exports = {
  // Core exports
  EventBus,
  InMemoryEventBus,
  EventTypes,

  // Factory functions
  createEventBus,
  getEventBus,
  resetEventBus,
};
