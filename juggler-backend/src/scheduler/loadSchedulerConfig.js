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
    toolMatrix: config.tool_matrix || constants.DEFAULT_TOOL_MATRIX,
    locSchedules: config.loc_schedules || {},
    locScheduleDefaults: config.loc_schedule_defaults || {},
    locScheduleOverrides: config.loc_schedule_overrides || {},
    hourLocationOverrides: config.hour_location_overrides || {},
    scheduleTemplates: config.schedule_templates || null,
    preferences: config.preferences || {},
    splitDefault: config.preferences ? config.preferences.splitDefault : undefined,
    splitMinDefault: config.preferences ? config.preferences.splitMinDefault : undefined,
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
    db('user_config').where('user_id', userId).select(),
    db('locations').where('user_id', userId).orderBy('sort_order')
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
