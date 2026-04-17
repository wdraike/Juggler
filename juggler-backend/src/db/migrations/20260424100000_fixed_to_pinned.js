/**
 * Migrate when:'fixed' → datePinned:1.
 * Sets date_pinned=1 on all instances whose master has when containing 'fixed'.
 * Strips 'fixed' from the master's when field (restores to empty or remaining tags).
 */
exports.up = async function(knex) {
  // Find masters with 'fixed' in when
  var masters = await knex('task_masters').where('when', 'like', '%fixed%').select('id', 'when');
  if (masters.length === 0) return;

  var masterIds = masters.map(function(m) { return m.id; });

  // Set date_pinned on all their instances
  await knex('task_instances').whereIn('master_id', masterIds).update({ date_pinned: 1 });

  // Strip 'fixed' from when on masters
  for (var i = 0; i < masters.length; i++) {
    var m = masters[i];
    var parts = (m.when || '').split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s && s !== 'fixed'; });
    await knex('task_masters').where('id', m.id).update({ when: parts.join(',') });
  }

  console.log('[MIGRATION] fixed→pinned: updated ' + masterIds.length + ' masters, set date_pinned on their instances');
};

exports.down = async function(knex) {
  // Reverse: find masters that were changed (date_pinned instances without 'fixed' in when)
  // This is lossy — we can't perfectly reverse which masters had 'fixed'
  console.log('[MIGRATION] fixed→pinned down: manual review needed');
};
