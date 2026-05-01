/**
 * Enhance sync_history with calendar_name and trigger_type.
 *
 * calendar_name: which specific calendar within the provider
 *   (e.g. "Juggler" for Apple CalDAV; null for GCal/MSFT primary).
 * trigger_type: how the sync was initiated — 'manual' | 'auto'.
 */
exports.up = async function(knex) {
  var hasCalName = await knex.schema.hasColumn('sync_history', 'calendar_name');
  var hasTrigger = await knex.schema.hasColumn('sync_history', 'trigger_type');
  if (!hasCalName || !hasTrigger) {
    await knex.schema.alterTable('sync_history', function(table) {
      if (!hasCalName) table.string('calendar_name', 255).nullable();
      if (!hasTrigger) table.string('trigger_type', 20).nullable();
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.alterTable('sync_history', function(table) {
    table.dropColumn('calendar_name');
    table.dropColumn('trigger_type');
  });
};
