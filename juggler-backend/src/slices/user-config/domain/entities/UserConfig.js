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
//
// ── AUDIT (999.687) ──────────────────────────────────────────────────────────
// All 12 keys are ACTIVE — consumed by scheduler, frontend, cal-sync, or export.
//   tool_matrix             — scheduler (runSchedule), MCP config, export/import
//   time_blocks             — scheduler, entity-limits, export/import, route guard
//   loc_schedules           — scheduler, export/import
//   loc_schedule_defaults   — scheduler, export/import
//   loc_schedule_overrides  — scheduler, export/import
//   hour_location_overrides — scheduler, export/import
//   preferences             — scheduler (splitDefault/splitMinDefault),
//                             cal-sync (calCompletedBehavior), task creation,
//                             export/import, frontend (gridZoom/fontSize/…)
//   schedule_templates      — scheduler, orphan-when-tag scan, export/import
//   template_defaults       — scheduler, export/import
//   template_overrides      — scheduler, export/import
//   cal_sync_settings       — cal-sync controller (ingest mode), DeleteTask
//                             (ingest-block), MCP tasks tool. Was missing from
//                             GetConfig/ExportData/MCP — FIXED in 999.687.
//   temp_unit_pref          — GetConfig (default 'F'), UpdateConfig (F/C guard),
//                             frontend weather display. UI-only; scheduler is
//                             F-only internally (migration 20260509000400).
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
 * Export/import format version (999.1603). Stamped onto every export by
 * ExportData; ImportData REJECTS payloads stamped with a NEWER version (an
 * export from a future build whose shape this server cannot faithfully read).
 * Payloads with no stamp are legacy v7 — accepted.
 * History: 7 (implicit, `v7: true` era) → 8 (adds scheduleTemplates /
 * templateDefaults / templateOverrides / tempUnitPref / full `preferences`
 * object + this stamp).
 */
UserConfig.EXPORT_FORMAT_VERSION = 8;

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
 * Pure value-parse, byte-identical to getAllConfig's per-row parse
 * (config.controller.js:52-55) WITHOUT constructing a UserConfig — JSON.parse a
 * string value, RETURN THE RAW STRING on parse failure, return non-strings as-is.
 *
 * Used by GetConfig over rows that may not carry user_id (the legacy read built
 * the config map purely from config_key/config_value and never validated user_id
 * per row — golden-master H1-1 feeds user_id-less rows). The full UserConfig
 * entity (with its userId invariant) is for write/identity paths, not this map build.
 * @param {*} value
 * @returns {*}
 */
UserConfig.parseConfigValue = function parseConfigValue(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value; // legacy passthrough on parse failure
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
