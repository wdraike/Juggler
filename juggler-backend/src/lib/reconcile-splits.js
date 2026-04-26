/**
 * Reconcile split chunks as persistent task_instances rows.
 *
 * A master with split=1 is supposed to decompose each occurrence into
 * N chunks of ~split_min minutes (last chunk may be shorter/merged).
 * Historically the scheduler computed those chunks ephemerally at runtime
 * and forgot them between runs. This helper makes them real rows:
 * each chunk is an instance row with the same occurrence_ordinal and
 * its own split_ordinal / split_total / per-chunk dur.
 *
 * Why persist: per-chunk calendar sync (each chunk becomes its own
 * gcal event), per-chunk status (user marks a single chunk done), and
 * the original product vision that split chunks are first-class tasks.
 *
 * Reconciliation is diff-based and per-occurrence: for each existing
 * occurrence_ordinal on the master, compute the desired chunk count N
 * from master.dur and master.split_min, then insert missing chunks and
 * delete extras. Survivors keep their ids (so cal_sync_ledger bindings
 * persist across re-chunking).
 *
 * Not called from production code yet. Wire-up is the next session's task.
 */

var MIN_CHUNK_DEFAULT = 15;

/**
 * Compute the desired chunk plan for a master + occurrence.
 * Returns an array of { splitOrdinal, dur } of length N.
 * Mirrors unifiedSchedule.js:314-338 (includes the "merge tiny last
 * chunk into previous" rule so chunk counts match scheduler expectations).
 */
function computeChunks(totalDur, splitMin) {
  var chunk = splitMin || MIN_CHUNK_DEFAULT;
  if (!totalDur || totalDur <= 0) return [];
  var numChunks = Math.ceil(totalDur / chunk);
  var result = [];
  for (var ci = 0; ci < numChunks; ci++) {
    var isLast = ci === numChunks - 1;
    var chunkDur = (isLast && totalDur % chunk !== 0) ? totalDur % chunk : chunk;
    if (chunkDur < chunk && ci > 0) {
      // Merge tiny last remainder into previous
      result[result.length - 1].dur += chunkDur;
      break;
    }
    result.push({ splitOrdinal: ci + 1, dur: chunkDur });
  }
  // Re-stamp split_total on all chunks
  result.forEach(function(r) { r.splitTotal = result.length; });
  return result;
}

/**
 * Reconcile chunk rows for one master. Returns counts of inserts/deletes/updates.
 *
 * Contract:
 *   - If master.split is falsy: collapse all instances back to split_ordinal=1,
 *     split_total=1 (undo any previous chunking).
 *   - If master.split is true: for each distinct occurrence_ordinal the master
 *     already has an instance for, materialize N chunk rows with split_ordinal 1..N.
 *
 * Uses uuidv7 for new chunk ids.
 */
var { v7: uuidv7 } = require('uuid');

async function reconcileSplitsForMaster(trx, masterId) {
  var master = await trx('task_masters').where('id', masterId).first();
  if (!master) return { inserted: 0, deleted: 0, updated: 0, skipped: 'master_not_found' };

  var existing = await trx('task_instances')
    .where('master_id', masterId)
    .orderBy([{ column: 'occurrence_ordinal' }, { column: 'split_ordinal' }]);

  // Collapse mode: master is not (or no longer) split.
  if (!master.split) {
    return collapseChunks(trx, masterId, master, existing);
  }

  // Expand mode: group existing by occurrence and reconcile each.
  var byOcc = {};
  existing.forEach(function(r) {
    var k = r.occurrence_ordinal;
    if (!byOcc[k]) byOcc[k] = [];
    byOcc[k].push(r);
  });

  var inserted = 0, deleted = 0, updated = 0;
  var occKeys = Object.keys(byOcc);
  for (var oi = 0; oi < occKeys.length; oi++) {
    var occOrd = Number(occKeys[oi]);
    var rows = byOcc[occKeys[oi]];
    var r = await reconcileOccurrence(trx, masterId, master, occOrd, rows);
    inserted += r.inserted;
    deleted += r.deleted;
    updated += r.updated;
  }
  return { inserted: inserted, deleted: deleted, updated: updated };
}

async function reconcileOccurrence(trx, masterId, master, occOrd, existingRows) {
  // Desired chunk plan derived from master
  var desired = computeChunks(master.dur, master.split_min);
  if (desired.length === 0) return { inserted: 0, deleted: 0, updated: 0 };

  // Sort existing by split_ordinal
  existingRows.sort(function(a, b) { return a.split_ordinal - b.split_ordinal; });

  var inserted = 0, deleted = 0, updated = 0;

  // Update survivors (matching split_ordinal 1..min(existing, desired))
  var overlap = Math.min(existingRows.length, desired.length);
  for (var i = 0; i < overlap; i++) {
    var e = existingRows[i];
    var d = desired[i];
    if (e.split_ordinal !== d.splitOrdinal ||
        Number(e.split_total) !== desired.length ||
        Number(e.dur) !== d.dur) {
      await trx('task_instances')
        .where('id', e.id)
        .update({
          split_ordinal: d.splitOrdinal,
          split_total: desired.length,
          dur: d.dur,
          updated_at: trx.fn.now()
        });
      updated++;
    }
  }

  // Insert missing chunks (when desired > existing)
  if (desired.length > existingRows.length) {
    var template = existingRows[0]; // carry scheduling fields from occurrence's primary row
    for (var j = existingRows.length; j < desired.length; j++) {
      var d2 = desired[j];
      await trx('task_instances').insert({
        id: uuidv7(),
        master_id: masterId,
        user_id: master.user_id,
        occurrence_ordinal: occOrd,
        split_ordinal: d2.splitOrdinal,
        split_total: desired.length,
        split_group: masterId,
        dur: d2.dur,
        // Placement left null — scheduler assigns on next run
        scheduled_at: null,
        date_pinned: template ? template.date_pinned : 0,
        status: '',
        time_remaining: null,
        unscheduled: null,
        generated: 0,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now()
      });
      inserted++;
    }
  }

  // Delete extras (when existing > desired) — delete from the tail (highest split_ordinal)
  if (existingRows.length > desired.length) {
    var toDel = existingRows.slice(desired.length).map(function(r) { return r.id; });
    await trx('task_instances').whereIn('id', toDel).del();
    deleted += toDel.length;
  }

  return { inserted: inserted, deleted: deleted, updated: updated };
}

/**
 * Collapse: master is no longer split. Keep split_ordinal=1 rows, delete the rest.
 * Reset split_total=1 on survivors.
 */
async function collapseChunks(trx, masterId, master, existing) {
  var deleted = 0, updated = 0;
  var survivors = [];
  var toDel = [];
  existing.forEach(function(r) {
    if (r.split_ordinal === 1) survivors.push(r);
    else toDel.push(r.id);
  });
  if (toDel.length > 0) {
    await trx('task_instances').whereIn('id', toDel).del();
    deleted = toDel.length;
  }
  for (var i = 0; i < survivors.length; i++) {
    var s = survivors[i];
    if (Number(s.split_total) !== 1 || Number(s.dur) !== Number(master.dur)) {
      await trx('task_instances')
        .where('id', s.id)
        .update({
          split_total: 1,
          dur: master.dur,
          updated_at: trx.fn.now()
        });
      updated++;
    }
  }
  return { inserted: 0, deleted: deleted, updated: updated };
}

/**
 * Per-user batched reconcile: load all NON-RECURRING split masters + their
 * instances in two queries, then reconcile in memory.
 *
 * Restricted to non-recurring tasks (recurring: 0) because recurring split
 * tasks are managed by the scheduler's own inMemoryChunks + inMemoryInserts
 * path with deterministic IDs. Calling this on recurring masters would create
 * UUID-based secondary chunks that conflict with the scheduler's
 * <primaryId>-N naming scheme.
 *
 * Called at the start of each scheduler transaction (before the task load)
 * so that newly created or config-changed non-recurring split tasks have
 * their secondary chunk rows materialized before the scheduler tries to
 * place them.
 */
async function reconcileSplitsForUser(trx, userId) {
  var masters = await trx('task_masters')
    .where({ user_id: userId, split: 1, recurring: 0 })
    .whereNull('disabled_at')
    .select();
  if (masters.length === 0) {
    return { inserted: 0, deleted: 0, updated: 0, mastersTouched: 0, touchedMasterIds: [] };
  }

  var masterIds = masters.map(function(m) { return m.id; });
  var allInstances = await trx('task_instances')
    .whereIn('master_id', masterIds)
    .orderBy([{ column: 'master_id' }, { column: 'occurrence_ordinal' }, { column: 'split_ordinal' }]);

  var byMaster = {};
  allInstances.forEach(function(r) {
    if (!byMaster[r.master_id]) byMaster[r.master_id] = [];
    byMaster[r.master_id].push(r);
  });

  var inserted = 0, deleted = 0, updated = 0;
  var touchedMasterIds = [];
  for (var mi = 0; mi < masters.length; mi++) {
    var master = masters[mi];
    var existing = byMaster[master.id] || [];
    var r = await reconcileMasterFromLoaded(trx, master, existing);
    inserted += r.inserted;
    deleted += r.deleted;
    updated += r.updated;
    if ((r.inserted + r.deleted + r.updated) > 0) touchedMasterIds.push(master.id);
  }
  return {
    inserted: inserted, deleted: deleted, updated: updated,
    mastersTouched: touchedMasterIds.length,
    touchedMasterIds: touchedMasterIds
  };
}

/**
 * Like reconcileSplitsForMaster but takes pre-loaded master + instances
 * to avoid the 2 queries per master. Used by reconcileSplitsForUser.
 */
async function reconcileMasterFromLoaded(trx, master, existing) {
  if (!master.split) {
    return collapseChunks(trx, master.id, master, existing);
  }
  var byOcc = {};
  existing.forEach(function(r) {
    var k = r.occurrence_ordinal;
    if (!byOcc[k]) byOcc[k] = [];
    byOcc[k].push(r);
  });
  var inserted = 0, deleted = 0, updated = 0;
  var occKeys = Object.keys(byOcc);
  for (var oi = 0; oi < occKeys.length; oi++) {
    var occOrd = Number(occKeys[oi]);
    var rows = byOcc[occKeys[oi]];
    var r = await reconcileOccurrence(trx, master.id, master, occOrd, rows);
    inserted += r.inserted;
    deleted += r.deleted;
    updated += r.updated;
  }
  return { inserted: inserted, deleted: deleted, updated: updated };
}

module.exports = {
  computeChunks: computeChunks,
  reconcileSplitsForMaster: reconcileSplitsForMaster,
  reconcileSplitsForUser: reconcileSplitsForUser,
};
