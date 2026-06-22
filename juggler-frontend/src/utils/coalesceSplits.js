/**
 * Render-only coalescing of adjacent identical-master split chunks (R56).
 *
 * The scheduler splits a task into chunks (split_ordinal/split_total) that the
 * calendar renders as separate cards. When chunks of the SAME master land
 * back-to-back on the same day, showing N tiny cards is noise — the user thinks
 * of it as one block. This merges contiguous same-master chunks into ONE display
 * object for rendering ONLY. Nothing is persisted; the underlying chunk rows are
 * untouched in the DB. The merged object carries `_coalescedIds` (every
 * underlying chunk id) so an edit to the block can fan out to all of them.
 *
 * Adjacency = same master (task.sourceId) + both are split chunks (splitTotal>1)
 * + time-contiguous (prev.start + prev.dur === next.start). Placements with no
 * sourceId, or non-split placements, pass through unchanged. Pure function.
 */
function masterKeyOf(p) {
  var t = (p && p.task) || {};
  // Only recurring/templated splits carry a sourceId master key; a placement
  // without one is never coalesced (we cannot prove two chunks share a master).
  return t.sourceId != null ? String(t.sourceId) : null;
}

function isSplitChunk(p) {
  return p && typeof p.splitTotal === 'number' && p.splitTotal > 1;
}

function coalesceAdjacentSplitChunks(placements) {
  if (!Array.isArray(placements) || placements.length < 2) return placements || [];
  var sorted = placements.slice().sort(function (a, b) { return a.start - b.start; });
  var out = [];
  var run = null; // the in-progress merged block

  function flush() {
    if (!run) return;
    if (run._coalescedIds.length > 1) {
      out.push(run.merged);
    } else {
      out.push(run.original); // single chunk — emit verbatim, no merge wrapper
    }
    run = null;
  }

  for (var i = 0; i < sorted.length; i++) {
    var p = sorted[i];
    var key = masterKeyOf(p);
    var mergeable = isSplitChunk(p) && key != null;

    if (!mergeable) { flush(); out.push(p); continue; }

    if (run && run.key === key && (run.end === p.start)) {
      // contiguous chunk of the same master — extend the running block
      run.merged = Object.assign({}, run.merged, {
        dur: run.merged.dur + p.dur,
        _coalescedIds: run.merged._coalescedIds.concat([p.task && p.task.id])
      });
      run._coalescedIds = run.merged._coalescedIds;
      run.end = p.start + p.dur;
    } else {
      flush();
      var idsSeed = [p.task && p.task.id];
      run = {
        key: key,
        end: p.start + p.dur,
        original: p,
        _coalescedIds: idsSeed,
        merged: Object.assign({}, p, {
          _isMergedSplit: true,
          _coalescedIds: idsSeed
        })
      };
    }
  }
  flush();
  return out;
}

module.exports = { coalesceAdjacentSplitChunks: coalesceAdjacentSplitChunks };
