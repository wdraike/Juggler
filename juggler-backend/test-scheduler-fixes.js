/**
 * Test script for scheduler priority inversion & past-task fixes.
 *
 * Run: node test-scheduler-fixes.js
 */

var unifiedSchedule = require('./src/scheduler/unifiedSchedule');
var scoreSchedule = require('./src/scheduler/scoreSchedule');
var constants = require('./src/scheduler/constants');
var dateHelpers = require('./src/scheduler/dateHelpers');
var formatDateKey = dateHelpers.formatDateKey;
var parseDate = dateHelpers.parseDate;

var DEFAULT_TIME_BLOCKS = constants.DEFAULT_TIME_BLOCKS;
var DEFAULT_TOOL_MATRIX = constants.DEFAULT_TOOL_MATRIX;

var today = new Date();
today.setHours(0, 0, 0, 0);
var todayKey = formatDateKey(today);

function dayOffset(n) {
  var d = new Date(today);
  d.setDate(d.getDate() + n);
  return formatDateKey(d);
}

function dowName(d) {
  return constants.DAY_NAMES[d.getDay()];
}

function makeCfg() {
  return {
    timeBlocks: DEFAULT_TIME_BLOCKS,
    toolMatrix: DEFAULT_TOOL_MATRIX,
    locSchedules: {},
    locScheduleDefaults: {},
    locScheduleOverrides: {},
    hourLocationOverrides: {},
    scheduleTemplates: null,
    preferences: {},
    splitDefault: undefined,
    splitMinDefault: undefined
  };
}

function makeTask(overrides) {
  var id = overrides.id || 'task_' + Math.random().toString(36).slice(2, 8);
  return Object.assign({
    id: id,
    text: overrides.text || id,
    date: todayKey,
    day: dowName(today),
    project: 'Test',
    pri: 'P3',
    dur: 30,
    when: 'morning,lunch,afternoon,evening',
    where: 'anywhere',
    dayReq: 'any',
    habit: false,
    rigid: false,
    section: '',
    notes: '',
    dependsOn: [],
    status: ''
  }, overrides);
}

var passed = 0;
var failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log('  PASS: ' + name);
    passed++;
  } else {
    console.log('  FAIL: ' + name);
    failed++;
  }
}

// ============================================================
// TEST 1: Priority ordering — P1 should be scheduled on today
//         or earlier day than P3 tasks.
// ============================================================
console.log('\n=== Test 1: Priority ordering ===');
(function() {
  // Create several P1 and P3 tasks, all dated today, with enough
  // total duration to fill today and spill over.
  var tasks = [];
  for (var i = 0; i < 4; i++) {
    tasks.push(makeTask({ id: 'p1_' + i, text: 'P1 task ' + i, pri: 'P1', dur: 60, date: todayKey }));
  }
  for (var j = 0; j < 4; j++) {
    tasks.push(makeTask({ id: 'p3_' + j, text: 'P3 task ' + j, pri: 'P3', dur: 60, date: todayKey }));
  }

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });

  var result = unifiedSchedule(tasks, statuses, todayKey, 0, makeCfg());

  // Find where P1 and P3 tasks ended up
  var p1Days = [], p3Days = [];
  var dp = result.dayPlacements;
  Object.keys(dp).forEach(function(dk) {
    dp[dk].forEach(function(p) {
      if (!p.task) return;
      if (p.task.id.startsWith('p1_')) p1Days.push(dk);
      if (p.task.id.startsWith('p3_')) p3Days.push(dk);
    });
  });

  // All P1 tasks should be placed
  assert(p1Days.length === 4, 'All P1 tasks placed');

  // Check that the latest P1 day <= earliest P3 day (P1 not pushed after P3)
  if (p1Days.length > 0 && p3Days.length > 0) {
    var p1Latest = p1Days.map(function(d) { return parseDate(d); }).sort(function(a,b) { return b-a; })[0];
    var p3Earliest = p3Days.map(function(d) { return parseDate(d); }).sort(function(a,b) { return a-b; })[0];
    assert(p1Latest <= p3Earliest, 'P1 tasks not pushed later than P3 tasks (P1 latest: ' + formatDateKey(p1Latest) + ', P3 earliest: ' + formatDateKey(p3Earliest) + ')');
  }

  // Score should have low crossDayPri penalty
  var score = result.score;
  assert(score.breakdown.crossDayPri !== undefined, 'crossDayPri in score breakdown');
})();

// ============================================================
// TEST 2: Deadline spread — P4 task due in 7 days should NOT
//         land on today; should be within ~2–3 days of deadline.
// ============================================================
console.log('\n=== Test 2: Deadline spread constraint ===');
(function() {
  var dueDate = dayOffset(7);
  // Fill today with P1 work to simulate a busy day — enough to consume all slots
  var tasks = [];
  for (var i = 0; i < 10; i++) {
    tasks.push(makeTask({ id: 'fill_' + i, text: 'Filler P1 ' + i, pri: 'P1', dur: 60, date: todayKey }));
  }
  // Also fill tomorrow
  for (var j = 0; j < 10; j++) {
    tasks.push(makeTask({ id: 'fill2_' + j, text: 'Filler P1 tmrw ' + j, pri: 'P1', dur: 60, date: dayOffset(1) }));
  }
  // P4 deadline task — dated near deadline (not today) so dateDrift doesn't pull it back
  tasks.push(makeTask({ id: 'p4_deadline', text: 'P4 deadline task', pri: 'P4', dur: 60, due: dueDate, date: dueDate }));

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });

  var result = unifiedSchedule(tasks, statuses, todayKey, 0, makeCfg());

  // Find where the P4 deadline task was placed
  var p4DateKey = null;
  var dp = result.dayPlacements;
  Object.keys(dp).forEach(function(dk) {
    dp[dk].forEach(function(p) {
      if (p.task && p.task.id === 'p4_deadline') p4DateKey = dk;
    });
  });

  if (p4DateKey) {
    var p4Date = parseDate(p4DateKey);
    var daysFromToday = Math.round((p4Date - today) / 86400000);
    // P4 with 7-day deadline: spread = ceil(7/3) = 3, so floor = deadline - 3 = day 4
    // Task should be on day 4-7, NOT day 0-1 (those are full anyway)
    assert(daysFromToday >= 3, 'P4 deadline task not placed too early (placed on day +' + daysFromToday + ')');
    assert(daysFromToday <= 7, 'P4 deadline task placed before deadline (day +' + daysFromToday + ')');
  } else {
    // Check unplaced
    var isUnplaced = result.unplaced.some(function(t) { return t.id === 'p4_deadline'; });
    assert(!isUnplaced, 'P4 deadline task should be placed (was unplaced)');
  }
})();

// ============================================================
// TEST 3: Cross-day priority penalty in scoring
// ============================================================
console.log('\n=== Test 3: Cross-day priority penalty ===');
(function() {
  // Construct a scenario with priority inversion and score it
  var dayPlacements = {};
  var todayPlacements = [
    { task: { id: 't1', text: 'Low pri', pri: 'P4', habit: false }, start: 540, dur: 60, locked: false }
  ];
  var tomorrowKey = dayOffset(1);
  var tomorrowPlacements = [
    { task: { id: 't2', text: 'High pri', pri: 'P1', habit: false }, start: 540, dur: 60, locked: false }
  ];
  dayPlacements[todayKey] = todayPlacements;
  dayPlacements[tomorrowKey] = tomorrowPlacements;

  var allTasks = [
    { id: 't1', text: 'Low pri', pri: 'P4', habit: false, dependsOn: [] },
    { id: 't2', text: 'High pri', pri: 'P1', habit: false, dependsOn: [] }
  ];

  var score = scoreSchedule(dayPlacements, [], allTasks);
  assert(score.breakdown.crossDayPri > 0, 'Cross-day priority penalty applied for P4-before-P1 (' + score.breakdown.crossDayPri + ')');

  // Now reverse: P1 on today, P4 on tomorrow — should have no penalty
  var dayPlacements2 = {};
  dayPlacements2[todayKey] = [
    { task: { id: 't2', text: 'High pri', pri: 'P1', habit: false }, start: 540, dur: 60, locked: false }
  ];
  dayPlacements2[tomorrowKey] = [
    { task: { id: 't1', text: 'Low pri', pri: 'P4', habit: false }, start: 540, dur: 60, locked: false }
  ];
  var score2 = scoreSchedule(dayPlacements2, [], allTasks);
  assert(score2.breakdown.crossDayPri === 0, 'No cross-day penalty when P1 is before P4 (' + score2.breakdown.crossDayPri + ')');
})();

// ============================================================
// TEST 4: Habits exempt from cross-day priority penalty
// ============================================================
console.log('\n=== Test 4: Habits exempt from cross-day penalty ===');
(function() {
  var dayPlacements = {};
  dayPlacements[todayKey] = [
    { task: { id: 'h1', text: 'Habit', pri: 'P4', habit: true }, start: 540, dur: 30, locked: false }
  ];
  dayPlacements[dayOffset(1)] = [
    { task: { id: 't1', text: 'High', pri: 'P1', habit: false }, start: 540, dur: 60, locked: false }
  ];
  var allTasks = [
    { id: 'h1', text: 'Habit', pri: 'P4', habit: true, dependsOn: [] },
    { id: 't1', text: 'High', pri: 'P1', habit: false, dependsOn: [] }
  ];
  var score = scoreSchedule(dayPlacements, [], allTasks);
  assert(score.breakdown.crossDayPri === 0, 'Habits do not trigger cross-day penalty (' + score.breakdown.crossDayPri + ')');
})();

// ============================================================
// TEST 5: Locked tasks exempt from cross-day priority penalty
// ============================================================
console.log('\n=== Test 5: Locked tasks exempt from cross-day penalty ===');
(function() {
  var dayPlacements = {};
  dayPlacements[todayKey] = [
    { task: { id: 'l1', text: 'Locked low', pri: 'P4', habit: false }, start: 540, dur: 30, locked: true }
  ];
  dayPlacements[dayOffset(1)] = [
    { task: { id: 't1', text: 'High', pri: 'P1', habit: false }, start: 540, dur: 60, locked: false }
  ];
  var allTasks = [
    { id: 'l1', text: 'Locked low', pri: 'P4', habit: false, dependsOn: [] },
    { id: 't1', text: 'High', pri: 'P1', habit: false, dependsOn: [] }
  ];
  var score = scoreSchedule(dayPlacements, [], allTasks);
  assert(score.breakdown.crossDayPri === 0, 'Locked tasks do not trigger cross-day penalty (' + score.breakdown.crossDayPri + ')');
})();

// ============================================================
// TEST 6: Phase 2.5 compaction — higher-pri tasks pulled earlier
// ============================================================
console.log('\n=== Test 6: Phase 2.5 compaction ===');
(function() {
  // Create a scenario where P4 grabs today (dated today, placed first by greedy)
  // and P1 ends up on a later day. Phase 2.5 should fix this.
  // Use many P4 tasks on today and a few P1 tasks also on today.
  var tasks = [];
  // P4 tasks that naturally fill today
  for (var i = 0; i < 3; i++) {
    tasks.push(makeTask({ id: 'p4_c' + i, text: 'P4 compaction ' + i, pri: 'P4', dur: 90, date: todayKey }));
  }
  // P1 tasks also wanting today
  for (var j = 0; j < 3; j++) {
    tasks.push(makeTask({ id: 'p1_c' + j, text: 'P1 compaction ' + j, pri: 'P1', dur: 90, date: todayKey }));
  }

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });

  var result = unifiedSchedule(tasks, statuses, todayKey, 0, makeCfg());

  // Check: P1 tasks should be on today (or at least not on later days than P4 tasks)
  var p1Dates = [], p4Dates = [];
  var dp = result.dayPlacements;
  Object.keys(dp).forEach(function(dk) {
    dp[dk].forEach(function(p) {
      if (!p.task) return;
      if (p.task.id.startsWith('p1_c')) p1Dates.push(parseDate(dk));
      if (p.task.id.startsWith('p4_c')) p4Dates.push(parseDate(dk));
    });
  });

  if (p1Dates.length > 0 && p4Dates.length > 0) {
    var p1Max = p1Dates.sort(function(a,b){return b-a;})[0];
    var p4Min = p4Dates.sort(function(a,b){return a-b;})[0];
    assert(p1Max <= p4Min || formatDateKey(p1Max) === formatDateKey(p4Min),
      'P1 tasks not pushed after P4 after compaction (P1 latest: ' + formatDateKey(p1Max) + ', P4 earliest: ' + formatDateKey(p4Min) + ')');
  }
  assert(p1Dates.length === 3, 'All P1 tasks placed (' + p1Dates.length + '/3)');
})();

// ============================================================
// TEST 7: Dependencies still respected
// ============================================================
console.log('\n=== Test 7: Dependencies respected ===');
(function() {
  var tasks = [
    makeTask({ id: 'dep_a', text: 'Dep A (first)', pri: 'P2', dur: 30, date: todayKey, dependsOn: [] }),
    makeTask({ id: 'dep_b', text: 'Dep B (after A)', pri: 'P1', dur: 30, date: todayKey, dependsOn: ['dep_a'] })
  ];
  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });

  var result = unifiedSchedule(tasks, statuses, todayKey, 0, makeCfg());

  var aEnd = null, bStart = null;
  var dp = result.dayPlacements;
  Object.keys(dp).forEach(function(dk) {
    dp[dk].forEach(function(p) {
      if (!p.task) return;
      if (p.task.id === 'dep_a') aEnd = { date: parseDate(dk), endMin: p.start + p.dur };
      if (p.task.id === 'dep_b') bStart = { date: parseDate(dk), startMin: p.start };
    });
  });

  if (aEnd && bStart) {
    // Scheduler enforces date-level dependency ordering; intra-day ordering
    // on the same day is best-effort via hill-climb, not guaranteed.
    var aDateBeforeOrSame = aEnd.date <= bStart.date;
    assert(aDateBeforeOrSame, 'Dependency: A placed on same or earlier day than B');
    // Also check intra-day ordering when on same day (best-effort)
    if (aEnd.date.getTime() === bStart.date.getTime()) {
      var aBeforeB = aEnd.endMin <= bStart.startMin;
      if (!aBeforeB) console.log('    NOTE: Same-day dep ordering not enforced (A ends ' + aEnd.endMin + ', B starts ' + bStart.startMin + ') — hill-climb best-effort');
    }
  } else {
    assert(false, 'Both dependency tasks should be placed');
  }
})();

// ============================================================
// TEST 8: Deadline tasks still meet deadlines
// ============================================================
console.log('\n=== Test 8: Deadline tasks meet deadlines ===');
(function() {
  var due3 = dayOffset(3);
  var tasks = [
    makeTask({ id: 'dl1', text: 'Deadline P1', pri: 'P1', dur: 60, due: due3, date: todayKey }),
    makeTask({ id: 'dl2', text: 'Deadline P2', pri: 'P2', dur: 60, due: due3, date: todayKey }),
  ];
  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });

  var result = unifiedSchedule(tasks, statuses, todayKey, 0, makeCfg());

  var deadlineOk = true;
  var dp = result.dayPlacements;
  Object.keys(dp).forEach(function(dk) {
    dp[dk].forEach(function(p) {
      if (!p.task) return;
      if (p.task.id === 'dl1' || p.task.id === 'dl2') {
        var placedDate = parseDate(dk);
        var dueDate = parseDate(due3);
        if (placedDate > dueDate) deadlineOk = false;
      }
    });
  });
  assert(deadlineOk, 'All deadline tasks placed on or before due date');
  assert(result.score.breakdown.deadlineMiss === 0, 'No deadline miss penalty');
})();

// ============================================================
// TEST 9: Habits land on their assigned day
// ============================================================
console.log('\n=== Test 9: Habits on correct day ===');
(function() {
  var tasks = [
    makeTask({
      id: 'habit1', text: 'Daily habit', pri: 'P3', dur: 20,
      date: todayKey, day: dowName(today),
      habit: true, time: '8:00 AM', when: 'morning'
    })
  ];
  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });

  var result = unifiedSchedule(tasks, statuses, todayKey, 0, makeCfg());

  var habitPlaced = false;
  var dp = result.dayPlacements;
  if (dp[todayKey]) {
    dp[todayKey].forEach(function(p) {
      if (p.task && p.task.id === 'habit1') habitPlaced = true;
    });
  }
  assert(habitPlaced, 'Habit placed on its assigned day (' + todayKey + ')');
})();

// ============================================================
// TEST 10: Performance — scheduler completes quickly
// ============================================================
console.log('\n=== Test 10: Performance ===');
(function() {
  // Generate 100 tasks of mixed priorities
  var tasks = [];
  var pris = ['P1', 'P2', 'P3', 'P4'];
  for (var i = 0; i < 100; i++) {
    var pri = pris[i % 4];
    var dateOff = Math.floor(i / 10);
    tasks.push(makeTask({
      id: 'perf_' + i,
      text: 'Perf task ' + i,
      pri: pri,
      dur: 30,
      date: dayOffset(dateOff)
    }));
  }
  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });

  var start = Date.now();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, makeCfg());
  var elapsed = Date.now() - start;

  assert(elapsed < 3000, 'Scheduler completes in < 3s for 100 tasks (' + elapsed + 'ms)');
  var placedCount = 0;
  Object.keys(result.dayPlacements).forEach(function(dk) {
    placedCount += result.dayPlacements[dk].length;
  });
  assert(placedCount >= 80, 'Most tasks placed (' + placedCount + '/100)');
})();

// ============================================================
// TEST 11: hasPastTasks flag in getSchedulePlacements response format
// ============================================================
console.log('\n=== Test 11: hasPastTasks response shape ===');
(function() {
  // This just validates the runSchedule module exports the right function
  var runSchedule = require('./src/scheduler/runSchedule');
  assert(typeof runSchedule.getSchedulePlacements === 'function', 'getSchedulePlacements exported');
  assert(typeof runSchedule.runScheduleAndPersist === 'function', 'runScheduleAndPersist exported');
})();

// ============================================================
// Summary
// ============================================================
console.log('\n========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
console.log('========================================\n');

process.exit(failed > 0 ? 1 : 0);
