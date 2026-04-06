/**
 * Migrate all task IDs to UUIDv7 format.
 * - Replaces arbitrary IDs (ht_*, ts*, rc_*, qa_*, etc.) with UUIDv7
 * - Updates source_id references (instances → templates)
 * - Updates depends_on JSON arrays
 * - Preserves all relationships
 */
var { v7: uuidv7 } = require('uuid');

exports.up = async function(knex) {
  // 1. Build ID mapping: oldId → newId
  var allTasks = await knex('tasks').select('id', 'source_id', 'depends_on', 'task_type');
  var idMap = {};
  var alreadyUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  allTasks.forEach(function(t) {
    if (alreadyUuid.test(t.id)) {
      idMap[t.id] = t.id; // already UUIDv7, keep as-is
    } else {
      idMap[t.id] = uuidv7();
    }
  });

  var needsRemap = allTasks.filter(function(t) { return idMap[t.id] !== t.id; });
  if (needsRemap.length === 0) {
    console.log('[MIGRATION] All IDs already UUIDv7, nothing to do');
    return;
  }
  console.log('[MIGRATION] Remapping ' + needsRemap.length + ' task IDs to UUIDv7');

  // 2. Temporarily disable FK checks for the batch update
  await knex.raw('SET FOREIGN_KEY_CHECKS = 0');

  try {
    // 3. Update IDs in batches (must update source_id and depends_on first to avoid FK issues)
    // Phase A: Update source_id references
    for (var i = 0; i < allTasks.length; i++) {
      var t = allTasks[i];
      if (t.source_id && idMap[t.source_id] && idMap[t.source_id] !== t.source_id) {
        await knex('tasks').where('id', t.id).update({ source_id: idMap[t.source_id] });
      }
    }
    console.log('[MIGRATION] Updated source_id references');

    // Phase B: Update depends_on JSON arrays
    for (var j = 0; j < allTasks.length; j++) {
      var t2 = allTasks[j];
      if (!t2.depends_on) continue;
      var deps;
      try { deps = typeof t2.depends_on === 'string' ? JSON.parse(t2.depends_on) : t2.depends_on; }
      catch(e) { continue; }
      if (!Array.isArray(deps) || deps.length === 0) continue;

      var changed = false;
      var newDeps = deps.map(function(depId) {
        if (idMap[depId] && idMap[depId] !== depId) { changed = true; return idMap[depId]; }
        return depId;
      });
      if (changed) {
        await knex('tasks').where('id', t2.id).update({ depends_on: JSON.stringify(newDeps) });
      }
    }
    console.log('[MIGRATION] Updated depends_on references');

    // Phase C: Update the actual task IDs (must be done last)
    for (var k = 0; k < needsRemap.length; k++) {
      var old = needsRemap[k];
      await knex('tasks').where('id', old.id).update({ id: idMap[old.id] });
    }
    console.log('[MIGRATION] Updated ' + needsRemap.length + ' task IDs');

    // 4. Update user_config schedule_cache if it references old IDs
    var cacheRows = await knex('user_config').where('config_key', 'schedule_cache');
    for (var ci = 0; ci < cacheRows.length; ci++) {
      // Invalidate cache — it will be regenerated on next scheduler run
      await knex('user_config').where({ user_id: cacheRows[ci].user_id, config_key: 'schedule_cache' }).del();
    }
    console.log('[MIGRATION] Invalidated schedule caches');

  } finally {
    await knex.raw('SET FOREIGN_KEY_CHECKS = 1');
  }
};

exports.down = async function(knex) {
  // Cannot reverse UUIDv7 migration — IDs are one-way
  console.log('[MIGRATION] UUIDv7 migration cannot be reversed. Old IDs are lost.');
};
