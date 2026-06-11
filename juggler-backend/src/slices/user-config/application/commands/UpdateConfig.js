/**
 * UpdateConfig — application command use-case (Phase H4 / W5).
 *
 * Reproduces the legacy `updateConfig` handler (config.controller.js:91-192)
 * step-for-step over the W3 ConfigRepositoryPort + the injected cache + scheduler
 * collaborators.
 *
 * ── STEP-FOR-STEP (matches the handler) ──────────────────────────────────────
 *   1. temp_unit_pref guard: key==='temp_unit_pref' && value not 'F'/'C' → 400.
 *   2. validKeys guard: !UserConfig.isValidKey(key) → 400 (the relocated validKeys
 *      array lives on UserConfig.VALID_KEYS, W2).
 *   3. size guard: JSON.stringify(value).length > 102400 → 400.
 *   4. upsert: repo.getConfigRow probe → update (config_value + updated_at new Date())
 *      or insert (no updated_at — column default). Relocated to repo.upsertConfig
 *      which encapsulates the existing?update:insert + P1 new Date().
 *   5. cache.invalidateConfig(userId).
 *   6. orphan when-tag scan (only for schedule_templates with an object value):
 *      build newTags from the templates' blocks, read repo.getActiveWhenTaggedTasks,
 *      compute orphaned tasks, push a warning when any. (config.controller.js:139-175.)
 *   7. respond { key, value, warnings }.
 *   8. background reschedule: if key in schedKeys → enqueueScheduleRun(userId,
 *      'config:'+key). The legacy fired this AFTER res.json (fire-and-forget); the
 *      use-case returns a `scheduleAfter` directive in the result so the W6
 *      controller fires it after responding, preserving the post-response ordering.
 *
 * ── P1 ── the updated_at stamp on the UPDATE path is `new Date()` inside the repo
 * (KnexConfigRepository.upsertConfig), correcting the legacy `getDb().fn.now()`
 * (config.controller.js:126) per WBS W3 acceptance (b) / ADR-0003. The use-case
 * does not stamp timestamps itself.
 *
 * ── NO NEW FALLBACKS ── every guard/default is preserved verbatim from the handler.
 *
 * @typedef {Object} UpdateConfigDeps
 * @property {import('../../domain/ports/ConfigRepositoryPort')} repo
 * @property {{invalidateConfig: Function}} cache
 * @property {Function} enqueueScheduleRun  (userId, source) — the background
 *   reschedule trigger (injected). The use-case returns a `scheduleAfter` directive;
 *   it does NOT call this directly (preserving the legacy after-response ordering).
 *   Kept in deps for parity / future direct-call wiring.
 */

'use strict';

var UserConfig = require('../../domain/entities/UserConfig');

// Schedule-affecting keys — verbatim from config.controller.js:180-184.
var SCHED_KEYS = [
  'hour_location_overrides', 'time_blocks', 'loc_schedules',
  'loc_schedule_defaults', 'loc_schedule_overrides', 'tool_matrix', 'preferences',
  'schedule_templates'
];

/** @param {UpdateConfigDeps} deps */
function UpdateConfig(deps) {
  if (!deps || !deps.repo || !deps.cache) {
    throw new Error('UpdateConfig: { repo, cache } are required');
  }
  this.repo = deps.repo;
  this.cache = deps.cache;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @param {string} input.key    the config key (route param).
 * @param {*} input.value       the config value (req.body.value).
 * @returns {Promise<{ status: number, body: Object, scheduleAfter?: {userId: string, source: string} }>}
 *   `scheduleAfter` (when present) tells the W6 controller to fire
 *   enqueueScheduleRun(userId, source) AFTER it sends the response — preserving the
 *   legacy fire-after-res.json ordering.
 */
UpdateConfig.prototype.execute = async function execute(input) {
  var userId = input.userId;
  var key = input.key;
  var value = input.value;

  // 1. temp_unit_pref guard (handler L107-109)
  if (key === 'temp_unit_pref' && value !== 'F' && value !== 'C') {
    return { status: 400, body: { error: "temp_unit_pref must be 'F' or 'C'" } };
  }

  // 2. validKeys guard (handler L111-113)
  if (!UserConfig.isValidKey(key)) {
    return { status: 400, body: { error: 'Invalid config key: ' + key } };
  }

  // 3. size guard (handler L116-119)
  var serialized = JSON.stringify(value);
  if (serialized.length > 102400) {
    return { status: 400, body: { error: 'Config value too large (max 100KB)' } };
  }

  // 4. upsert (handler L121-134) — existing?update:insert relocated to the repo.
  await this.repo.upsertConfig(userId, key, JSON.stringify(value));

  // 5. cache invalidate (handler L136)
  await this.cache.invalidateConfig(userId);

  // 6. orphan when-tag scan (handler L138-175)
  var warnings = [];
  if (key === 'schedule_templates' && value && typeof value === 'object') {
    var newTags = {};
    Object.values(value).forEach(function (tmpl) {
      (tmpl.blocks || []).forEach(function (b) {
        if (b.tag) newTags[b.tag] = true;
      });
    });

    var activeTasks = await this.repo.getActiveWhenTaggedTasks(userId);

    var orphanedTasks = [];
    activeTasks.forEach(function (t) {
      var parts = (t.when || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      var nonSpecial = parts.filter(function (p) { return p !== 'fixed' && p !== 'allday' && p !== 'anytime'; });
      if (nonSpecial.length === 0) return;
      var hasValid = nonSpecial.some(function (p) { return newTags[p]; });
      if (!hasValid) {
        orphanedTasks.push({ id: t.id, text: t.text, when: t.when });
      }
    });

    if (orphanedTasks.length > 0) {
      warnings.push({
        type: 'orphanedWhenTags',
        tasks: orphanedTasks,
        message: orphanedTasks.length + ' task(s) use time block tags that no longer exist in any template'
      });
    }
  }

  // 7. response (handler L177)
  var result = { status: 200, body: { key: key, value: value, warnings: warnings } };

  // 8. background reschedule (handler L179-187) — fired AFTER res.json by the legacy
  // handler. Returned as a directive so the W6 controller preserves the ordering.
  if (SCHED_KEYS.includes(key)) {
    result.scheduleAfter = { userId: userId, source: 'config:' + key };
  }

  return result;
};

UpdateConfig.SCHED_KEYS = SCHED_KEYS;

module.exports = UpdateConfig;
