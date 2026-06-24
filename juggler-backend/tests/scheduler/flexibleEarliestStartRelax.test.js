/**
 * Leg C (scheduler-recurring-rework §3) — flexible earliest-start relax.
 *
 * A flexible-TPC session whose spaced day (anchor) and the rest of its forward
 * cycle window are full must RELAX its soft earliest-start back to the cycle start
 * and take an EARLIER open day — instead of going unplaced/vanishing. The hard
 * deadline (cycle end) is unchanged; the cross-cycle spacing guard still prevents
 * same-series double-up.
 *
 * Pure scheduler (unifiedScheduleV2) — no DB, no wall-clock. RED on pre-fix (the
 * forward-only search leaves it unplaced); GREEN after (placed earlier than anchor).
 */
'use strict';
process.env.NODE_ENV = 'test';

var unifiedScheduleV2 = require('../../src/scheduler/unifiedScheduleV2');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');

var TODAY_KEY = '2026-06-24'; // Wednesday
var NOW_MINS = 5; // 12:05 AM — nothing has passed today yet

function makeCfg(overrides) {
  return Object.assign({ timeBlocks: DEFAULT_TIME_BLOCKS, toolMatrix: DEFAULT_TOOL_MATRIX, timezone: 'America/New_York' }, overrides || {});
}

function addDays(key, n) {
  var p = key.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  d.setUTCDate(d.getUTCDate() + n);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

var _c = 0;
function makeBlocker(dateKey) {
  // a pinned fixed task covering 6:00 AM–12:00 PM (360 min) — fills the whole morning
  // window (weekday 360–480 and weekend 420–720) so a morning task cannot fit that day.
  _c++;
  return {
    id: 'blk-' + _c, taskType: 'task', text: 'Blocker ' + _c,
    date: dateKey, day: null, time: '6:00 AM', scheduledAt: dateKey + 'T10:00:00Z',
    dur: 360, pri: 'P1', status: '', when: 'fixed', placementMode: 'fixed', datePinned: true,
    recurring: false, location: [], tools: [], dependsOn: [], dayReq: 'any', marker: false
  };
}

function recurringInstance(anchorKey) {
  return {
    id: 'flex-1', taskType: 'recurring_instance', text: 'Flex session',
    date: anchorKey, day: null, time: null, scheduledAt: null, dur: 30, pri: 'P3', status: '',
    when: 'morning', placementMode: 'time_window', timeFlex: 10080,
    recurring: true, recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 1 },
    recurStart: TODAY_KEY, sourceId: 'flex-m', generated: false,
    location: [], tools: [], dependsOn: [], dayReq: 'any', marker: false,
    splitTotal: 1, splitOrdinal: 1
  };
}

function runScheduler(tasks) {
  var statuses = {}; tasks.forEach(function(t) { statuses[t.id] = t.status || ''; });
  return unifiedScheduleV2(tasks, statuses, TODAY_KEY, NOW_MINS, makeCfg());
}

function placedDate(result, id) {
  if (!result || !result.dayPlacements) return null;
  var keys = Object.keys(result.dayPlacements);
  for (var i = 0; i < keys.length; i++) {
    var hit = result.dayPlacements[keys[i]].find(function(p) { return p.task && p.task.id === id; });
    if (hit) return keys[i];
  }
  return null;
}

describe('Leg C — flexible-TPC earliest-start relax (fit earlier, never lost)', () => {
  test('anchor + forward cycle full → relaxes to an EARLIER open day (not unplaced)', () => {
    var anchor = addDays(TODAY_KEY, 3); // Sat 6/27 — the spaced day
    // Block every morning from today through the end of the cycle EXCEPT day+1 (6/25),
    // and also block the anchor day. The only free morning is 6/25 — which is BEFORE the
    // anchor, so only the earliest-start relax (search the cycle from its start) can reach it.
    var freeDay = addDays(TODAY_KEY, 1); // Thu 6/25
    var tasks = [recurringInstance(anchor)];
    for (var off = 0; off <= 9; off++) {
      var dk = addDays(TODAY_KEY, off);
      if (dk === freeDay) continue;
      tasks.push(makeBlocker(dk));
    }

    var result = runScheduler(tasks);
    var where = placedDate(result, 'flex-1');

    // Must be PLACED (never lost)...
    expect(where).not.toBeNull();
    // ...on the only free morning, which is EARLIER than its spaced anchor day (relax worked).
    expect(where).toBe(freeDay);
    expect(where < anchor).toBe(true);
  });
});
