/**
 * lib-config — typed environment-variable access.
 *
 * Single front door for reading configuration from `process.env`. Adapters and
 * infrastructure read config HERE; domain code never touches `process.env`
 * directly (see JUGGLER-HEX-DESIGN §4, lib-config row).
 *
 * Each config key is DECLARED in {@link SCHEMA} with an explicit, documented
 * default. These declared defaults are legitimate configuration — they let the
 * service be renamed without code changes — and are NOT silent data fallbacks.
 * Resolution always goes through the schema: there are no scattered `||` / `??`
 * fallbacks on arbitrary values, and requesting an unknown key throws (fail
 * loud) rather than returning silent `undefined`.
 *
 * Typed getters coerce the raw string from `process.env` to the declared type
 * and substitute the declared default only when the variable is unset.
 *
 * @module lib/config
 */

/**
 * @typedef {Object} ConfigEntry
 * @property {string} key       The environment variable name.
 * @property {'string'|'int'|'bool'} type  Declared type for coercion.
 * @property {string|number|boolean} default  Explicit default when unset.
 */

/**
 * Declared config schema. Every readable key MUST appear here.
 *
 * @type {Object.<string, ConfigEntry>}
 */
const SCHEMA = {
  // Service-rename overrides: defaults let us rename the product/app/service
  // without touching code. Declared config, not a data fallback.
  APP_ID: { key: 'APP_ID', type: 'string', default: 'juggler' },
  PRODUCT_LABEL: { key: 'PRODUCT_LABEL', type: 'string', default: 'juggler' },
  SERVICE_NAME: { key: 'SERVICE_NAME', type: 'string', default: 'strivers' },
};

/**
 * Look up a key's schema entry, throwing loudly if it isn't declared.
 *
 * @param {string} key
 * @returns {ConfigEntry}
 */
function entryFor(key) {
  const entry = SCHEMA[key];
  if (!entry) {
    throw new Error(
      `lib/config: unknown config key "${key}". ` +
        `Declare it in the SCHEMA before reading it.`,
    );
  }
  return entry;
}

/**
 * Resolve the raw value for a key: the env var if set to a non-empty string,
 * otherwise the declared default. An empty-string env var is treated as UNSET
 * — this preserves byte-identical behavior with the legacy `process.env.X ||
 * default` reads this lib replaces (`||` treats `''` as falsy → default).
 *
 * @param {string} key
 * @returns {{ raw: (string|undefined), entry: ConfigEntry }}
 */
function resolveRaw(key) {
  const entry = entryFor(key);
  const present = Object.prototype.hasOwnProperty.call(process.env, entry.key)
    ? process.env[entry.key]
    : undefined;
  // Empty string is treated as unset to match the legacy `|| default` semantic.
  const raw = present === undefined || present === '' ? undefined : present;
  return { raw, entry };
}

/**
 * Read a string config value.
 *
 * @param {string} key  A key declared in the schema.
 * @returns {string} The env value if set, else the declared default.
 */
function getString(key) {
  const { raw, entry } = resolveRaw(key);
  if (entry.type !== 'string') {
    throw new Error(`lib/config: "${key}" is type "${entry.type}", not "string"`);
  }
  return raw === undefined ? entry.default : raw;
}

/**
 * Read an integer config value. Coerces the raw string via base-10 parse.
 *
 * @param {string} key  A key declared in the schema.
 * @returns {number} The parsed env value if set, else the declared default.
 */
function getInt(key) {
  const { raw, entry } = resolveRaw(key);
  if (entry.type !== 'int') {
    throw new Error(`lib/config: "${key}" is type "${entry.type}", not "int"`);
  }
  if (raw === undefined) {
    return entry.default;
  }
  // Strict: reject trailing garbage ("5abc") that Number.parseInt would
  // silently truncate to 5 — the contract is fail-loud on non-integers.
  if (!/^[+-]?\d+$/.test(raw.trim())) {
    throw new Error(
      `lib/config: "${entry.key}" expected an integer but got "${raw}"`,
    );
  }
  return Number.parseInt(raw.trim(), 10);
}

/**
 * Read a boolean config value. Truthy strings: "true", "1" (case-insensitive,
 * trimmed). Falsy strings: "false", "0". Anything else throws (fail loud).
 *
 * @param {string} key  A key declared in the schema.
 * @returns {boolean} The coerced env value if set, else the declared default.
 */
function getBool(key) {
  const { raw, entry } = resolveRaw(key);
  if (entry.type !== 'bool') {
    throw new Error(`lib/config: "${key}" is type "${entry.type}", not "bool"`);
  }
  if (raw === undefined) {
    return entry.default;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  throw new Error(
    `lib/config: "${entry.key}" expected a boolean ("true"/"false"/"1"/"0") ` +
      `but got "${raw}"`,
  );
}

module.exports = {
  SCHEMA,
  getString,
  getInt,
  getBool,
};
