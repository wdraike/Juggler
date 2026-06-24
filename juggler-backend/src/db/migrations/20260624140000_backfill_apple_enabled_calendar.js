/**
 * Reconcile Apple calendar sync source-of-truth (999.860).
 *
 * The Apple sync adapter reads enabled rows from user_calendars, falling back to
 * the legacy users.apple_cal_calendar_url only when ZERO rows are enabled. Some
 * users ended up syncing via that legacy fallback while every user_calendars
 * apple row had enabled=0 — so the Calendar Sync modal (which reads
 * user_calendars.enabled) showed all checkboxes unchecked despite Apple actively
 * syncing. This backfill enables the user_calendars row matching the legacy
 * apple_cal_calendar_url for any user who has no apple row enabled, making the
 * two sources agree. user_calendars.enabled becomes the single source of truth.
 *
 * Done in JS (not a single UPDATE…JOIN) to avoid MySQL's "can't self-reference
 * the target table" restriction on the "no other row enabled" guard.
 */
exports.up = async function(knex) {
  var users = await knex('users')
    .whereNotNull('apple_cal_calendar_url')
    .select('id', 'apple_cal_calendar_url');

  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    var anyEnabled = await knex('user_calendars')
      .where({ user_id: u.id, provider: 'apple', enabled: true })
      .first();
    if (anyEnabled) continue; // already has an enabled apple calendar — leave as-is

    await knex('user_calendars')
      .where({ user_id: u.id, provider: 'apple', calendar_id: u.apple_cal_calendar_url })
      .update({ enabled: true, updated_at: knex.fn.now() });
  }
};

// Irreversible by design: we can't know which rows were enabled before the
// backfill. down() is a no-op so a rollback doesn't re-introduce the bug.
exports.down = async function() {};
