'use strict';

/**
 * Backfill implied_deadline for existing recurring instances (999.879).
 *
 * Pre-condition: implied_deadline column exists (migration 20260621000000).
 *
 * Any existing recurring_instance row with a non-null `date` but NULL
 * `implied_deadline` gets backfilled to `date + 1 day` (end of occurrence
 * day). This matches what recurringPeriodEndKey() at runSchedule.js:321
 * computes for non-flexible-TPC recurrences — the day-locked default where
 * the commitment boundary is the end of the occurrence day.
 *
 * Rolling-interval tasks (e.g. "Get a Haircut" 60-day, "Wash Red Car"
 * 30-day) have their occurrence day as the committed day — no intra-cycle
 * roam window — so implied_deadline = date + 1 day is correct.
 *
 * down() is no-op: re-NULLing the column would lose data; the original
 * NULL state was never contractually meaningful.
 */

exports.up = async function up(knex) {
  await knex.raw(`
    UPDATE task_instances
    SET implied_deadline = DATE_ADD(\`date\`, INTERVAL 1 DAY)
    WHERE implied_deadline IS NULL
      AND \`date\` IS NOT NULL
  `);
};

exports.down = async function down(knex) {
  // No-op — reverting to NULL would orphan the implied_deadline contract.
  // The original NULL state was never semantically meaningful.
};