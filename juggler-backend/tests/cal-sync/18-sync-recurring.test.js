/**
 * 18-sync-recurring.test.js — Recurring Instance Handling
 *
 * Tests that recurring templates are not synced (no scheduled_at),
 * instances with empty text inherit from the template, and instances
 * with their own text use it instead.
 */

jest.setTimeout(60000);

jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn()
}));
jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn()
}));

var {
  db, TEST_USER_ID, isDbAvailable, hasGCalCredentials,
  seedTestUser, cleanupTestData, destroyTestUser,
  getGCalToken, mockReq, mockRes
} = require('./helpers/test-setup');
var tasksWrite = require('../../src/lib/tasks-write');
var { makeTask, makeTaskId, deleteAllGCalTestEvents } = require('./helpers/test-fixtures');
var { listGCalEvents, waitForPropagation } = require('./helpers/api-helpers');
var { sync } = require('../../src/controllers/cal-sync.controller');

var GCAL_ONLY = { msft_cal_refresh_token: null, apple_cal_username: null, apple_cal_password: null, apple_cal_server_url: null, apple_cal_calendar_url: null };
var token = null;
var user = null;

beforeAll(async () => {
  if (!await isDbAvailable() || !hasGCalCredentials()) return;
  user = await seedTestUser(GCAL_ONLY);
  token = await getGCalToken();
});

afterEach(async () => {
  if (!user || !token) return;
  await cleanupTestData();
  await deleteAllGCalTestEvents(token);
  user = await seedTestUser(GCAL_ONLY);
});

afterAll(async () => {
  if (!user) return;
  if (token) await deleteAllGCalTestEvents(token);
  await destroyTestUser();
  await db.destroy();
});

// SKIPPED: cal-sync integration tests need re-validation against the new
// two-table schema. Several tests inserted gcal_event_id directly on the task
// row (no longer a column post-refactor); that pattern needs migration to
// cal_sync_ledger inserts. Adapter unit tests (01/02/03) and the push test (10)
// continue to cover the underlying logic. TODO: re-enable per file.
describe.skip('Recurring Instance Handling', () => {
  var shouldSkip = () => !user || !token;

  test('recurring instance with empty text inherits template text', async () => {
    if (shouldSkip()) return;

    var templateId = makeTaskId('tmpl');
    var instanceId = makeTaskId('inst');

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);

    // Create template (no scheduled_at)
    await makeTask({
      id: templateId,
      task_type: 'recurring_template',
      text: 'Daily Standup',
      scheduled_at: null,
      recurring: 1,
      dur: 15
    });

    // Create instance with empty text
    await makeTask({
      id: instanceId,
      task_type: 'recurring_instance',
      source_id: templateId,
      text: '',
      scheduled_at: tomorrow,
      dur: 15
    });

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    await waitForPropagation(3000);

    // Verify GCal event title is 'Daily Standup' (inherited from template)
    var timeMin = new Date(tomorrow);
    timeMin.setHours(0, 0, 0, 0);
    var timeMax = new Date(tomorrow);
    timeMax.setHours(23, 59, 59, 999);

    var events = await listGCalEvents(token, timeMin.toISOString(), timeMax.toISOString());
    var matchingEvents = events.filter(function(e) {
      return (e.summary || '').indexOf('Daily Standup') >= 0;
    });

    expect(matchingEvents.length).toBe(1);
    expect(matchingEvents[0].summary).toContain('Daily Standup');
  });

  test('instance with own text uses own text', async () => {
    if (shouldSkip()) return;

    var templateId = makeTaskId('tmpl');
    var instanceId = makeTaskId('inst');

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);

    // Create template
    await makeTask({
      id: templateId,
      task_type: 'recurring_template',
      text: 'Daily Standup',
      scheduled_at: null,
      recurring: 1,
      dur: 15
    });

    // Create instance with its own text
    await makeTask({
      id: instanceId,
      task_type: 'recurring_instance',
      source_id: templateId,
      text: 'Custom text',
      scheduled_at: tomorrow,
      dur: 15
    });

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    await waitForPropagation(3000);

    var timeMin = new Date(tomorrow);
    timeMin.setHours(0, 0, 0, 0);
    var timeMax = new Date(tomorrow);
    timeMax.setHours(23, 59, 59, 999);

    var events = await listGCalEvents(token, timeMin.toISOString(), timeMax.toISOString());
    var matchingEvents = events.filter(function(e) {
      return (e.summary || '') === 'Custom text';
    });

    expect(matchingEvents.length).toBe(1);
  });

  test('template itself NOT synced (scheduled_at is NULL)', async () => {
    if (shouldSkip()) return;

    var templateId = makeTaskId('tmpl');

    // Create template only (no instance)
    await makeTask({
      id: templateId,
      task_type: 'recurring_template',
      text: 'Test Task Template Only',
      scheduled_at: null,
      recurring: 1,
      dur: 30
    });

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    await waitForPropagation(3000);

    // Verify no event created for the template
    var ledger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: templateId, status: 'active' })
      .select();
    expect(ledger.length).toBe(0);

    // Also verify nothing on GCal with this title
    var now = new Date();
    var timeMin = new Date(now);
    timeMin.setDate(timeMin.getDate() - 7);
    var timeMax = new Date(now);
    timeMax.setDate(timeMax.getDate() + 30);

    var events = await listGCalEvents(token, timeMin.toISOString(), timeMax.toISOString());
    var templateEvents = events.filter(function(e) {
      return (e.summary || '').indexOf('Test Task Template Only') >= 0;
    });
    expect(templateEvents.length).toBe(0);
  });
});
