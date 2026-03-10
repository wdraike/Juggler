/**
 * Add msft_cal_sync_ledger table for Microsoft Calendar bidirectional sync
 */
exports.up = function(knex) {
  return knex.schema.createTable('msft_cal_sync_ledger', function(table) {
    table.increments('id').primary();
    table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('task_id', 100).nullable();
    table.string('msft_event_id', 255).nullable();
    table.string('origin', 10).notNullable().defaultTo('juggler');
    table.string('last_pushed_hash', 32).nullable();
    table.string('last_pulled_hash', 32).nullable();
    table.string('msft_summary', 1000).nullable();
    table.string('msft_start', 50).nullable();
    table.string('msft_end', 50).nullable();
    table.boolean('msft_all_day').defaultTo(false);
    table.string('status', 20).notNullable().defaultTo('active');
    table.timestamp('synced_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('user_id');
    table.index('task_id');
    table.index('msft_event_id');
    table.index('status');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('msft_cal_sync_ledger');
};
