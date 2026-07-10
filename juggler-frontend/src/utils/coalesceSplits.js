/**
 * Render-only coalescing of same-occurrence split chunks (R56).
 *
 * The scheduler splits a task into chunks (split_ordinal/split_total) that the
 * calendar renders as separate cards. Showing N tiny cards for one occurrence
 * is noise — the user thinks of it as one block. This merges same-occurrence
 * chunks into ONE display object for rendering ONLY. Nothing is persisted;
 * the underlying chunk rows are untouched in the DB. The merged object carries
 * `_coalescedIds` (every underlying chunk id) so an edit to the block can fan
 * out to all of them.
 *
 * Grouping key = task.splitGroup (the DB's own same-occurrence identity,
 * `task_instances.split_group` — set once at fabrication time, stable
 * regardless of later status changes). Chunks with no splitGroup, or
 * non-split placements, pass through unchanged. Pure function.
 *
 * NOTE (fixed 2026-07-09): previously grouped by time-contiguity
 * (`prev.end === next.start`), which silently stopped merging once ANY
 * chunk in the group went terminal — `derivePlacements.js` overrides a
 * terminal chunk's placement `end` to its own actual completion/skip
 * wall-clock time (JUG-CLOSE-NOW), and each chunk in a group can be
 * actioned at a different real moment (e.g. skip-cascade landing minutes
 * apart), so the chunks' individual times drift apart independently of
 * whether they're still the same occurrence. splitGroup is the correct,
 * status-independent identity — a split occurrence must display as ONE
 * card regardless of when/whether its chunks were individually resolved.
 */
function splitGroupKeyOf(p) {
  var t = (p && p.task) || {};
  return t.splitGroup != null ? String(t.splitGroup) : null;
}

function isSplitChunk(p) {
  return p && typeof p.splitTotal === 'number' && p.splitTotal > 1;
}

function coalesceAdjacentSplitChunks(placements) {
  if (!Array.isArray(placements) || placements.length < 2) return placements || [];

  var groups = {};   // splitGroup -> [placements]
  var groupOrder = [];
  var passthrough = [];

  placements.forEach(function (p) {
    var key = isSplitChunk(p) ? splitGroupKeyOf(p) : null;
    if (key == null) { passthrough.push(p); return; }
    if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
    groups[key].push(p);
  });

  var merged = groupOrder.map(function (key) {
    var chunks = groups[key].slice().sort(function (a, b) { return a.start - b.start; });
    if (chunks.length === 1) return chunks[0];
    var first = chunks[0];
    var totalDur = chunks.reduce(function (sum, c) { return sum + c.dur; }, 0);
    return Object.assign({}, first, {
      dur: totalDur,
      _isMergedSplit: true,
      _coalescedIds: chunks.map(function (c) { return c.task && c.task.id; })
    });
  });

  return passthrough.concat(merged).sort(function (a, b) { return a.start - b.start; });
}

/**
 * 999.1220 (2026-07-06 ruling): done is CHUNK-ONLY. Given a merged block's
 * chunk ids (ordinal order) and the status map, return the ids a status
 * change on the merged card should hit:
 *   - 'done' → [next incomplete chunk] (first non-terminal), or [] when every
 *     chunk is already terminal;
 *   - anything else → all ids (R56 fan-out unchanged: cancel/skip apply to
 *     the whole occurrence).
 */
function statusChangeTargets(val, ids, statuses, isTerminal) {
  if (val !== 'done') return ids.slice();
  var next = ids.find(function (id) { return !isTerminal(statuses[id] || ''); });
  return next ? [next] : [];
}

/** Per-chunk progress for the merged card label ("1/3 done"). */
function splitProgress(ids, statuses) {
  var done = ids.filter(function (id) { return statuses[id] === 'done'; }).length;
  return { done: done, total: ids.length };
}

/**
 * Status the merged card displays (and its StatusToggle acts on): the next
 * incomplete chunk's status, or the last chunk's status once every chunk is
 * terminal — so the card only strikes through when the whole occurrence is
 * settled, and a done tap always advances the next incomplete chunk.
 */
function mergedCardStatus(ids, statuses, isTerminal) {
  var next = ids.find(function (id) { return !isTerminal(statuses[id] || ''); });
  return next != null ? (statuses[next] || '') : (statuses[ids[ids.length - 1]] || '');
}

module.exports = {
  coalesceAdjacentSplitChunks: coalesceAdjacentSplitChunks,
  statusChangeTargets: statusChangeTargets,
  splitProgress: splitProgress,
  mergedCardStatus: mergedCardStatus
};
