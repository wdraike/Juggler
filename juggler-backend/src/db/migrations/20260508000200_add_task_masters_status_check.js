'use strict';

/**
 * Add CHECK constraint on task_masters.status to mirror the one added to
 * task_instances in 20260506000200_add_schema_check_constraints.js.
 *
 * task_instances has: CHECK (status IN ('','wip','done','cancel','skip','pause','disabled'))
 * task_masters was missed in that migration. This closes the gap.
 */
exports.up = async function(knex) {
  // Guard: if constraint already exists, skip (idempotent)
  try {
    await knex.raw(`
      ALTER TABLE task_masters
        ADD CONSTRAINT chk_task_masters_status
          CHECK (status IN ('','wip','done','cancel','skip','pause','disabled') OR status IS NULL)
    `);
  } catch (e) {
    if (e.code === 'ER_DUP_KEYNAME' || (e.message && e.message.includes('Duplicate'))) {
      // Already exists — safe to continue
    } else {
      throw e;
    }
  }
};

exports.down = async function(knex) {
  await knex.raw('ALTER TABLE task_masters DROP CHECK chk_task_masters_status').catch(() => {});
};
