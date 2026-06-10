/**
 * EventId — value object wrapping a provider event id string.
 *
 * Immutable, compared by value. Provider event ids are opaque strings
 * (gcal/msft ids, Apple CalDAV resource URLs). The VO rejects empty/non-string
 * values so a missing id can never silently flow through the sync pipeline.
 */

/**
 * @param {string} value
 */
function EventId(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('EventId requires a non-empty string, got: ' + JSON.stringify(value));
  }
  this.value = value;
  Object.freeze(this);
}

/**
 * Value equality.
 * @param {*} other
 * @returns {boolean}
 */
EventId.prototype.equals = function equals(other) {
  return other instanceof EventId && other.value === this.value;
};

/**
 * @returns {string}
 */
EventId.prototype.toString = function toString() {
  return this.value;
};

/**
 * Factory. Returns the input unchanged if it is already an EventId.
 * @param {(string|EventId)} value
 * @returns {EventId}
 */
EventId.from = function from(value) {
  if (value instanceof EventId) return value;
  return new EventId(value);
};

module.exports = EventId;
