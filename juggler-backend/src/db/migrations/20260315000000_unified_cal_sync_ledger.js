/**
 * Create unified cal_sync_ledger table and migrate data from
 * gcal_sync_ledger and msft_cal_sync_ledger.
 * Old tables are kept for backward compatibility (dropped in a later migration).
 */
exports.up = async function(knex) {
  // 1. Create the unified ledger table
  await knex.schema.createTable('cal_sync_ledger', function(table) {
    table.increments('id').primary();
    table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('provider', 10).notNullable();           // 'gcal', 'msft', 'apple', etc.
    table.string('task_id', 100).nullable();
    table.string('provider_event_id', 255).nullable();
    table.string('origin', 10).notNullable().defaultTo('juggler');
    table.string('last_pushed_hash', 32).nullable();
    table.string('last_pulled_hash', 32).nullable();
    table.string('event_summary', 1000).nullable();
    table.string('event_start', 50).nullable();
    table.string('event_end', 50).nullable();
    table.boolean('event_all_day').defaultTo(false);
    table.timestamp('last_modified_at').nullable();        // provider's lastModified
    table.timestamp('task_updated_at').nullable();          // task's updated_at at sync
    table.string('status', 20).notNullable().defaultTo('active');
    table.timestamp('synced_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('user_id');
    table.index(['user_id', 'provider']);
    table.index('task_id');
    table.index('provider_event_id');
    table.index('status');
  });

  // 2. Migrate data from gcal_sync_ledger
  var hasGcal = await knex.schema.hasTable('gcal_sync_ledger');
  if (hasGcal) {
    var gcalRows = await knex('gcal_sync_ledger').select();
    if (gcalRows.length > 0) {
      var mapped = gcalRows.map(function(r) {
        return {
          user_id: r.user_id,
          provider: 'gcal',
          task_id: r.task_id,
          provider_event_id: r.gcal_event_id,
          origin: r.origin,
          last_pushed_hash: r.last_pushed_hash,
          last_pulled_hash: r.last_pulled_hash,
          event_summary: r.gcal_summary,
          event_start: r.gcal_start,
          event_end: r.gcal_end,
          event_all_day: r.gcal_all_day,
          status: r.status,
          synced_at: r.synced_at,
          created_at: r.created_at
        };
      });
      var chunkSize = 100;
      for (var i = 0; i < mapped.length; i += chunkSize) {
        await knex('cal_sync_ledger').insert(mapped.slice(i, i + chunkSize));
      }
    }
  }

  // 3. Migrate data from msft_cal_sync_ledger
  var hasMsft = await knex.schema.hasTable('msft_cal_sync_ledger');
  if (hasMsft) {
    var msftRows = await knex('msft_cal_sync_ledger').select();
    if (msftRows.length > 0) {
      var mapped2 = msftRows.map(function(r) {
        return {
          user_id: r.user_id,
          provider: 'msft',
          task_id: r.task_id,
          provider_event_id: r.msft_event_id,
          origin: r.origin,
          last_pushed_hash: r.last_pushed_hash,
          last_pulled_hash: r.last_pulled_hash,
          event_summary: r.msft_summary,
          event_start: r.msft_start,
          event_end: r.msft_end,
          event_all_day: r.msft_all_day,
          status: r.status,
          synced_at: r.synced_at,
          created_at: r.created_at
        };
      });
      var chunkSize2 = 100;
      for (var j = 0; j < mapped2.length; j += chunkSize2) {
        await knex('cal_sync_ledger').insert(mapped2.slice(j, j + chunkSize2));
      }
    }
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('cal_sync_ledger');
};
