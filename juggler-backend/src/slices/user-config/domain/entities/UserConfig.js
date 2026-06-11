/**
 * UserConfig — the user_config record entity (Phase H4 / W2).
 *
 * Models one row of the `user_config` table the legacy config.controller and
 * entity-limits middleware read/write:
 *
 *     user_config(user_id, config_key, config_value, updated_at, created_at)
 *
 * Verified against:
 *   - config.controller.js:121-134  — read by {user_id, config_key}; config_value
 *     is a JSON STRING on write (`JSON.stringify(value)`), parsed on read
 *     (getAllConfig:52-55 JSON.parse with a try/catch passthrough).
 *   - entity-limits.js:104-119      — reads {user_id, config_key:'time_blocks'},
 *     parses config_value when it's a string.
 *   - the W1 golden-master Surface 1 (H1-1 config_key/config_value shape).
 *
 * PURE: zero infra imports — no db, no env. The entity is the identity carrier for
 * a config record; it does NOT perform the JSON.stringify/parse on the I/O hot
 * path (the mapper/repository in W3 owns the row↔value transform). It exposes
 * {@link UserConfig#parsedValue} as a characterized, byte-identical convenience
 * (mirroring getAllConfig's try/catch-passthrough parse) for the domain layers.
 *
 * BEHAVIOR-PRESERVING: stores config_key + config_value verbatim; parsedValue
 * reproduces the legacy parse EXACTLY — `JSON.parse(config_value)` when it's a
 * string, returning the RAW string if parse throws (config.controller.js:53), and
 * the value as-is when not a string.
 */

'use strict';

// The closed set of writable config keys — verbatim from config.controller.js's
// updateConfig validKeys (lines 97-103). 'temp_unit_pref' has its own F/C guard
// in the controller; the full list is kept here so the domain can validate a key
// before it reaches the DB (the controller relied on this inline array).
var VALID_KEYS = Object.freeze([
  'tool_matrix', 'time_blocks', 'loc_schedules',
  'loc_schedule_defaults', 'loc_schedule_overrides',
  'hour_location_overrides', 'preferences',
  'schedule_templates', 'template_defaults', 'template_overrides',
  'cal_sync_settings', 'temp_unit_pref'
]);

/**
 * @param {Object} props
 * @param {string} props.userId       the owning user id (user_config.user_id).
 * @param {string} props.configKey    the config key (user_config.config_key).
 * @param {*} [props.configValue]     the stored value — a JSON string (DB shape)
 *   or an already-parsed value. Carried verbatim.
 * @throws {Error} if userId or configKey is not a non-empty string.
 */
function UserConfig(props) {
  if (!props || typeof props !== 'object') {
    throw new Error('UserConfig requires a props object');
  }
  if (typeof props.userId !== 'string' || props.userId.length === 0) {
    throw new Error('UserConfig.userId must be a non-empty string, got: ' + JSON.stringify(props.userId));
  }
  if (typeof props.configKey !== 'string' || props.configKey.length === 0) {
    throw new Error('UserConfig.configKey must be a non-empty string, got: ' + JSON.stringify(props.configKey));
  }
  this.userId = props.userId;
  this.configKey = props.configKey;
  this.configValue = props.configValue; // verbatim (string or parsed) — not coerced
  Object.freeze(this);
}

/** The closed set of writable config keys (config.controller updateConfig). */
UserConfig.VALID_KEYS = VALID_KEYS;

/**
 * True iff `key` is a writable config key — mirrors updateConfig's
 * `validKeys.includes(key)` guard (config.controller.js:111).
 * @param {*} key
 * @returns {boolean}
 */
UserConfig.isValidKey = function isValidKey(key) {
  return VALID_KEYS.indexOf(key) !== -1;
};

/**
 * The parsed config value — characterized byte-identical to getAllConfig's parse
 * (config.controller.js:52-55): JSON.parse the value when it is a string, RETURN
 * THE RAW STRING if parse throws, and return the value as-is when not a string.
 * @returns {*}
 */
UserConfig.prototype.parsedValue = function parsedValue() {
  var v = this.configValue;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v; // legacy passthrough on parse failure
  }
};

/**
 * @param {*} other
 * @returns {boolean}
 */
UserConfig.prototype.equals = function equals(other) {
  return other instanceof UserConfig &&
    other.userId === this.userId &&
    other.configKey === this.configKey;
};

/**
 * Build a UserConfig from a DB row ({user_id, config_key, config_value}).
 * @param {{user_id: string, config_key: string, config_value?: *}} row
 * @returns {UserConfig}
 */
UserConfig.fromRow = function fromRow(row) {
  if (row instanceof UserConfig) return row;
  return new UserConfig({
    userId: row.user_id,
    configKey: row.config_key,
    configValue: row.config_value
  });
};

module.exports = UserConfig;
