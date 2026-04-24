/**
 * scheduleDiff — compare v1 and v2 scheduler outputs during shadow rollout.
 *
 * Called once per scheduler run when SCHEDULER_V2_SHADOW=true. Logs a
 * summary line plus per-task diffs to console. Never mutates state, never
 * throws (exceptions are caught and logged so shadow mode can't break v1).
 *
 * The "truth" is v1. v2's output is the candidate being evaluated.
 *
 * Diff categories:
 *   - match:    same placement (date + startMin within 1 min, or both unplaced)
 *   - moved:    both placed but at different date/time
 *   - onlyV1:   v1 placed, v2 did not
 *   - onlyV2:   v2 placed, v1 did not
 *   - v2error:  v2 threw while computing (captured at call site)
 *
 * Output format is deliberately grep-friendly for log mining. Tag is
 * `[SCHED-DIFF]` so ops can filter.
 */

function flattenPlacements(dayPlacements) {
  // v1 and v2 both return dayPlacements keyed by "M/D". Flatten to
  // { taskId → { dateKey, start, dur } } for per-task lookup. When multiple
  // placements share a taskId (splits), keep the earliest — matches the
  // per-task "did it get placed" question we're asking.
  var out = {};
  if (!dayPlacements || typeof dayPlacements !== 'object') return out;
  Object.keys(dayPlacements).forEach(function(dk) {
    var list = dayPlacements[dk];
    if (!Array.isArray(list)) return;
    list.forEach(function(p) {
      var id = p && p.task && p.task.id;
      if (!id) return;
      var existing = out[id];
      if (!existing || (p.start != null && p.start < existing.start)) {
        out[id] = { dateKey: dk, start: p.start, dur: p.dur };
      }
    });
  });
  return out;
}

function diffSchedules(v1Result, v2Result, meta) {
  if (!v1Result || !v2Result) return null;

  var v1Placed = flattenPlacements(v1Result.dayPlacements);
  var v2Placed = flattenPlacements(v2Result.dayPlacements);

  // Unplaced: list → set of ids.
  var v1Unplaced = {};
  (v1Result.unplaced || []).forEach(function(t) { if (t && t.id) v1Unplaced[t.id] = true; });
  var v2Unplaced = {};
  (v2Result.unplaced || []).forEach(function(t) { if (t && t.id) v2Unplaced[t.id] = true; });

  // Union of ids seen by either side.
  var allIds = {};
  Object.keys(v1Placed).forEach(function(id) { allIds[id] = true; });
  Object.keys(v2Placed).forEach(function(id) { allIds[id] = true; });
  Object.keys(v1Unplaced).forEach(function(id) { allIds[id] = true; });
  Object.keys(v2Unplaced).forEach(function(id) { allIds[id] = true; });

  var counts = { match: 0, moved: 0, onlyV1: 0, onlyV2: 0, bothUnplaced: 0 };
  var details = [];

  Object.keys(allIds).forEach(function(id) {
    var p1 = v1Placed[id];
    var p2 = v2Placed[id];
    var u1 = !!v1Unplaced[id];
    var u2 = !!v2Unplaced[id];

    if (!p1 && !p2 && u1 && u2) { counts.bothUnplaced++; return; }
    if (!p1 && !u1 && !p2 && !u2) return; // id seen but no state either side — skip
    if (p1 && p2) {
      var sameDate = p1.dateKey === p2.dateKey;
      var sameStart = Math.abs((p1.start || 0) - (p2.start || 0)) <= 1;
      if (sameDate && sameStart) { counts.match++; return; }
      counts.moved++;
      details.push({ id: id, kind: 'moved', v1: p1, v2: p2 });
      return;
    }
    if (p1 && !p2) { counts.onlyV1++; details.push({ id: id, kind: 'onlyV1', v1: p1, v2Unplaced: u2 }); return; }
    if (p2 && !p1) { counts.onlyV2++; details.push({ id: id, kind: 'onlyV2', v2: p2, v1Unplaced: u1 }); return; }
  });

  return { counts: counts, details: details, meta: meta || {} };
}

function logDiff(diff, opts) {
  if (!diff) return;
  var tag = '[SCHED-DIFF]';
  var c = diff.counts;
  var meta = diff.meta || {};

  // Summary line — one per run. Grep-friendly.
  console.log(tag + ' run user=' + (meta.userId || '?') +
    (meta.primary ? ' primary=' + meta.primary : '') +
    (meta.context ? ' ctx=' + meta.context : '') +
    ' match=' + c.match +
    ' moved=' + c.moved +
    ' onlyV1=' + c.onlyV1 +
    ' onlyV2=' + c.onlyV2 +
    ' bothUnplaced=' + c.bothUnplaced +
    (meta.v2Stub ? ' v2=STUB' : '') +
    (meta.v2Ms != null ? ' v2Ms=' + meta.v2Ms : '') +
    (meta.v1Ms != null ? ' v1Ms=' + meta.v1Ms : '') +
    (meta.error ? ' error=' + String(meta.error).substring(0, 200) : ''));

  // Detail lines — cap at 50 per run so a divergent run doesn't drown logs.
  // Caller should aggregate if more detail is needed.
  var verboseLimit = (opts && opts.verboseLimit != null) ? opts.verboseLimit : 50;
  var shown = 0;
  for (var i = 0; i < diff.details.length && shown < verboseLimit; i++) {
    var d = diff.details[i];
    if (d.kind === 'moved') {
      console.log(tag + '   moved id=' + d.id +
        ' v1=' + d.v1.dateKey + '@' + d.v1.start +
        ' v2=' + d.v2.dateKey + '@' + d.v2.start);
    } else if (d.kind === 'onlyV1') {
      console.log(tag + '   onlyV1 id=' + d.id + ' v1=' + d.v1.dateKey + '@' + d.v1.start);
    } else if (d.kind === 'onlyV2') {
      console.log(tag + '   onlyV2 id=' + d.id + ' v2=' + d.v2.dateKey + '@' + d.v2.start);
    }
    shown++;
  }
  if (diff.details.length > verboseLimit) {
    console.log(tag + '   ... ' + (diff.details.length - verboseLimit) + ' more diffs suppressed');
  }
}

// Validate the "no overlapping placements within a day" invariant on a
// scheduler result. Pinned/marker entries are exempt (markers have dur=0
// and are allowed to coexist; pinned items can stack at the user's choice).
// Returns an array of { dateKey, a, b } overlap pairs.
function findOverlaps(result) {
  var out = [];
  if (!result || !result.dayPlacements) return out;
  Object.keys(result.dayPlacements).forEach(function(dk) {
    var list = (result.dayPlacements[dk] || []).slice();
    // Exclude markers (dur=0 by construction; coexist by design).
    list = list.filter(function(p) {
      return p && p.dur > 0 && !(p.task && p.task.marker);
    });
    list.sort(function(a, b) { return (a.start || 0) - (b.start || 0); });
    for (var i = 0; i < list.length - 1; i++) {
      var a = list[i], b = list[i + 1];
      var aEnd = (a.start || 0) + (a.dur || 0);
      var bStart = b.start || 0;
      if (bStart < aEnd) {
        // Allow same task (split chunks at consecutive minutes are fine if
        // they don't actually overlap — caught by start < aEnd above).
        out.push({ dateKey: dk, a: { id: a.task && a.task.id, start: a.start, dur: a.dur },
                   b: { id: b.task && b.task.id, start: b.start, dur: b.dur } });
      }
    }
  });
  return out;
}

module.exports = { diffSchedules: diffSchedules, logDiff: logDiff, findOverlaps: findOverlaps };
