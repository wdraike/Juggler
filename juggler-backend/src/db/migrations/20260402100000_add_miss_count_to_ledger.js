/**
 * Add miss_count column to cal_sync_ledger.
 *
 * Used to prevent premature task deletion when a provider's calendarView
 * transiently fails to return an event. The sync engine increments miss_count
 * each time an expected event is absent; only after MISS_THRESHOLD consecutive
 * misses is the task actually deleted. A successful fetch resets the counter.
 */

exports.up = async function(knex) {
  await knex.schema.alterTable('cal_sync_ledger', function(table) {
    table.integer('miss_count').notNullable().defaultTo(0).after('status');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('cal_sync_ledger', function(table) {
    table.dropColumn('miss_count');
  });
};
