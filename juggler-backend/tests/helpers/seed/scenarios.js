/**
 * Named test scenarios — composable DB-backed setups for specific test categories.
 *
 * Each function inserts all required rows and returns the data so tests can
 * reference inserted IDs without re-reading from DB.
 *
 * Usage:
 *   const db = require('../test-db');
 *   const scenarios = require('./seed/scenarios');
 *
 *   beforeAll(async () => {
 *     if (!await db.isAvailable()) return;
 *     await db.clearUser(USER_ID);
 *     ctx = await scenarios.schedulerDeadlineChain(db, USER_ID);
 *   });
 *
 *   test('chain respects deadline', () => {
 *     expect(ctx.tasks[1].master.id).toBeDefined();
 *   });
 */

var { seedBaseUser } = require('./base-user');
var tf = require('./task-factory');

// ─── Scheduler scenarios ─────────────────────────────────────────────────────

/**
 * SC-01: Simple one-off tasks — baseline schedule population.
 * 5 tasks at varying priorities and durations with no constraints.
 */
async function simpleOneOffs(db, userId) {
  await seedBaseUser(db, userId.replace('test-user-', ''));
  var tasks = await tf.createTasks(db, userId, [
    { text: 'P1 quick task',   pri: 'P1', dur: 15 },
    { text: 'P2 medium task',  pri: 'P2', dur: 30 },
    { text: 'P3 long task',    pri: 'P3', dur: 60 },
    { text: 'P3 anytime task', pri: 'P3', dur: 30, when: '' },
    { text: 'Morning only',    pri: 'P2', dur: 20, when: 'morning' }
  ]);
  return { tasks };
}

/**
 * SC-02: Deadline chain — two tasks where task B has a deadline and depends on A.
 * Tests that A is placed before B and both fit before the deadline.
 */
async function deadlineChain(db, userId, deadlineDate) {
  await seedBaseUser(db, userId.replace('test-user-', ''));
  var deadline = deadlineDate || tomorrowDate();
  var chain = await tf.createChain(db, userId, [
    { text: 'Chain Step A', dur: 30, pri: 'P2' },
    { text: 'Chain Step B', dur: 30, pri: 'P2', dueAt: deadline }
  ]);
  return { chain, deadline };
}

/**
 * SC-03: Split task that must fill across multiple slots.
 * 2-hour task with 30-min minimum chunks = 4 chunks.
 */
async function splitTask(db, userId) {
  await seedBaseUser(db, userId.replace('test-user-', ''));
  var result = await tf.createSplitTask(db, userId, {
    text: 'Big project work', dur: 120, splitMin: 30, pri: 'P2', when: ''
  });
  return result;
}

/**
 * SC-04: Recurring daily task (rigid morning slot).
 * Tests that the recurring master exists and can be expanded by the scheduler.
 */
async function rigidDailyRecurring(db, userId) {
  await seedBaseUser(db, userId.replace('test-user-', ''));
  var result = await tf.createRecurring(db, userId, {
    text: 'Daily morning meds',
    dur: 15,
    pri: 'P3',
    when: 'morning',
    rigid: true,
    placementMode: 'recurring_rigid',
    recur: { type: 'daily', days: [], every: 1 }
  });
  return result;
}

/**
 * SC-05: Weekly recurring task (flex placement).
 * Tests tpc placement with cross-day splits allowed.
 */
async function weeklyFlexRecurring(db, userId) {
  await seedBaseUser(db, userId.replace('test-user-', ''));
  var result = await tf.createRecurring(db, userId, {
    text: 'Weekly project review',
    dur: 60,
    pri: 'P2',
    when: '',
    split: true,
    splitMin: 30,
    recur: { type: 'weekly', days: ['Mon', 'Wed', 'Fri'], every: 1, timesPerCycle: 2 }
  });
  return result;
}

/**
 * SC-06: Pinned calendar event (immovable anchor).
 * Tests that other tasks flow around it.
 */
async function pinnedEvent(db, userId, scheduledAt) {
  await seedBaseUser(db, userId.replace('test-user-', ''));
  var sat = scheduledAt || (todayDate() + 'T14:00:00');
  var result = await tf.createTask(db, userId, {
    text: 'Doctor appointment',
    dur: 60,
    pri: 'P1',
    when: 'fixed',
    datePinned: true,
    scheduledAt: sat,
    date: sat.slice(0, 10).replace(/-/g, '/').replace(/^20\d\d\//, '')
  });
  await tf.pinTask(db, result.instance.id, sat);
  return result;
}

/**
 * SC-07: Location-constrained tasks.
 * Mix of home-only and work-only tasks; tests location filtering.
 */
async function locationConstrained(db, userId) {
  await seedBaseUser(db, userId.replace('test-user-', ''));
  var tasks = await tf.createTasks(db, userId, [
    { text: 'Print documents', dur: 20, location: ['work'], pri: 'P2' },
    { text: 'Watch training video', dur: 45, location: ['home'], when: 'evening', pri: 'P3' },
    { text: 'Phone call', dur: 30, tools: ['phone'], pri: 'P2' }
  ]);
  return { tasks };
}

// ─── Task state machine scenarios ────────────────────────────────────────────

/**
 * SM-01: One task in each valid status for transition testing.
 * Returns a map of status → { master, instance }.
 */
async function allStatuses(db, userId) {
  await seedBaseUser(db, userId.replace('test-user-', ''));
  var byStatus = {};
  var statuses = ['', 'done', 'skip', 'cancel', 'missed'];
  for (var s of statuses) {
    var result = await tf.createTask(db, userId, {
      text: 'Task status=' + (s || 'pending'),
      dur: 30,
      scheduledAt: pastScheduledAt(),
      date: yesterdayDate()
    });
    if (s) {
      await tf.setStatus(db, result.instance.id, s, {
        scheduled_at: pastScheduledAt(),
        completed_at: s !== 'missed' ? db.fn.now() : null
      });
    }
    byStatus[s || 'pending'] = result;
  }
  return { byStatus };
}

/**
 * SM-02: Disabled recurring template with active instances.
 * Tests re-enable flow and instance limit enforcement.
 */
async function disabledRecurring(db, userId) {
  await seedBaseUser(db, userId.replace('test-user-', ''));
  var master = await tf.createRecurring(db, userId, {
    text: 'Disabled recurring task',
    dur: 30,
    recur: { type: 'daily', days: [], every: 1 },
    disabledAt: new Date().toISOString(),
    disabledReason: 'manual'
  });
  return master;
}

/**
 * SM-03: Overdue tasks (scheduled_at in the past, status still pending).
 */
async function overdueTasks(db, userId) {
  await seedBaseUser(db, userId.replace('test-user-', ''));
  var tasks = await tf.createTasks(db, userId, [
    { text: 'Overdue P1', pri: 'P1', dur: 30, scheduledAt: daysAgo(3), date: dateStr(daysAgo(3)) },
    { text: 'Overdue P2', pri: 'P2', dur: 60, scheduledAt: daysAgo(1), date: dateStr(daysAgo(1)) },
    { text: 'Overdue P3', pri: 'P3', dur: 15, scheduledAt: daysAgo(7), date: dateStr(daysAgo(7)) }
  ]);
  return { tasks };
}

// ─── Cal-sync scenarios ───────────────────────────────────────────────────────

/**
 * CS-01: Seed a user_calendars row for a Google Calendar.
 * Pass in your test OAuth tokens via env — skipped if not present.
 * cal_sync_ledger rows are added as the sync runs.
 */
async function gcalCalendar(db, userId, opts) {
  await seedBaseUser(db, userId.replace('test-user-', ''));
  opts = opts || {};
  var accessToken  = opts.accessToken  || process.env.TEST_GCAL_ACCESS_TOKEN  || null;
  var refreshToken = opts.refreshToken || process.env.TEST_GCAL_REFRESH_TOKEN || null;
  var calendarId   = opts.calendarId   || process.env.TEST_GCAL_CALENDAR_ID   || 'primary';

  if (!refreshToken) return { skipped: true, reason: 'TEST_GCAL_REFRESH_TOKEN not set' };

  await db('user_calendars').insert({
    user_id:       userId,
    provider:      'gcal',
    provider_account_id: calendarId,
    access_token:  accessToken,
    refresh_token: refreshToken,
    sync_enabled:  1,
    ingest_mode:   'task',
    created_at:    db.fn.now(),
    updated_at:    db.fn.now()
  }).onConflict(['user_id', 'provider', 'provider_account_id']).merge();

  return { skipped: false, calendarId };
}

/**
 * CS-02: Seed a user_calendars row for Microsoft Calendar.
 */
async function msftCalendar(db, userId, opts) {
  await seedBaseUser(db, userId.replace('test-user-', ''));
  opts = opts || {};
  var accessToken  = opts.accessToken  || process.env.TEST_MSFT_ACCESS_TOKEN  || null;
  var refreshToken = opts.refreshToken || process.env.TEST_MSFT_REFRESH_TOKEN || null;
  var calendarId   = opts.calendarId   || process.env.TEST_MSFT_CALENDAR_ID   || null;

  if (!refreshToken) return { skipped: true, reason: 'TEST_MSFT_REFRESH_TOKEN not set' };

  await db('user_calendars').insert({
    user_id:       userId,
    provider:      'msft',
    provider_account_id: calendarId,
    access_token:  accessToken,
    refresh_token: refreshToken,
    sync_enabled:  1,
    ingest_mode:   'task',
    created_at:    db.fn.now(),
    updated_at:    db.fn.now()
  }).onConflict(['user_id', 'provider', 'provider_account_id']).merge();

  return { skipped: false, calendarId };
}

/**
 * CS-03: Seed a user_calendars row for Apple CalDAV.
 * Credentials will be provided by the user — placeholder for now.
 */
async function appleCalendar(db, userId, opts) {
  await seedBaseUser(db, userId.replace('test-user-', ''));
  opts = opts || {};
  var calendarUrl = opts.calendarUrl || process.env.TEST_APPLE_CALENDAR_URL || null;
  var username    = opts.username    || process.env.TEST_APPLE_USERNAME     || null;
  var appPassword = opts.appPassword || process.env.TEST_APPLE_APP_PASSWORD || null;

  if (!calendarUrl || !username || !appPassword) {
    return { skipped: true, reason: 'TEST_APPLE_CALENDAR_URL / USERNAME / APP_PASSWORD not set' };
  }

  await db('user_calendars').insert({
    user_id:       userId,
    provider:      'apple',
    provider_account_id: calendarUrl,
    access_token:  appPassword,
    refresh_token: null,
    sync_enabled:  1,
    ingest_mode:   'task',
    created_at:    db.fn.now(),
    updated_at:    db.fn.now()
  }).onConflict(['user_id', 'provider', 'provider_account_id']).merge();

  return { skipped: false, calendarUrl };
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowDate() {
  var d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function yesterdayDate() {
  var d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function daysAgo(n) {
  var d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function dateStr(datetimeStr) {
  // Convert 'YYYY-MM-DD HH:MM:SS' → 'M/D'
  var parts = datetimeStr.slice(0, 10).split('-');
  return parseInt(parts[1]) + '/' + parseInt(parts[2]);
}

function pastScheduledAt() {
  return daysAgo(1);
}

module.exports = {
  // Scheduler
  simpleOneOffs,
  deadlineChain,
  splitTask,
  rigidDailyRecurring,
  weeklyFlexRecurring,
  pinnedEvent,
  locationConstrained,
  // State machine
  allStatuses,
  disabledRecurring,
  overdueTasks,
  // Cal-sync
  gcalCalendar,
  msftCalendar,
  appleCalendar,
  // Date utils (re-exported for tests)
  todayDate,
  tomorrowDate,
  yesterdayDate,
  daysAgo,
  dateStr
};
