'use strict';

/**
 * One-time purge of sync_history rows older than 7 days.
 * Clears the ~1M row backlog that accumulated without a retention policy.
 * Future pruning is handled inline at end of each sync run (D-13 in cal-sync.controller.js).
 */

exports.up = async function(knex) {
  var exists = await knex.schema.hasTable('sync_history');
  if (!exists) return;
  await knex('sync_history')
    .where('created_at', '<', knex.raw('NOW() - INTERVAL 7 DAY'))
    .del();
};

exports.down = async function(knex) {
  // no-op — data already deleted; cannot restore
};
