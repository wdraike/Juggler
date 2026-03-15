/**
 * SCurveTimeline — dual-circle 24-hour clock timeline.
 * AM circle on the left (12AM–12PM), PM circle on the right (12PM–12AM).
 * Cards placed in the gap between circles and around the edges.
 * Rectangular cards with colored accents matching time-block bands.
 */

import React, { useMemo } from 'react';
import { PRI_COLORS, locIcon, LOC_TINT } from '../../state/constants';
import { getTheme } from '../../theme/colors';
import { getBlocksForDate } from '../../scheduler/timeBlockHelpers';
import { formatHour } from '../../scheduler/dateHelpers';
import ScheduleCard from './ScheduleCard';

/* ── Dimensions ────────────────────────────────────────── */
var BAND_W      = 28;     // thick coloured time-block band
var CURVE_MARGIN = 24;    // keep cards this far from the curve
var PADDING     = 10;
var SAMPLE_STEP = 4;
var CARD_GAP    = 8;
var ASPECT_RATIO = 4;
var CIRCLE_GAP  = 0.15;   // fraction of vpW between circles (where cards go)

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
  var bandMax = R + BAND_W / 2 + CURVE_MARGIN;
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

function minDistToSeg(ax, ay, bx, by, cx, cy) {
  var dx = bx - ax, dy = by - ay;
  var lenSq = dx * dx + dy * dy;
  if (lenSq < 0.001) return Math.sqrt((ax - cx) * (ax - cx) + (ay - cy) * (ay - cy));
  var t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / lenSq));
  var px = ax + t * dx, py = ay + t * dy;
  return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
}

/* Connector: card edge → band outer edge.
 * Tries exact time position first, falls back to radial if line would cross circle. */
function computeConnector(cardX, cardY, cW, cH, curveX, curveY, R, CX, CY) {
  var bandOuter = R + BAND_W / 2 + 2;
  var tdx = curveX - CX, tdy = curveY - CY;
  var td = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
  var iBx = CX + (tdx / td) * bandOuter;
  var iBy = CY + (tdy / td) * bandOuter;
  var iEdge = rectEdgePoint(cardX, cardY, cW, cH, iBx, iBy);
  var minD = minDistToSeg(iEdge.x, iEdge.y, iBx, iBy, CX, CY);
  if (minD >= R) {
    return { ex: iEdge.x, ey: iEdge.y, bx: iBx, by: iBy };
  }
  var ccx = cardX + cW / 2, ccy = cardY + cH / 2;
  var cdx = ccx - CX, cdy = ccy - CY;
  var cd = Math.sqrt(cdx * cdx + cdy * cdy) || 1;
  var fBx = CX + (cdx / cd) * bandOuter;
  var fBy = CY + (cdy / cd) * bandOuter;
  var fEdge = rectEdgePoint(cardX, cardY, cW, cH, fBx, fBy);
  return { ex: fEdge.x, ey: fEdge.y, bx: fBx, by: fBy };
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
  var hStep = cW + CARD_GAP;
  var vStep = cH + CARD_GAP;

  /* ── Generate frame slots (perimeter + gap between circles) ── */
  var raw = [];

  // Bottom: left → right
  for (var x = P; x + cW <= vpW - P; x += hStep)
    raw.push({ x: Math.round(x), y: vpH - P - cH });
  // Right: bottom → top
  for (var y = vpH - P - cH - vStep; y >= P; y -= vStep)
    raw.push({ x: vpW - P - cW, y: Math.round(y) });
  // Top: right → left
  for (var x = vpW - P - cW - hStep; x >= P; x -= hStep)
    raw.push({ x: Math.round(x), y: P });
  // Left: top → bottom
  for (var y = P + vStep; y + cH <= vpH - P; y += vStep)
    raw.push({ x: P, y: Math.round(y) });

  // Gap between circles: vertical column of slots
  var gapCX = (amCX + pmCX) / 2;
  var gapLeft = gapCX - cW / 2;
  // Add slots in the gap column
  for (var y = P; y + cH <= vpH - P; y += vStep) {
    raw.push({ x: Math.round(gapLeft), y: Math.round(y) });
  }
  // Also add a second column offset if there's room
  var gapW = pmCX - pmR - BAND_W / 2 - CURVE_MARGIN - (amCX + amR + BAND_W / 2 + CURVE_MARGIN);
  if (gapW > cW * 2 + CARD_GAP) {
    var col1X = gapCX - cW - CARD_GAP / 2;
    var col2X = gapCX + CARD_GAP / 2;
    for (var y = P; y + cH <= vpH - P; y += vStep) {
      raw.push({ x: Math.round(col1X), y: Math.round(y) });
      raw.push({ x: Math.round(col2X), y: Math.round(y) });
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

  /* ── Clock angle for slot assignment ── */
  // For dual circles, we map everything to a 0–2π range over 24h.
  // AM items: mins 0–720 → angle 0–π
  // PM items: mins 720–1440 → angle π–2π
  function timeAngle(mins) {
    return (mins / 1440) * 2 * Math.PI;
  }

  // Slot angle: based on position relative to both circles
  function slotAngle(sx, sy) {
    // If slot is closer to AM circle, compute angle within AM range (0–π)
    // If closer to PM circle, compute angle within PM range (π–2π)
    var dA = Math.sqrt((sx + cW / 2 - amCX) * (sx + cW / 2 - amCX) + (sy + cH / 2 - amCY) * (sy + cH / 2 - amCY));
    var dP = Math.sqrt((sx + cW / 2 - pmCX) * (sx + cW / 2 - pmCX) + (sy + cH / 2 - pmCY) * (sy + cH / 2 - pmCY));

    var R, CX, CY, offset;
    if (dA <= dP) {
      R = amR; CX = amCX; CY = amCY; offset = 0;
    } else {
      R = pmR; CX = pmCX; CY = pmCY; offset = Math.PI;
    }

    // Clock angle within this circle: 12 at top, clockwise
    // mathAngle = atan2(-(y-CY), x-CX) → clock = π/2 - mathAngle
    var ma = Math.atan2(-(sy + cH / 2 - CY), sx + cW / 2 - CX);
    var ca = Math.PI / 2 - ma;
    if (ca < 0) ca += 2 * Math.PI;
    if (ca >= 2 * Math.PI) ca -= 2 * Math.PI;
    // Scale to 0–π range, then add offset
    var halfAngle = ca / 2;  // 0–π
    return offset + halfAngle;
  }

  var slotAngles = [];
  for (var i = 0; i < slots.length; i++) {
    slotAngles.push(slotAngle(slots[i].x, slots[i].y));
  }

  /* ── Half-screen boundary: AM cards left, PM cards right ── */
  var halfX = vpW / 2;

  /* ── Build item data, split by AM/PM ── */
  var amItems = [], pmItems = [];
  for (var i = 0; i < items.length; i++) {
    var pos = minutesToDualPosition(items[i].mins, amR, amCX, amCY, pmR, pmCX, pmCY);
    var entry = { item: items[i], pos: pos, angle: timeAngle(items[i].mins) };
    if (pos.isAM) { amItems.push(entry); } else { pmItems.push(entry); }
  }
  amItems.sort(function (a, b) { return a.angle - b.angle; });
  pmItems.sort(function (a, b) { return a.angle - b.angle; });

  /* Split slots by half-screen */
  var amSlots = [], pmSlots = [];
  for (var i = 0; i < slots.length; i++) {
    var slotCenterX = slots[i].x + cW / 2;
    if (slotCenterX <= halfX) { amSlots.push(i); } else { pmSlots.push(i); }
  }
  amSlots.sort(function (a, b) { return slotAngles[a] - slotAngles[b]; });
  pmSlots.sort(function (a, b) { return slotAngles[a] - slotAngles[b]; });

  /* Assign items to slots within their half */
  function assignHalf(halfItems, halfSlotOrder) {
    var result = [];
    var HN = halfItems.length;
    var HM = halfSlotOrder.length;
    if (HN === 0 || HM === 0) return result;

    var bestOff = 0, bestCost = Infinity;
    for (var off = 0; off < HM; off++) {
      var cost = 0;
      for (var i = 0; i < HN; i++) {
        var si = (off + Math.round(i * HM / HN)) % HM;
        var s = halfSlotOrder[si];
        var diff = slotAngles[s] - halfItems[i].angle;
        if (diff > Math.PI) diff -= 2 * Math.PI;
        if (diff < -Math.PI) diff += 2 * Math.PI;
        cost += diff * diff;
      }
      if (cost < bestCost) { bestCost = cost; bestOff = off; }
    }

    var usedSlot = {};
    for (var i = 0; i < HN; i++) {
      var ideal = (bestOff + Math.round(i * HM / HN)) % HM;
      var found = -1;
      for (var d = 0; d < HM; d++) {
        var t1 = (ideal + d) % HM;
        if (!usedSlot[t1]) { found = t1; break; }
        var t2 = (ideal - d + HM) % HM;
        if (!usedSlot[t2]) { found = t2; break; }
      }
      if (found < 0) continue;
      usedSlot[found] = true;
      var s = halfSlotOrder[found];

      result.push({
        x: slots[s].x, y: slots[s].y,
        curveX: halfItems[i].pos.x, curveY: halfItems[i].pos.y,
        circleR: halfItems[i].pos.circleR,
        circleCX: halfItems[i].pos.circleCX,
        circleCY: halfItems[i].pos.circleCY,
        isAM: halfItems[i].pos.isAM,
        item: halfItems[i].item
      });
    }
    return result;
  }

  var cards = assignHalf(amItems, amSlots).concat(assignHalf(pmItems, pmSlots));

  /* ── Connector helpers ── */
  function cardLine(c) {
    return computeConnector(c.x, c.y, cW, cH, c.curveX, c.curveY, c.circleR, c.circleCX, c.circleCY);
  }
  function cardLineAt(nx, ny, c) {
    return computeConnector(nx, ny, cW, cH, c.curveX, c.curveY, c.circleR, c.circleCX, c.circleCY);
  }

  function posValidBasic(nx, ny, skipIdx) {
    if (nx < P || nx + cW > vpW - P || ny < P || ny + cH > vpH - P) return false;
    // Keep card on its half of the screen (AM=left, PM=right)
    if (skipIdx >= 0 && skipIdx < cards.length) {
      var cardCenterX = nx + cW / 2;
      if (cards[skipIdx].isAM && cardCenterX > halfX) return false;
      if (!cards[skipIdx].isAM && cardCenterX < halfX) return false;
    }
    if (rectOverlapsEitherBand(nx, ny, cW, cH, amR, amCX, amCY, pmR, pmCX, pmCY)) return false;
    for (var j = 0; j < cards.length; j++) {
      if (j === skipIdx) continue;
      if (rectsOverlap(nx, ny, cW, cH, cards[j].x, cards[j].y, cW, cH)) return false;
    }
    // Connector accuracy check
    if (skipIdx >= 0 && skipIdx < cards.length) {
      var c = cards[skipIdx];
      var cn = computeConnector(nx, ny, cW, cH, c.curveX, c.curveY, c.circleR, c.circleCX, c.circleCY);
      var tdx = c.curveX - c.circleCX, tdy = c.curveY - c.circleCY;
      var td = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
      var bandOuter = c.circleR + BAND_W / 2 + 2;
      var idealBx = c.circleCX + (tdx / td) * bandOuter;
      var idealBy = c.circleCY + (tdy / td) * bandOuter;
      var bpDist = Math.sqrt((cn.bx - idealBx) * (cn.bx - idealBx) + (cn.by - idealBy) * (cn.by - idealBy));
      if (bpDist > BAND_W) return false;
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

  var DIRS = [
    { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
    { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
    { dx: -1, dy: -1 }, { dx: 1, dy: -1 },
    { dx: -1, dy: 1 }, { dx: 1, dy: 1 }
  ];

  /* ── Phase 2a: Nudge toward curve ── */
  for (var iter = 0; iter < NUDGE_ITERS; iter++) {
    var improved = false;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var ccx = c.x + cW / 2, ccy = c.y + cH / 2;
      var toDist = Math.sqrt((c.curveX - ccx) * (c.curveX - ccx) + (c.curveY - ccy) * (c.curveY - ccy));
      if (toDist < NUDGE_STEP) continue;

      var crossBefore = cardCrossings(i);
      var bestX = -1, bestY = -1, bestDist = toDist, bestCross = crossBefore;
      var candidates = [{ dx: (c.curveX - ccx) / toDist, dy: (c.curveY - ccy) / toDist }];
      for (var d = 0; d < DIRS.length; d++) candidates.push(DIRS[d]);

      for (var d = 0; d < candidates.length; d++) {
        var nx = c.x + candidates[d].dx * NUDGE_STEP;
        var ny = c.y + candidates[d].dy * NUDGE_STEP;
        if (!posValid(nx, ny, i)) continue;

        var newCcx = nx + cW / 2, newCcy = ny + cH / 2;
        var newDist = Math.sqrt((c.curveX - newCcx) * (c.curveX - newCcx) + (c.curveY - newCcy) * (c.curveY - newCcy));
        if (newDist >= bestDist) continue;

        var ox = c.x, oy = c.y;
        c.x = nx; c.y = ny;
        var crossAfter = cardCrossings(i);
        c.x = ox; c.y = oy;

        if (crossAfter > crossBefore) continue;
        if (crossAfter < bestCross || (crossAfter === bestCross && newDist < bestDist)) {
          bestDist = newDist; bestX = nx; bestY = ny; bestCross = crossAfter;
        }
      }
      if (bestX >= 0) { c.x = bestX; c.y = bestY; improved = true; }
    }
    if (!improved) break;
  }

  /* ── Phase 2b: Resolve crossings ── */
  var TIME_BUDGET = 600;
  var tStart = Date.now();
  function overBudget() { return Date.now() - tStart > TIME_BUDGET; }

  /* Swap crossing pairs */
  for (var sp = 0; sp < 10 && !overBudget(); sp++) {
    var didSwap = false;
    for (var a = 0; a < cards.length && !overBudget(); a++) {
      if (cardCrossings(a) === 0) continue;
      for (var b = a + 1; b < cards.length; b++) {
        var crossA = cardCrossings(a), crossB = cardCrossings(b);
        if (crossA === 0 && crossB === 0) continue;
        var sumBefore = crossA + crossB;

        var axOld = cards[a].x, ayOld = cards[a].y;
        var bxOld = cards[b].x, byOld = cards[b].y;
        cards[a].x = bxOld; cards[a].y = byOld;
        cards[b].x = axOld; cards[b].y = ayOld;

        var validA = posValidBasic(cards[a].x, cards[a].y, a);
        var validB = posValidBasic(cards[b].x, cards[b].y, b);
        var abOvlp = rectsOverlap(cards[a].x, cards[a].y, cW, cH, cards[b].x, cards[b].y, cW, cH);
        var sumAfter = validA && validB && !abOvlp ? cardCrossings(a) + cardCrossings(b) : sumBefore + 1;

        if (sumAfter < sumBefore) {
          didSwap = true;
        } else {
          cards[a].x = axOld; cards[a].y = ayOld;
          cards[b].x = bxOld; cards[b].y = byOld;
        }
      }
    }
    if (!didSwap) break;
  }

  /* Jiggle */
  var jigSteps = [NUDGE_STEP, NUDGE_STEP * 3, NUDGE_STEP * 8, NUDGE_STEP * 16, NUDGE_STEP * 32];
  for (var jp = 0; jp < 60 && !overBudget(); jp++) {
    var jigDone = true, jigImproved = false;
    for (var i = 0; i < cards.length; i++) {
      var myC = cardCrossings(i);
      if (myC === 0) continue;
      jigDone = false;
      var bestX2 = -1, bestY2 = -1, bestC2 = myC;
      for (var si = 0; si < jigSteps.length; si++) {
        var step = jigSteps[si];
        for (var d = 0; d < DIRS.length; d++) {
          var nx = cards[i].x + DIRS[d].dx * step;
          var ny = cards[i].y + DIRS[d].dy * step;
          if (!posValidBasic(nx, ny, i)) continue;
          var ox = cards[i].x, oy = cards[i].y;
          cards[i].x = nx; cards[i].y = ny;
          var ca = cardCrossings(i);
          cards[i].x = ox; cards[i].y = oy;
          if (ca < bestC2) { bestC2 = ca; bestX2 = nx; bestY2 = ny; }
        }
      }
      if (bestX2 >= 0) { cards[i].x = bestX2; cards[i].y = bestY2; jigImproved = true; }
    }
    if (jigDone || !jigImproved) break;
  }

  /* Viewport scan relocate */
  var scanStep = Math.round(Math.max(cW, cH) * 0.75);
  for (var i = 0; i < cards.length && !overBudget(); i++) {
    var myC = cardCrossings(i);
    if (myC === 0) continue;
    var c = cards[i];
    var bestRX = -1, bestRY = -1, bestRC = myC, bestRD = Infinity;
    for (var sy = P; sy + cH <= vpH - P; sy += scanStep) {
      for (var sx = P; sx + cW <= vpW - P; sx += scanStep) {
        if (!posValidBasic(sx, sy, i)) continue;
        var ox = c.x, oy = c.y;
        c.x = sx; c.y = sy;
        var cc = cardCrossings(i);
        c.x = ox; c.y = oy;
        if (cc > bestRC) continue;
        var ddx = sx + cW / 2 - c.curveX, ddy = sy + cH / 2 - c.curveY;
        var dd = ddx * ddx + ddy * ddy;
        if (cc < bestRC || dd < bestRD) { bestRC = cc; bestRX = sx; bestRY = sy; bestRD = dd; }
      }
    }
    if (bestRX >= 0 && bestRC < myC) { c.x = bestRX; c.y = bestRY; }
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
  var onExpand       = props.onExpand;
  var darkMode       = props.darkMode;
  var nowMins        = props.nowMins;
  var isToday        = props.isToday;
  var blockedTaskIds = props.blockedTaskIds;
  var isMobile       = props.isMobile;
  var vpW            = props.viewportWidth  || 800;
  var vpH            = props.viewportHeight || 600;
  var dateKey        = props.dateKey;
  var schedCfg       = props.schedCfg || {};

  var theme = getTheme(darkMode);

  /* ── Circle sizing and positioning ── */
  // Two circles side by side. Each takes up roughly 23% of width.
  var circleW = vpW * 0.23;
  var R = Math.max(29, Math.min(circleW / 2 - BAND_W, (vpH - 2 * PADDING) * 0.25));

  // AM circle: left side, PM circle: right side
  var gap = vpW * CIRCLE_GAP;
  var amCX = vpW / 2 - gap / 2 - R;
  var pmCX = vpW / 2 + gap / 2 + R;
  var amCY = vpH / 2;
  var pmCY = vpH / 2;

  // Clamp so circles don't go off-screen
  var minEdge = R + BAND_W / 2 + PADDING + 10;
  if (amCX < minEdge) amCX = minEdge;
  if (pmCX > vpW - minEdge) pmCX = vpW - minEdge;

  var amR = R;
  var pmR = R;

  /* ── Time blocks ── */
  var blocks = useMemo(function () {
    if (!dateKey || !schedCfg.timeBlocks) return [];
    return getBlocksForDate(dateKey, schedCfg.timeBlocks, schedCfg);
  }, [dateKey, schedCfg]);

  /* ── Curve samples for both circles ── */
  var curveSamples = useMemo(function () {
    var defColor   = darkMode ? '#475569' : '#CBD5E1';
    var nightColor = darkMode ? '#1E293B' : '#E2E8F0';
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
        locColor: (blk.loc && LOC_TINT[blk.loc]) || (darkMode ? '#475569' : '#CBD5E1'),
        whenColor: blk.color || (darkMode ? '#475569' : '#CBD5E1'),
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
    var sorted = (placements || []).slice().sort(function (a, b) { return a.start - b.start; });

    var defColor = darkMode ? '#475569' : '#94A3B8';
    var allItems = [];
    for (var i = 0; i < sorted.length; i++) {
      var item = sorted[i];
      var mins = item.start != null ? item.start : 720;
      var blk = getBlockAtMinute(mins, blocks);
      var blockColor = blk ? (blk.color || defColor) : defColor;
      allItems.push({ item: item, mins: mins, blockColor: blockColor });
    }

    var area = estimateArea(amR, amCX, amCY, pmR, pmCX, pmCY, vpW, vpH);
    var size = computeCardSize(allItems.length, area, isMobile);
    var cW = size.w;
    var cH = size.h;

    var cards = placeCards(allItems, cW, cH, amR, amCX, amCY, pmR, pmCX, pmCY, vpW, vpH);
    return { cards: cards, cW: cW, cH: cH };
  }, [placements, amR, amCX, amCY, pmR, pmCX, pmCY, vpW, vpH, isMobile, blocks, darkMode]);

  var cards = cardLayout.cards;
  var cW = cardLayout.cW;
  var cH = cardLayout.cH;
  var layoutMode = cH < 55 ? 'compact' : 'normal';

  /* ── Now indicator ── */
  var nowPos = useMemo(function () {
    if (!isToday || nowMins == null) return null;
    return minutesToDualPosition(nowMins, amR, amCX, amCY, pmR, pmCX, pmCY);
  }, [isToday, nowMins, amR, amCX, amCY, pmR, pmCX, pmCY]);

  /* ── Content height ── */
  var contentH = vpH;
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
            stroke={darkMode ? '#64748B' : '#94A3B8'} strokeWidth={2}
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
            fill={darkMode ? '#E2E8F0' : '#334155'}
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
    <div style={{ position: 'relative', width: vpW, height: contentH, minHeight: vpH, overflow: 'hidden' }}>
      <svg style={{
        position: 'absolute', left: 0, top: 0,
        width: vpW, height: contentH,
        pointerEvents: 'none'
      }}>

        {/* Circle labels */}
        <text x={amCX} y={amCY - amR - BAND_W / 2 - 28}
          textAnchor="middle" dominantBaseline="middle"
          fill={darkMode ? '#94A3B8' : '#64748B'}
          fontSize={isMobile ? 11 : 14} fontWeight={700}
          fontFamily="'Inter', system-ui" opacity={0.7}>
          AM
        </text>
        <text x={pmCX} y={pmCY - pmR - BAND_W / 2 - 28}
          textAnchor="middle" dominantBaseline="middle"
          fill={darkMode ? '#94A3B8' : '#64748B'}
          fontSize={isMobile ? 11 : 14} fontWeight={700}
          fontFamily="'Inter', system-ui" opacity={0.7}>
          PM
        </text>

        {/* AM circle */}
        {renderCurve(curveSamples.am, 'am')}
        {renderBlockSegs(blockSegments.am, 'amSeg')}

        {/* PM circle */}
        {renderCurve(curveSamples.pm, 'pm')}
        {renderBlockSegs(blockSegments.pm, 'pmSeg')}

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
                fill={darkMode ? '#94A3B8' : '#64748B'}
                opacity={m.showLabel ? 0.7 : 0.4} />
              {m.showLabel ? (
                <text x={m.x + outX * (BAND_W / 2 + 16)}
                  y={m.y + outY * (BAND_W / 2 + 16)}
                  textAnchor="middle" dominantBaseline="middle"
                  fill={darkMode ? '#CBD5E1' : '#475569'}
                  fontSize={isMobile ? 9 : 11} fontWeight={700}
                  fontFamily="'Inter', system-ui">
                  {formatHour(m.hour)}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* Connector lines */}
        {cards.map(function (c) {
          var pc = PRI_COLORS[c.item.task.pri] || PRI_COLORS.P3;
          var cn = computeConnector(c.cardX, c.cardY, cW, cH,
                                    c.curveX, c.curveY, c.circleR, c.circleCX, c.circleCY);
          return <line key={'cn' + (c.item.key || c.item.task.id)}
            x1={cn.bx} y1={cn.by} x2={cn.ex} y2={cn.ey}
            stroke={pc} strokeWidth={1.2} opacity={0.3} />;
        })}

        {/* Task markers on the curve */}
        {cards.map(function (c) {
          var pc = PRI_COLORS[c.item.task.pri] || PRI_COLORS.P3;
          return <circle key={'mk' + (c.item.key || c.item.task.id)}
            cx={c.curveX} cy={c.curveY} r={5}
            fill={pc} opacity={0.9}
            stroke={darkMode ? '#0F172A' : '#FFFFFF'} strokeWidth={2} />;
        })}

        {/* Now indicator */}
        {nowPos && (
          <g>
            <circle cx={nowPos.x} cy={nowPos.y} r={7} fill="#EF4444" />
            <circle cx={nowPos.x} cy={nowPos.y} r={12}
              fill="none" stroke="#EF4444" strokeWidth={2} opacity={0.4} />
          </g>
        )}
      </svg>

      {/* Task cards — render lower cards first so upper cards sit on top and are clickable */}
      {cards.slice().sort(function (a, b) { return b.cardY - a.cardY; }).map(function (c) {
        var bc = c.blockColor || (darkMode ? '#475569' : '#CBD5E1');
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
            border: darkMode ? '1px solid #334155' : '1px solid #E2E8F0'
          }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
              background: darkMode ? '#1E293B' : '#FFFFFF',
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
                onExpand={function () { onExpand(c.item.task.id); }}
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
