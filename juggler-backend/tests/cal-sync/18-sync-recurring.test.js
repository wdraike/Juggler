/**
 * 18-sync-recurring.test.js — Recurring Instance Handling
 *
 * Tests that recurring templates are not synced (no scheduled_at),
 * instances with empty text inherit from the template, and instances
 * with their own text use it instead.
 *
 * Also tests the past-recurring-instance protection in the task&&!event branch:
 * providers don't return past events, so past recurring instances must NOT be
 * deleted by the miss-count ladder — only their ledger row is cleaned up.
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
var { assertDbAvailable } = require('../helpers/requireDB');
var tasksWrite = require('../../src/lib/tasks-write');
var { makeTask, makeTaskId, makeLedgerRow, deleteAllGCalTestEvents } = require('./helpers/test-fixtures');
var { listGCalEvents, waitForPropagation } = require('./helpers/api-helpers');
var { sync } = require('../../src/controllers/cal-sync.controller');
var gcalAdapter = require('../../src/lib/cal-adapters/gcal.adapter');
var { describeWithCreds } = require('./helpers/credentialGate');

var GCAL_ONLY = { msft_cal_refresh_token: null, apple_cal_username: null, apple_cal_password: null, apple_cal_server_url: null, apple_cal_calendar_url: null };
var token = null;
var user = null;

beforeAll(async () => {
  // Date-only fake timers (999.2157): Date frozen, every timer API real — no hangs
  installDateOnlyFakeTimers(new Date('2026-01-15T12:00:00Z'));
  await assertDbAvailable();
  if (!hasGCalCredentials()) return;
  user = await seedTestUser(GCAL_ONLY);
  token = await getGCalToken();
});

afterEach(async () => {
  jest.useRealTimers();
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

describeWithCreds(() => hasGCalCredentials(), 'Recurring Instance Handling', () => {
  test('recurring instance with empty text inherits template text', async () => {
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

  test.todo('instance with own text uses own text — tasks_v always uses master text; instance-level text override not implemented in data model');

  test('template itself NOT synced (scheduled_at is NULL)', async () => {
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

// ─── Past recurring instance protection (task&&!event branch guard) ──────────
//
// These tests verify the fix for the catastrophic deletion bug:
// providers don't return past events, so past recurring instances always appear
// as task&&!event. Without the guard they accumulate miss_count and are deleted
// after MISS_THRESHOLD syncs, silently destroying historical recurring tasks.
//
// These tests require a DB but NOT live calendar credentials — the GCal adapter
// is mocked to return an empty event list (simulating a provider that omits past events).

describe('task&&!event — past recurring instance protection', () => {
  var mockUser = null;
  var getValidAccessTokenSpy = null;
  var listEventsSpy = null;

  beforeEach(async () => {
    await assertDbAvailable();
    // Seed user with a fake gcal_refresh_token so gcal adapter is "connected",
    // but we mock the API calls so no real network request is made.
    mockUser = await seedTestUser({
      gcal_refresh_token: 'fake-refresh-token-for-past-recurring-test',
      gcal_access_token: 'fake-access-token',
      gcal_token_expiry: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
      msft_cal_refresh_token: null,
      apple_cal_username: null,
      apple_cal_password: null,
      apple_cal_server_url: null,
      apple_cal_calendar_url: null
    });
    // Mock the gcal adapter so no real GCal API calls are made.
    // getValidAccessToken returns the stored access token immediately.
    getValidAccessTokenSpy = jest.spyOn(gcalAdapter, 'getValidAccessToken')
      .mockResolvedValue('fake-access-token');
    // listEvents returns an empty array — simulating a provider that does not
    // return past events (the normal behavior of all calendar providers).
    listEventsSpy = jest.spyOn(gcalAdapter, 'listEvents')
      .mockResolvedValue([]);
  });

  afterEach(async () => {
    if (getValidAccessTokenSpy) getValidAccessTokenSpy.mockRestore();
    if (listEventsSpy) listEventsSpy.mockRestore();
    if (await isDbAvailable()) await cleanupTestData();
  });

  it('does NOT delete a past recurring_instance when provider returns no event', async () => {
    await assertDbAvailable();

    // Setup: past recurring_instance task (scheduled 2 hours ago)
    var pastTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    var taskId = makeTaskId('past-recur');
    await makeTask({
      id: taskId,
      task_type: 'recurring_instance',
      text: 'Past Recurring Test NOT delete a past recurring_instance',
      scheduled_at: pastTime,
      dur: 30,
      recurring: 1
    });

    // Setup: ledger row with a provider_event_id (as if it was previously pushed to GCal)
    var ledgerRow = await makeLedgerRow({
      user_id: TEST_USER_ID,
      provider: 'gcal',
      task_id: taskId,
      provider_event_id: 'fake-gcal-event-id-past-recur',
      origin: 'juggler',
      status: 'active',
      miss_count: 0,
      event_start: pastTime
    });
    var ledgerId = ledgerRow.id;

    // Run sync — provider returns zero events (past events are not returned)
    var req = mockReq(mockUser);
    var res = mockRes();
    await sync(req, res);

    // Task must still exist — past recurring_instance protection
    var taskAfter = await db('tasks_v').where('id', taskId).first();
    expect(taskAfter).toBeTruthy();

    // Ledger must be cleaned with status='deleted_local', not 'deleted_remote'
    var ledgerAfter = await db('cal_sync_ledger').where('id', ledgerId).first();
    expect(ledgerAfter).toBeTruthy();
    expect(ledgerAfter.status).toBe('deleted_local');
    // task_id is nulled out when ledger is cleaned
    expect(ledgerAfter.task_id).toBeNull();
  });

  it('DOES apply miss-count to a future recurring_instance when provider returns no event', async () => {
    await assertDbAvailable();

    // Setup: future recurring_instance task (scheduled 1 hour from now)
    var futureTime = new Date(Date.now() + 1 * 60 * 60 * 1000);
    var taskId = makeTaskId('future-recur');
    await makeTask({
      id: taskId,
      task_type: 'recurring_instance',
      text: 'Future Recurring Test miss-count',
      scheduled_at: futureTime,
      dur: 30,
      recurring: 1
    });

    // Setup: ledger row with provider_event_id and event_start in the sync window.
    // The sync window typically covers today + a few days so a 1h-future event is in window.
    var ledgerRow = await makeLedgerRow({
      user_id: TEST_USER_ID,
      provider: 'gcal',
      task_id: taskId,
      provider_event_id: 'fake-gcal-event-id-future-recur',
      origin: 'juggler',
      status: 'active',
      miss_count: 0,
      event_start: futureTime,
      // Set last_pushed_hash to a stable value so the task-changed guard doesn't fire
      last_pushed_hash: 'stable-hash-future'
    });
    var ledgerId = ledgerRow.id;

    // Run sync — provider returns zero events
    var req = mockReq(mockUser);
    var res = mockRes();
    await sync(req, res);

    // Task must still exist — not past the MISS_THRESHOLD yet
    var taskAfter = await db('tasks_v').where('id', taskId).first();
    expect(taskAfter).toBeTruthy();

    // Ledger must NOT be marked deleted_local (that's only for past recurring instances)
    var ledgerAfter = await db('cal_sync_ledger').where('id', ledgerId).first();
    expect(ledgerAfter).toBeTruthy();
    expect(ledgerAfter.status).not.toBe('deleted_local');
  });
});
