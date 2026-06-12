/**
 * ConflictResolver — pure occupancy + conflict primitives (H6 W1 domain core).
 *
 * HOUSES the occupancy/conflict primitives MOVED out of
 * `src/scheduler/unifiedScheduleV2.js`, byte-for-byte:
 *   - `reserve` / `reserveWithTravel`   — mark a slot (and its travel buffers) busy
 *   - `isFree` / `isFreeWithTravel`     — slot-free tests (with travel buffers)
 *   - `rebuildPrefix`                   — occupancy prefix-sum for capacity math
 *   - `overlaps`                        — half-open slot overlap test (conflict check)
 *
 * `unifiedScheduleV2.js` imports and delegates to these — this class is the single
 * source of truth for occupancy mutation/queries. The minute-grid representation
 * (an `occ` object keyed 0..1440, and an `Int32Array(1441)` prefix sum) is
 * UNCHANGED so the placement loop's per-minute reads/writes stay identical and the
 * golden-master placements remain bit-for-bit.
 *
 * PURE: no I/O. Operates only on plain occupancy maps/arrays the caller owns.
 *
 * NOTE (H6 W1 scope): the CALENDAR-busy conflict path (`resolve(schedule,
 * calendarBusy)`) is provided as a thin reducer over these primitives. The
 * scheduler's live conflict handling (rigid-recurring overlap warnings, force-
 * placement) remains orchestrated in `unifiedScheduleV2.js` this wave because it
 * is interleaved with the placement passes and pinned by source-grep
 * characterization (e.g. C-WX weather fail-open). Those orchestration phases are
 * candidates for a later wave; the primitives they call now live here.
 */

'use strict';

/**
 * Mark `[start, start+dur)` busy on the minute-grid `occ` (clamped to [0,1440)).
 * BYTE-IDENTICAL port of `unifiedScheduleV2.reserve`.
 * @param {Object} occ minute-grid occupancy map (key minute → true)
 * @param {number} start
 * @param {number} dur
 */
function reserve(occ, start, dur) {
  var end = Math.min(start + dur, 1440);
  for (var i = Math.max(0, start); i < end; i++) occ[i] = true;
}

/**
 * Mark `[start-tb, start+dur+ta)` busy (travel buffers extend the footprint).
 * BYTE-IDENTICAL port of `unifiedScheduleV2.reserveWithTravel`.
 * @param {Object} occ
 * @param {number} start
 * @param {number} dur
 * @param {number} [tb] travel-before minutes
 * @param {number} [ta] travel-after minutes
 */
function reserveWithTravel(occ, start, dur, tb, ta) {
  var s = Math.max(0, start - (tb || 0));
  var e = Math.min(start + dur + (ta || 0), 1440);
  for (var i = s; i < e; i++) occ[i] = true;
}

/**
 * Rebuild the occupancy prefix-sum `psum[i]` = busy-minutes in `[0, i)`.
 * BYTE-IDENTICAL port of `unifiedScheduleV2.rebuildPrefix`.
 * @param {Object} occ
 * @param {Int32Array} psum length-1441 array
 */
function rebuildPrefix(occ, psum) {
  psum[0] = 0;
  for (var i = 0; i < 1440; i++) {
    psum[i + 1] = psum[i] + (occ[i] ? 1 : 0);
  }
}

/**
 * Is `[start, start+dur)` entirely free on `occ`?
 * BYTE-IDENTICAL port of `unifiedScheduleV2.isFree`.
 * @param {Object} occ
 * @param {number} start
 * @param {number} dur
 * @returns {boolean}
 */
function isFree(occ, start, dur) {
  var end = Math.min(start + dur, 1440);
  for (var i = start; i < end; i++) if (occ[i]) return false;
  return true;
}

/**
 * Is `[start-tb, start+dur+ta)` entirely free on `occ`?
 * BYTE-IDENTICAL port of `unifiedScheduleV2.isFreeWithTravel`.
 * @param {Object} occ
 * @param {number} start
 * @param {number} dur
 * @param {number} [tb]
 * @param {number} [ta]
 * @returns {boolean}
 */
function isFreeWithTravel(occ, start, dur, tb, ta) {
  var s = Math.max(0, start - (tb || 0));
  var e = Math.min(start + dur + (ta || 0), 1440);
  for (var i = s; i < e; i++) if (occ[i]) return false;
  return true;
}

/**
 * Half-open overlap test between two `[start, start+dur)` slots on the SAME day.
 * BYTE-IDENTICAL to the scheduler's conflict check
 * (`p.start < start + dur && p.start + p.dur > start`).
 * @param {number} aStart
 * @param {number} aDur
 * @param {number} bStart
 * @param {number} bDur
 * @returns {boolean}
 */
function overlaps(aStart, aDur, bStart, bDur) {
  return aStart < bStart + bDur && aStart + aDur > bStart;
}

/**
 * Reduce a set of busy `[start, dur]` intervals onto a fresh occupancy grid.
 * Convenience used by `resolve` and by domain unit tests; built only from the
 * pure `reserve` primitive above.
 * @param {Array<{start:number,dur:number,travelBefore?:number,travelAfter?:number}>} busy
 * @returns {Object} occupancy map
 */
function buildOccupancy(busy) {
  var occ = {};
  (busy || []).forEach(function(b) {
    reserveWithTravel(occ, b.start, b.dur, b.travelBefore, b.travelAfter);
  });
  return occ;
}

/**
 * Identify which proposed placements collide with external calendar-busy spans on
 * the same day. Read-only (does not mutate the schedule); returns the colliding
 * placements so an orchestrator can decide how to resolve them.
 *
 * `schedule` here is the per-day placement view `{ dateKey: [ {task,start,dur} ] }`;
 * `calendarBusy` is `{ dateKey: [ {start,dur} ] }`.
 *
 * @param {Object} schedule  { dateKey: ScheduledTask-like[] }
 * @param {Object} calendarBusy { dateKey: {start,dur}[] }
 * @returns {Array<{dateKey:string, placement:Object, busy:Object}>} collisions
 */
function resolve(schedule, calendarBusy) {
  var collisions = [];
  if (!schedule || !calendarBusy) return collisions;
  Object.keys(schedule).forEach(function(dateKey) {
    var busySpans = calendarBusy[dateKey] || [];
    if (!busySpans.length) return;
    (schedule[dateKey] || []).forEach(function(p) {
      if (!p) return;
      busySpans.forEach(function(b) {
        if (overlaps(p.start, p.dur, b.start, b.dur)) {
          collisions.push({ dateKey: dateKey, placement: p, busy: b });
        }
      });
    });
  });
  return collisions;
}

module.exports = {
  reserve: reserve,
  reserveWithTravel: reserveWithTravel,
  rebuildPrefix: rebuildPrefix,
  isFree: isFree,
  isFreeWithTravel: isFreeWithTravel,
  overlaps: overlaps,
  buildOccupancy: buildOccupancy,
  resolve: resolve
};
