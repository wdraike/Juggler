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
 * ── EXCEPTION — SELF-HEAL (999.2144, APPROVED FALLBACK) ─────────────────────
 * schedule_templates/template_defaults/template_overrides are the one exception:
 * UpdateConfig used to guard only key-name + 100KB size, so a corrupt or missing
 * shape could reach this read path (dev-DB evidence: schedule_templates.weekday
 * .blocks collapsed to a loc-less block, locOverrides wiped) and would previously
 * be served AS-IS via `|| null`. This is a David-approved, DOCUMENTED fallback
 * (2026-07-21, noted in juggler/CLAUDE.md "Approved Fallbacks"): when
 * schedule_templates is missing or fails validateScheduleTemplates, the WHOLE
 * trio is healed to the server-side defaults (domain/defaultTemplates) — the
 * healed values are BOTH served in this response AND persisted (repo.upsertConfig
 * + cache.invalidateConfig), so the corruption is fixed once, not masked on every
 * read. template_defaults/template_overrides are additionally healed
 * INDEPENDENTLY (only the one that fails its own validator, when schedule_templates
 * itself is valid) — see the self-heal block below.
 *
 * ── HARDENING (999.2144 harrison+law review) ─────────────────────────────────
 * FINDING 1 (BLOCK, fixed): an independent template_defaults heal must reference
 * ids the user ACTUALLY has — defaultTemplates.buildFallbackTemplateDefaults()
 * (not the literal 'weekday'/'weekend' default) guarantees the healed value
 * itself passes validateTemplateDefaults(healed, knownTemplateIds), so a custom-id
 * schedule_templates (e.g. {work, light}) converges instead of re-healing forever.
 * FINDING 2 (WARN, fixed): the trio-heal writes run inside ONE repo.runInTransaction
 * (no partial-trio persist on a mid-heal failure) and the whole heal-persist step
 * is best-effort — a persist failure is logged (this.logger, optional injected dep)
 * and swallowed, never thrown, so a DB hiccup during self-heal cannot turn a
 * routine GET (previously always 200) into a 500. The healed value is still
 * served this response regardless; an unpersisted heal simply retries next read.
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
var scheduleTemplateValidation = require('../../domain/logic/scheduleTemplateValidation');
var defaultTemplates = require('../../domain/defaultTemplates');

/** @param {GetConfigDeps} deps */
function GetConfig(deps) {
  if (!deps || !deps.repo || !deps.cache) {
    throw new Error('GetConfig: { repo, cache } are required');
  }
  this.repo = deps.repo;
  this.cache = deps.cache;
  this._parseFloat = deps.parseFloat || parseFloat;
  // Optional — self-heal persistence failures are logged, never thrown (999.2144
  // harrison FINDING 2). Defaults to a no-op so existing callers/tests that don't
  // inject a logger are unaffected.
  this.logger = deps.logger || { warn: function () {}, error: function () {} };
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

  // ── SELF-HEAL: schedule-template config integrity (999.2144) ──────────────
  // See the class doc "EXCEPTION — SELF-HEAL" note above for the approval.
  var healedKeys = [];
  var effectiveScheduleTemplates;
  var effectiveTemplateDefaults;
  var effectiveTemplateOverrides;

  var scheduleTemplatesCheck = scheduleTemplateValidation.validateScheduleTemplates(config.schedule_templates);
  if (config.schedule_templates === undefined || !scheduleTemplatesCheck.valid) {
    // schedule_templates itself is missing/corrupt — heal the WHOLE trio: any
    // template_defaults/overrides referencing the now-replaced templates are
    // no longer meaningful either.
    effectiveScheduleTemplates = defaultTemplates.buildDefaultScheduleTemplates();
    effectiveTemplateDefaults = defaultTemplates.buildDefaultTemplateDefaults();
    effectiveTemplateOverrides = defaultTemplates.buildDefaultTemplateOverrides();
    healedKeys.push('schedule_templates', 'template_defaults', 'template_overrides');
  } else {
    effectiveScheduleTemplates = config.schedule_templates;
    var knownTemplateIds = Object.keys(effectiveScheduleTemplates);

    var templateDefaultsCheck = scheduleTemplateValidation.validateTemplateDefaults(config.template_defaults, knownTemplateIds);
    if (config.template_defaults === undefined || !templateDefaultsCheck.valid) {
      // 999.2144 harrison FINDING 1 (law-confirmed): buildDefaultTemplateDefaults()
      // always references 'weekday'/'weekend'. For a user with CUSTOM template ids
      // (no 'weekday'/'weekend' present — a fully valid schedule_templates shape),
      // healing to that literal default would ITSELF fail validateTemplateDefaults
      // against knownTemplateIds on the very next read — re-heal, re-persist,
      // forever (write-per-read, cache permanently defeated). Use the fallback
      // builder instead, which is guaranteed to reference ids the user actually has.
      effectiveTemplateDefaults = defaultTemplates.buildFallbackTemplateDefaults(knownTemplateIds);
      healedKeys.push('template_defaults');
    } else {
      effectiveTemplateDefaults = config.template_defaults;
    }

    var templateOverridesCheck = scheduleTemplateValidation.validateTemplateOverrides(config.template_overrides, knownTemplateIds);
    if (config.template_overrides === undefined || !templateOverridesCheck.valid) {
      effectiveTemplateOverrides = defaultTemplates.buildDefaultTemplateOverrides();
      healedKeys.push('template_overrides');
    } else {
      effectiveTemplateOverrides = config.template_overrides;
    }
  }

  if (healedKeys.length > 0) {
    var repo = this.repo;
    var logger = this.logger;
    var healedValues = {
      schedule_templates: effectiveScheduleTemplates,
      template_defaults: effectiveTemplateDefaults,
      template_overrides: effectiveTemplateOverrides
    };
    // 999.2144 harrison FINDING 2: the heal writes are (a) wrapped in ONE
    // transaction so a mid-heal failure never persists a PARTIAL trio, and
    // (b) best-effort — a persist failure is logged and swallowed rather than
    // thrown, so a DB hiccup during a routine GET's self-heal cannot turn a
    // previously-always-200 read into a 500. The healed value is still served
    // THIS response either way; an unpersisted heal simply retries next read.
    try {
      await repo.runInTransaction(function (trxRepo) {
        return Promise.all(healedKeys.map(function (k) {
          return trxRepo.upsertConfig(userId, k, JSON.stringify(healedValues[k]));
        }));
      });
      await this.cache.invalidateConfig(userId);
    } catch (err) {
      logger.warn('[user-config.GetConfig] schedule-template self-heal persist failed (serving healed value unpersisted): ' + err.message);
    }
  }

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
    scheduleTemplates: effectiveScheduleTemplates,
    templateDefaults: effectiveTemplateDefaults,
    templateOverrides: effectiveTemplateOverrides,
    calSyncSettings: config.cal_sync_settings || null,
    userTimezone: userTimezone || null
  };
  await this.cache.set(cacheKey, result, 3600); // 1 hour TTL
  return { status: 200, body: result };
};

module.exports = GetConfig;
