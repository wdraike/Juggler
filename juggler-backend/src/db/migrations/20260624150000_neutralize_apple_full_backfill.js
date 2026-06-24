/**
 * Neutralize the 999.860 backfill push-activation footgun.
 *
 * 20260624140000 enabled the user_calendars apple row matching the legacy
 * apple_cal_calendar_url to fix a DISPLAY bug — but left sync_direction as-is
 * (typically 'full'), which turned the display fix into an active PUSH target.
 * On dev this pushed ~120 juggler tasks to a SHARED Family calendar before it was
 * caught. A display fix must NEVER activate a write/push.
 *
 * This migration downgrades exactly the calendar that backfill enabled — the
 * apple row that is enabled + full-sync + matches the user's legacy
 * apple_cal_calendar_url — to 'ingest' (read-only). The calendar stays ENABLED
 * (so the Calendar Sync modal still shows it checked — the original 860 intent),
 * but can never push: the push path selects only (enabled=true AND
 * sync_direction='full'). Push must be an explicit UI choice, never inferred from
 * a backfill.
 *
 * Scoped to the legacy-matching row only, so a calendar a user explicitly set to
 * full-push (a different calendar_id) is untouched. JS per-user to avoid a MySQL
 * self-join on the target table.
 */
exports.up = async function(knex) {
  var users = await knex('users')
    .whereNotNull('apple_cal_calendar_url')
    .select('id', 'apple_cal_calendar_url');

  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    await knex('user_calendars')
      .where({
        user_id: u.id,
        provider: 'apple',
        calendar_id: u.apple_cal_calendar_url,
        enabled: true,
        sync_direction: 'full'
      })
      .update({ sync_direction: 'ingest', updated_at: knex.fn.now() });
  }
};

// Irreversible by design: the pre-state (full) was the bug. down() is a no-op so
// a rollback never re-arms the push footgun.
exports.down = async function() {};
