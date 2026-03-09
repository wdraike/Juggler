/**
 * Normalize priority values: "1" → "P1", "2" → "P2", etc.
 */
exports.up = function(knex) {
  return knex.raw("UPDATE tasks SET pri = CONCAT('P', pri) WHERE pri REGEXP '^[1-4]$'");
};

exports.down = function(knex) {
  // No-op: P1-P4 format is the canonical form
  return Promise.resolve();
};
