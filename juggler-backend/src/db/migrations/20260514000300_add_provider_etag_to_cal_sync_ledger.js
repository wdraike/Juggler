/**
 * Add provider_etag to cal_sync_ledger.
 *
 * Apple CalDAV VEVENTs rarely include LAST-MODIFIED, leaving last_modified_at
 * NULL for all Apple rows. CalDAV ETags are always present and change on every
 * server-side edit — using them as the change-detection signal for Apple.
 */

exports.up = async function(knex) {
  await knex.schema.alterTable('cal_sync_ledger', function(table) {
    table.string('provider_etag', 255).nullable().defaultTo(null)
      .collate('utf8mb4_unicode_ci').after('last_modified_at');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('cal_sync_ledger', function(table) {
    table.dropColumn('provider_etag');
  });
};
