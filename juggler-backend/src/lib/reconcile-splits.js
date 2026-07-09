/**
 * Split-chunk plan computation.
 *
 * A master with split=1 decomposes each occurrence into N chunks of
 * ~split_min minutes (last chunk may be shorter/merged). computeChunks is
 * the single plan function for persisted chunk rows (999.1190) — consumed
 * by runSchedule.js's 5b recurring chunk fanout.
 *
 * 999.1179: the reconcileSplitsForMaster / reconcileSplitsForUser diff-based
 * reconcilers that used to live here were dead runtime code (their scheduler
 * call was removed per ROADMAP 999.097) and have been deleted.
 */

var MIN_CHUNK_DEFAULT = 15;

/**
 * Compute the desired chunk plan for a master + occurrence.
 * Returns an array of { splitOrdinal, dur } of length N.
 * Includes the "merge tiny last chunk into previous" rule.
 *
 * 999.1190: this is the SINGLE plan function for PERSISTED chunk rows —
 * runSchedule.js's 5b recurring chunk fanout imports computeChunks.
 * A prior comment here claimed it "mirrors unifiedSchedule.js:314-338" — that
 * file no longer exists. The live placement engine
 * (unifiedScheduleV2.js placeSplitInline) deliberately does NOT use a
 * precomputed plan: it chunks by free-slot availability (free-run driven,
 * STEP flooring, splitMin re-check), so placed chunk durations may differ
 * from the persisted row plan; the post-placement merge step recombines
 * contiguous chunks. Unifying plan + placement chunking into one function is
 * gated on the runSchedule/unifiedScheduleV2 consolidation spike (999.1108).
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

module.exports = {
  computeChunks: computeChunks,
};
