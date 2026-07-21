/**
 * defaultTemplates — server-side SSOT for the schedule-template defaults
 * (999.2144).
 *
 * Prior to this module, the ONLY place default schedule templates existed was
 * `juggler-frontend/src/state/constants.js:144-182` — the backend had no
 * defaults, no repair path, and no reset endpoint. This is a block-for-block
 * mirror of that frontend SSOT (same ids, tags, names, colors, icons, locs,
 * `system:true`) so the backend can self-heal corrupt/missing config
 * (GetConfig.js) and serve a POST /config/templates/reset endpoint
 * (ResetScheduleTemplates.js) without depending on the frontend bundle.
 *
 * PURE: zero infra imports — no db, no fetch, no env. Every export is a
 * FACTORY (build*) that returns a FRESH deep copy on every call — callers
 * persist/mutate the returned object, so a shared module-level singleton
 * would let one caller's mutation leak into another's "default".
 */

'use strict';

function cloneBlocks(blocks) {
  return blocks.map(function (b) { return Object.assign({}, b); });
}

// Verbatim from constants.js:144-151 (DEFAULT_WEEKDAY_BLOCKS).
var WEEKDAY_BLOCKS = [
  { id: 'morning', tag: 'morning', name: 'Morning', start: 360, end: 480, color: '#C8942A', icon: '☀️', loc: 'home' },
  { id: 'biz1', tag: 'biz', name: 'Biz', start: 480, end: 720, color: '#2E4A7A', icon: '💼', loc: 'work' },
  { id: 'lunch', tag: 'lunch', name: 'Lunch', start: 720, end: 780, color: '#2D6A4F', icon: '🍽️', loc: 'work' },
  { id: 'biz2', tag: 'biz', name: 'Biz', start: 780, end: 1020, color: '#2E4A7A', icon: '💼', loc: 'work' },
  { id: 'evening', tag: 'evening', name: 'Evening', start: 1020, end: 1260, color: '#9E6B3B', icon: '🌙', loc: 'home' },
  { id: 'night', tag: 'night', name: 'Night', start: 1260, end: 1380, color: '#475569', icon: '🌑', loc: 'home' }
];

// Verbatim from constants.js:153-158 (DEFAULT_WEEKEND_BLOCKS).
var WEEKEND_BLOCKS = [
  { id: 'morning', tag: 'morning', name: 'Morning', start: 420, end: 720, color: '#C8942A', icon: '☀️', loc: 'home' },
  { id: 'afternoon', tag: 'afternoon', name: 'Afternoon', start: 720, end: 1020, color: '#C8942A', icon: '🌤️', loc: 'home' },
  { id: 'evening', tag: 'evening', name: 'Evening', start: 1020, end: 1260, color: '#9E6B3B', icon: '🌙', loc: 'home' },
  { id: 'night', tag: 'night', name: 'Night', start: 1260, end: 1380, color: '#475569', icon: '🌑', loc: 'home' }
];

/**
 * Verbatim from constants.js:166-177 (DEFAULT_SCHEDULE_TEMPLATES).
 * @returns {Object} a fresh {weekday, weekend} schedule_templates value.
 */
function buildDefaultScheduleTemplates() {
  return {
    weekday: { name: 'Weekday', icon: '🏢', system: true, blocks: cloneBlocks(WEEKDAY_BLOCKS), locOverrides: {} },
    weekend: { name: 'Weekend', icon: '🏠', system: true, blocks: cloneBlocks(WEEKEND_BLOCKS), locOverrides: {} }
  };
}

/**
 * Verbatim from constants.js:179-182 (DEFAULT_TEMPLATE_DEFAULTS).
 * @returns {Object} a fresh Mon..Sun -> templateId map.
 */
function buildDefaultTemplateDefaults() {
  return {
    Mon: 'weekday', Tue: 'weekday', Wed: 'weekday', Thu: 'weekday', Fri: 'weekday',
    Sat: 'weekend', Sun: 'weekend'
  };
}

/**
 * template_overrides has no frontend default constant — the legacy behavior
 * (config.template_overrides || {}) is "empty until the user overrides a
 * specific date", so the default is the empty object.
 * @returns {Object} a fresh empty template_overrides value.
 */
function buildDefaultTemplateOverrides() {
  return {};
}

/**
 * buildFallbackTemplateDefaults — self-heal fallback for `template_defaults`
 * when the canonical 'weekday'/'weekend' default doesn't fit the user's ACTUAL
 * `schedule_templates` ids (999.2144 harrison review FINDING 1 / law-confirmed).
 *
 * `buildDefaultTemplateDefaults()` always references 'weekday'/'weekend'. A
 * user with fully custom template ids (e.g. {work, light} — no 'weekday'/
 * 'weekend' present) has a VALID `schedule_templates` shape, so GetConfig's
 * independent template_defaults heal must not write the literal canonical
 * default: `validateTemplateDefaults(buildDefaultTemplateDefaults(), ['work',
 * 'light'])` would itself be INVALID (every ref unknown) — the very next read
 * re-validates, re-heals, and re-persists, forever: a DB write on every GET,
 * the config cache permanently defeated, and a served `templateDefaults` that
 * references templates the user does not have.
 *
 * This picks a value GUARANTEED to pass `validateTemplateDefaults(healed,
 * knownTemplateIds)`: each weekday slot (Mon-Fri) maps to 'weekday' when that
 * id is present, else the first known id; each weekend slot (Sat/Sun) maps to
 * 'weekend' when present, else the first known id. When both 'weekday' and
 * 'weekend' ARE present this is byte-identical to buildDefaultTemplateDefaults().
 *
 * @param {string[]} knownTemplateIds  MUST be non-empty (schedule_templates is
 *   validated non-empty — validateScheduleTemplates — before this is called).
 * @returns {Object} a fresh Mon..Sun -> templateId map, valid against knownTemplateIds.
 */
function buildFallbackTemplateDefaults(knownTemplateIds) {
  var fallbackId = knownTemplateIds[0];
  var weekdayId = knownTemplateIds.indexOf('weekday') !== -1 ? 'weekday' : fallbackId;
  var weekendId = knownTemplateIds.indexOf('weekend') !== -1 ? 'weekend' : fallbackId;
  return {
    Mon: weekdayId, Tue: weekdayId, Wed: weekdayId, Thu: weekdayId, Fri: weekdayId,
    Sat: weekendId, Sun: weekendId
  };
}

module.exports = {
  buildDefaultScheduleTemplates: buildDefaultScheduleTemplates,
  buildDefaultTemplateDefaults: buildDefaultTemplateDefaults,
  buildDefaultTemplateOverrides: buildDefaultTemplateOverrides,
  buildFallbackTemplateDefaults: buildFallbackTemplateDefaults
};
