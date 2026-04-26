/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.raw(
    'ALTER TABLE `impersonation_log` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.raw(
    'ALTER TABLE `impersonation_log` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'
  );
};
