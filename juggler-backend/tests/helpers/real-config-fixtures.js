/**
 * Test Fixtures — Based on Real User Configuration
 *
 * Mirrors the actual Strive production config:
 * - Time blocks: morning/lunch/afternoon/evening/night (weekday), morning/lunch/afternoon/evening/night (weekend)
 * - Locations: home, work, transit, Hotel, Airplane
 * - Tools: phone, personal_pc, work_pc, printer, car, TV
 * - Location schedules: weekday (all home), weekend (all home with gaps)
 * - Recurrings: morning prescriptions (rigid), lunch (rigid), breakfast (rigid),
 *           evening meds (rigid), exercise, apply for jobs, resume optimizer
 */

// ─── Time Blocks (matches user's actual config) ────────────────────────
var WEEKDAY_BLOCKS = [
  { id: 'morning', tag: 'morning', name: 'Morning', start: 360, end: 720, color: '#F59E0B', icon: '☀️', loc: 'home' },
  { id: 'lunch_1775051460766', tag: 'lunch', name: 'Lunch', start: 720, end: 780, color: '#2D6A4F', icon: '🍽️', loc: 'work' },
  { id: 'afternoon_1774980203707', tag: 'afternoon', name: 'Afternoon', start: 780, end: 1020, color: '#C8942A', icon: '🌤️', loc: 'home' },
  { id: 'evening', tag: 'evening', name: 'Evening', start: 1020, end: 1260, color: '#7C3AED', icon: '🌙', loc: 'home' },
  { id: 'night', tag: 'night', name: 'Night', start: 1260, end: 1380, color: '#475569', icon: '🌑', loc: 'home' }
];

var WEEKEND_BLOCKS = [
  { id: 'morning', tag: 'morning', name: 'Morning', start: 360, end: 720, color: '#F59E0B', icon: '☀️', loc: 'home' },
  { id: 'lunch_1774036901348', tag: 'lunch', name: 'Lunch', start: 720, end: 780, color: '#059669', icon: '🍽️', loc: 'home' },
  { id: 'afternoon_1774980226765', tag: 'afternoon', name: 'Afternoon', start: 825, end: 1020, color: '#C8942A', icon: '🌤️', loc: 'home' },
  { id: 'evening', tag: 'evening', name: 'Evening', start: 1020, end: 1260, color: '#7C3AED', icon: '🌙', loc: 'home' },
  { id: 'night', tag: 'night', name: 'Night', start: 1260, end: 1380, color: '#475569', icon: '🌑', loc: 'home' }
];

var REAL_TIME_BLOCKS = {
  Mon: WEEKDAY_BLOCKS, Tue: WEEKDAY_BLOCKS, Wed: WEEKDAY_BLOCKS,
  Thu: WEEKDAY_BLOCKS, Fri: WEEKDAY_BLOCKS,
  Sat: WEEKEND_BLOCKS, Sun: WEEKEND_BLOCKS
};

// ─── Tool Matrix (matches user's actual config) ────────────────────────
var REAL_TOOL_MATRIX = {
  home: ['phone', 'personal_pc', 'car', 'TV', 'printer'],
  work: ['phone', 'printer', 'car'],
  transit: ['phone', 'personal_pc'],
  Hotel: ['phone', 'personal_pc', 'car', 'TV'],
  Airplane: ['personal_pc'],
  gym: ['phone'],
  downtown: ['phone', 'car']
};

// ─── Location Schedules ────────────────────────────────────────────────
var REAL_LOC_SCHEDULES = {
  weekday: { icon: '🏢', name: 'Weekday', system: true, hours: {} },
  weekend: { icon: '🏠', name: 'Weekend', system: true, hours: {} }
};

// Fill weekday: all home, every 15 min from 360-1440
for (var m = 360; m <= 1440; m += 15) {
  REAL_LOC_SCHEDULES.weekday.hours[m] = 'home';
}

// Fill weekend: all home BUT with gaps at 765-810 (matches real config)
for (var m2 = 360; m2 <= 1380; m2 += 15) {
  if (m2 >= 765 && m2 <= 810) continue; // Gap — falls through to time block loc
  REAL_LOC_SCHEDULES.weekend.hours[m2] = 'home';
}

var REAL_LOC_SCHEDULE_DEFAULTS = {
  Mon: 'weekday', Tue: 'weekday', Wed: 'weekend',
  Thu: 'weekend', Fri: 'weekend', Sat: 'weekend', Sun: 'weekend'
};

// ─── Full Config Object ────────────────────────────────────────────────
function makeRealConfig(overrides) {
  var cfg = {
    timeBlocks: REAL_TIME_BLOCKS,
    toolMatrix: REAL_TOOL_MATRIX,
    locSchedules: REAL_LOC_SCHEDULES,
    locScheduleDefaults: REAL_LOC_SCHEDULE_DEFAULTS,
    locScheduleOverrides: {},
    hourLocationOverrides: {},
    scheduleTemplates: null,
    splitMinDefault: 15,
    preferences: {
      pullForwardDampening: true,
      splitDefault: false,
      splitMinDefault: 15
    }
  };
  if (overrides) {
    Object.keys(overrides).forEach(function(k) { cfg[k] = overrides[k]; });
  }
  return cfg;
}

// ─── Task Builders ─────────────────────────────────────────────────────

var _taskCounter = 0;

function makeTask(props) {
  _taskCounter++;
  var base = {
    id: props.id || 'task_' + _taskCounter,
    taskType: props.taskType || 'task',
    text: props.text || 'Test Task ' + _taskCounter,
    date: props.date || null,
    day: props.day || null,
    time: props.time || null,
    scheduledAt: props.scheduledAt || null,
    tz: props.tz || null,
    dur: props.dur != null ? props.dur : 30,
    timeRemaining: props.timeRemaining != null ? props.timeRemaining : null,
    pri: props.pri || 'P3',
    project: props.project || null,
    status: props.status || '',
    section: props.section || null,
    notes: props.notes || '',
    deadline: props.deadline || null,
    startAfter: props.startAfter || null,
    startAfterAt: props.startAfterAt || null,
    location: props.location || [],
    tools: props.tools || [],
    when: props.when != null ? props.when : '',
    dayReq: props.dayReq || 'any',
    recurring: props.recurring || false,
    placementMode: props.placementMode || undefined,
    timeFlex: props.timeFlex != null ? props.timeFlex : undefined,
    split: props.split || false,
    splitMin: props.splitMin || null,
    recur: props.recur || null,
    sourceId: props.sourceId || null,
    generated: props.generated || false,
    gcalEventId: props.gcalEventId || null,
    msftEventId: props.msftEventId || null,
    dependsOn: props.dependsOn || [],
    datePinned: props.datePinned || false,
    flexWhen: props.flexWhen || false,
    travelBefore: props.travelBefore || undefined,
    travelAfter: props.travelAfter || undefined,
    recurStart: props.recurStart || null,
    recurEnd: props.recurEnd || null,
    disabledAt: props.disabledAt || null,
    disabledReason: props.disabledReason || null
  };
  return base;
}

/** Rigid recurring — anchored at its when-block */
function makeRigidRecurring(props) {
  return makeTask(Object.assign({
    recurring: true,
    placementMode: 'recurring_rigid',
    taskType: 'recurring_instance',
    generated: true
  }, props));
}

/** Non-rigid recurring — scheduler chooses best slot within when-windows */
function makeFlexRecurring(props) {
  return makeTask(Object.assign({
    recurring: true,
    placementMode: props && props.preferredTimeMins != null ? 'recurring_window' : 'recurring_flexible',
    taskType: 'recurring_instance',
    generated: true,
    flexWhen: true
  }, props));
}

/** Fixed calendar event — immovable anchor */
function makeFixedEvent(props) {
  return makeTask(Object.assign({
    when: 'fixed',
    datePinned: true
  }, props));
}

/** Deadline task */
function makeDeadlineTask(props) {
  return makeTask(Object.assign({}, props));
}

// ─── Real Recurring Templates (from user's actual setup) ───────────────────

function makeRealRecurrings(dateKey) {
  return [
    makeRigidRecurring({
      id: 'rc_ht_meds_' + dateKey.replace('/', ''),
      text: 'Take morning prescriptions',
      sourceId: 'ht_meds',
      date: dateKey,
      when: 'morning',
      dur: 20,
      pri: 'P3',
      project: 'Recurrings'
    }),
    makeRigidRecurring({
      id: 'rc_ht_breakfast_' + dateKey.replace('/', ''),
      text: 'Eat Breakfast',
      sourceId: 'ht_breakfast',
      date: dateKey,
      when: 'morning',
      dur: 30,
      pri: 'P3',
      project: 'Recurrings',
      time: '10:56 AM'
    }),
    makeRigidRecurring({
      id: 'rc_ht_lunch_' + dateKey.replace('/', ''),
      text: 'Lunch',
      sourceId: 'ht_lunch',
      date: dateKey,
      when: 'lunch',
      dur: 30,
      pri: 'P3',
      project: 'Recurrings'
    }),
    makeRigidRecurring({
      id: 'rc_ht_evening_meds_' + dateKey.replace('/', ''),
      text: 'Take Evening Medications',
      sourceId: 'ht_evening_meds',
      date: dateKey,
      when: 'evening',
      dur: 10,
      pri: 'P3',
      project: 'Recurrings'
    }),
    makeFlexRecurring({
      id: 'rc_ht_exercise_' + dateKey.replace('/', ''),
      text: 'Exercise',
      sourceId: 'ht_exercise',
      date: dateKey,
      when: 'morning,lunch,afternoon,evening',
      dur: 30,
      pri: 'P3',
      project: 'Recurrings',
      split: true,
      splitMin: 15
    }),
    makeFlexRecurring({
      id: 'rc_ht_apply_' + dateKey.replace('/', ''),
      text: 'Apply for Jobs',
      sourceId: 'ht_apply',
      date: dateKey,
      when: '',
      dur: 60,
      pri: 'P1',
      project: 'Job Search',
      tools: ['personal_pc'],
      split: true,
      splitMin: 30,
      flexWhen: true
    }),
    makeFlexRecurring({
      id: 'rc_ht_resume_' + dateKey.replace('/', ''),
      text: 'Work on Resume Optimizer',
      sourceId: 'ht_resume',
      date: dateKey,
      when: '',
      dur: 120,
      pri: 'P1',
      project: 'Job Search',
      tools: ['personal_pc'],
      split: true,
      splitMin: 15,
      flexWhen: true
    })
  ];
}

// ─── Assertion Helpers ─────────────────────────────────────────────────

function findPlacement(result, taskId) {
  for (var dk in result.dayPlacements) {
    var placements = result.dayPlacements[dk];
    for (var i = 0; i < placements.length; i++) {
      if (placements[i].task.id === taskId) return placements[i];
    }
  }
  return null;
}

function findAllPlacements(result, taskId) {
  var found = [];
  for (var dk in result.dayPlacements) {
    var placements = result.dayPlacements[dk];
    for (var i = 0; i < placements.length; i++) {
      if (placements[i].task.id === taskId) found.push(placements[i]);
    }
  }
  return found;
}

function placementTime(placement) {
  if (!placement) return null;
  var h = Math.floor(placement.start / 60);
  var m = placement.start % 60;
  var ampm = h < 12 ? 'AM' : 'PM';
  var h12 = h % 12 || 12;
  return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
}

function isInWindow(placement, windowStart, windowEnd) {
  return placement && placement.start >= windowStart && placement.start + placement.dur <= windowEnd;
}

function hasNoOverlaps(result, dateKey) {
  var placements = result.dayPlacements[dateKey] || [];
  var nonMarkers = placements.filter(function(p) { return !p.marker; });
  nonMarkers.sort(function(a, b) { return a.start - b.start; });
  for (var i = 1; i < nonMarkers.length; i++) {
    var prev = nonMarkers[i - 1];
    var curr = nonMarkers[i];
    if (curr.start < prev.start + prev.dur) return false;
  }
  return true;
}

function getDayPlacements(result, dateKey) {
  return (result.dayPlacements[dateKey] || [])
    .slice()
    .sort(function(a, b) { return a.start - b.start; })
    .map(function(p) {
      return {
        id: p.task.id,
        text: p.task.text,
        start: p.start,
        dur: p.dur,
        time: placementTime(p)
      };
    });
}

// ─── Reset counter between tests ───────────────────────────────────────
function resetCounter() { _taskCounter = 0; }

module.exports = {
  REAL_TIME_BLOCKS,
  REAL_TOOL_MATRIX,
  REAL_LOC_SCHEDULES,
  REAL_LOC_SCHEDULE_DEFAULTS,
  WEEKDAY_BLOCKS,
  WEEKEND_BLOCKS,
  makeRealConfig,
  makeTask,
  makeRigidRecurring,
  makeFlexRecurring,
  makeFixedEvent,
  makeDeadlineTask,
  makeRealRecurrings,
  findPlacement,
  findAllPlacements,
  placementTime,
  isInWindow,
  hasNoOverlaps,
  getDayPlacements,
  resetCounter
};
