/**
 * ScoreEngine — pure schedule-quality scorer (H6 W1 domain core).
 *
 * HOUSES the algorithm formerly in `src/scheduler/scoreSchedule.js`, byte-for-byte.
 * `scoreSchedule.js` now delegates to `ScoreEngine.score`, so this class is the
 * single source of truth for scoring. The C-SCORE golden-master calls
 * `scoreSchedule` (→ ScoreEngine) and pins {total, breakdown, details} bit-for-bit.
 *
 * Lower score = better. 0 = perfect.
 *
 * PURE: no I/O. Only dependency is the domain-local `constants.js` for `PRI_RANK`
 * (a frozen lookup table, zero side effects — no fs/crypto at load time).
 *
 * The penalty constants and parse/weight helpers are reproduced EXACTLY from the
 * legacy file — do NOT retune them; the golden-master and C-SCORE pin them
 * (UNPLACED_MULTIPLIER=1, DEADLINE_MISS_PENALTY=500, FRAGMENTATION_PENALTY=15, …).
 */

'use strict';

var PRI_RANK = require('../constants').PRI_RANK;

var UNPLACED_MULTIPLIER = 1;
var DEADLINE_MISS_PENALTY = 500;
var PRIORITY_DRIFT_BASE = 20;
var CROSS_DAY_PRI_BASE = 20;
var DATE_DRIFT_PENALTY = 10;
var FRAGMENTATION_PENALTY = 15;

/**
 * Parse a date string into a comparable integer (YYYYMMDD).
 *
 * Accepts:
 *   - ISO format:    '2026-03-22'  → 20260322
 *   - Legacy M/D:    '3/22'        → current-year * 10000 + 0322
 *   - Legacy M/D/Y:  '3/22/2026'   → 20260322
 */
function parseDateKey(str) {
  if (!str) return null;
  // ISO: YYYY-MM-DD
  var iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return parseInt(iso[1], 10) * 10000 + parseInt(iso[2], 10) * 100 + parseInt(iso[3], 10);
  }
  // Legacy M/D or M/D/YYYY
  var parts = str.split('/');
  if (parts.length < 2) return null;
  var month = parseInt(parts[0], 10);
  var day   = parseInt(parts[1], 10);
  var year  = parts[2] ? parseInt(parts[2], 10) : new Date().getFullYear();
  return year * 10000 + month * 100 + day;
}

function priWeight(pri) {
  return PRI_RANK[pri] || PRI_RANK['P3'];
}

/**
 * Compute a quality score for a proposed schedule.
 *
 * @param {Object} dayPlacements  { dateKey: [ { task, start, dur, ...} ] }
 * @param {Array}  unplaced       Array of task objects that could not be placed
 * @param {Array}  allTasks       All task objects that were considered
 * @returns {{ total: number, breakdown: Object, details: Array }}
 */
function score(dayPlacements, unplaced, _allTasks) {
  var breakdown = {
    unplaced:      0,
    deadlineMiss:  0,
    priorityDrift: 0,
    crossDayPri:   0,
    dateDrift:     0,
    fragmentation: 0
  };
  var details = [];

  // ── 1. Unplaced penalty ─────────────────────────────────────────
  (unplaced || []).forEach(function(task) {
    var penalty = priWeight(task.pri) * UNPLACED_MULTIPLIER;
    breakdown.unplaced += penalty;
    details.push({ taskId: task.id, type: 'unplaced', penalty: penalty });
  });

  // ── 2. Per-day analysis ─────────────────────────────────────────
  Object.keys(dayPlacements || {}).forEach(function(dateKey) {
    var slots = dayPlacements[dateKey];
    if (!slots || slots.length === 0) return;

    // ── 2a. Deadline miss ──────────────────────────────────────────
    slots.forEach(function(slot) {
      var task = slot.task;
      if (!task) return;
      var deadline = task.deadline || task.deadlineDate;
      if (!deadline) return;
      var placedNum   = parseDateKey(dateKey);
      var deadlineNum = parseDateKey(deadline);
      if (placedNum != null && deadlineNum != null && placedNum > deadlineNum) {
        var penalty = DEADLINE_MISS_PENALTY;
        breakdown.deadlineMiss += penalty;
        details.push({ taskId: task.id, type: 'deadlineMiss', penalty: penalty });
      }
    });

    // ── 2b. Priority drift (within the same day) ───────────────────
    // Sort placements by start time; check every adjacent pair.
    var sorted = slots.slice().sort(function(a, b) { return a.start - b.start; });
    for (var i = 0; i < sorted.length - 1; i++) {
      var earlier = sorted[i];
      var later   = sorted[i + 1];
      if (!earlier.task || !later.task) continue;
      var priEarlier = priWeight(earlier.task.pri);
      var priLater   = priWeight(later.task.pri);
      // Higher PRI_RANK = higher priority. If a lower-priority task is placed
      // before a higher-priority task, that's drift.
      if (priEarlier < priLater) {
        var gap     = priLater - priEarlier;
        var penalty = PRIORITY_DRIFT_BASE + gap;
        breakdown.priorityDrift += penalty;
        details.push({ taskId: earlier.task.id, type: 'priorityDrift', penalty: penalty });
      }
    }

    // ── 2c. Date drift (placed on different day than task.date) ────
    slots.forEach(function(slot) {
      var task = slot.task;
      if (!task || !task.date) return;
      var taskNum   = parseDateKey(task.date);
      var placedNum = parseDateKey(dateKey);
      if (taskNum != null && placedNum != null && taskNum !== placedNum) {
        breakdown.dateDrift += DATE_DRIFT_PENALTY;
        details.push({ taskId: task.id, type: 'dateDrift', penalty: DATE_DRIFT_PENALTY });
      }
    });

    // ── 2d. Fragmentation (split tasks) ────────────────────────────
    // Group placements by task id that have splitPart metadata.
    var seenSplit = {};
    slots.forEach(function(slot) {
      var task = slot.task;
      if (!task) return;
      if (slot.splitPart == null) return;
      if (!seenSplit[task.id]) seenSplit[task.id] = 0;
      seenSplit[task.id]++;
    });
    Object.keys(seenSplit).forEach(function(taskId) {
      var parts = seenSplit[taskId];
      if (parts <= 1) return;
      // Penalize each split beyond the first
      var penalty = (parts - 1) * FRAGMENTATION_PENALTY;
      breakdown.fragmentation += penalty;
      details.push({ taskId: taskId, type: 'fragmentation', penalty: penalty });
    });
  });

  // ── 3. Cross-day priority inversion ────────────────────────────
  // For each pair of days, if a lower-priority task is on an earlier day
  // than a higher-priority task, penalize.
  var dateKeys = Object.keys(dayPlacements || {}).sort();
  for (var di = 0; di < dateKeys.length - 1; di++) {
    var earlyDayKey = dateKeys[di];
    var earlyNum    = parseDateKey(earlyDayKey);
    var earlySlots  = dayPlacements[earlyDayKey] || [];

    for (var dj = di + 1; dj < dateKeys.length; dj++) {
      var laterDayKey = dateKeys[dj];
      var laterNum    = parseDateKey(laterDayKey);
      var laterSlots  = dayPlacements[laterDayKey] || [];

      if (earlyNum == null || laterNum == null || earlyNum >= laterNum) continue;

      // Check all (earlier-day task, later-day task) pairs for priority inversions
      earlySlots.forEach(function(es) {
        if (!es.task) return;
        var priEarly = priWeight(es.task.pri);
        laterSlots.forEach(function(ls) {
          if (!ls.task) return;
          var priLater = priWeight(ls.task.pri);
          // Lower-pri task on early day, higher-pri task on later day → inversion
          if (priEarly < priLater) {
            var gap     = priLater - priEarly;
            var penalty = CROSS_DAY_PRI_BASE + gap;
            breakdown.crossDayPri += penalty;
            details.push({ taskId: es.task.id, type: 'crossDayPri', penalty: penalty });
          }
        });
      });
    }
  }

  // ── 4. Total ────────────────────────────────────────────────────
  var total = 0;
  Object.keys(breakdown).forEach(function(k) { total += breakdown[k]; });

  return { total: total, breakdown: breakdown, details: details };
}

module.exports = {
  score: score,
  // Exposed for unit tests / callers; byte-identical to the legacy helpers.
  parseDateKey: parseDateKey,
  priWeight: priWeight,
  // Penalty constants (frozen reference — pinned by C-SCORE).
  PENALTIES: Object.freeze({
    UNPLACED_MULTIPLIER: UNPLACED_MULTIPLIER,
    DEADLINE_MISS_PENALTY: DEADLINE_MISS_PENALTY,
    PRIORITY_DRIFT_BASE: PRIORITY_DRIFT_BASE,
    CROSS_DAY_PRI_BASE: CROSS_DAY_PRI_BASE,
    DATE_DRIFT_PENALTY: DATE_DRIFT_PENALTY,
    FRAGMENTATION_PENALTY: FRAGMENTATION_PENALTY
  })
};
