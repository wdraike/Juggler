/**
 * Populate source_id on habit instances (dh*, rc_*) by matching to their
 * source templates. Templates can have any prefix (ht_*, qa_*, etc.) —
 * they're identified as habits with recur config that aren't instances.
 */
exports.up = async function(knex) {
  // Find all habit templates (have recur config, not dh*/rc_* instances)
  var allHabits = await knex('tasks')
    .where('habit', 1)
    .whereNotNull('recur')
    .select('id', 'text', 'user_id', 'recur');

  var templates = allHabits.filter(function(t) {
    var id = String(t.id);
    if (id.indexOf('dh') === 0 || id.indexOf('rc_') === 0) return false;
    var recur = typeof t.recur === 'string' ? JSON.parse(t.recur || 'null') : t.recur;
    return recur && recur.type && recur.type !== 'none';
  });

  if (templates.length === 0) return;

  // Build lookup: user_id + text -> template id
  var lookup = {};
  templates.forEach(function(t) {
    var key = t.user_id + '|' + t.text;
    if (!lookup[key]) lookup[key] = t.id;
  });

  // Find all instances (dh*, rc_*) without source_id
  var instances = await knex('tasks')
    .where('habit', 1)
    .whereNull('source_id')
    .where(function() {
      this.where('id', 'like', 'dh%').orWhere('id', 'like', 'rc_%');
    })
    .select('id', 'text', 'user_id');

  var updated = 0;
  for (var i = 0; i < instances.length; i++) {
    var inst = instances[i];
    var key = inst.user_id + '|' + inst.text;
    var sourceId = lookup[key];
    if (sourceId) {
      await knex('tasks').where('id', inst.id).update({ source_id: sourceId });
      updated++;
    }
  }

  if (updated > 0) {
    console.log('[MIGRATION] populated source_id on ' + updated + ' habit instances');
  }
};

exports.down = async function(knex) {
  await knex('tasks')
    .where('habit', 1)
    .where(function() {
      this.where('id', 'like', 'dh%').orWhere('id', 'like', 'rc_%');
    })
    .update({ source_id: null });
};
