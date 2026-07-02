/**
 * dailyViewHelpers — pure helper functions extracted verbatim from
 * DailyView.jsx (999.965 JUG-PERF-FE-GOD-COMPONENTS split, WBS W2).
 * No logic changes — see TRACEABILITY.md B1.
 */

import { GRID_START } from '../../state/constants';
import { formatDateKey } from '../../scheduler/dateHelpers';

export function weatherCodeLabel(code) {
  if (code == null || code === 0) return 'Clear';
  if (code <= 3) return 'Partly Cloudy';
  if (code <= 48) return 'Foggy';
  if (code === 51 || code === 53) return 'Light Drizzle';
  if (code === 55) return 'Drizzle';
  if (code === 61 || code === 63) return 'Light Rain';
  if (code === 65) return 'Heavy Rain';
  if (code === 66 || code === 67) return 'Freezing Rain';
  if (code === 71 || code === 73) return 'Light Snow';
  if (code === 75) return 'Heavy Snow';
  if (code === 77) return 'Snow Grains';
  if (code === 80 || code === 81) return 'Rain Showers';
  if (code === 82) return 'Heavy Showers';
  if (code === 85 || code === 86) return 'Snow Showers';
  return 'Stormy';
}

export function minsToTime(m) {
  var h = Math.floor(m / 60);
  var mm = m % 60;
  var ampm = h >= 12 ? 'p' : 'a';
  h = h % 12 || 12;
  return h + (mm ? ':' + String(mm).padStart(2, '0') : '') + ampm;
}

export function durLabel(dur) {
  if (!dur) return '';
  return dur >= 60 ? Math.round(dur / 60 * 10) / 10 + 'h' : dur + 'm';
}

// juggler-cal-history Plan E — past-fade + popup helpers (D-10/D-12).
export function isTaskPast(item, todayKey) {
  var t = item && item.task;
  if (!t || !t.scheduledAt) return false;
  return formatDateKey(new Date(t.scheduledAt)) < todayKey;
}

export function labelForStatus(s) {
  if (s === 'done') return 'Done at';
  if (s === 'skip') return 'Skipped at';
  if (s === 'cancel' || s === 'cancelled') return 'Cancelled at';
  if (s === 'pause') return 'Paused at';
  return 'Resolved at';
}

export function formatCompletedAt(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  var time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, '');
  var day = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return time + ' ' + day;
}

export function getStatusReason(t, status) {
  if (!t || !status) return null;

  switch (status) {
    case 'cancel':
      return t.cancelReason ? 'cancelled: ' + t.cancelReason : 'cancelled by user';
    case 'skip':
      return t.skipReason ? 'skipped: ' + t.skipReason : 'skipped for today';
    case 'pause':
      return t.pauseReason ? 'paused: ' + t.pauseReason : 'temporarily paused';
    default:
      return null; // 'done' doesn't typically have automatic reasons
  }
}

/* ── Task nature → background tint ── */
export function tileBg(task, darkMode, hover, theme) {
  // Reminder events — subtle purple/violet
  if (task.marker) {
    if (darkMode) return hover ? '#4338CA30' : '#4338CA1C';
    return hover ? '#EEF2FF20' : '#EEF2FF12';
  }
  // Fixed/rigid tasks — subtle amber/orange
  if (task.fixed || task.rigid || task.placementMode === 'fixed' || task.placement_mode === 'fixed') {
    if (darkMode) return hover ? '#9E6B3B30' : '#9E6B3B1C';
    return hover ? '#FEF3C720' : '#FEF3C712';
  }
  // Recurrings — subtle teal
  if (task.recurring) {
    if (darkMode) return hover ? '#0D948830' : '#0D94881C';
    return hover ? '#CCFBF120' : '#CCFBF112';
  }
  // Default flexible — very subtle neutral
  return theme.bgCard;
}

/* ── Overlap layout: assign columns + enforce minimum block height ── */
export var MIN_BLOCK_H = 22;
var BLOCK_GAP = 2;

// Exported for unit testing of the adjacent-same-task chunk merge (M-SCH-2,
// backlog 999.579). Not part of the public component API.
export function computeColumns(placements, hourHeight) {
  // Minimum visual duration in minutes — ensures MIN_BLOCK_H blocks
  // are treated as overlapping during clustering
  var minVisualMin = hourHeight > 0 ? (MIN_BLOCK_H / hourHeight) * 60 : 0;

  // Merge adjacent split chunks of the same task into a single visual block.
  // Two chunks are "adjacent" if they share sourceId and one ends where the next starts.
  var rawItems = placements.map(function (p) {
    var s = p.start;
    var e = p.end || s + (p.dur || (p.task ? p.task.dur || 30 : 30));
    return { p: p, start: s, end: e };
  }).sort(function (a, b) { return a.start - b.start || a.end - b.end; });

  var mergedItems = [];
  for (var mi = 0; mi < rawItems.length; mi++) {
    var curr = rawItems[mi];
    var src = curr.p.task && (curr.p.task.sourceId || curr.p.task.splitGroup);
    // Try to merge with the previous merged item
    if (src && mergedItems.length > 0) {
      var prev = mergedItems[mergedItems.length - 1];
      var prevSrc = prev.p.task && (prev.p.task.sourceId || prev.p.task.splitGroup);
      if (prevSrc === src && curr.start === prev.end) {
        // Merge: extend the previous block
        prev.end = curr.end;
        prev.p = Object.assign({}, prev.p, {
          dur: prev.end - prev.start,
          _mergedChunks: (prev.p._mergedChunks || 1) + 1
        });
        continue;
      }
    }
    mergedItems.push({ p: curr.p, start: curr.start, end: curr.end });
  }

  var items = mergedItems.map(function(it) {
    var visualEnd = Math.max(it.end, it.start + minVisualMin);
    return { p: it.p, start: it.start, end: it.end, visualEnd: visualEnd };
  });

  var clusters = [];
  var cur = null;
  for (var i = 0; i < items.length; i++) {
    if (!cur || items[i].start >= cur.end) {
      cur = { items: [items[i]], end: items[i].visualEnd };
      clusters.push(cur);
    } else {
      cur.items.push(items[i]);
      if (items[i].visualEnd > cur.end) cur.end = items[i].visualEnd;
    }
  }

  var result = [];
  clusters.forEach(function (cluster) {
    var cols = [];
    cluster.items.forEach(function (it) {
      var placed = false;
      for (var c = 0; c < cols.length; c++) {
        if (it.start >= cols[c]) {
          cols[c] = it.visualEnd;
          it.col = c;
          placed = true;
          break;
        }
      }
      if (!placed) {
        it.col = cols.length;
        cols.push(it.visualEnd);
      }
    });
    var totalCols = cols.length;

    var colBottoms = {};
    cluster.items.forEach(function (it) {
      var naturalTop = ((it.start - GRID_START * 60) / 60) * hourHeight;
      var naturalH = Math.max(((it.end - it.start) / 60) * hourHeight, MIN_BLOCK_H);
      var colKey = it.col;
      var top = naturalTop;
      if (colBottoms[colKey] != null && colBottoms[colKey] + BLOCK_GAP > top) {
        top = colBottoms[colKey] + BLOCK_GAP;
      }
      colBottoms[colKey] = top + naturalH;
      result.push({ p: it.p, top: top, height: naturalH, col: it.col, totalCols: totalCols });
    });
  });

  return result;
}
