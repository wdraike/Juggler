/**
 * Date-based reconciliation of existing pending recurring instances against
 * desired target occurrences.
 *
 * Goal: preserve instance IDs + occurrence_ordinals across scheduler runs
 * so completion state, cal links, and the UI don't churn. Match existing
 * groups to targets by exact-date first, then nearest-first. Unmatched
 * existing groups fall through to deletion; unmatched targets become new
 * inserts.
 *
 * Pure function — no DB access. Consumes rows/occurrences and produces an
 * assignment report the caller applies.
 */

/**
 * Build occurrence groups from raw task_instance rows.
 * Each group represents one occurrence (all chunks sharing the same
 * occurrence_ordinal). Cal-linked rows (gcal/msft) are excluded — callers
 * should route those through the id-based diff path so outbound sync stays
 * correct.
 *
 * @param {Array} taskRows raw rows from task_instances
 * @param {Function} parseDate M/D → Date parser
 * @returns {Object} masterId → { occOrdStr → group }
 */
function buildExistingGroups(taskRows, parseDate) {
  var byMaster = {};
  taskRows.forEach(function(r) {
    if (r.task_type !== 'recurring_instance') return;
    if (r.status && r.status !== '') return;
    if (r.gcal_event_id || r.msft_event_id) return;
    var mid = r.master_id || r.source_id;
    if (!mid) return;
    var occOrd = Number(r.occurrence_ordinal) || 0;
    if (!byMaster[mid]) byMaster[mid] = {};
    var g = byMaster[mid][occOrd];
    if (!g) {
      g = { occOrd: occOrd, occId: null, date: null, dateObj: null, chunkIds: [], scheduledAt: null };
      byMaster[mid][occOrd] = g;
    }
    g.chunkIds.push(r.id);
    if (Number(r.split_ordinal || 1) === 1) {
      g.occId = r.id;
      g.date = r.date;
      g.dateObj = r.date ? parseDate(r.date) : null;
      g.scheduledAt = r.scheduled_at;
    }
  });
  return byMaster;
}

/**
 * Match desired target occurrences to existing groups.
 *
 * @param {Array} desiredOccurrences from expandRecurring; each entry
 *        { id, sourceId, date, ... }. Mutated: matched entries get
 *        `_reconMatched = true`.
 * @param {Object} existingGroupsByMaster output of buildExistingGroups
 * @param {Function} parseDate M/D → Date
 * @returns {Object} {
 *   occIdOverrides: { originalDesiredId: existingOccId },
 *   occurrenceMoves: [{ masterId, newDate, chunkIds }]
 * }
 */
function matchOccurrences(desiredOccurrences, existingGroupsByMaster, parseDate) {
  var occIdOverrides = {};
  var occurrenceMoves = [];

  Object.keys(existingGroupsByMaster).forEach(function(masterId) {
    var groupsMap = existingGroupsByMaster[masterId];
    var remaining = Object.keys(groupsMap).map(function(k) { return groupsMap[k]; })
      .filter(function(g) { return g.occId && g.dateObj; });
    var desiredForMaster = desiredOccurrences.filter(function(o) { return o.sourceId === masterId; });

    desiredForMaster.forEach(function(desired) {
      if (desired._reconMatched) return;
      for (var i = 0; i < remaining.length; i++) {
        if (remaining[i].date === desired.date) {
          occIdOverrides[desired.id] = remaining[i].occId;
          desired._reconMatched = true;
          remaining.splice(i, 1);
          break;
        }
      }
    });

    var unmatchedTargets = desiredForMaster.filter(function(d) { return !d._reconMatched; });
    unmatchedTargets.sort(function(a, b) {
      var ad = parseDate(a.date), bd = parseDate(b.date);
      if (!ad || !bd) return 0;
      return ad - bd;
    });
    unmatchedTargets.forEach(function(desired) {
      if (remaining.length === 0) return;
      var desiredDate = parseDate(desired.date);
      if (!desiredDate) return;
      var bestIdx = 0, bestDist = Infinity;
      for (var ei = 0; ei < remaining.length; ei++) {
        var d = Math.abs(Math.round((remaining[ei].dateObj.getTime() - desiredDate.getTime()) / 86400000));
        if (d < bestDist) { bestDist = d; bestIdx = ei; }
      }
      var g = remaining[bestIdx];
      occIdOverrides[desired.id] = g.occId;
      occurrenceMoves.push({
        masterId: masterId,
        newDate: desired.date,
        chunkIds: groupsMap[g.occOrd].chunkIds.slice()
      });
      desired._reconMatched = true;
      remaining.splice(bestIdx, 1);
    });
  });

  return { occIdOverrides: occIdOverrides, occurrenceMoves: occurrenceMoves };
}

module.exports = {
  buildExistingGroups: buildExistingGroups,
  matchOccurrences: matchOccurrences
};
