/**
 * GetConfig — application query use-case (Phase H4 / W5).
 *
 * Reproduces the legacy `getAllConfig` HTTP handler (config.controller.js:37-86)
 * step-for-step over the W3 ConfigRepositoryPort + the injected cache port:
 *
 *   1. cache.get(`user:${userId}:config`) — return the cached payload verbatim on hit.
 *   2. miss → repo.getLocations/getTools/getProjects/getConfigRows in parallel
 *      (the legacy Promise.all over the 4 reads).
 *   3. build the `config` map: each row's config_value JSON-parsed when a string,
 *      RAW string on parse failure (the legacy try/catch passthrough,
 *      config.controller.js:53) — delegated to UserConfig.fromRow().parsedValue().
 *   4. shape the result object (locations/tools/projects mapped + the config keys
 *      with the `tempUnitPref || 'F'` default, byte-identical to lines 57-79).
 *   5. cache.set(cacheKey, result, 3600) — 1h TTL.
 *   6. return { status: 200, body: result }.
 *
 * The use-case is express-free: it returns a `{ status, body }` envelope the W6
 * thin controller maps onto res.status(...).json(...). The 500 try/catch the
 * handler wraps stays in the W6 controller (it is an express concern); this
 * use-case performs the orchestration the handler body performed.
 *
 * ── NO NEW FALLBACKS ─────────────────────────────────────────────────────────
 * Every `|| null` / `|| 'F'` / `|| undefined` below is preserved verbatim from the
 * legacy handler. No new fallback is introduced.
 *
 * @typedef {Object} GetConfigDeps
 * @property {import('../../domain/ports/ConfigRepositoryPort')} repo
 * @property {{get: Function, set: Function}} cache  the lib-cache CachePort
 *   (get/set) the legacy handler used.
 * @property {Function} [parseFloat]  numeric coercion (injected for purity; defaults
 *   to global parseFloat).
 */

'use strict';

var UserConfig = require('../../domain/entities/UserConfig');

/** @param {GetConfigDeps} deps */
function GetConfig(deps) {
  if (!deps || !deps.repo || !deps.cache) {
    throw new Error('GetConfig: { repo, cache } are required');
  }
  this.repo = deps.repo;
  this.cache = deps.cache;
  this._parseFloat = deps.parseFloat || parseFloat;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @returns {Promise<{ status: number, body: Object }>}
 */
GetConfig.prototype.execute = async function execute(input) {
  var userId = input.userId;
  var pf = this._parseFloat;
  var cacheKey = 'user:' + userId + ':config';

  var cached = await this.cache.get(cacheKey);
  if (cached) return { status: 200, body: cached };

  var res = await Promise.all([
    this.repo.getLocations(userId),
    this.repo.getTools(userId),
    this.repo.getProjects(userId),
    this.repo.getConfigRows(userId),
    this.repo.getUserTimezone(userId)
  ]);
  var locations = res[0];
  var tools = res[1];
  var projects = res[2];
  var configRows = res[3];
  // A1: the user's configured timezone (users.timezone), null when unset. The
  // frontend uses this over the browser tz for task-time display (TZ-DISPLAY-1).
  var userTimezone = res[4];

  var config = {};
  configRows.forEach(function (row) {
    // Legacy getAllConfig built the map purely from config_key/config_value and
    // never validated user_id per row — use the pure parse (NOT fromRow, which
    // enforces the userId invariant meant for write/identity paths).
    config[row.config_key] = UserConfig.parseConfigValue(row.config_value);
  });

  var result = {
    locations: locations.map(function (l) {
      return {
        id: l.location_id,
        name: l.name,
        icon: l.icon,
        lat: l.lat != null ? pf(l.lat) : undefined,
        lon: l.lon != null ? pf(l.lon) : undefined,
        displayName: l.display_name || undefined
      };
    }),
    tools: tools.map(function (t) { return { id: t.tool_id, name: t.name, icon: t.icon }; }),
    projects: projects.map(function (p) {
      return { id: p.id, name: p.name, color: p.color, icon: p.icon, sortOrder: p.sort_order };
    }),
    toolMatrix: config.tool_matrix || null,
    timeBlocks: config.time_blocks || null,
    locSchedules: config.loc_schedules || null,
    locScheduleDefaults: config.loc_schedule_defaults || null,
    locScheduleOverrides: config.loc_schedule_overrides || null,
    hourLocationOverrides: config.hour_location_overrides || null,
    preferences: config.preferences || null,
    tempUnitPref: config.temp_unit_pref || 'F',
    scheduleTemplates: config.schedule_templates || null,
    templateDefaults: config.template_defaults || null,
    templateOverrides: config.template_overrides || null,
    calSyncSettings: config.cal_sync_settings || null,
    userTimezone: userTimezone || null
  };
  await this.cache.set(cacheKey, result, 3600); // 1 hour TTL
  return { status: 200, body: result };
};

module.exports = GetConfig;
