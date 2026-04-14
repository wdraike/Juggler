/**
 * Create `tasks_with_sync_v` — tasks_v extended with calendar event IDs
 * sourced from `cal_sync_ledger`.
 *
 * The base `tasks_v` returns NULL for `gcal_event_id` / `msft_event_id` /
 * `apple_event_id` because those columns are deprecated on the `tasks` table;
 * the authoritative sync state lives in `cal_sync_ledger` keyed by (task_id,
 * provider). This view LEFT JOINs one aggregate per provider so readers that
 * need event IDs (cal-sync controllers, ingest-mode delete guards) can migrate
 * without regressing.
 *
 * Known drift at time of creation: 10 `tasks` rows (5 gcal + 5 msft) have a
 * non-null event_id on the row but NO matching active ledger entry. This view
 * reports NULL for those — they appear non-linked when read through the view.
 * Cal-sync's own reconciliation (outside this refactor) needs to either
 * recreate the ledger rows or clear the drifted task columns.
 *
 * Ledger aggregation: duplicates within (task_id, provider, status='active')
 * exist but carry the same `provider_event_id`, so ANY_VALUE is safe.
 */
exports.up = async function(knex) {
  await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
  await knex.raw(`
    CREATE VIEW tasks_with_sync_v AS
    SELECT
      v.id, v.task_type, v.user_id, v.text, v.date_pinned, v.scheduled_at,
      v.desired_at, v.desired_date, v.dur, v.time_remaining, v.pri, v.project,
      v.status, v.section, v.notes, v.due_at, v.start_after_at, v.location,
      v.tools, v.\`when\`, v.day_req, v.recurring, v.rigid, v.time_flex,
      v.split, v.split_min, v.recur, v.source_id, v.\`generated\`,
      gcl.provider_event_id AS gcal_event_id,
      v.depends_on, v.created_at, v.updated_at,
      mcl.provider_event_id AS msft_event_id,
      v.marker, v.flex_when, v.travel_before, v.travel_after, v.tz,
      v.recur_start, v.recur_end, v.disabled_at, v.disabled_reason, v.prev_when,
      v.preferred_time, v.unscheduled, v.preferred_time_mins,
      acl.provider_event_id AS apple_event_id
    FROM tasks_v v
    LEFT JOIN (
      SELECT task_id, ANY_VALUE(provider_event_id) AS provider_event_id
      FROM cal_sync_ledger
      WHERE status = 'active' AND provider = 'gcal' AND task_id IS NOT NULL
      GROUP BY task_id
    ) gcl ON gcl.task_id = v.id
    LEFT JOIN (
      SELECT task_id, ANY_VALUE(provider_event_id) AS provider_event_id
      FROM cal_sync_ledger
      WHERE status = 'active' AND provider = 'msft' AND task_id IS NOT NULL
      GROUP BY task_id
    ) mcl ON mcl.task_id = v.id
    LEFT JOIN (
      SELECT task_id, ANY_VALUE(provider_event_id) AS provider_event_id
      FROM cal_sync_ledger
      WHERE status = 'active' AND provider = 'apple' AND task_id IS NOT NULL
      GROUP BY task_id
    ) acl ON acl.task_id = v.id
  `);
};

exports.down = async function(knex) {
  await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
};
