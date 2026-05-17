/**
 * Add event_url to cal_sync_ledger so the frontend can deep-link directly
 * to the event in the provider's calendar app (GCal htmlLink, MSFT webLink).
 * Apple CalDAV has no web URL so that column stays NULL for apple rows.
 */
exports.up = async function(knex) {
  await knex.schema.table('cal_sync_ledger', function(t) {
    t.string('event_url', 1000).nullable().after('provider_etag');
  });
};

exports.down = async function(knex) {
  await knex.schema.table('cal_sync_ledger', function(t) {
    t.dropColumn('event_url');
  });
};
