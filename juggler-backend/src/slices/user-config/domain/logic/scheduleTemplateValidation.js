/**
 * scheduleTemplateValidation — PURE shape validators for the schedule-template
 * config trio (999.2144): `schedule_templates`, `template_defaults`,
 * `template_overrides`.
 *
 * Before this module, UpdateConfig guarded only the config key NAME + a 100KB
 * size cap (application/commands/UpdateConfig.js) — any JSON shape landed in
 * these three keys unchecked. Dev-DB evidence: `schedule_templates.weekday.
 * blocks` collapsed to `[{start:0,end:540,tag:'custom',name:'Custom'}]` (no
 * `loc` — the exact field these validators require) and `locOverrides` was
 * wiped, both accepted+persisted without complaint.
 *
 * PURE: zero infra imports — no db, no fetch, no env. Ref-checking against
 * "known template ids" takes the id list as a plain array argument; callers
 * (UpdateConfig, GetConfig) resolve that list from the repository/domain
 * defaults themselves.
 *
 * Each validator returns `{valid: boolean, errors: string[]}` — errors are
 * human-readable, path-prefixed strings suitable for a 400 `details` array.
 */

'use strict';

var WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
var DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Validate the `schedule_templates` config value.
 *
 * Rules: a non-empty plain object of templateId -> template. Each template
 * requires `name` (non-empty string) + `blocks` (array — MAY be empty:
 * juggler-frontend/src/hooks/useConfig.js auto-populates an empty `blocks`
 * array from the weekday defaults on load, so an empty array is a tolerated,
 * self-healing state, not a shape violation). Each block requires `start`/
 * `end` (integers, 0<=start<1440, start<end<=1440), `loc` (non-empty string —
 * MISSING in the dev-DB corruption this ticket evidences), `tag` (non-empty
 * string), `name` (string). Templates may carry optional `icon`/`color`
 * (string), `system` (boolean), `locOverrides` (object), `id` (string).
 *
 * @param {*} value
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateScheduleTemplates(value) {
  var errors = [];
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    return { valid: false, errors: ['schedule_templates must be a non-empty object of templateId -> template'] };
  }

  Object.keys(value).forEach(function (templateId) {
    var tmpl = value[templateId];
    var prefix = 'schedule_templates.' + templateId;

    if (!isPlainObject(tmpl)) {
      errors.push(prefix + ' must be an object');
      return;
    }

    if (!isNonEmptyString(tmpl.name)) {
      errors.push(prefix + '.name must be a non-empty string');
    }

    if (!Array.isArray(tmpl.blocks)) {
      errors.push(prefix + '.blocks must be an array');
    } else {
      tmpl.blocks.forEach(function (block, i) {
        var bprefix = prefix + '.blocks[' + i + ']';
        if (!isPlainObject(block)) {
          errors.push(bprefix + ' must be an object');
          return;
        }
        if (!Number.isInteger(block.start) || block.start < 0 || block.start >= 1440) {
          errors.push(bprefix + '.start must be an integer in [0, 1440)');
        }
        if (!Number.isInteger(block.end) || block.end <= block.start || block.end > 1440) {
          errors.push(bprefix + '.end must be an integer greater than start, up to 1440');
        }
        if (!isNonEmptyString(block.loc)) {
          errors.push(bprefix + '.loc must be a non-empty string');
        }
        if (!isNonEmptyString(block.tag)) {
          errors.push(bprefix + '.tag must be a non-empty string');
        }
        if (typeof block.name !== 'string') {
          errors.push(bprefix + '.name must be a string');
        }
      });
    }

    if (tmpl.locOverrides !== undefined && !isPlainObject(tmpl.locOverrides)) {
      errors.push(prefix + '.locOverrides must be an object when present');
    }
    if (tmpl.icon !== undefined && typeof tmpl.icon !== 'string') {
      errors.push(prefix + '.icon must be a string when present');
    }
    if (tmpl.color !== undefined && typeof tmpl.color !== 'string') {
      errors.push(prefix + '.color must be a string when present');
    }
    if (tmpl.system !== undefined && typeof tmpl.system !== 'boolean') {
      errors.push(prefix + '.system must be a boolean when present');
    }
    if (tmpl.id !== undefined && typeof tmpl.id !== 'string') {
      errors.push(prefix + '.id must be a string when present');
    }
  });

  return { valid: errors.length === 0, errors: errors };
}

/**
 * Validate the `template_defaults` config value: an object with EXACTLY the
 * keys Mon..Sun, each mapping to a templateId (non-empty string). When
 * `knownTemplateIds` is supplied (an array), each templateId must also be a
 * member of it (unknown ref = invalid) — callers resolve that list from the
 * user's STORED `schedule_templates` (or from the value being validated in
 * the same write, if that's the more appropriate source for the call site).
 *
 * @param {*} value
 * @param {?string[]} [knownTemplateIds]
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateTemplateDefaults(value, knownTemplateIds) {
  var errors = [];
  if (!isPlainObject(value)) {
    return { valid: false, errors: ['template_defaults must be an object'] };
  }

  var keys = Object.keys(value);
  var missing = WEEK_DAYS.filter(function (d) { return keys.indexOf(d) === -1; });
  var extra = keys.filter(function (k) { return WEEK_DAYS.indexOf(k) === -1; });
  if (missing.length > 0) {
    errors.push('template_defaults is missing day keys: ' + missing.join(', '));
  }
  if (extra.length > 0) {
    errors.push('template_defaults has unexpected keys: ' + extra.join(', '));
  }

  // Set built ONCE per call (law review INFO, 999.2144) — O(1) membership
  // instead of an indexOf scan per day/date key.
  var knownIdSet = Array.isArray(knownTemplateIds) ? new Set(knownTemplateIds) : null;

  WEEK_DAYS.forEach(function (day) {
    if (!Object.prototype.hasOwnProperty.call(value, day)) return;
    var tid = value[day];
    if (!isNonEmptyString(tid)) {
      errors.push('template_defaults.' + day + ' must be a non-empty templateId string');
      return;
    }
    if (knownIdSet && !knownIdSet.has(tid)) {
      errors.push('template_defaults.' + day + ' references unknown template "' + tid + '"');
    }
  });

  return { valid: errors.length === 0, errors: errors };
}

/**
 * Validate the `template_overrides` config value: an object of YYYY-MM-DD ->
 * templateId (non-empty string). Empty object is valid (no overrides set).
 * When `knownTemplateIds` is supplied, each templateId must be a member of it.
 *
 * @param {*} value
 * @param {?string[]} [knownTemplateIds]
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateTemplateOverrides(value, knownTemplateIds) {
  var errors = [];
  if (!isPlainObject(value)) {
    return { valid: false, errors: ['template_overrides must be an object'] };
  }

  // Set built ONCE per call (law review INFO, 999.2144) — O(1) membership
  // instead of an indexOf scan per day/date key.
  var knownIdSet = Array.isArray(knownTemplateIds) ? new Set(knownTemplateIds) : null;

  Object.keys(value).forEach(function (dateKey) {
    if (!DATE_KEY_RE.test(dateKey)) {
      errors.push('template_overrides key "' + dateKey + '" must be a YYYY-MM-DD date string');
      return;
    }
    var tid = value[dateKey];
    if (!isNonEmptyString(tid)) {
      errors.push('template_overrides.' + dateKey + ' must be a non-empty templateId string');
      return;
    }
    if (knownIdSet && !knownIdSet.has(tid)) {
      errors.push('template_overrides.' + dateKey + ' references unknown template "' + tid + '"');
    }
  });

  return { valid: errors.length === 0, errors: errors };
}

module.exports = {
  validateScheduleTemplates: validateScheduleTemplates,
  validateTemplateDefaults: validateTemplateDefaults,
  validateTemplateOverrides: validateTemplateOverrides
};
