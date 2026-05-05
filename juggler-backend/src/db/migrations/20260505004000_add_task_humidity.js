exports.up = async function(knex) {
  await knex.raw(
    "ALTER TABLE task_masters " +
    "  ADD COLUMN weather_humidity_min TINYINT UNSIGNED NULL, " +
    "  ADD COLUMN weather_humidity_max TINYINT UNSIGNED NULL"
  );
};

exports.down = async function(knex) {
  await knex.raw(
    "ALTER TABLE task_masters DROP COLUMN weather_humidity_min, DROP COLUMN weather_humidity_max"
  );
};
