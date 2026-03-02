/**
 * Add gcal_sync_ledger table, seed from existing tasks, drop gcal_deleted_events
 */

exports.up = async function(knex) {
  // 1. Create the ledger table
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

    table.index('user_id');
    table.index('task_id');
    table.index('gcal_event_id');
    table.index('status');
  });

  // 2. Seed from existing tasks that have gcal_event_id
  var tasks = await knex('tasks').whereNotNull('gcal_event_id').select(
    'id', 'user_id', 'gcal_event_id', 'text', 'date', 'time', 'dur', 'when'
  );

  if (tasks.length > 0) {
    var rows = tasks.map(function(t) {
      // Determine origin: gcal_* prefix means it came from GCal, otherwise from Juggler
      var origin = (t.id && t.id.startsWith('gcal_')) ? 'gcal' : 'juggler';

      return {
        user_id: t.user_id,
        task_id: t.id,
        gcal_event_id: t.gcal_event_id,
        origin: origin,
        gcal_summary: t.text,
        gcal_all_day: t.when === 'allday' ? 1 : 0,
        status: 'active',
        synced_at: knex.fn.now(),
        created_at: knex.fn.now()
      };
    });

    // Insert in chunks
    var chunkSize = 100;
    for (var i = 0; i < rows.length; i += chunkSize) {
      await knex('gcal_sync_ledger').insert(rows.slice(i, i + chunkSize));
    }
  }

  // 3. Drop the old gcal_deleted_events table
  await knex.schema.dropTableIfExists('gcal_deleted_events');
};

exports.down = async function(knex) {
  // Recreate gcal_deleted_events
  await knex.schema.createTable('gcal_deleted_events', function(table) {
    table.increments('id').primary();
    table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('gcal_event_id', 255).notNullable();
    table.timestamp('deleted_at').defaultTo(knex.fn.now());
    table.index('user_id');
  });

  // Drop ledger
  await knex.schema.dropTableIfExists('gcal_sync_ledger');
};
