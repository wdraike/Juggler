/**
 * Clean up time mode fields on existing tasks.
 * Time Window tasks (preferred_time=1) should not have when/split/split_min/flex_when.
 * Time Block tasks (preferred_time=0 or null) should not have time_flex.
 */
exports.up = async function(knex) {
  // Time Window tasks: clear time-block-only fields
  var windowCleared = await knex('tasks')
    .where('preferred_time', 1)
    .where(function() {
      this.whereNotNull('when')
        .orWhereNotNull('split')
        .orWhereNotNull('split_min')
        .orWhereNotNull('flex_when');
    })
    .update({ when: null, split: null, split_min: null, flex_when: null });

  if (windowCleared > 0) {
    console.log('[MIGRATION] cleared block fields on ' + windowCleared + ' Time Window tasks');
  }

  // Time Block tasks: clear time-window-only fields
  var blockCleared = await knex('tasks')
    .where(function() {
      this.where('preferred_time', 0).orWhereNull('preferred_time');
    })
    .whereNotNull('time_flex')
    .update({ time_flex: null });

  if (blockCleared > 0) {
    console.log('[MIGRATION] cleared time_flex on ' + blockCleared + ' Time Block tasks');
  }
};

exports.down = function(knex) {
  // Cannot restore values — this is a one-way data cleanup
  return Promise.resolve();
};
