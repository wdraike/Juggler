/**
 * Clean up time mode fields on existing tasks.
 * Time Window tasks (preferred_time=1): split/split_min/flex_when are irrelevant.
 *   (when and time_flex ARE relevant — when carries the anchor tag, time_flex is the window)
 * Time Block tasks (preferred_time=0 or null): time_flex is irrelevant.
 */
exports.up = async function(knex) {
  // Time Window tasks: clear split/split_min/flex_when (block-only fields)
  var windowCleared = await knex('tasks')
    .where('preferred_time', 1)
    .where(function() {
      this.whereNotNull('split')
        .orWhereNotNull('split_min')
        .orWhereNotNull('flex_when');
    })
    .update({ split: null, split_min: null, flex_when: null });

  if (windowCleared > 0) {
    console.log('[MIGRATION] cleared block-only fields on ' + windowCleared + ' Time Window tasks');
  }

  // Time Block tasks: clear time_flex (window-only field)
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
