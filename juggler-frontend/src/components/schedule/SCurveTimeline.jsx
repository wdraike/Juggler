/**
 * SCurveTimeline — circular 24-hour clock timeline.
 * Single circle: 12AM at top, clockwise through the day.
 * Cards placed around the frame and nudged toward the circle.
 * Cards get a colored left border matching their time-block band.
 */

import React, { useMemo } from 'react';
import { PRI_COLORS, locIcon, LOC_TINT } from '../../state/constants';
import { getTheme } from '../../theme/colors';
import { getBlocksForDate } from '../../scheduler/timeBlockHelpers';
import { formatHour } from '../../scheduler/dateHelpers';
import ScheduleCard from './ScheduleCard';

/* ── Dimensions ────────────────────────────────────────── */
var BAND_W      = 32;     // thick coloured time-block band
var CURVE_MARGIN = 32;    // keep cards this far from the curve
var PADDING     = 10;
var SAMPLE_STEP = 4;
var CARD_GAP    = 8;      // visible gap between cards (room for shadows)
var ASPECT_RATIO = 4;     // card width / height (wider, shorter)

/* ── Geometry ──────────────────────────────────────────── */
function minutesToPosition(mins, R, CX, CY) {
  // Single circle, clock-style: 6AM at left, noon at top, clockwise
  // Offset so 6AM (360 mins) maps to the left (9 o'clock position)
  var t = mins / 1440;           // 0→1 over 24 hours
  var angle = t * 2 * Math.PI;  // 0→2π over 24h
  // 6AM at left = math angle π, noon at top = math angle π/2
  // mathAngle = π - angle maps 0→π (12AM→left... no)
  // We want: 6AM (t=0.25) → left (mathAngle=π)
  //          noon (t=0.5) → top (mathAngle=π/2)
  //          6PM (t=0.75) → right (mathAngle=0)
  //          12AM (t=0) → bottom (mathAngle=-π/2 = 3π/2)
  // So mathAngle = π - angle + π/2 = 3π/2 - angle
  // Check: t=0.25 → angle=π/2 → 3π/2 - π/2 = π ✓ (left)
  //        t=0.5  → angle=π   → 3π/2 - π   = π/2 ✓ (top)
  //        t=0.75 → angle=3π/2 → 3π/2 - 3π/2 = 0 ✓ (right)
  //        t=0    → angle=0   → 3π/2 ✓ (bottom)
  var mathAngle = 3 * Math.PI / 2 - angle;
  return {
    x: CX + R * Math.cos(mathAngle),
    y: CY - R * Math.sin(mathAngle),
    nx: Math.cos(mathAngle),
    ny: -Math.sin(mathAngle)
  };
}

function getBlockAtMinute(mins, blocks) {
  for (var i = 0; i < blocks.length; i++) {
    if (mins >= blocks[i].start && mins < blocks[i].end) return blocks[i];
  }
  return null;
}

/*
 * Estimate available area outside the circle band for card placement.
 * Single circle centered at (CX, CY) with radius R.
 */
function estimateArea(R, CX, CY, vpW, vpH) {
  var total = 0;
  var step = 10;
  var bandMax = R + BAND_W / 2 + CURVE_MARGIN;
  var bandMin = Math.max(0, R - BAND_W / 2 - CURVE_MARGIN);
  for (var y = PADDING; y < vpH - PADDING; y += step) {
    var dy = y - CY;
    var r2 = bandMax * bandMax - dy * dy;
    if (r2 <= 0) {
      // Entirely outside the band — full row available
      total += (vpW - 2 * PADDING) * step;
      continue;
    }
    var outerX = Math.sqrt(r2);
    // Outside the band: left of circle and right of circle
    var leftEnd = CX - outerX - PADDING;
    var rightStart = CX + outerX;
    if (leftEnd > 0) total += leftEnd * step;
    if (vpW - PADDING - rightStart > 0) total += (vpW - PADDING - rightStart) * step;
    // Inside the band (if bandMin > 0)
    var r2i = bandMin * bandMin - dy * dy;
    if (r2i > 0) {
      var innerX = Math.sqrt(r2i);
      var innerW = 2 * innerX;
      if (innerW > 0) total += innerW * step;
    }
  }
  return total;
}

/* ── Phase 1: Compute optimal card size ─────── */
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

/* ── tooCloseToTangent — no longer needed for single circle, always returns false ── */
function tooCloseToTangent() { return false; }

/* ── Hexagon geometry ────────────────────────────────────
 * Cards are elongated hexagons (pointed left/right ends).
 *
 *      _______________
 *    /                 \
 *   <                   >
 *    \_________________/
 *
 * pd = point depth = h * HEX_INDENT (how far each point indents)
 */
var HEX_INDENT = 0.4;

function hexVertices(x, y, w, h) {
  var pd = Math.round(h * HEX_INDENT);
  return [
    [x + pd, y],           // 0: top-left
    [x + w - pd, y],       // 1: top-right
    [x + w, y + h / 2],    // 2: right point
    [x + w - pd, y + h],   // 3: bottom-right
    [x + pd, y + h],       // 4: bottom-left
    [x, y + h / 2]         // 5: left point
  ];
}

/* Hex-hex overlap using Separating Axis Theorem (with CARD_GAP) */
function hexsOverlap(x1, y1, w1, h1, x2, y2, w2, h2) {
  var v1 = hexVertices(x1, y1, w1, h1);
  var v2 = hexVertices(x2, y2, w2, h2);
  for (var i = 0; i < 6; i++) {
    var j = (i + 1) % 6;
    var ex = v1[j][0] - v1[i][0], ey = v1[j][1] - v1[i][1];
    var len = Math.sqrt(ex * ex + ey * ey);
    if (len < 0.001) continue;
    var nx = -ey / len, ny = ex / len;
    var min1 = Infinity, max1 = -Infinity;
    var min2 = Infinity, max2 = -Infinity;
    for (var k = 0; k < 6; k++) {
      var d1 = v1[k][0] * nx + v1[k][1] * ny;
      if (d1 < min1) min1 = d1;
      if (d1 > max1) max1 = d1;
      var d2 = v2[k][0] * nx + v2[k][1] * ny;
      if (d2 < min2) min2 = d2;
      if (d2 > max2) max2 = d2;
    }
    if (max1 + CARD_GAP <= min2 || max2 + CARD_GAP <= min1) return false;
  }
  return true;
}

/* Does a line segment hit a hexagon? Tests against all 6 edges. */
function segHitsHex(ax, ay, bx, by, hx, hy, hw, hh) {
  var v = hexVertices(hx, hy, hw, hh);
  for (var i = 0; i < 6; i++) {
    var j = (i + 1) % 6;
    if (segsIntersect(ax, ay, bx, by, v[i][0], v[i][1], v[j][0], v[j][1])) return true;
  }
  return false;
}

/* Does a hexagon overlap the annular curve band? */
function hexOverlapsCurveBand(x, y, w, h, R, CX, CY) {
  var bandMin = R - BAND_W / 2 - CURVE_MARGIN;
  var bandMax = R + BAND_W / 2 + CURVE_MARGIN;
  if (bandMin < 0) bandMin = 0;
  var v = hexVertices(x, y, w, h);
  var minDist = Infinity, maxDist = 0;
  for (var i = 0; i < 6; i++) {
    var d = Math.sqrt((v[i][0] - CX) * (v[i][0] - CX) + (v[i][1] - CY) * (v[i][1] - CY));
    if (d < minDist) minDist = d;
    if (d > maxDist) maxDist = d;
  }
  // Also check nearest point on each edge to centre
  for (var i = 0; i < 6; i++) {
    var j = (i + 1) % 6;
    var ex = v[j][0] - v[i][0], ey = v[j][1] - v[i][1];
    var len2 = ex * ex + ey * ey;
    if (len2 > 0.001) {
      var t = Math.max(0, Math.min(1, ((CX - v[i][0]) * ex + (CY - v[i][1]) * ey) / len2));
      var px = v[i][0] + t * ex, py = v[i][1] + t * ey;
      var d = Math.sqrt((px - CX) * (px - CX) + (py - CY) * (py - CY));
      if (d < minDist) minDist = d;
    }
  }
  return minDist <= bandMax && maxDist >= bandMin;
}

/* Nearest point on hex boundary to target point */
function hexEdgePoint(hx, hy, hw, hh, tx, ty) {
  var v = hexVertices(hx, hy, hw, hh);
  var bestX = v[0][0], bestY = v[0][1], bestDist = Infinity;
  for (var i = 0; i < 6; i++) {
    var j = (i + 1) % 6;
    var ex = v[j][0] - v[i][0], ey = v[j][1] - v[i][1];
    var len2 = ex * ex + ey * ey;
    var t = len2 > 0.001 ? Math.max(0, Math.min(1, ((tx - v[i][0]) * ex + (ty - v[i][1]) * ey) / len2)) : 0;
    var px = v[i][0] + t * ex, py = v[i][1] + t * ey;
    var d = (px - tx) * (px - tx) + (py - ty) * (py - ty);
    if (d < bestDist) { bestDist = d; bestX = px; bestY = py; }
  }
  return { x: bestX, y: bestY };
}

/*
 * ── Frame layout: cards around viewport edges, nudged toward curve ──
 *
 * Phase 1 — Generate non-overlapping slots around the viewport perimeter,
 *   clockwise from bottom-centre (6 AM). Assign each task to the slot
 *   closest to its time-proportional position.
 *
 * Phase 2 — Iteratively nudge each card toward its S-curve anchor.
 *   Accept a move only when it causes no card overlap, stays clear of
 *   the curve band, and does not make its connector line cross any other.
 */
var NUDGE_STEP   = 6;
var NUDGE_ITERS  = 150;

/* Line-segment intersection (excluding near-endpoint touches) */
function segsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  var denom = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(denom) < 0.001) return false;
  var t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denom;
  var u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denom;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
}


/* Connector endpoint: nearest point on card edge toward circle centre */
function connectorEdge(cx, cy, cW, cH, circCX, circCY) {
  return {
    x: Math.max(cx, Math.min(cx + cW, circCX)),
    y: Math.max(cy, Math.min(cy + cH, circCY))
  };
}

/* Minimum distance from point (cx,cy) to line segment (ax,ay)→(bx,by) */
function minDistToSeg(ax, ay, bx, by, cx, cy) {
  var dx = bx - ax, dy = by - ay;
  var lenSq = dx * dx + dy * dy;
  if (lenSq < 0.001) return Math.sqrt((ax - cx) * (ax - cx) + (ay - cy) * (ay - cy));
  var t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / lenSq));
  var px = ax + t * dx, py = ay + t * dy;
  return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
}

/* Compute full connector: card edge + band point.
 * Tries the task's exact time position first.
 * Checks the actual card-edge-to-band-point line for circle crossing.
 * Falls back to radial band point (card direction) if it would cross. */
function computeConnector(cardX, cardY, cW, cH, curveX, curveY, R, CX, CY) {
  var bandOuter = R + BAND_W / 2 + 2;

  // Ideal: band outer edge at task's exact angular position
  var tdx = curveX - CX, tdy = curveY - CY;
  var td = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
  var iBx = CX + (tdx / td) * bandOuter;
  var iBy = CY + (tdy / td) * bandOuter;
  // Hex edge toward ideal band point
  var iEdge = hexEdgePoint(cardX, cardY, cW, cH, iBx, iBy);
  // Check actual edge-to-band line
  var minD = minDistToSeg(iEdge.x, iEdge.y, iBx, iBy, CX, CY);
  if (minD >= R) {
    return { ex: iEdge.x, ey: iEdge.y, bx: iBx, by: iBy };
  }

  // Fallback: radial from centre toward card centre
  var ccx = cardX + cW / 2, ccy = cardY + cH / 2;
  var cdx = ccx - CX, cdy = ccy - CY;
  var cd = Math.sqrt(cdx * cdx + cdy * cdy) || 1;
  var fBx = CX + (cdx / cd) * bandOuter;
  var fBy = CY + (cdy / cd) * bandOuter;
  var fEdge = hexEdgePoint(cardX, cardY, cW, cH, fBx, fBy);
  return { ex: fEdge.x, ey: fEdge.y, bx: fBx, by: fBy };
}

/* Band-edge point: where the connector meets the outer band edge.
 * Radial from circle centre toward card centre, at distance R + BAND_W/2 + 2. */
function bandEdgePoint(cardCX, cardCY, R, CX, CY) {
  var dx = cardCX - CX;
  var dy = cardCY - CY;
  var d = Math.sqrt(dx * dx + dy * dy) || 1;
  var bandOuter = R + BAND_W / 2 + 2;
  return { x: CX + (dx / d) * bandOuter, y: CY + (dy / d) * bandOuter };
}

function placeCardsAroundFrame(items, cW, cH, R, CX, CY, vpW, vpH) {
  if (items.length === 0) return [];

  var P = PADDING;
  var hStep = cW + CARD_GAP;
  var vStep = cH + CARD_GAP;

  /* ── Phase 1a: generate non-overlapping slots around the frame ── */
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

  // Remove corner-overlap slots
  var slots = [];
  for (var i = 0; i < raw.length; i++) {
    var ok = true;
    for (var j = 0; j < slots.length; j++) {
      if (hexsOverlap(raw[i].x, raw[i].y, cW, cH,
                        slots[j].x, slots[j].y, cW, cH)) { ok = false; break; }
    }
    if (ok) slots.push(raw[i]);
  }

  /* ── Clock angle: continuous 0→2π matching the circle layout ──
   * Layout: 6AM=left, noon=top, 6PM=right, 12AM=bottom.
   * For a screen point (x,y), compute which "time angle" it corresponds to.
   * mathAngle = atan2(-(y-CY), x-CX)  →  timeAngle = 3π/2 - mathAngle
   * Normalized to [0, 2π). */
  function clockAngle(x, y) {
    var ma = Math.atan2(-(y - CY), x - CX);  // math angle
    var ta = 3 * Math.PI / 2 - ma;           // time angle (matches minutesToPosition)
    ta = ta % (2 * Math.PI);
    if (ta < 0) ta += 2 * Math.PI;
    return ta;
  }

  // Pre-compute each slot's clock angle from viewport centre
  var slotAngles = [];
  for (var i = 0; i < slots.length; i++) {
    slotAngles.push(clockAngle(slots[i].x + cW / 2, slots[i].y + cH / 2));
  }

  var totalSlots = slots.length;
  if (totalSlots === 0) return [];

  /* ── Phase 1b: assign via clock-angle proportional mapping ── */
  var itemData = [];
  for (var i = 0; i < items.length; i++) {
    var pos = minutesToPosition(items[i].mins, R, CX, CY);
    // Item clock angle = (mins/1440) * 2π, same as clockAngle(pos.x, pos.y)
    itemData.push({
      item: items[i], pos: pos,
      angle: (items[i].mins / 1440) * 2 * Math.PI
    });
  }

  /* Sort items by clock angle (0→2π, 12AM→12AM clockwise) */
  itemData.sort(function (a, b) { return a.angle - b.angle; });

  /* Sort slot indices by clock angle */
  var slotOrder = [];
  for (var i = 0; i < totalSlots; i++) slotOrder.push(i);
  slotOrder.sort(function (a, b) { return slotAngles[a] - slotAngles[b]; });

  /* Assign: proportional mapping that preserves angular order.
   * Both itemData and slotOrder are sorted by clock angle. We find the
   * rotational offset that minimises total squared angular error,
   * then spread items evenly across slots from that offset. */
  var cards = [];
  var N = itemData.length;
  var M = totalSlots;
  if (N > 0 && M > 0) {
    var bestOff = 0, bestCost = Infinity;
    for (var off = 0; off < M; off++) {
      var cost = 0;
      for (var i = 0; i < N; i++) {
        var si = (off + Math.round(i * M / N)) % M;
        var s = slotOrder[si];
        var diff = slotAngles[s] - itemData[i].angle;
        if (diff > Math.PI) diff -= 2 * Math.PI;
        if (diff < -Math.PI) diff += 2 * Math.PI;
        cost += diff * diff;
      }
      if (cost < bestCost) { bestCost = cost; bestOff = off; }
    }

    var usedSlot = {};
    for (var i = 0; i < N; i++) {
      var ideal = (bestOff + Math.round(i * M / N)) % M;
      // Find nearest unused slot to ideal (handles collisions)
      var found = -1;
      for (var d = 0; d < M; d++) {
        var t1 = (ideal + d) % M;
        if (!usedSlot[t1]) { found = t1; break; }
        var t2 = (ideal - d + M) % M;
        if (!usedSlot[t2]) { found = t2; break; }
      }
      if (found < 0) continue;
      usedSlot[found] = true;
      var s = slotOrder[found];

      cards.push({
        x: slots[s].x, y: slots[s].y,
        curveX: itemData[i].pos.x, curveY: itemData[i].pos.y,
        item: itemData[i].item
      });
    }
  }

  /* ── Helper: connector line endpoints (matches render exactly) ── */
  function cardLine(c) {
    return computeConnector(c.x, c.y, cW, cH, c.curveX, c.curveY, R, CX, CY);
  }
  function cardLineAt(nx, ny, curveX, curveY) {
    return computeConnector(nx, ny, cW, cH, curveX, curveY, R, CX, CY);
  }

  /* Basic: bounds + curve band + tangent + card-card overlap only
   * Also rejects positions where the connector can't reach the correct time. */
  function posValidBasic(nx, ny, skipIdx) {
    if (nx < P || nx + cW > vpW - P || ny < P || ny + cH > vpH - P) return false;
    if (hexOverlapsCurveBand(nx, ny, cW, cH, R, CX, CY)) return false;
    if (tooCloseToTangent(nx, ny, cW, cH, CX, CY)) return false;
    for (var j = 0; j < cards.length; j++) {
      if (j === skipIdx) continue;
      if (hexsOverlap(nx, ny, cW, cH, cards[j].x, cards[j].y, cW, cH)) return false;
    }
    // Reject if connector would cross the circle (line can't reach correct time)
    if (skipIdx >= 0 && skipIdx < cards.length) {
      var cn = computeConnector(nx, ny, cW, cH,
                                cards[skipIdx].curveX, cards[skipIdx].curveY, R, CX, CY);
      // Check if the band point actually matches the task's time position
      var tdx = cards[skipIdx].curveX - CX, tdy = cards[skipIdx].curveY - CY;
      var td = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
      var bandOuter = R + BAND_W / 2 + 2;
      var idealBx = CX + (tdx / td) * bandOuter;
      var idealBy = CY + (tdy / td) * bandOuter;
      var bpDist = Math.sqrt((cn.bx - idealBx) * (cn.bx - idealBx) +
                             (cn.by - idealBy) * (cn.by - idealBy));
      if (bpDist > BAND_W) return false;  // band point too far from correct time
    }
    return true;
  }

  /* Full: also rejects if any connector passes through this card or
   * this card's connector passes through any other card.
   * Uses exact same geometry as the SVG render. */
  function posValid(nx, ny, skipIdx) {
    if (!posValidBasic(nx, ny, skipIdx)) return false;
    var ml = cardLineAt(nx, ny, cards[skipIdx].curveX, cards[skipIdx].curveY);
    for (var j = 0; j < cards.length; j++) {
      if (j === skipIdx) continue;
      var ol = cardLine(cards[j]);
      if (segHitsHex(ol.ex, ol.ey, ol.bx, ol.by, nx, ny, cW, cH)) return false;
      if (segHitsHex(ml.ex, ml.ey, ml.bx, ml.by,
                      cards[j].x, cards[j].y, cW, cH)) return false;
    }
    return true;
  }

  /* ── Helper: count total issues (line-line crossings + line-through-card) ── */
  function totalCrossings() {
    var count = 0;
    for (var a = 0; a < cards.length; a++) {
      var al = cardLine(cards[a]);
      for (var b = a + 1; b < cards.length; b++) {
        var bl = cardLine(cards[b]);
        if (segsIntersect(al.ex, al.ey, al.bx, al.by,
                          bl.ex, bl.ey, bl.bx, bl.by)) count++;
        if (segHitsHex(al.ex, al.ey, al.bx, al.by,
                        cards[b].x, cards[b].y, cW, cH)) count++;
        if (segHitsHex(bl.ex, bl.ey, bl.bx, bl.by,
                        cards[a].x, cards[a].y, cW, cH)) count++;
      }
    }
    return count;
  }

  /* ── Helper: count issues for one card (line-line crossings + line-through-card) ── */
  function cardCrossings(idx) {
    var c = cards[idx];
    var cl = cardLine(c);
    var count = 0;
    for (var j = 0; j < cards.length; j++) {
      if (j === idx) continue;
      var ol = cardLine(cards[j]);
      if (segsIntersect(cl.ex, cl.ey, cl.bx, cl.by,
                        ol.ex, ol.ey, ol.bx, ol.by)) count++;
      if (segHitsHex(cl.ex, cl.ey, cl.bx, cl.by,
                      cards[j].x, cards[j].y, cW, cH)) count++;
      if (segHitsHex(ol.ex, ol.ey, ol.bx, ol.by,
                      c.x, c.y, cW, cH)) count++;
    }
    return count;
  }

  var DIRS = [
    { dx:  0, dy: -1 }, { dx:  0, dy:  1 },
    { dx: -1, dy:  0 }, { dx:  1, dy:  0 },
    { dx: -1, dy: -1 }, { dx:  1, dy: -1 },
    { dx: -1, dy:  1 }, { dx:  1, dy:  1 }
  ];

  /* ── Phase 2a: Pull cards toward curve anchors ──
   *  Multi-directional: toward-curve + 8 compass directions.
   *  Accept best move that reduces distance without increasing crossings. */
  for (var iter = 0; iter < NUDGE_ITERS; iter++) {
    var improved = false;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var ccx = c.x + cW / 2, ccy = c.y + cH / 2;
      var toDist = Math.sqrt((c.curveX - ccx) * (c.curveX - ccx) +
                             (c.curveY - ccy) * (c.curveY - ccy));
      if (toDist < NUDGE_STEP) continue;

      var crossBefore = cardCrossings(i);

      var bestX = -1, bestY = -1, bestDist = toDist, bestCross = crossBefore;
      // Try toward-curve direction
      var candidates = [{ dx: (c.curveX - ccx) / toDist, dy: (c.curveY - ccy) / toDist }];
      for (var d = 0; d < DIRS.length; d++) candidates.push(DIRS[d]);

      for (var d = 0; d < candidates.length; d++) {
        var nx = c.x + candidates[d].dx * NUDGE_STEP;
        var ny = c.y + candidates[d].dy * NUDGE_STEP;
        if (!posValid(nx, ny, i)) continue;

        var newCcx = nx + cW / 2, newCcy = ny + cH / 2;
        var newDist = Math.sqrt((c.curveX - newCcx) * (c.curveX - newCcx) +
                                (c.curveY - newCcy) * (c.curveY - newCcy));
        if (newDist >= bestDist) continue;

        // Temporarily move to check crossings
        var ox = c.x, oy = c.y;
        c.x = nx; c.y = ny;
        var crossAfter = cardCrossings(i);
        c.x = ox; c.y = oy;

        if (crossAfter > crossBefore) continue;
        // Prefer moves that also reduce crossings
        if (crossAfter < bestCross || (crossAfter === bestCross && newDist < bestDist)) {
          bestDist = newDist; bestX = nx; bestY = ny; bestCross = crossAfter;
        }
      }
      if (bestX >= 0) { c.x = bestX; c.y = bestY; improved = true; }
    }
    if (!improved) break;
  }

  /* ── Phase 2b: resolve crossings with a time budget ──
   *  Swap → jiggle → relocate, all within 400ms max. */
  var TIME_BUDGET = 600;
  var tStart = Date.now();

  function overBudget() { return Date.now() - tStart > TIME_BUDGET; }

  /* Swap crossing pairs — use per-card crossing counts (cheap) */
  for (var sp = 0; sp < 10 && !overBudget(); sp++) {
    var didSwap = false;
    for (var a = 0; a < cards.length && !overBudget(); a++) {
      if (cardCrossings(a) === 0) continue;
      for (var b = a + 1; b < cards.length; b++) {
        var crossA = cardCrossings(a);
        var crossB = cardCrossings(b);
        if (crossA === 0 && crossB === 0) continue;
        var sumBefore = crossA + crossB;

        var axOld = cards[a].x, ayOld = cards[a].y;
        var bxOld = cards[b].x, byOld = cards[b].y;
        cards[a].x = bxOld; cards[a].y = byOld;
        cards[b].x = axOld; cards[b].y = ayOld;

        var validA = posValidBasic(cards[a].x, cards[a].y, a);
        var validB = posValidBasic(cards[b].x, cards[b].y, b);
        var abOvlp = hexsOverlap(cards[a].x, cards[a].y, cW, cH,
                                   cards[b].x, cards[b].y, cW, cH);
        var sumAfter = validA && validB && !abOvlp
                       ? cardCrossings(a) + cardCrossings(b) : sumBefore + 1;

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

  /* Jiggle: 8 directions at increasing step sizes */
  var jigSteps = [NUDGE_STEP, NUDGE_STEP * 3, NUDGE_STEP * 8,
                  NUDGE_STEP * 16, NUDGE_STEP * 32];
  for (var jp = 0; jp < 60 && !overBudget(); jp++) {
    var jigDone = true;
    var jigImproved = false;
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

  /* Relocate: coarse viewport scan for cards still crossing */
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
        if (cc < bestRC || dd < bestRD) {
          bestRC = cc; bestRX = sx; bestRY = sy; bestRD = dd;
        }
      }
    }
    if (bestRX >= 0 && bestRC < myC) { c.x = bestRX; c.y = bestRY; }
  }

  /* ── Lateral shift: slide cards left/right/up/down in small steps ──
   *  Specifically targets line-through-card overlaps that a simple
   *  lateral move can fix. */
  var shiftMax = Math.round(Math.max(cW, cH) * 4);
  var shiftStep = Math.round(NUDGE_STEP * 1.5);
  for (var sp2 = 0; sp2 < 3 && !overBudget(); sp2++) {
    var shiftImproved = false;
    for (var i = 0; i < cards.length && !overBudget(); i++) {
      var myC2 = cardCrossings(i);
      if (myC2 === 0) continue;
      var bestSX = -1, bestSY = -1, bestSC = myC2;
      // Try sliding in 4 cardinal directions at increasing distances
      for (var dir = 0; dir < 4; dir++) {
        var sdx = dir === 0 ? 1 : dir === 1 ? -1 : 0;
        var sdy = dir === 2 ? 1 : dir === 3 ? -1 : 0;
        for (var dist = shiftStep; dist <= shiftMax; dist += shiftStep) {
          var sx = cards[i].x + sdx * dist;
          var sy = cards[i].y + sdy * dist;
          if (!posValidBasic(sx, sy, i)) continue;
          var oxs = cards[i].x, oys = cards[i].y;
          cards[i].x = sx; cards[i].y = sy;
          var sc = cardCrossings(i);
          cards[i].x = oxs; cards[i].y = oys;
          if (sc < bestSC) { bestSC = sc; bestSX = sx; bestSY = sy; }
        }
      }
      if (bestSX >= 0) {
        cards[i].x = bestSX; cards[i].y = bestSY;
        shiftImproved = true;
      }
    }
    if (!shiftImproved) break;
  }

  /* ── Final cleanup: ensure no card sits on any connector line ──
   *  Uses strict posValid. Scan viewport for a clean position. */
  var fStep = Math.round(Math.max(cW, cH) * 0.35);
  for (var i = 0; i < cards.length && !overBudget(); i++) {
    if (cardCrossings(i) === 0) continue;
    var c = cards[i];
    var bestFX = -1, bestFY = -1, bestFC = cardCrossings(i), bestFD = Infinity;
    for (var fy = P; fy + cH <= vpH - P; fy += fStep) {
      for (var fx = P; fx + cW <= vpW - P; fx += fStep) {
        if (!posValid(fx, fy, i)) continue;
        var ox = c.x, oy = c.y;
        c.x = fx; c.y = fy;
        var fc = cardCrossings(i);
        c.x = ox; c.y = oy;
        if (fc > bestFC) continue;
        var fdx = fx + cW / 2 - c.curveX, fdy = fy + cH / 2 - c.curveY;
        var fd = fdx * fdx + fdy * fdy;
        if (fc < bestFC || fd < bestFD) {
          bestFC = fc; bestFX = fx; bestFY = fy; bestFD = fd;
        }
      }
    }
    if (bestFX >= 0 && bestFC < cardCrossings(i)) { c.x = bestFX; c.y = bestFY; }
  }

  /* ── Build result ── */
  var result = [];
  for (var i = 0; i < cards.length; i++) {
    result.push({
      item: cards[i].item.item,
      curveX: cards[i].curveX, curveY: cards[i].curveY,
      cardX: Math.round(cards[i].x), cardY: Math.round(cards[i].y),
      side: cards[i].curveX < CX ? 'left' : 'right',
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

  /* ── R sized to fit circle with room for cards around it ── */
  var maxRW = Math.max(29, (vpW - 2 * PADDING) / 5.56);
  var maxRH = Math.max(29, (vpH - 2 * PADDING) * 0.23);
  var R  = Math.min(maxRW, maxRH);
  var CX = vpW / 2;
  var CY = vpH / 2;

  /* ── Time blocks ── */
  var blocks = useMemo(function () {
    if (!dateKey || !schedCfg.timeBlocks) return [];
    return getBlocksForDate(dateKey, schedCfg.timeBlocks, schedCfg);
  }, [dateKey, schedCfg]);

  /* ── Curve samples — single circle ── */
  var curveSamples = useMemo(function () {
    var defColor   = darkMode ? '#475569' : '#CBD5E1';
    var nightColor = darkMode ? '#1E293B' : '#E2E8F0';
    var out = [];
    for (var m = 0; m <= 1440; m += SAMPLE_STEP) {
      var mins = m % 1440;
      var pos  = minutesToPosition(mins, R, CX, CY);
      var blk  = getBlockAtMinute(mins, blocks);
      var color = blk ? (blk.color || defColor)
                      : (mins >= 360 && mins < 1080 ? defColor : nightColor);
      out.push({ x: pos.x, y: pos.y, color: color });
    }
    return out;
  }, [R, CX, CY, blocks, darkMode]);

  /* ── Interior arc segments: "when" (block name) + "where" (location) ── */
  var INNER_LOC_W = 33;   // width of inner location ring (50% wider)
  var INNER_WHEN_W = 27;  // width of inner "when" label ring (50% wider)
  var innerLocR = R - BAND_W / 2 - INNER_LOC_W / 2 - 3;               // location ring radius
  var innerWhenR = innerLocR - INNER_LOC_W / 2 - INNER_WHEN_W / 2 - 2; // when ring inside that

  var blockSegments = useMemo(function () {
    return blocks.map(function (blk) {
      var midMins = (blk.start + blk.end) / 2;

      // Start/end angles for arc (6AM=left, noon=top, 6PM=right, 12AM=bottom)
      var startT = blk.start / 1440;
      var endT   = blk.end / 1440;
      var startAngle = startT * 2 * Math.PI;
      var endAngle   = endT * 2 * Math.PI;

      // SVG arc path for location ring
      function arcPath(r) {
        var sA = 3 * Math.PI / 2 - startAngle;
        var eA = 3 * Math.PI / 2 - endAngle;
        var x1 = CX + r * Math.cos(sA);
        var y1 = CY - r * Math.sin(sA);
        var x2 = CX + r * Math.cos(eA);
        var y2 = CY - r * Math.sin(eA);
        var sweep = (endAngle - startAngle) > Math.PI ? 1 : 0;
        return 'M ' + x1 + ' ' + y1 + ' A ' + r + ' ' + r + ' 0 ' + sweep + ' 1 ' + x2 + ' ' + y2;
      }

      // Mid-point positions for labels
      var midPos = minutesToPosition(midMins, R, CX, CY);
      // Location label on inner loc ring
      var locLabelR = innerLocR;
      var midA = 3 * Math.PI / 2 - (midMins / 1440) * 2 * Math.PI;
      var locX = CX + locLabelR * Math.cos(midA);
      var locY = CY - locLabelR * Math.sin(midA);
      // When label on inner when ring
      var whenX = CX + innerWhenR * Math.cos(midA);
      var whenY = CY - innerWhenR * Math.sin(midA);

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
  }, [blocks, R, CX, CY, innerLocR, innerWhenR, darkMode]);

  /* ── Hour markers — every 3 hours with label, every 1 hour with tick ── */
  var hourMarkers = useMemo(function () {
    var out = [];
    for (var h = 0; h < 24; h++) {
      var mins = h * 60;
      var pos  = minutesToPosition(mins, R, CX, CY);
      out.push({
        hour: h, x: pos.x, y: pos.y, nx: pos.nx, ny: pos.ny,
        showLabel: h % 3 === 0
      });
    }
    return out;
  }, [R, CX, CY]);

  /* ── Card layout: frame placement + nudge toward curve ── */
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

    // Compute optimal card size
    var area = estimateArea(R, CX, CY, vpW, vpH);
    var size = computeCardSize(allItems.length, area, isMobile);
    var cW = size.w;
    var cH = size.h;

    // Place all cards around frame, then nudge toward curve
    var cards = placeCardsAroundFrame(allItems, cW, cH, R, CX, CY, vpW, vpH);
    return { cards: cards, cW: cW, cH: cH };
  }, [placements, R, CX, CY, vpW, vpH, isMobile, blocks, darkMode]);

  var cards = cardLayout.cards;
  var cW = cardLayout.cW;
  var cH = cardLayout.cH;
  var layoutMode = cH < 55 ? 'compact' : 'normal';

  /* ── Now indicator ── */
  var nowPos = useMemo(function () {
    if (!isToday || nowMins == null) return null;
    return minutesToPosition(nowMins, R, CX, CY);
  }, [isToday, nowMins, R, CX, CY]);

  /* ── Content height ── */
  var contentH = vpH;
  for (var ci = 0; ci < cards.length; ci++) {
    var bot = cards[ci].cardY + cH + PADDING;
    if (bot > contentH) contentH = bot;
  }

  /* ── Render ── */
  return (
    <div style={{ position: 'relative', width: vpW, height: contentH, minHeight: vpH, overflow: 'hidden' }}>
      <svg style={{
        position: 'absolute', left: 0, top: 0,
        width: vpW, height: contentH,
        pointerEvents: 'none'
      }}>

        {/* 1. Coloured time-block band */}
        {curveSamples.map(function (s, i) {
          if (i === 0) return null;
          var p = curveSamples[i - 1];
          return <line key={'b' + i} x1={p.x} y1={p.y} x2={s.x} y2={s.y}
            stroke={s.color} strokeWidth={BAND_W}
            strokeLinecap="round" opacity={0.55} />;
        })}

        {/* 2. Centre-line */}
        {curveSamples.map(function (s, i) {
          if (i === 0) return null;
          var p = curveSamples[i - 1];
          return <line key={'c' + i} x1={p.x} y1={p.y} x2={s.x} y2={s.y}
            stroke={darkMode ? '#64748B' : '#94A3B8'} strokeWidth={2}
            strokeLinecap="round" />;
        })}

        {/* 3. Interior rings: location (where) + block name (when) */}
        {blockSegments.map(function (seg, i) {
          return (
            <g key={'seg' + i}>
              {/* Location arc (outer inner ring) */}
              <path d={seg.locPath} fill="none"
                stroke={seg.locColor} strokeWidth={INNER_LOC_W}
                strokeLinecap="butt" opacity={0.35} />
              {/* When arc (inner inner ring) */}
              <path d={seg.whenPath} fill="none"
                stroke={seg.whenColor} strokeWidth={INNER_WHEN_W}
                strokeLinecap="butt" opacity={0.3} />
              {/* Location emoji */}
              {seg.locLabel ? (
                <text x={seg.locX} y={seg.locY}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={isMobile ? 14 : 18}>
                  {seg.locLabel}
                </text>
              ) : null}
              {/* Block name + icon */}
              <text x={seg.whenX} y={seg.whenY}
                textAnchor="middle" dominantBaseline="middle"
                fill={darkMode ? '#E2E8F0' : '#334155'}
                fontSize={isMobile ? 9 : 11} fontWeight={700}
                fontFamily="'DM Sans', system-ui" opacity={0.8}>
                {seg.whenLabel}
              </text>
            </g>
          );
        })}

        {/* 4. Hour tick marks on the curve + labels every 3h */}
        {hourMarkers.map(function (m) {
          var dx = m.x - CX;
          var dy = m.y - CY;
          var d  = Math.sqrt(dx * dx + dy * dy) || 1;
          var outX = dx / d;
          var outY = dy / d;

          return (
            <g key={'h' + m.hour}>
              {/* Tick circle on the curve at every hour */}
              <circle cx={m.x} cy={m.y} r={m.showLabel ? 3 : 2}
                fill={darkMode ? '#94A3B8' : '#64748B'}
                opacity={m.showLabel ? 0.7 : 0.4} />
              {/* Label every 3 hours */}
              {m.showLabel ? (
                <text x={m.x + outX * (BAND_W / 2 + 18)}
                  y={m.y + outY * (BAND_W / 2 + 18)}
                  textAnchor="middle" dominantBaseline="middle"
                  fill={darkMode ? '#CBD5E1' : '#475569'}
                  fontSize={isMobile ? 9 : 12} fontWeight={700}
                  fontFamily="'DM Sans', system-ui">
                  {formatHour(m.hour)}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* 5. Connector lines: card → band edge (checked to avoid crossing circle) */}
        {cards.map(function (c) {
          var pc = PRI_COLORS[c.item.task.pri] || PRI_COLORS.P3;
          var cn = computeConnector(c.cardX, c.cardY, cW, cH,
                                    c.curveX, c.curveY, R, CX, CY);
          return <line key={'cn' + (c.item.key || c.item.task.id)}
            x1={cn.bx} y1={cn.by} x2={cn.ex} y2={cn.ey}
            stroke={pc} strokeWidth={1.2} opacity={0.3} />;
        })}

        {/* 6. Task markers on the curve */}
        {cards.map(function (c) {
          var pc = PRI_COLORS[c.item.task.pri] || PRI_COLORS.P3;
          return <circle key={'mk' + (c.item.key || c.item.task.id)}
            cx={c.curveX} cy={c.curveY} r={5}
            fill={pc} opacity={0.9}
            stroke={darkMode ? '#0F172A' : '#FFFFFF'} strokeWidth={2} />;
        })}

        {/* 7. Now indicator */}
        {nowPos && (
          <g>
            <circle cx={nowPos.x} cy={nowPos.y} r={7} fill="#EF4444" />
            <circle cx={nowPos.x} cy={nowPos.y} r={12}
              fill="none" stroke="#EF4444" strokeWidth={2} opacity={0.4} />
          </g>
        )}
      </svg>

      {/* 8. Task cards — hexagonal shape */}
      {cards.map(function (c) {
        var hexPd = Math.round(cH * HEX_INDENT);
        var pdPct = (hexPd / cW * 100).toFixed(1);
        var rPct = (100 - hexPd / cW * 100).toFixed(1);
        var clipPath = 'polygon(' +
          pdPct + '% 0%, ' + rPct + '% 0%, 100% 50%, ' +
          rPct + '% 100%, ' + pdPct + '% 100%, 0% 50%)';
        var bc = c.blockColor || (darkMode ? '#475569' : '#CBD5E1');
        return (
          <div key={c.item.key || c.item.task.id} style={{
            position: 'absolute',
            left: c.cardX, top: c.cardY,
            width: cW, height: cH,
            boxSizing: 'border-box',
            zIndex: 20,
            clipPath: clipPath,
            WebkitClipPath: clipPath,
            overflow: 'hidden'
          }}>
            {/* Full hex background */}
            <div style={{
              position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
              background: darkMode ? '#1E293B' : '#FFFFFF'
            }} />
            {/* Colored accent on left point */}
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: hexPd + 3,
              background: bc,
              opacity: 0.55
            }} />
            <div style={{
              position: 'relative',
              paddingLeft: hexPd + 4, paddingRight: hexPd + 2,
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
