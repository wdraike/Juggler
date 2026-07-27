'use strict';

/**
 * 999.4671 — one-time repair of calendar tasks that provider TRANSPARENCY wrongly
 * demoted to placement_mode='reminder'.
 *
 * ── WHAT WENT WRONG ─────────────────────────────────────────────────────────
 * Until 999.4671, ingest mapped a provider event's free/busy transparency onto
 * placement_mode: `event.isTransparent → PLACEMENT_MODES.REMINDER`
 * (slices/calendar/domain/ingest-event-decision.js), and all three adapters
 * re-applied it on every external-edit pull. Google marks a large class of events
 * `transparency: 'transparent'` ("Free") by default — every all-day event, and the
 * events Gmail auto-creates from confirmation mail (appointments, tickets). A
 * REMINDER is a dur=0 marker in the scheduler ("markers never consume occupancy",
 * unifiedScheduleV2.js buildItems), so those tasks reserved NOTHING and the
 * scheduler placed other work straight over real appointments.
 *
 * Dev-DB evidence (3308, 2026-07-27): five gcal-ingested task_masters rows sat at
 * placement_mode='reminder' with dur 30–60 — e.g. "Appointment at Pulmonary
 * Associates of Richmond" (60m), "telehealth appointment with Dr. Peter Nguyen"
 * (60m), "The Odyssey - The IMAX 2D Experience" (60m) — while `user_calendars` was
 * EMPTY, so calIngestMode defaulted to 'task' and transparency was the sole cause.
 *
 * ── WHAT THIS REPAIRS ───────────────────────────────────────────────────────
 * Provider-ingested masters (id prefixed `gcal_` / `msft_` / `apple_` — the
 * convention decideIngestEvent itself relies on to tell provider-created tasks from
 * Juggler-created ones) that are still REMINDER **and carry a real duration**
 * → 'fixed', so they own their slot again. The code fix alone cannot reach them:
 * with transparency out of the placement path, nothing ever re-evaluates an
 * already-stored placement_mode.
 *
 * Second pass — the all-day residue. Transparency beat the all-day branch in the
 * old ternary, so a transparent all-day event was stored as `when='allday'` AND
 * `placement_mode='reminder'` (e.g. dev-DB `gcal_ef0880c9d57f4545 "Garbage Day"`).
 * That combination is unreachable under the new ingest and leaves the row without
 * all-day treatment downstream (`taskMappers.js` computes the all-day due key only
 * for `placement_mode='all_day'`). `when='allday'` is a precise discriminator — the
 * old all-day ingest path is the only writer of it — so these flip to 'all_day'.
 * Not a double-booking fix (dur=0 either way); a data-consistency one.
 *
 * ── WHAT IT DELIBERATELY LEAVES ALONE ───────────────────────────────────────
 *  - dur = 0 rows that are NOT marked `when='allday'` (genuine point markers):
 *    they consume no grid occupancy either way, so they are not part of the
 *    double-booking defect, and flipping them would be a display change with no
 *    evidence behind it.
 *  - Every task belonging to a user who owns ANY calendar with
 *    ingest_mode='reminder'. For those users "ingest as reminders" is a real
 *    Juggler-side setting, and a stored REMINDER may well be that setting's
 *    intended output rather than the transparency bug's.
 *
 * Residual risk, stated plainly: a user who manually changed a synced task to
 * REMINDER inside Juggler before this migration is indistinguishable in the schema
 * from one the bug demoted (both are just placement_mode='reminder'; the audit
 * columns record the user for sync-driven writes too, since sync runs as the user).
 * Those get flipped to 'fixed' and must be re-set once. Accepted: the alternative
 * is leaving every genuinely double-booked appointment broken forever.
 */

var PROVIDER_PREFIXES = ['gcal\\_%', 'msft\\_%', 'apple\\_%'];

// Shared scope for both passes: provider-ingested masters belonging to a user who
// has NOT opted any calendar into reminder-ingest.
function demotedSyncedTasks(knex) {
  return knex('task_masters')
    .where('placement_mode', 'reminder')
    .where(function () {
      var q = this;
      PROVIDER_PREFIXES.forEach(function (pattern) {
        q.orWhere('id', 'like', pattern);
      });
    })
    .whereNotExists(function () {
      this.select('*')
        .from('user_calendars')
        .whereRaw('user_calendars.user_id = task_masters.user_id')
        .andWhere('user_calendars.ingest_mode', 'reminder');
    });
}

exports.up = async function up(knex) {
  var repaired = await demotedSyncedTasks(knex)
    .where('dur', '>', 0)
    .update({ placement_mode: 'fixed' });

  var allDayRepaired = await demotedSyncedTasks(knex)
    .where('when', 'allday')
    .update({ placement_mode: 'all_day' });

  console.log('[999.4671] repaired ' + repaired + ' transparency-demoted synced task(s) → placement_mode=fixed, '
    + allDayRepaired + ' all-day residue row(s) → placement_mode=all_day');
};

exports.down = async function down() {
  // Irreversible by design: the pre-repair value was 'reminder' for BOTH
  // bug-demoted and (rarely) user-chosen rows, and nothing in the schema records
  // which was which — so a down() that flipped every synced 'fixed'/'all_day'
  // task back to 'reminder' would re-break far more rows than it restored.
  // No-op — note that `migrate:rollback` therefore reports success while leaving
  // this migration's data changes in place.
};
