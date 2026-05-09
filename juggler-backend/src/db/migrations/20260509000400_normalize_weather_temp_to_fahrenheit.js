/**
 * Normalize all stored weather temperature constraints to Fahrenheit.
 *
 * Internal storage and scheduler decisions are F-only going forward.
 * The user's display preference (C/F) is a UI concern handled via
 * user_config.temp_unit_pref and frontend conversion at render time.
 *
 * Steps:
 *   1. Convert any rows with weather_temp_unit='C' to F (val * 9/5 + 32).
 *   2. Set weather_temp_unit='F' for every row that has any temp value
 *      (handles legacy NULL unit rows that were entered through the F-default UI).
 */

exports.up = async function(knex) {
  // 1. C → F conversion (round to nearest int; column is SMALLINT)
  await knex.raw(
    "UPDATE task_masters " +
    "SET " +
    "  weather_temp_min = CASE WHEN weather_temp_min IS NOT NULL THEN ROUND(weather_temp_min * 9 / 5 + 32) ELSE NULL END, " +
    "  weather_temp_max = CASE WHEN weather_temp_max IS NOT NULL THEN ROUND(weather_temp_max * 9 / 5 + 32) ELSE NULL END, " +
    "  weather_temp_unit = 'F' " +
    "WHERE weather_temp_unit = 'C'"
  );

  // 2. Backfill unit='F' for any row carrying temp values without an explicit unit
  await knex.raw(
    "UPDATE task_masters " +
    "SET weather_temp_unit = 'F' " +
    "WHERE weather_temp_unit IS NULL " +
    "  AND (weather_temp_min IS NOT NULL OR weather_temp_max IS NOT NULL)"
  );
};

exports.down = async function() {
  // No-op: the original mixed-unit state is not safely recoverable
  // (we cannot tell which rows were originally entered in C without history).
};
