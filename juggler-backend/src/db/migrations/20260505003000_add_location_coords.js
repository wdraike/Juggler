/**
 * Add lat, lon, display_name to the locations table so geocoded coordinates
 * and human-readable place names survive page reloads.
 */

exports.up = async function(knex) {
  await knex.raw(
    "ALTER TABLE locations " +
    "  ADD COLUMN lat DECIMAL(9,6) NULL, " +
    "  ADD COLUMN lon DECIMAL(9,6) NULL, " +
    "  ADD COLUMN display_name VARCHAR(255) COLLATE utf8mb4_unicode_ci NULL"
  );
};

exports.down = async function(knex) {
  await knex.raw(
    "ALTER TABLE locations DROP COLUMN lat, DROP COLUMN lon, DROP COLUMN display_name"
  );
};
