'use strict';

exports.up = async function(knex) {
  var exists = await knex.schema.hasTable('sync_history');
  if (!exists) return;
  await knex('sync_history')
    .where('created_at', '<', knex.raw('NOW() - INTERVAL 3 DAY'))
    .del();
};

exports.down = async function(knex) {
  // no-op — data already deleted; cannot restore
};
