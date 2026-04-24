/**
 * Drop legacy per-provider sync tables.
 *
 * The unified `cal_sync_ledger` (migration 20260315000000) has replaced
 * `gcal_sync_ledger` and `msft_cal_sync_ledger`. All data was migrated into
 * the unified table when it was created, and no live code references the
 * legacy tables anymore — verified by a repo-wide search (2026-04-26):
 * the only references remaining are inside the creation migrations' own
 * down() bodies.
 *
 * `gcal_deleted_events` tracked Google event tombstones for a pre-unified
 * reconciliation path and is also unreferenced by live code.
 *
 * down() is a best-effort restore of empty tables — data cannot be recovered.
 */
exports.up = async function(knex) {
  await knex.schema.dropTableIfExists('gcal_sync_ledger');
  await knex.schema.dropTableIfExists('msft_cal_sync_ledger');
  await knex.schema.dropTableIfExists('gcal_deleted_events');
};

exports.down = async function(knex) {
  var hasGcalLedger = await knex.schema.hasTable('gcal_sync_ledger');
  if (!hasGcalLedger) {
    await knex.schema.createTable('gcal_sync_ledger', function(table) {
      table.increments('id').primary();
      table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('task_id', 100).nullable();
      table.string('gcal_event_id', 255).nullable();
      table.string('origin', 10).notNullable().defaultTo('juggler');
      table.string('last_pushed_hash', 32).nullable();
      table.string('last_pulled_hash', 32).nullable();
      table.string('gcal_summary', 1000).nullable();
      table.string('gcal_start', 50).nullable();
      table.string('gcal_end', 50).nullable();
      table.boolean('gcal_all_day').defaultTo(false);
      table.string('status', 20).notNullable().defaultTo('active');
      table.timestamp('synced_at').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  var hasMsftLedger = await knex.schema.hasTable('msft_cal_sync_ledger');
  if (!hasMsftLedger) {
    await knex.schema.createTable('msft_cal_sync_ledger', function(table) {
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
    });
  }

  var hasDeleted = await knex.schema.hasTable('gcal_deleted_events');
  if (!hasDeleted) {
    await knex.schema.createTable('gcal_deleted_events', function(table) {
      table.increments('id').primary();
      table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('gcal_event_id', 255).notNullable();
      table.timestamp('deleted_at').defaultTo(knex.fn.now());
    });
  }
};
