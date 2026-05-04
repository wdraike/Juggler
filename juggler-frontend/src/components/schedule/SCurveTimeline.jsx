/**
 * SCurveTimeline — dual-circle 24-hour clock timeline.
 * AM circle on the left (12AM–12PM), PM circle on the right (12PM–12AM).
 * Cards placed in the gap between circles and around the edges.
 * Rectangular cards with colored accents matching time-block bands.
 */

import React, { useMemo } from 'react';
import { PRI_COLORS, locIcon, LOC_TINT, isTerminalStatus } from '../../state/constants';
import { getTheme } from '../../theme/colors';
import { getBlocksForDate } from '../../scheduler/timeBlockHelpers';

import ScheduleCard from './ScheduleCard';

/* ── Dimensions ────────────────────────────────────────── */
var BAND_W      = 28;     // thick coloured time-block band
var CURVE_MARGIN = 24;    // keep cards this far from the curve
var CLOCK_BUFFER = 36;    // keep-out distance from the outer band edge of
                          // EITHER circle (clears the hour labels that
                          // sit ~21px outside the band with ~15px extra
                          // for visual breathing room)
var PADDING     = 10;
var SAMPLE_STEP = 4;
var CARD_GAP    = 8;
var ASPECT_RATIO = 4;
var CIRCLE_GAP  = 0.2;    // fraction of vpW between circle centres —
                          // wide enough that cards breathe in the
                          // central gap but leaves enough room on the
                          // outer sides of each circle for horizontal
                          // cards to reach the viewport edges

/* ── Geometry ──────────────────────────────────────────── */

/**
 * AM circle: 12AM at bottom, 6AM at left, noon at top. Clockwise.
 * PM circle: noon at top, 6PM at right, 12AM at bottom. Clockwise.
 *
 * Both use clock-style: top=12/noon, right=3/3PM, bottom=6/6AM, left=9/9PM
 * AM: mins 0–720 mapped to full circle. 12AM=bottom, 3AM=left, 6AM=top(!), 9AM=right, noon=bottom
 * Actually let's do: AM circle has 12AM at bottom, going clockwise:
 *   12AM=bottom, 3AM=right, 6AM=top, 9AM=left, noon=bottom (full loop)
 * PM circle same pattern:
 *   12PM=bottom, 3PM=right, 6PM=top, 9PM=left, 12AM=bottom
 *
 * Revised for better readability — standard clock positions:
 * AM: 12AM at top, clockwise → 3AM right, 6AM bottom, 9AM left, noon at top again? No, half-day = full circle.
 * Let's use: 12-hour clock style per circle.
 *   AM circle: 12AM at top, 1AM at 30°, ..., 6AM at bottom, ..., 11AM at 330°
 *   PM circle: 12PM at top, 1PM at 30°, ..., 6PM at bottom, ..., 11PM at 330°
 */
function minutesToDualPosition(mins, amR, amCX, amCY, pmR, pmCX, pmCY) {
  var isAM = mins < 720;
  var R, CX, CY, halfMins;
  if (isAM) {
    R = amR; CX = amCX; CY = amCY;
    halfMins = mins;        // 0–720
  } else {
    R = pmR; CX = pmCX; CY = pmCY;
    halfMins = mins - 720;  // 0–720
  }
  // Map 0–720 to full circle. 0 (12:00) at top, clockwise.
  var t = halfMins / 720;             // 0→1
  var angle = t * 2 * Math.PI;       // 0→2π
  // Standard clock: 12 at top = -π/2, clockwise = positive angle
  var mathAngle = -Math.PI / 2 + angle;  // wait, that's counter-clockwise for math
  // For clockwise on screen (y increases down):
  // 12 at top: angle=0 → screen (0, -R) → mathAngle = π/2
  // 3 at right: angle=π/2 → screen (R, 0) → mathAngle = 0
  // 6 at bottom: angle=π → screen (0, R) → mathAngle = -π/2
  // 9 at left: angle=3π/2 → screen (-R, 0) → mathAngle = π
  // So mathAngle = π/2 - angle
  var ma = Math.PI / 2 - angle;
  return {
    x: CX + R * Math.cos(ma),
    y: CY - R * Math.sin(ma),
    nx: Math.cos(ma),
    ny: -Math.sin(ma),
    isAM: isAM,
    circleR: R,
    circleCX: CX,
    circleCY: CY
  };
}

function getBlockAtMinute(mins, blocks) {
  for (var i = 0; i < blocks.length; i++) {
    if (mins >= blocks[i].start && mins < blocks[i].end) return blocks[i];
  }
  return null;
}

/* ── Card geometry (rectangular) ──────────────────────── */

function rectsOverlap(x1, y1, w1, h1, x2, y2, w2, h2) {
  return !(x1 + w1 + CARD_GAP <= x2 || x2 + w2 + CARD_GAP <= x1 ||
           y1 + h1 + CARD_GAP <= y2 || y2 + h2 + CARD_GAP <= y1);
}

function segHitsRect(ax, ay, bx, by, rx, ry, rw, rh) {
  var edges = [
    [rx, ry, rx + rw, ry],         // top
    [rx + rw, ry, rx + rw, ry + rh], // right
    [rx + rw, ry + rh, rx, ry + rh], // bottom
    [rx, ry + rh, rx, ry]           // left
  ];
  for (var i = 0; i < 4; i++) {
    if (segsIntersect(ax, ay, bx, by, edges[i][0], edges[i][1], edges[i][2], edges[i][3])) return true;
  }
  return false;
}

function rectOverlapsCurveBand(x, y, w, h, R, CX, CY) {
  var bandMin = R - BAND_W / 2 - CURVE_MARGIN;
  var bandMax = R + BAND_W / 2 + CLOCK_BUFFER;
  if (bandMin < 0) bandMin = 0;
  var corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  var minDist = Infinity, maxDist = 0;
  for (var i = 0; i < 4; i++) {
    var d = Math.sqrt((corners[i][0] - CX) * (corners[i][0] - CX) + (corners[i][1] - CY) * (corners[i][1] - CY));
    if (d < minDist) minDist = d;
    if (d > maxDist) maxDist = d;
  }
  // Check closest point on each edge to the circle center
  var edges = [[0,1],[1,2],[2,3],[3,0]];
  for (var i = 0; i < 4; i++) {
    var c0 = corners[edges[i][0]], c1 = corners[edges[i][1]];
    var ex = c1[0] - c0[0], ey = c1[1] - c0[1];
    var len2 = ex * ex + ey * ey;
    if (len2 > 0.001) {
      var t = Math.max(0, Math.min(1, ((CX - c0[0]) * ex + (CY - c0[1]) * ey) / len2));
      var px = c0[0] + t * ex, py = c0[1] + t * ey;
      var d = Math.sqrt((px - CX) * (px - CX) + (py - CY) * (py - CY));
      if (d < minDist) minDist = d;
    }
  }
  return minDist <= bandMax && maxDist >= bandMin;
}

function rectOverlapsEitherBand(x, y, w, h, amR, amCX, amCY, pmR, pmCX, pmCY) {
  return rectOverlapsCurveBand(x, y, w, h, amR, amCX, amCY) ||
         rectOverlapsCurveBand(x, y, w, h, pmR, pmCX, pmCY);
}

// True iff all four corners of the card rect lie in the closed outward
// tangent half-plane at P on circle (CX,CY,R). This is the necessary and
// sufficient condition for every straight line from any point on the rect's
// boundary to P to stay outside the disk interior.
function cardOutsideTangent(rx, ry, rw, rh, PX, PY, CX, CY, R) {
  var nx = PX - CX, ny = PY - CY;
  var threshold = R * R - 0.5;
  var cs = [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]];
  for (var i = 0; i < 4; i++) {
    if ((cs[i][0] - CX) * nx + (cs[i][1] - CY) * ny < threshold) return false;
  }
  return true;
}

function rectEdgePoint(rx, ry, rw, rh, tx, ty) {
  // Find the closest point on the rectangle border to (tx, ty)
  var cx = rx + rw / 2, cy = ry + rh / 2;
  var dx = tx - cx, dy = ty - cy;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { x: rx + rw / 2, y: ry };
  var scaleX = Math.abs(dx) > 0.001 ? (rw / 2) / Math.abs(dx) : Infinity;
  var scaleY = Math.abs(dy) > 0.001 ? (rh / 2) / Math.abs(dy) : Infinity;
  var scale = Math.min(scaleX, scaleY);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/* ── Layout helpers ───────────────────────────────────── */
var NUDGE_STEP   = 6;
var NUDGE_ITERS  = 150;

function segsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  var denom = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(denom) < 0.001) return false;
  var t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denom;
  var u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denom;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
}

// Connector: card edge → band outer edge, always at the item's exact time.
// Placement enforces the outward-tangent rule, so this straight line is
// guaranteed not to enter the disk interior.
function computeConnector(cardX, cardY, cW, cH, curveX, curveY, R, CX, CY) {
  var bandOuter = R + BAND_W / 2 + 2;
  var tdx = curveX - CX, tdy = curveY - CY;
  var td = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
  var bx = CX + (tdx / td) * bandOuter;
  var by = CY + (tdy / td) * bandOuter;
  var edge = rectEdgePoint(cardX, cardY, cW, cH, bx, by);
  return { ex: edge.x, ey: edge.y, bx: bx, by: by };
}

/* ── Area estimation for card sizing ── */
function estimateArea(amR, amCX, amCY, pmR, pmCX, pmCY, vpW, vpH) {
  var total = 0;
  var step = 10;
  for (var y = PADDING; y < vpH - PADDING; y += step) {
    var rowW = vpW - 2 * PADDING;
    // Subtract area blocked by AM circle band
    var amBandMax = amR + BAND_W / 2 + CURVE_MARGIN;
    var dyA = y - amCY;
    if (Math.abs(dyA) < amBandMax) {
      var chordA = Math.sqrt(amBandMax * amBandMax - dyA * dyA);
      var aLeft = Math.max(PADDING, amCX - chordA);
      var aRight = Math.min(vpW - PADDING, amCX + chordA);
      if (aRight > aLeft) rowW -= (aRight - aLeft);
    }
    // Subtract area blocked by PM circle band
    var pmBandMax = pmR + BAND_W / 2 + CURVE_MARGIN;
    var dyP = y - pmCY;
    if (Math.abs(dyP) < pmBandMax) {
      var chordP = Math.sqrt(pmBandMax * pmBandMax - dyP * dyP);
      var pLeft = Math.max(PADDING, pmCX - chordP);
      var pRight = Math.min(vpW - PADDING, pmCX + chordP);
      if (pRight > pLeft) rowW -= (pRight - pLeft);
    }
    if (rowW > 0) total += rowW * step;
  }
  return total;
}

function computeCardSize(count, totalArea, isMobile) {
  if (count === 0) return { w: 120, h: 48 };
  var areaPerCard = (totalArea / count) * 0.65;
  var w = Math.sqrt(areaPerCard * ASPECT_RATIO);
  var h = w / ASPECT_RATIO;
  if (isMobile) {
    w = Math.max(120, Math.min(200, w));
    h = Math.max(29, Math.min(50, h));
  } else {
    w = Math.max(160, Math.min(300, w));
    h = Math.max(34, Math.min(63, h));
  }
  return { w: Math.round(w), h: Math.round(h) };
}

/* ── Card placement ───────────────────────────────────── */

function placeCards(items, cW, cH, amR, amCX, amCY, pmR, pmCX, pmCY, vpW, vpH) {
  if (items.length === 0) return [];

  var P = PADDING;
  var halfW = vpW / 2;
  var hStep = cW + CARD_GAP;
  var vStep = cH + CARD_GAP;

  /* ── Layout geometry (hoisted for slot generation) ── */
  var amLeftX  = P;
  var amRightX = Math.max(P, amCX + amR + BAND_W / 2 + CLOCK_BUFFER);
  var pmLeftX  = Math.max(P, Math.min(vpW - cW - P,
                           pmCX - pmR - BAND_W / 2 - CLOCK_BUFFER - cW));
  var pmRightX = vpW - cW - P;

  var vStepCol = cH + CARD_GAP;
  var colYSt = P + vStepCol;
  var colYEn = vpH - P - vStepCol;
  var colHalfSpan = Math.min(amCY - colYSt, colYEn - amCY);
  colYSt = Math.round(amCY - colHalfSpan);
  colYEn = Math.round(amCY + colHalfSpan);

  var amHalfSpan = Math.min(amCX - P, halfW - CARD_GAP - amCX);
  var amRowXSt = Math.round(amCX - amHalfSpan);
  var amRowXEn = Math.round(amCX + amHalfSpan);
  var pmHalfSpan = Math.min(pmCX - halfW - CARD_GAP, vpW - P - pmCX);
  var pmRowXSt = Math.round(pmCX - pmHalfSpan);
  var pmRowXEn = Math.round(pmCX + pmHalfSpan);

  /* ── Generate candidate slots ──
   * Slots match the exact positions the sector layout uses so every
   * card the monotone assignment needs has a valid slot. */
  var raw = [];

  var colXs = [amLeftX, amRightX, pmLeftX, pmRightX];
  for (var ci = 0; ci < colXs.length; ci++) {
    for (var y = colYSt; y + cH <= colYEn; y += vStep) {
      raw.push({ x: Math.round(colXs[ci]), y: Math.round(y) });
    }
  }

  var rowRanges = [
    [amRowXSt, amRowXEn],
    [pmRowXSt, pmRowXEn]
  ];
  for (var ri = 0; ri < rowRanges.length; ri++) {
    var rxSt = rowRanges[ri][0], rxEn = rowRanges[ri][1];
    for (var x = rxSt; x + cW <= rxEn; x += hStep) {
      raw.push({ x: Math.round(x), y: P });
      raw.push({ x: Math.round(x), y: vpH - P - cH });
      raw.push({ x: Math.round(x), y: P + cH + CARD_GAP });
      raw.push({ x: Math.round(x), y: vpH - P - 2 * cH - CARD_GAP });
    }
  }

  // Remove slots that overlap either circle band
  var slots = [];
  for (var i = 0; i < raw.length; i++) {
    if (rectOverlapsEitherBand(raw[i].x, raw[i].y, cW, cH, amR, amCX, amCY, pmR, pmCX, pmCY)) continue;
    // Check no overlap with already accepted slots
    var ok = true;
    for (var j = 0; j < slots.length; j++) {
      if (rectsOverlap(raw[i].x, raw[i].y, cW, cH, slots[j].x, slots[j].y, cW, cH)) { ok = false; break; }
    }
    if (ok) slots.push(raw[i]);
  }

  if (slots.length === 0) return [];

  /* ── Other-circle horizontal bound ──
   * With the viewport split in half, the centre line is the boundary.
   * AM cards stay entirely in the left half, PM cards in the right. */
  var amRightLimit = halfW;   // AM cards: x + cW ≤ this
  var pmLeftLimit  = halfW;   // PM cards: x ≥ this

  /* ── Build item data, split by AM/PM ──
   * itemAng is the clock angle of the task on its own circle (0-2π, with
   * 12 at top and going clockwise). Used for the monotone matching below. */
  function itemClockAngle(mins) {
    var halfMins = mins < 720 ? mins : mins - 720;
    return (halfMins / 720) * 2 * Math.PI;
  }
  var amItems = [], pmItems = [];
  for (var i = 0; i < items.length; i++) {
    var pos = minutesToDualPosition(items[i].mins, amR, amCX, amCY, pmR, pmCX, pmCY);
    var entry = { item: items[i], pos: pos, itemAng: itemClockAngle(items[i].mins) };
    if (pos.isAM) { amItems.push(entry); } else { pmItems.push(entry); }
  }
  amItems.sort(function (a, b) { return a.itemAng - b.itemAng; });
  pmItems.sort(function (a, b) { return a.itemAng - b.itemAng; });

  /* Slot eligibility by the other-circle horizontal rule */
  var amSlotList = [], pmSlotList = [];
  for (var i = 0; i < slots.length; i++) {
    if (slots[i].x + cW <= amRightLimit) amSlotList.push(i);
    if (slots[i].x >= pmLeftLimit)       pmSlotList.push(i);
  }

  /* Per-side slot clock angle (0-2π on that circle) */
  function slotClockAngleRel(slotIdx, CX, CY) {
    var scx = slots[slotIdx].x + cW / 2;
    var scy = slots[slotIdx].y + cH / 2;
    var ma = Math.atan2(-(scy - CY), scx - CX);
    var ca = Math.PI / 2 - ma;
    if (ca < 0) ca += 2 * Math.PI;
    if (ca >= 2 * Math.PI) ca -= 2 * Math.PI;
    return ca;
  }
  var amSlotEntries = amSlotList.map(function (k) {
    return { k: k, ang: slotClockAngleRel(k, amCX, amCY) };
  });
  var pmSlotEntries = pmSlotList.map(function (k) {
    return { k: k, ang: slotClockAngleRel(k, pmCX, pmCY) };
  });

  /* ── Monotone angular assignment ──
   * With items and slots both sorted by clock angle on the same circle,
   * assigning item i to a slot whose angle is ≥ item (i-1)'s slot angle
   * produces crossing-free leader lines. To handle angular wrap, we cut the
   * circle at the largest gap between consecutive items and linearize from
   * there — so the "last" item in the walk sits just before the empty arc.
   * Within that linearization we do a monotone greedy with a tangent-safety
   * filter. If the monotone walk stalls for an item (no tangent-safe slot
   * ahead of the pointer) we fall back to the globally nearest tangent-safe
   * slot; if even that fails, we pick any unused slot and warn. */
  function assignMonotoneSide(sortedItems, slotEntries, usedSlot) {
    var n = sortedItems.length;
    var assignments = new Array(n);
    if (n === 0) return assignments;

    // Find largest angular gap between consecutive items (wrap-aware).
    var startIdx = 0;
    var bestGap = 2 * Math.PI - (sortedItems[n - 1].itemAng - sortedItems[0].itemAng);
    for (var i = 1; i < n; i++) {
      var gap = sortedItems[i].itemAng - sortedItems[i - 1].itemAng;
      if (gap > bestGap) { bestGap = gap; startIdx = i; }
    }
    var startAng = sortedItems[startIdx].itemAng;
    function norm(a) {
      var v = a - startAng;
      while (v < 0) v += 2 * Math.PI;
      while (v >= 2 * Math.PI) v -= 2 * Math.PI;
      return v;
    }

    // Linearize slots into normalized angle order, filtering already-used.
    var linear = [];
    for (var i = 0; i < slotEntries.length; i++) {
      var e = slotEntries[i];
      if (usedSlot[e.k]) continue;
      linear.push({ k: e.k, ang: norm(e.ang) });
    }
    linear.sort(function (a, b) { return a.ang - b.ang; });

    function tangentSafeFor(it, k) {
      var p = it.pos;
      return cardOutsideTangent(slots[k].x, slots[k].y, cW, cH, p.x, p.y, p.circleCX, p.circleCY, p.circleR);
    }

    var ptr = 0;
    for (var step = 0; step < n; step++) {
      var itemIdx = (startIdx + step) % n;
      var it = sortedItems[itemIdx];
      var picked = -1;

      // Monotone walk: first tangent-safe slot at or after ptr.
      for (var j = ptr; j < linear.length; j++) {
        if (usedSlot[linear[j].k]) continue;
        if (!tangentSafeFor(it, linear[j].k)) continue;
        picked = j;
        break;
      }

      // Fallback 1: nearest tangent-safe slot anywhere (may break monotone).
      if (picked < 0) {
        var bestJ = -1, bestDiff = Infinity;
        var target = norm(it.itemAng);
        for (var j = 0; j < linear.length; j++) {
          if (usedSlot[linear[j].k]) continue;
          if (!tangentSafeFor(it, linear[j].k)) continue;
          var d = linear[j].ang - target;
          if (d < 0) d = -d;
          if (d < bestDiff) { bestDiff = d; bestJ = j; }
        }
        picked = bestJ;
      }

      // Fallback 2: nearest unused slot regardless of tangent (warns; leader may chord).
      if (picked < 0) {
        var bestJ2 = -1, bestDiff2 = Infinity;
        var target2 = norm(it.itemAng);
        for (var j = 0; j < linear.length; j++) {
          if (usedSlot[linear[j].k]) continue;
          var d2 = linear[j].ang - target2;
          if (d2 < 0) d2 = -d2;
          if (d2 < bestDiff2) { bestDiff2 = d2; bestJ2 = j; }
        }
        picked = bestJ2;
        if (picked >= 0 && typeof console !== 'undefined' && console.warn) {
          console.warn('SCurveTimeline: no tangent-safe slot for item', it.item && it.item.id);
        }
      }

      if (picked < 0) { assignments[itemIdx] = -1; continue; }
      usedSlot[linear[picked].k] = true;
      assignments[itemIdx] = linear[picked].k;
      // Only advance pointer on a forward (monotone) pick.
      if (picked >= ptr) ptr = picked + 1;
    }
    return assignments;
  }

  var usedSlot = {};
  var amAssigns = assignMonotoneSide(amItems, amSlotEntries, usedSlot);
  var pmAssigns = assignMonotoneSide(pmItems, pmSlotEntries, usedSlot);

  var cards = [];
  function pushAssigned(sortedItems, assigns) {
    for (var i = 0; i < sortedItems.length; i++) {
      var s = assigns[i];
      if (s == null || s < 0) continue;
      var it = sortedItems[i];
      cards.push({
        x: slots[s].x, y: slots[s].y,
        curveX: it.pos.x, curveY: it.pos.y,
        circleR: it.pos.circleR,
        circleCX: it.pos.circleCX,
        circleCY: it.pos.circleCY,
        isAM: it.pos.isAM,
        item: it.item
      });
    }
  }
  pushAssigned(amItems, amAssigns);
  pushAssigned(pmItems, pmAssigns);

  /* ── Connector helpers ── */
  function cardLine(c) {
    return computeConnector(c.x, c.y, cW, cH, c.curveX, c.curveY, c.circleR, c.circleCX, c.circleCY);
  }
  function cardLineAt(nx, ny, c) {
    return computeConnector(nx, ny, cW, cH, c.curveX, c.curveY, c.circleR, c.circleCX, c.circleCY);
  }

  function posValidBasic(nx, ny, skipIdx) {
    if (nx < P || nx + cW > vpW - P || ny < P || ny + cH > vpH - P) return false;
    // Don't cross into the other circle's horizontal column.
    if (skipIdx >= 0 && skipIdx < cards.length) {
      if (cards[skipIdx].isAM  && nx + cW > amRightLimit) return false;
      if (!cards[skipIdx].isAM && nx      < pmLeftLimit)  return false;
    }
    if (rectOverlapsEitherBand(nx, ny, cW, cH, amR, amCX, amCY, pmR, pmCX, pmCY)) return false;
    for (var j = 0; j < cards.length; j++) {
      if (j === skipIdx) continue;
      if (rectsOverlap(nx, ny, cW, cH, cards[j].x, cards[j].y, cW, cH)) return false;
    }
    // Tangent half-plane rule: guarantees the leader line can't chord the disk.
    if (skipIdx >= 0 && skipIdx < cards.length) {
      var c = cards[skipIdx];
      if (!cardOutsideTangent(nx, ny, cW, cH, c.curveX, c.curveY, c.circleCX, c.circleCY, c.circleR)) return false;
    }
    return true;
  }

  function posValid(nx, ny, skipIdx) {
    if (!posValidBasic(nx, ny, skipIdx)) return false;
    var ml = cardLineAt(nx, ny, cards[skipIdx]);
    for (var j = 0; j < cards.length; j++) {
      if (j === skipIdx) continue;
      var ol = cardLine(cards[j]);
      if (segHitsRect(ol.ex, ol.ey, ol.bx, ol.by, nx, ny, cW, cH)) return false;
      if (segHitsRect(ml.ex, ml.ey, ml.bx, ml.by, cards[j].x, cards[j].y, cW, cH)) return false;
    }
    return true;
  }

  function cardCrossings(idx) {
    var c = cards[idx];
    var cl = cardLine(c);
    var count = 0;
    for (var j = 0; j < cards.length; j++) {
      if (j === idx) continue;
      var ol = cardLine(cards[j]);
      if (segsIntersect(cl.ex, cl.ey, cl.bx, cl.by, ol.ex, ol.ey, ol.bx, ol.by)) count++;
      if (segHitsRect(cl.ex, cl.ey, cl.bx, cl.by, cards[j].x, cards[j].y, cW, cH)) count++;
      if (segHitsRect(ol.ex, ol.ey, ol.bx, ol.by, c.x, c.y, cW, cH)) count++;
    }
    return count;
  }

  /* ── Sector-based border layout ──
   * Classify each card's connection-point angle into one of four
   * sectors (right/top/left/bottom), then split top and bottom rows
   * per-circle so AM and PM cards stay in their own halves. Columns
   * start from the top, rows start from the left — no centering. */
  function classifySector(c) {
    var dy = c.curveY - c.circleCY;
    var dx = c.curveX - c.circleCX;
    var rad = Math.atan2(-dy, dx);
    var deg = rad * 180 / Math.PI;
    while (deg < 0) deg += 360;
    while (deg >= 360) deg -= 360;
    if (deg >= 315 || deg < 45) return 'right';
    if (deg < 135) return 'top';
    if (deg < 225) return 'left';
    return 'bottom';
  }
  var groups = {
    amLeft: [], amRight: [], pmLeft: [], pmRight: [],
    amTop: [], amBottom: [], pmTop: [], pmBottom: []
  };
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var sector = classifySector(c);
    if (c.isAM) {
      if (sector === 'top')         groups.amTop.push(i);
      else if (sector === 'bottom') groups.amBottom.push(i);
      else if (sector === 'left')   groups.amLeft.push(i);
      else                          groups.amRight.push(i);
    } else {
      if (sector === 'top')         groups.pmTop.push(i);
      else if (sector === 'bottom') groups.pmBottom.push(i);
      else if (sector === 'left')   groups.pmLeft.push(i);
      else                          groups.pmRight.push(i);
    }
  }
  function byCurveY(a, b) { return cards[a].curveY - cards[b].curveY; }
  function byCurveX(a, b) { return cards[a].curveX - cards[b].curveX; }
  groups.amLeft.sort(byCurveY);
  groups.amRight.sort(byCurveY);
  groups.pmLeft.sort(byCurveY);
  groups.pmRight.sort(byCurveY);
  groups.amTop.sort(byCurveX);
  groups.amBottom.sort(byCurveX);
  groups.pmTop.sort(byCurveX);
  groups.pmBottom.sort(byCurveX);

  /* ── Sector overflow redistribution ──
   * Compute capacity for each row/column sector. When a sector has
   * more cards than it can fit without overlap, spill the excess cards
   * (those nearest the sector boundary) into the adjacent sector. */
  function rowCapacity(xSt, xEn) {
    var avail = xEn - xSt;
    if (avail < cW) return 0;
    var minStepX = (cW + CARD_GAP) / 2;
    return Math.max(1, Math.floor((avail - cW) / minStepX) + 1);
  }
  function colCapacity(ySt, yEn) {
    var avail = yEn - ySt;
    if (avail < cH) return 0;
    return Math.floor((avail + CARD_GAP) / (cH + CARD_GAP));
  }

  function spillOverflow(rowGroup, leftCol, rightCol, rowCap, colCap) {
    if (rowGroup.length <= rowCap) return;
    var excess = rowGroup.length - rowCap;
    var leftRoom  = Math.max(0, colCap - leftCol.length);
    var rightRoom = Math.max(0, colCap - rightCol.length);
    var maxSpill = leftRoom + rightRoom;
    if (excess > maxSpill) excess = maxSpill;
    var leftLoad = leftCol.length;
    var rightLoad = rightCol.length;
    for (var sp = 0; sp < excess; sp++) {
      var leftFree  = colCap - leftLoad;
      var rightFree = colCap - rightLoad;
      if (leftFree <= 0 && rightFree <= 0) break;
      if (leftFree > 0 && (leftLoad <= rightLoad || rightFree <= 0)) {
        leftCol.push(rowGroup.shift());
        leftLoad++;
      } else if (rightFree > 0) {
        rightCol.push(rowGroup.pop());
        rightLoad++;
      } else {
        break;
      }
    }
  }

  var amRowCap = rowCapacity(amRowXSt, amRowXEn);
  var pmRowCap = rowCapacity(pmRowXSt, pmRowXEn);
  var colCap   = colCapacity(colYSt, colYEn);
  spillOverflow(groups.amTop,    groups.amLeft, groups.amRight, amRowCap, colCap);
  spillOverflow(groups.amBottom, groups.amLeft, groups.amRight, amRowCap, colCap);
  spillOverflow(groups.pmTop,    groups.pmLeft, groups.pmRight, pmRowCap, colCap);
  spillOverflow(groups.pmBottom, groups.pmLeft, groups.pmRight, pmRowCap, colCap);

  // Re-sort after redistribution.
  function byCurveY2(a, b) { return cards[a].curveY - cards[b].curveY; }
  function byCurveX2(a, b) { return cards[a].curveX - cards[b].curveX; }
  groups.amLeft.sort(byCurveY2);
  groups.amRight.sort(byCurveY2);
  groups.pmLeft.sort(byCurveY2);
  groups.pmRight.sort(byCurveY2);
  groups.amTop.sort(byCurveX2);
  groups.amBottom.sort(byCurveX2);
  groups.pmTop.sort(byCurveX2);
  groups.pmBottom.sort(byCurveX2);

  /* ── Layout helpers ── */
  function layoutVerticalColumn(indices, colX, yStart, yEnd) {
    var n = indices.length;
    if (n === 0) return;
    var avail = yEnd - yStart;
    var step = cH + CARD_GAP;
    var totalH = n * cH + (n - 1) * CARD_GAP;
    // Centre when cards fit; overflow downward when they don't
    // (no compression — contentH will grow and parent scrolls).
    var startY = totalH <= avail
      ? yStart + (avail - totalH) / 2
      : yStart;
    for (var k = 0; k < n; k++) {
      cards[indices[k]].x = Math.round(colX);
      cards[indices[k]].y = Math.round(startY + k * step);
    }
  }

  function layoutHorizontalRow(indices, boundaryY, towardDir, xStart, xEnd) {
    var n = indices.length;
    if (n === 0) return;
    var avail = xEnd - xStart;
    var singleNeeded = n * cW + (n - 1) * CARD_GAP;
    var useStep = (n > 1) && (singleNeeded > avail);
    if (!useStep) {
      var step = n > 1 ? Math.min(cW + CARD_GAP, (avail - cW) / (n - 1)) : 0;
      var totalSpan = (n - 1) * step;
      var startX = xStart + (avail - cW - totalSpan) / 2;
      if (startX < xStart) startX = xStart;
      for (var k = 0; k < n; k++) {
        cards[indices[k]].x = Math.round(startX + k * step);
        cards[indices[k]].y = boundaryY;
      }
      return;
    }
    // Step pattern: alternate between two y-levels. Enforce minimum
    // stepX so same-row cards (2·stepX apart) don't overlap.
    var minStepX = (cW + CARD_GAP) / 2;
    var stepX = Math.max(minStepX, (avail - cW) / (n - 1));
    var totalStepSpan = (n - 1) * stepX;
    var startStepX = xStart + (avail - cW - totalStepSpan) / 2;
    if (startStepX < xStart) startStepX = xStart;
    var altY = boundaryY + towardDir * (cH + CARD_GAP);
    for (var k = 0; k < n; k++) {
      cards[indices[k]].x = Math.round(startStepX + k * stepX);
      cards[indices[k]].y = (k % 2 === 0) ? boundaryY : altY;
    }
  }

  // Columns — centred vertically on circleCY.
  layoutVerticalColumn(groups.amLeft,  amLeftX,  colYSt, colYEn);
  layoutVerticalColumn(groups.amRight, amRightX, colYSt, colYEn);
  layoutVerticalColumn(groups.pmLeft,  pmLeftX,  colYSt, colYEn);
  layoutVerticalColumn(groups.pmRight, pmRightX, colYSt, colYEn);

  // Rows — centred horizontally on circleCX.
  layoutHorizontalRow(groups.amTop,    P,            +1, amRowXSt, amRowXEn);
  layoutHorizontalRow(groups.amBottom, vpH - cH - P, -1, amRowXSt, amRowXEn);
  layoutHorizontalRow(groups.pmTop,    P,            +1, pmRowXSt, pmRowXEn);
  layoutHorizontalRow(groups.pmBottom, vpH - cH - P, -1, pmRowXSt, pmRowXEn);

  /* ── Final safety-net ──
   * Clamp horizontally to viewport, push cards off circle bands,
   * nudge stacked cards. No vertical ceiling — contentH grows to
   * fit overflow and the parent container scrolls. */
  for (var ci = 0; ci < cards.length; ci++) {
    var cc = cards[ci];
    if (cc.x < P)            cc.x = P;
    if (cc.x + cW > vpW - P) cc.x = vpW - P - cW;
    if (cc.y < P)            cc.y = P;

    for (var pass = 0; pass < 5; pass++) {
      if (!rectOverlapsEitherBand(cc.x, cc.y, cW, cH, amR, amCX, amCY, pmR, pmCX, pmCY)) break;
      var dx = (cc.x + cW / 2) - (cc.isAM ? amCX : pmCX);
      var dy = (cc.y + cH / 2) - (cc.isAM ? amCY : pmCY);
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;
      cc.x += Math.round(dx / dist * 20);
      cc.y += Math.round(dy / dist * 20);
      if (cc.x < P)            cc.x = P;
      if (cc.x + cW > vpW - P) cc.x = vpW - P - cW;
      if (cc.y < P)            cc.y = P;
    }
  }

  // Nudge stacked cards so no two occupy the exact same position.
  for (var ci = 0; ci < cards.length; ci++) {
    for (var cj = ci + 1; cj < cards.length; cj++) {
      if (Math.abs(cards[ci].x - cards[cj].x) < 2 && Math.abs(cards[ci].y - cards[cj].y) < 2) {
        cards[cj].y += cH + CARD_GAP;
      }
    }
  }

  /* ── Post-placement invariant check ── */
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (!cardOutsideTangent(c.x, c.y, cW, cH, c.curveX, c.curveY, c.circleCX, c.circleCY, c.circleR)) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('SCurveTimeline: leader line will cross circle for item', c.item && c.item.item && c.item.item.id);
      }
    }
  }

  /* ── Build result ── */
  var result = [];
  for (var i = 0; i < cards.length; i++) {
    result.push({
      item: cards[i].item.item,
      curveX: cards[i].curveX, curveY: cards[i].curveY,
      circleR: cards[i].circleR,
      circleCX: cards[i].circleCX,
      circleCY: cards[i].circleCY,
      cardX: Math.round(cards[i].x), cardY: Math.round(cards[i].y),
      blockColor: cards[i].item.blockColor
    });
  }
  return result;
}

/* ── Component ─────────────────────────────────────────── */
export default function SCurveTimeline(props) {
  var placements     = props.placements;
  var statuses       = props.statuses;
  var onStatusChange = props.onStatusChange;
  var onDelete       = props.onDelete;
  var onExpand       = props.onExpand;
  var darkMode       = props.darkMode;
  var nowMins        = props.nowMins;
  var isToday        = props.isToday;
  var blockedTaskIds = props.blockedTaskIds;
  var isMobile       = props.isMobile;
  var dateKey        = props.dateKey;
  var schedCfg       = props.schedCfg || {};

  var vpW            = props.viewportWidth  || 800;
  var vpH            = props.viewportHeight || 600;

  var theme = getTheme(darkMode);

  /* ── Responsive card + circle sizing ──
   * 1. Split viewport into two equal halves.
   * 2. Circle diameter = 1/3 of min(halfW, layoutH), so the circle
   *    scales proportionally and stays readable.
   * 3. Remaining area (half minus circle footprint) × 75% is the
   *    budget for task cards. Divide by the max task count on any
   *    single sector to get per-card area, then derive cW/cH from
   *    that. All cards use the same size.
   */

  // Count visible tasks per half so we can size cards.
  var amCount = 0, pmCount = 0;
  var visiblePlacements = (placements || []).filter(function (p) {
    var s = statuses && p.task ? statuses[p.task.id] : null;
    return !isTerminalStatus(s);
  });
  for (var vi = 0; vi < visiblePlacements.length; vi++) {
    var st = visiblePlacements[vi].start;
    if (st != null && st < 720) amCount++;
    else pmCount++;
  }
  var maxSideCount = Math.max(amCount, pmCount, 1);

  var MIN_R  = 40;
  var MAX_R  = 250;
  var MIN_CW = 110;
  var MAX_CW = 280;
  var MIN_CH = 40;
  var HALF_FIXED = PADDING + CARD_GAP + 2 * CLOCK_BUFFER + BAND_W;

  // Minimum content dimensions for a comfortable layout.
  var COMFORT_R  = 100;
  var COMFORT_CW = 150;
  var COMFORT_CH = Math.round(COMFORT_CW / ASPECT_RATIO);
  var MIN_CONTENT_W = 2 * (HALF_FIXED + 2 * COMFORT_CW + 2 * COMFORT_R);
  var MIN_CONTENT_H = 2 * (PADDING + 2 * COMFORT_CH + CARD_GAP + CLOCK_BUFFER + BAND_W / 2 + COMFORT_R) + 40;

  var scrollMode = vpW < MIN_CONTENT_W || vpH < MIN_CONTENT_H;
  var layoutW = Math.max(vpW, MIN_CONTENT_W);
  var layoutH = Math.max(vpH, MIN_CONTENT_H);
  var halfW = layoutW / 2;
  var smallerDim = Math.min(halfW, layoutH);

  // Step 1: circle radius from layout dimensions.
  var R = Math.round(Math.max(MIN_R, Math.min(MAX_R, smallerDim * 0.225)));

  // Step 2: max card width that fits geometrically.
  var geoCW = Math.floor((halfW - HALF_FIXED - 2 * R) / 2);
  if (geoCW < MIN_CW) {
    R = Math.floor((halfW - HALF_FIXED - 2 * MIN_CW) / 2);
    if (R < MIN_R) R = MIN_R;
    geoCW = Math.floor((halfW - HALF_FIXED - 2 * R) / 2);
  }

  // Step 3: area budget caps cW when there are many tasks.
  var halfArea = halfW * layoutH;
  var circleArea = Math.PI * (R + BAND_W / 2) * (R + BAND_W / 2);
  var cardBudgetArea = (halfArea - circleArea) * 0.75;
  var perCardArea = cardBudgetArea / maxSideCount;
  var areaCW = Math.sqrt(perCardArea * ASPECT_RATIO);

  var cW = Math.round(Math.max(MIN_CW, Math.min(MAX_CW, geoCW, areaCW)));

  // Step 4: card height, capped by vertical space above/below circle.
  var cH = Math.max(MIN_CH, Math.min(70, Math.round(cW / ASPECT_RATIO)));
  var rowSpace = layoutH / 2 - R - BAND_W / 2 - CLOCK_BUFFER - PADDING;
  var maxRowCH = Math.floor((rowSpace - CARD_GAP) / 2);
  if (maxRowCH >= MIN_CH && cH > maxRowCH) {
    cH = maxRowCH;
    cW = Math.round(Math.min(cW, cH * ASPECT_RATIO));
    if (cW < MIN_CW) cW = MIN_CW;
  }

  // Circle centres (within layout dimensions, not viewport).
  var amCX = halfW / 2;
  var pmCX = halfW + halfW / 2;
  var amCY = layoutH / 2;
  var pmCY = layoutH / 2;

  // Clamp so circles don't go off-screen.
  var minEdge = R + BAND_W / 2 + PADDING + 10;
  if (amCX < minEdge) amCX = minEdge;
  if (pmCX > layoutW - minEdge) pmCX = layoutW - minEdge;

  var amR = R;
  var pmR = R;

  /* ── Time blocks ── */
  var blocks = useMemo(function () {
    if (!dateKey || !schedCfg.timeBlocks) return [];
    return getBlocksForDate(dateKey, schedCfg.timeBlocks, schedCfg);
  }, [dateKey, schedCfg]);

  /* ── Curve samples for both circles ── */
  var curveSamples = useMemo(function () {
    var defColor   = theme.badgeText;
    var nightColor = darkMode ? theme.bgCard : theme.bgTertiary;
    var am = [], pm = [];

    for (var m = 0; m <= 720; m += SAMPLE_STEP) {
      var mins = m % 720;
      var pos = minutesToDualPosition(mins, amR, amCX, amCY, pmR, pmCX, pmCY);
      var blk = getBlockAtMinute(mins, blocks);
      var color = blk ? (blk.color || defColor)
                      : (mins >= 360 ? defColor : nightColor);
      am.push({ x: pos.x, y: pos.y, color: color });
    }
    for (var m = 720; m <= 1440; m += SAMPLE_STEP) {
      var mins = m === 1440 ? 720 : m;  // wrap end to start of PM
      var pos = minutesToDualPosition(mins, amR, amCX, amCY, pmR, pmCX, pmCY);
      var blk = getBlockAtMinute(mins, blocks);
      var color = blk ? (blk.color || defColor)
                      : (mins < 1080 ? defColor : nightColor);
      pm.push({ x: pos.x, y: pos.y, color: color });
    }
    return { am: am, pm: pm };
  }, [amR, amCX, amCY, pmR, pmCX, pmCY, blocks, darkMode]);

  /* ── Interior arc segments ── */
  var INNER_LOC_W = 33;
  var INNER_WHEN_W = 27;

  function makeBlockSegments(circleBlocks, circR, circCX, circCY, halfOffset) {
    return circleBlocks.map(function (blk) {
      var innerLocR = circR - BAND_W / 2 - INNER_LOC_W / 2 - 3;
      var innerWhenR = innerLocR - INNER_LOC_W / 2 - INNER_WHEN_W / 2 - 2;

      var midMins = (blk.start + blk.end) / 2;
      // Angles within this half-day circle
      var startHalf = blk.start - halfOffset;  // 0-based within this half
      var endHalf = blk.end - halfOffset;
      var midHalf = midMins - halfOffset;

      function halfAngle(halfMins) {
        var t = halfMins / 720;
        return Math.PI / 2 - t * 2 * Math.PI;
      }

      function arcPath(r) {
        var sA = halfAngle(startHalf);
        var eA = halfAngle(endHalf);
        var x1 = circCX + r * Math.cos(sA);
        var y1 = circCY - r * Math.sin(sA);
        var x2 = circCX + r * Math.cos(eA);
        var y2 = circCY - r * Math.sin(eA);
        var spanAngle = (endHalf - startHalf) / 720 * 2 * Math.PI;
        var sweep = spanAngle > Math.PI ? 1 : 0;
        return 'M ' + x1 + ' ' + y1 + ' A ' + r + ' ' + r + ' 0 ' + sweep + ' 1 ' + x2 + ' ' + y2;
      }

      var midA = halfAngle(midHalf);
      var locX = circCX + innerLocR * Math.cos(midA);
      var locY = circCY - innerLocR * Math.sin(midA);
      var whenX = circCX + innerWhenR * Math.cos(midA);
      var whenY = circCY - innerWhenR * Math.sin(midA);

      return {
        locPath: arcPath(innerLocR),
        whenPath: arcPath(innerWhenR),
        locColor: (blk.loc && LOC_TINT[blk.loc]) || theme.badgeText,
        whenColor: blk.color || theme.badgeText,
        locLabel: blk.loc ? locIcon(blk.loc) : '',
        locX: locX, locY: locY,
        whenLabel: (blk.icon || '') + ' ' + (blk.name || blk.tag || ''),
        whenX: whenX, whenY: whenY
      };
    });
  }

  var blockSegments = useMemo(function () {
    var amBlocks = blocks.filter(function (b) { return b.start < 720; });
    var pmBlocks = blocks.filter(function (b) { return b.end > 720; });
    // Clamp AM blocks to 0–720
    amBlocks = amBlocks.map(function (b) {
      return Object.assign({}, b, { end: Math.min(b.end, 720) });
    });
    // Clamp PM blocks to 720–1440, offset to 0-based
    pmBlocks = pmBlocks.map(function (b) {
      return Object.assign({}, b, { start: Math.max(b.start, 720) });
    });

    var amSegs = makeBlockSegments(amBlocks, amR, amCX, amCY, 0);
    var pmSegs = makeBlockSegments(pmBlocks, pmR, pmCX, pmCY, 720);
    return { am: amSegs, pm: pmSegs };
  }, [blocks, amR, amCX, amCY, pmR, pmCX, pmCY, darkMode, isMobile, INNER_LOC_W, INNER_WHEN_W]);

  /* ── Hour markers ── */
  var hourMarkers = useMemo(function () {
    var out = [];
    for (var h = 0; h < 24; h++) {
      var mins = h * 60;
      var pos = minutesToDualPosition(mins, amR, amCX, amCY, pmR, pmCX, pmCY);
      out.push({
        hour: h, x: pos.x, y: pos.y, nx: pos.nx, ny: pos.ny,
        showLabel: h % 3 === 0,
        circleCX: pos.circleCX, circleCY: pos.circleCY
      });
    }
    return out;
  }, [amR, amCX, amCY, pmR, pmCX, pmCY]);

  /* ── Card layout ── */
  var cardLayout = useMemo(function () {
    // Hide terminal-status tasks (done / cancel / skip) from the clock view.
    var visible = (placements || []).filter(function (p) {
      var s = statuses && p.task ? statuses[p.task.id] : null;
      return !isTerminalStatus(s);
    });
    var sorted = visible.slice().sort(function (a, b) { return a.start - b.start; });

    var defColor = theme.badgeText;
    var allItems = [];
    for (var i = 0; i < sorted.length; i++) {
      var item = sorted[i];
      var startMins = item.start != null ? item.start : 720;
      var rawDur = (item.dur != null ? item.dur : (item.task && item.task.dur)) || 0;
      if (rawDur < 5) rawDur = 5;
      // Clamp the arc to its starting half-day circle and point the leader
      // at the midpoint of the visible arc.
      var halfCap = startMins < 720 ? 720 : 1440;
      var endMins = Math.min(startMins + rawDur, halfCap);
      var midMins = (startMins + endMins) / 2;
      var blk = getBlockAtMinute(startMins, blocks);
      var blockColor = blk ? (blk.color || defColor) : defColor;
      allItems.push({ item: item, mins: midMins, blockColor: blockColor });
    }

    var cards = placeCards(allItems, cW, cH, amR, amCX, amCY, pmR, pmCX, pmCY, layoutW, layoutH);
    return { cards: cards };
  }, [placements, statuses, amR, amCX, amCY, pmR, pmCX, pmCY, cW, cH, layoutW, layoutH, isMobile, blocks, darkMode, scrollMode, R]);

  var cards = cardLayout.cards;
  var layoutMode = cH < 55 ? 'compact' : 'normal';

  /* ── Now indicator ── */
  var nowPos = useMemo(function () {
    if (!isToday || nowMins == null) return null;
    return minutesToDualPosition(nowMins, amR, amCX, amCY, pmR, pmCX, pmCY);
  }, [isToday, nowMins, amR, amCX, amCY, pmR, pmCX, pmCY]);

  /* ── Content dimensions ──
   * contentH may grow beyond layoutH if cards overflow vertically. */
  var contentW = layoutW;
  var contentH = layoutH;
  for (var ci = 0; ci < cards.length; ci++) {
    var bot = cards[ci].cardY + cH + PADDING;
    if (bot > contentH) contentH = bot;
  }

  /* ── Render helper for one circle's curve segments ── */
  function renderCurve(samples, prefix) {
    return samples.map(function (s, i) {
      if (i === 0) return null;
      var p = samples[i - 1];
      return (
        <g key={prefix + i}>
          <line x1={p.x} y1={p.y} x2={s.x} y2={s.y}
            stroke={s.color} strokeWidth={BAND_W}
            strokeLinecap="round" opacity={0.55} />
          <line x1={p.x} y1={p.y} x2={s.x} y2={s.y}
            stroke={theme.badgeText} strokeWidth={2}
            strokeLinecap="round" />
        </g>
      );
    });
  }

  function renderBlockSegs(segs, prefix) {
    return segs.map(function (seg, i) {
      return (
        <g key={prefix + i}>
          <path d={seg.locPath} fill="none"
            stroke={seg.locColor} strokeWidth={INNER_LOC_W}
            strokeLinecap="butt" opacity={0.35} />
          <path d={seg.whenPath} fill="none"
            stroke={seg.whenColor} strokeWidth={INNER_WHEN_W}
            strokeLinecap="butt" opacity={0.3} />
          {seg.locLabel ? (
            <text x={seg.locX} y={seg.locY}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={isMobile ? 14 : 18}>
              {seg.locLabel}
            </text>
          ) : null}
          <text x={seg.whenX} y={seg.whenY}
            textAnchor="middle" dominantBaseline="middle"
            fill={theme.text}
            fontSize={isMobile ? 9 : 11} fontWeight={700}
            fontFamily="'Inter', system-ui" opacity={0.8}>
            {seg.whenLabel}
          </text>
        </g>
      );
    });
  }

  /* ── Render ── */
  return (
    <div style={{ position: 'relative', width: contentW, height: contentH, minHeight: layoutH, overflow: 'visible' }}>
      <svg style={{
        position: 'absolute', left: 0, top: 0,
        width: contentW, height: contentH,
        pointerEvents: 'none'
      }}>

        {/* AM circle */}
        {renderCurve(curveSamples.am, 'am')}
        {renderBlockSegs(blockSegments.am, 'amSeg')}

        {/* PM circle */}
        {renderCurve(curveSamples.pm, 'pm')}
        {renderBlockSegs(blockSegments.pm, 'pmSeg')}

        {/* AM / PM center labels */}
        <text x={amCX} y={amCY}
          textAnchor="middle" dominantBaseline="middle"
          fill={theme.textMuted}
          fontSize={isMobile ? 16 : 22} fontWeight={700}
          fontFamily="'Inter', system-ui" opacity={0.35}>
          AM
        </text>
        <text x={pmCX} y={pmCY}
          textAnchor="middle" dominantBaseline="middle"
          fill={theme.textMuted}
          fontSize={isMobile ? 16 : 22} fontWeight={700}
          fontFamily="'Inter', system-ui" opacity={0.35}>
          PM
        </text>

        {/* Hour tick marks + labels */}
        {hourMarkers.map(function (m) {
          var dx = m.x - m.circleCX;
          var dy = m.y - m.circleCY;
          var d  = Math.sqrt(dx * dx + dy * dy) || 1;
          var outX = dx / d;
          var outY = dy / d;

          return (
            <g key={'h' + m.hour}>
              <circle cx={m.x} cy={m.y} r={m.showLabel ? 3 : 2}
                fill={theme.badgeText}
                opacity={m.showLabel ? 0.7 : 0.4} />
              {m.showLabel ? (
                <text x={m.x + outX * (BAND_W / 2 + 16)}
                  y={m.y + outY * (BAND_W / 2 + 16)}
                  textAnchor="middle" dominantBaseline="middle"
                  fill={theme.textSecondary}
                  fontSize={isMobile ? 9 : 11} fontWeight={700}
                  fontFamily="'Inter', system-ui">
                  {m.hour % 12 || 12}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* Connector lines + arrowhead at the arc */}
        {cards.map(function (c) {
          var pc = PRI_COLORS[c.item.task.pri] || PRI_COLORS.P3;
          var cn = computeConnector(c.cardX, c.cardY, cW, cH,
                                    c.curveX, c.curveY, c.circleR, c.circleCX, c.circleCY);
          var ndx = c.circleCX - cn.bx, ndy = c.circleCY - cn.by;
          var nl  = Math.sqrt(ndx * ndx + ndy * ndy) || 1;
          var nux = ndx / nl, nuy = ndy / nl;
          var pxn = -nuy,      pyn = nux;
          var aLen = 7, aHalfW = 3.5;
          var tipX  = cn.bx + nux * 2;          var tipY  = cn.by + nuy * 2;
          var baseX = cn.bx - nux * (aLen - 2); var baseY = cn.by - nuy * (aLen - 2);
          var bLx = baseX + pxn * aHalfW, bLy = baseY + pyn * aHalfW;
          var bRx = baseX - pxn * aHalfW, bRy = baseY - pyn * aHalfW;
          var key = c.item.key || c.item.task.id;
          return (
            <g key={'cn' + key}>
              <line
                x1={baseX} y1={baseY} x2={cn.ex} y2={cn.ey}
                stroke={pc} strokeWidth={1.2} opacity={0.45} />
              <polygon
                points={tipX + ',' + tipY + ' ' + bLx + ',' + bLy + ' ' + bRx + ',' + bRy}
                fill={pc} opacity={0.75} />
            </g>
          );
        })}

        {/* Task arcs — thick, semi-transparent arc spanning each task's
            duration on the band, so hour ticks and the curve show through. */}
        {cards.map(function (c) {
          var pc = PRI_COLORS[c.item.task.pri] || PRI_COLORS.P3;
          var startMins = c.item.start != null ? c.item.start : 720;
          var dur = (c.item.dur != null ? c.item.dur : (c.item.task && c.item.task.dur)) || 0;
          if (dur < 5) dur = 5;  // tiny tasks still visible
          var isAM = startMins < 720;
          var halfBase = isAM ? 0 : 720;
          var halfCap  = 720;
          var sHalf = startMins - halfBase;
          var eHalf = Math.min(sHalf + dur, halfCap);
          if (eHalf <= sHalf) return null;
          var t1 = sHalf / 720, t2 = eHalf / 720;
          var a1 = Math.PI / 2 - t1 * 2 * Math.PI;
          var a2 = Math.PI / 2 - t2 * 2 * Math.PI;
          var R = c.circleR, CX = c.circleCX, CY = c.circleCY;
          var x1 = CX + R * Math.cos(a1), y1 = CY - R * Math.sin(a1);
          var x2 = CX + R * Math.cos(a2), y2 = CY - R * Math.sin(a2);
          var spanAngle = (eHalf - sHalf) / 720 * 2 * Math.PI;
          var sweep = spanAngle > Math.PI ? 1 : 0;
          var d = 'M ' + x1 + ' ' + y1 + ' A ' + R + ' ' + R + ' 0 ' + sweep + ' 1 ' + x2 + ' ' + y2;
          return <path key={'arc' + (c.item.key || c.item.task.id)}
            d={d} fill="none" stroke={pc} strokeWidth={BAND_W}
            strokeLinecap="butt" opacity={0.45} />;
        })}

        {/* Now indicator — tapered clock hand on the active circle */}
        {nowPos && (function () {
          var cx = nowPos.circleCX, cy = nowPos.circleCY;
          var tx = nowPos.x,        ty = nowPos.y;
          var dx = tx - cx, dy = ty - cy;
          var L  = Math.sqrt(dx * dx + dy * dy) || 1;
          var ux = dx / L, uy = dy / L;
          var px = -uy,    py = ux;                  // perpendicular
          var baseW = 7, tipW = 1.2, tailLen = 10;   // hand proportions
          var bx = cx - ux * tailLen, by = cy - uy * tailLen;
          var BL = (bx + px * baseW / 2) + ',' + (by + py * baseW / 2);
          var BR = (bx - px * baseW / 2) + ',' + (by - py * baseW / 2);
          var TL = (tx + px * tipW  / 2) + ',' + (ty + py * tipW  / 2);
          var TR = (tx - px * tipW  / 2) + ',' + (ty - py * tipW  / 2);
          return (
            <g>
              <polygon points={BL + ' ' + TL + ' ' + TR + ' ' + BR}
                fill={theme.redText} opacity={0.95} />
              <circle cx={cx} cy={cy} r={5} fill={theme.redText} />
              <circle cx={cx} cy={cy} r={2} fill={theme.bg} />
            </g>
          );
        })()}
      </svg>

      {/* Task cards — render lower cards first so upper cards sit on top and are clickable */}
      {cards.slice().sort(function (a, b) { return b.cardY - a.cardY; }).map(function (c) {
        var bc = c.blockColor || theme.badgeText;
        return (
          <div key={c.item.key || c.item.task.id} onClick={function () { onExpand(c.item.task.id); }} style={{
            position: 'absolute',
            left: c.cardX, top: c.cardY,
            width: cW, height: cH,
            boxSizing: 'border-box',
            zIndex: 20,
            borderRadius: 6,
            overflow: 'hidden',
            cursor: 'pointer',
            border: '1px solid ' + theme.border
          }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
              background: theme.bgCard,
              pointerEvents: 'none'
            }} />
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: 4,
              background: bc,
              opacity: 0.75,
              pointerEvents: 'none'
            }} />
            <div style={{
              position: 'relative',
              paddingLeft: 8, paddingRight: 6,
              height: '100%'
            }}>
              <ScheduleCard
                item={c.item}
                status={statuses[c.item.task.id] || ''}
                onStatusChange={function (val) { onStatusChange(c.item.task.id, val); }}
                onDelete={onDelete ? function() { onDelete(c.item.task.id); } : null}
                darkMode={darkMode}
                isBlocked={blockedTaskIds && blockedTaskIds.has(c.item.task.id)}
                isMobile={isMobile}
                layoutMode={layoutMode}
                cardHeight={cH}
              />
            </div>
          </div>
        );
      })}

    </div>
  );
}
