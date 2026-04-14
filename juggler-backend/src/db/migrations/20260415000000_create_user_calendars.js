/**
 * Create user_calendars table for multi-calendar selection per provider,
 * and add calendar_id column to cal_sync_ledger for multi-calendar tracking.
 */
exports.up = async function(knex) {
  await knex.schema.createTable('user_calendars', function(table) {
    table.increments('id').primary();
    table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('provider', 10).notNullable();              // 'apple', 'gcal', 'msft'
    table.string('calendar_id', 500).notNullable();           // URL for Apple, calendar ID for GCal/MSFT
    table.string('display_name', 255).nullable();
    table.boolean('enabled').notNullable().defaultTo(true);
    table.string('sync_direction', 10).notNullable().defaultTo('full'); // 'full' or 'ingest'
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.unique(['user_id', 'provider', 'calendar_id']);
    table.index(['user_id', 'provider']);
  });

  // Migrate existing Apple calendar selections into user_calendars
  var usersWithApple = await knex('users')
    .whereNotNull('apple_cal_calendar_url')
    .whereNotNull('apple_cal_username')
    .select('id', 'apple_cal_calendar_url');

  if (usersWithApple.length > 0) {
    var rows = usersWithApple.map(function(u) {
      return {
        user_id: u.id,
        provider: 'apple',
        calendar_id: u.apple_cal_calendar_url,
        display_name: null,
        enabled: true,
        sync_direction: 'full'
      };
    });
    await knex('user_calendars').insert(rows);
  }

  // Add calendar_id to cal_sync_ledger for multi-calendar awareness
  var hasLedger = await knex.schema.hasTable('cal_sync_ledger');
  if (hasLedger) {
    await knex.schema.alterTable('cal_sync_ledger', function(table) {
      table.string('calendar_id', 500).nullable().after('provider');
    });
  }
};

exports.down = async function(knex) {
  var hasLedger = await knex.schema.hasTable('cal_sync_ledger');
  if (hasLedger) {
    await knex.schema.alterTable('cal_sync_ledger', function(table) {
      table.dropColumn('calendar_id');
    });
  }

  await knex.schema.dropTableIfExists('user_calendars');
};
