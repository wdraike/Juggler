/**
 * Single scheduler-config loader (999.1187).
 *
 * user_config load + parse + scheduler-cfg assembly used to exist in FOUR
 * independent copies with key-case drift: runSchedule.js loadConfig and
 * mcp/tools/config.js get_config read the real snake_case DB keys
 * (config.time_blocks, config.tool_matrix, …) while schedulerSession.js and
 * schedule.routes.js copies read camelCase keys (cfg.timeBlocks, …) that never
 * exist in user_config — so the stepper/debug paths silently ran on
 * DEFAULT_TIME_BLOCKS / DEFAULT_TOOL_MATRIX for every request.
 *
 * This module is the ONE loader (assembly semantics = the live scheduler's
 * previous runSchedule.js loadConfig, moved verbatim). Consumers:
 *   - src/scheduler/runSchedule.js       (loadConfig alias)
 *   - src/scheduler/schedulerSession.js  (stepper)
 *   - src/routes/schedule.routes.js      (POST /api/schedule/debug)
 *   - src/mcp/tools/config.js get_config exposes a different response shape and
 *     still parses rows itself (its keys are already snake_case-correct);
 *     migrating it onto parseUserConfigRows is a follow-up owned by the MCP
 *     surface.
 *
 * The `DEFAULT_*` / `|| {}` assembly defaults are config-absence defaults
 * (user has not configured the setting yet), not silent data fallbacks —
 * unchanged from the pre-consolidation live scheduler behavior.
 */

var db = require('../db');
var constants = require('./constants');
// H7 (JUG-SCHEDULER-LEGACY-DB-BYPASS / 999.1532): the user_config/locations
// reads route through the EXISTING ScheduleRepositoryPort methods
// (getUserConfigRows/getLocations — added in 999.1193, already byte-identical
// to these two queries) via RunScheduleCommand, instead of a new port.
var RunScheduleCommand = require('../slices/scheduler/application/RunScheduleCommand');
var _runScheduleCommand = new RunScheduleCommand();

/**
 * Parse raw user_config rows into a {config_key: parsedValue} map.
 * JSON parse is STRICT (the live scheduler's semantics): a corrupt
 * config_value throws rather than silently degrading to a raw string.
 */
function parseUserConfigRows(rows) {
  var config = {};
  rows.forEach(function(row) {
    var val = typeof row.config_value === 'string'
      ? JSON.parse(row.config_value) : row.config_value;
    config[row.config_key] = val;
  });
  return config;
}

/**
 * Assemble the scheduler cfg object from a parsed user_config map (+ locations).
 * Reads the snake_case DB keys — the only key spelling that exists in
 * user_config (see tests seeding config_key 'time_blocks' / 'tool_matrix').
 */
function assembleSchedulerCfg(config, locations) {
  return {
    timeBlocks: config.time_blocks || constants.DEFAULT_TIME_BLOCKS,
    // 999.1599 (harrison review, 2026-07-15): a present-but-EMPTY tool_matrix
    // ('{}' — no location keys at all) is truthy in JS, so the plain `||`
    // idiom above (correct for absent/null/undefined) silently skipped the
    // default here — the ONE case this function's own doc comment says
    // should NOT happen ("config-absence defaults... not silent data
    // fallbacks"). An empty object has no distinguishable "explicitly
    // cleared by the user" signal anywhere in the write path (UpdateConfig
    // validates keys/size only, never tool_matrix semantics; ImportData.js:113
    // writes '{}' whenever import data carries no toolMatrix at all) — so
    // there is no real state to preserve by treating it specially; both
    // "row absent" and "row present but empty" mean the same thing
    // ("nothing configured yet") and both must fall back to the default.
    // Root cause of the "Submit Weekly UI Claim" dev-DB repro (999.1599):
    // tool_matrix persisted as '{}' for that user, so EVERY tool lookup
    // (at every location, not just 'home') failed — DEFAULT_TOOL_MATRIX
    // owns 'phone' at home/work/transit/downtown/gym, so falling back
    // correctly resolves the reported symptom outright.
    toolMatrix: (config.tool_matrix && Object.keys(config.tool_matrix).length > 0)
      ? config.tool_matrix
      : constants.DEFAULT_TOOL_MATRIX,
    locSchedules: config.loc_schedules || {},
    locScheduleDefaults: config.loc_schedule_defaults || {},
    locScheduleOverrides: config.loc_schedule_overrides || {},
    hourLocationOverrides: config.hour_location_overrides || {},
    scheduleTemplates: config.schedule_templates || null,
    // 999.2161: the canonical trio's other two members (999.2146) — day
    // assignment (`template_defaults`, Mon..Sun -> templateId) and
    // date-specific exceptions (`template_overrides`, YYYY-MM-DD ->
    // templateId). Previously assembled cfg carried scheduleTemplates but
    // NOT these two, so getBlocksForDate could only resolve a templateId via
    // the legacy locScheduleOverrides field (kept content-identical to
    // templateOverrides by the frontend's dual-write) and never consulted
    // templateDefaults at all — day-assignment edits only reached the
    // scheduler via the frontend pre-resolving them into the legacy
    // time_blocks row on every save. Same absence-default pattern as
    // scheduleTemplates above (`|| null`, not `|| {}` — getBlocksForDate
    // treats a present-but-empty map as "no override/default for this
    // key", identical to absent).
    templateDefaults: config.template_defaults || null,
    templateOverrides: config.template_overrides || null,
    preferences: config.preferences || {},
    splitDefault: config.preferences ? config.preferences.splitDefault : undefined,
    splitMinDefault: config.preferences ? config.preferences.splitMinDefault : undefined,
    // Per-user scheduler day bounds (999.1223) — minutes since midnight;
    // undefined = hardwired GRID_START/GRID_END defaults in unifiedScheduleV2.
    schedFloor: config.preferences ? config.preferences.schedFloor : undefined,
    schedCeiling: config.preferences ? config.preferences.schedCeiling : undefined,
    locations: locations
  };
}

/**
 * Load user config values from DB and assemble into scheduler cfg object.
 *
 * user_config holds JSON-blob settings (time_blocks, preferences, etc).
 * The `locations` user setting lives in its own table (matching the
 * shape exposed by getAllConfig in config.controller.js); the scheduler
 * needs lat/lon from there to load weather forecasts for weather-constrained
 * tasks. Reading `config.locations` from user_config silently produced an
 * empty array, which made `loadWeatherForHorizon` skip and weatherOk
 * fail-open for every weather-constrained task.
 */
async function loadSchedulerConfig(userId) {
  var [rows, locRows] = await Promise.all([
    _runScheduleCommand.getUserConfigRows(db, userId),
    _runScheduleCommand.getLocations(db, userId)
  ]);
  return buildSchedulerCfg(rows, locRows);
}

/**
 * Pure rows→cfg assembly (H7, 999.1193): parse raw user_config rows + map raw
 * locations rows and assemble the scheduler cfg. No DB access — callers that
 * fetch the rows through ScheduleRepositoryPort (runSchedule.js) share the
 * EXACT same parse/map/assembly as the db-backed loadSchedulerConfig above.
 */
function buildSchedulerCfg(rows, locRows) {
  var config = parseUserConfigRows(rows);

  var locations = locRows.map(function(l) {
    return {
      id: l.location_id,
      name: l.name,
      icon: l.icon,
      lat: l.lat != null ? parseFloat(l.lat) : undefined,
      lon: l.lon != null ? parseFloat(l.lon) : undefined,
      displayName: l.display_name || undefined
    };
  });

  return assembleSchedulerCfg(config, locations);
}

module.exports = {
  loadSchedulerConfig: loadSchedulerConfig,
  buildSchedulerCfg: buildSchedulerCfg,
  parseUserConfigRows: parseUserConfigRows,
  assembleSchedulerCfg: assembleSchedulerCfg
};
