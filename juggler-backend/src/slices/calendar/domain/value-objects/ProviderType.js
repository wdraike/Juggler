/**
 * ProviderType — value object / enum for a calendar provider identifier.
 *
 * Valid values match the providerId strings the adapters expose and the
 * README "providerId" row: 'gcal' | 'msft' | 'apple' | 'memory'.
 * Construction rejects any unknown provider so an unsupported provider can
 * never propagate through the calendar slice.
 */

/**
 * Canonical set of valid provider ids.
 * @type {ReadonlyArray<string>}
 */
var VALID_PROVIDERS = Object.freeze(['gcal', 'msft', 'apple', 'memory']);

/**
 * @param {string} value
 */
function ProviderType(value) {
  if (typeof value !== 'string' || VALID_PROVIDERS.indexOf(value) === -1) {
    throw new TypeError(
      'ProviderType must be one of [' + VALID_PROVIDERS.join(', ') +
      '], got: ' + JSON.stringify(value)
    );
  }
  this.value = value;
  Object.freeze(this);
}

ProviderType.VALID_PROVIDERS = VALID_PROVIDERS;

/**
 * True if `value` is a recognized provider id.
 * @param {*} value
 * @returns {boolean}
 */
ProviderType.isValid = function isValid(value) {
  return typeof value === 'string' && VALID_PROVIDERS.indexOf(value) !== -1;
};

/**
 * Value equality.
 * @param {*} other
 * @returns {boolean}
 */
ProviderType.prototype.equals = function equals(other) {
  return other instanceof ProviderType && other.value === this.value;
};

/**
 * @returns {string}
 */
ProviderType.prototype.toString = function toString() {
  return this.value;
};

/**
 * Factory. Returns the input unchanged if it is already a ProviderType.
 * @param {(string|ProviderType)} value
 * @returns {ProviderType}
 */
ProviderType.from = function from(value) {
  if (value instanceof ProviderType) return value;
  return new ProviderType(value);
};

module.exports = ProviderType;
