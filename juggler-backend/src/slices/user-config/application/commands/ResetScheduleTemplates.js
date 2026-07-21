/**
 * ResetScheduleTemplates — POST /config/templates/reset use-case (999.2144;
 * contract consumed by the 999.2145 frontend Reset button).
 *
 * Writes the server-side schedule-template defaults trio (SSOT:
 * domain/defaultTemplates — a block-for-block mirror of the frontend
 * constants.js defaults) over whatever schedule_templates/template_defaults/
 * template_overrides currently hold, invalidates the config cache, and
 * returns the restored trio. KEEP the response shape
 * `{scheduleTemplates, templateDefaults, templateOverrides}` EXACTLY as-is —
 * 999.2145's Reset button is written against it.
 *
 * Mirrors UpdateConfig's post-response reschedule ordering (step 8 there):
 * returns a `scheduleAfter` directive instead of firing enqueueScheduleRun
 * directly, so the W6 controller fires it AFTER res.json.
 *
 * @typedef {Object} ResetScheduleTemplatesDeps
 * @property {import('../../domain/ports/ConfigRepositoryPort')} repo
 * @property {{invalidateConfig: Function}} cache
 */

'use strict';

var defaultTemplates = require('../../domain/defaultTemplates');

/** @param {ResetScheduleTemplatesDeps} deps */
function ResetScheduleTemplates(deps) {
  if (!deps || !deps.repo || !deps.cache) {
    throw new Error('ResetScheduleTemplates: { repo, cache } are required');
  }
  this.repo = deps.repo;
  this.cache = deps.cache;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @returns {Promise<{ status: number, body: Object, scheduleAfter: {userId: string, source: string} }>}
 */
ResetScheduleTemplates.prototype.execute = async function execute(input) {
  var userId = input.userId;

  var scheduleTemplates = defaultTemplates.buildDefaultScheduleTemplates();
  var templateDefaults = defaultTemplates.buildDefaultTemplateDefaults();
  var templateOverrides = defaultTemplates.buildDefaultTemplateOverrides();

  await this.repo.upsertConfig(userId, 'schedule_templates', JSON.stringify(scheduleTemplates));
  await this.repo.upsertConfig(userId, 'template_defaults', JSON.stringify(templateDefaults));
  await this.repo.upsertConfig(userId, 'template_overrides', JSON.stringify(templateOverrides));

  await this.cache.invalidateConfig(userId);

  return {
    status: 200,
    body: {
      scheduleTemplates: scheduleTemplates,
      templateDefaults: templateDefaults,
      templateOverrides: templateOverrides
    },
    scheduleAfter: { userId: userId, source: 'config:templates_reset' }
  };
};

module.exports = ResetScheduleTemplates;
