exports.up = function(knex) {
  return knex.schema.table('cal_sync_ledger', function(t) {
    // Stores a hash of user-editable task fields only (text, when, project, marker, notes, url).
    // Excludes scheduler-controlled fields (date, time, dur, status) so that the scheduler
    // rescheduling a task between syncs does not incorrectly trigger the tasksNeedingReCreate
    // path. NULL on legacy rows — the miss-count re-push path is suppressed until this is set.
    t.string('last_user_hash', 32).nullable().after('last_pushed_hash');
  });
};

exports.down = function(knex) {
  return knex.schema.table('cal_sync_ledger', function(t) {
    t.dropColumn('last_user_hash');
  });
};
