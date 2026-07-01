/**
 * 13-sync-declined-invite.test.js — BUG-999.999 regression (mock-based, no DB)
 *
 * Bug: a GCal-sourced task is not removed when the user deletes/declines the
 * invite in Google Calendar. `GoogleCalendarAdapter.listEvents` filters ONLY
 * top-level `event.status==='cancelled'`; a deleted INVITATION is still
 * returned by Google's events.list with top-level `status:'confirmed'` and
 * the user's own attendee `responseStatus:'declined'` — so it survives the
 * filter and the absent-event delete-ladder in cal-sync.controller.js never
 * fires.
 *
 * PRIMARY (load-bearing) regression test: proves listEvents (which composes
 * the private filter + normalizeEvent) EXCLUDES a self-declined event, while
 * KEEPING accepted/tentative/needsAction/no-self/no-attendees events (AC3
 * negatives — guard against wrongful deletion of real invites/owner events).
 *
 * Mocked at the gcalApi.listEvents boundary (raw Google API), same technique
 * as 04-adapter-gcal-edge.test.js's "BF-4: cancelled events" test — this
 * exercises the REAL adapter filter + normalizeEvent code, not a stub.
 */
jest.setTimeout(60000);

jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn()
}));
jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn()
}));

var gcalAdapter = require('../../src/lib/cal-adapters/gcal.adapter');
var gcalApi = require('../../src/lib/gcal-api');

afterEach(() => jest.restoreAllMocks());

function selfEvent(id, responseStatus) {
  return {
    id: id,
    status: 'confirmed',
    summary: 'Invite ' + id,
    start: { dateTime: '2026-07-05T10:00:00-04:00' },
    end: { dateTime: '2026-07-05T10:30:00-04:00' },
    attendees: [
      { email: 'organizer@example.com', organizer: true, responseStatus: 'accepted' },
      { email: 'calsync-test@test.com', self: true, responseStatus: responseStatus }
    ]
  };
}

describe('BUG-999.999: declined self-invite excluded from listEvents', () => {
  it('excludes an event whose self-attendee has responseStatus:"declined"', async () => {
    jest.spyOn(gcalApi, 'listEvents').mockResolvedValue({
      items: [selfEvent('declined-invite-1', 'declined')],
      nextSyncToken: 'tok-declined'
    });

    var result = await gcalAdapter.listEvents('mock-token', '2026-07-01', '2026-07-08', null);

    expect(result.find(function(e) { return e.id === 'declined-invite-1'; })).toBeUndefined();
    expect(result).toHaveLength(0);
  });

  it('a mixed batch: only the declined-self event is excluded, the accepted one survives', async () => {
    jest.spyOn(gcalApi, 'listEvents').mockResolvedValue({
      items: [
        selfEvent('declined-invite-2', 'declined'),
        selfEvent('accepted-invite-1', 'accepted')
      ],
      nextSyncToken: 'tok-mixed'
    });

    var result = await gcalAdapter.listEvents('mock-token', '2026-07-01', '2026-07-08', null);
    var ids = result.map(function(e) { return e.id; });

    expect(ids).not.toContain('declined-invite-2');
    expect(ids).toContain('accepted-invite-1');
    expect(result).toHaveLength(1);
  });
});

// ─── AC3 negatives: must NOT be excluded (guard against wrongful deletion) ──

describe('BUG-999.999 AC3 negatives: non-declined / owner events survive listEvents', () => {
  it('keeps an event whose self-attendee has responseStatus:"accepted"', async () => {
    jest.spyOn(gcalApi, 'listEvents').mockResolvedValue({
      items: [selfEvent('accepted-invite-2', 'accepted')],
      nextSyncToken: 'tok-accepted'
    });
    var result = await gcalAdapter.listEvents('mock-token', '2026-07-01', '2026-07-08', null);
    expect(result.find(function(e) { return e.id === 'accepted-invite-2'; })).toBeDefined();
    expect(result).toHaveLength(1);
  });

  it('keeps an event whose self-attendee has responseStatus:"tentative"', async () => {
    jest.spyOn(gcalApi, 'listEvents').mockResolvedValue({
      items: [selfEvent('tentative-invite-1', 'tentative')],
      nextSyncToken: 'tok-tentative'
    });
    var result = await gcalAdapter.listEvents('mock-token', '2026-07-01', '2026-07-08', null);
    expect(result.find(function(e) { return e.id === 'tentative-invite-1'; })).toBeDefined();
    expect(result).toHaveLength(1);
  });

  it('keeps an event whose self-attendee has responseStatus:"needsAction"', async () => {
    jest.spyOn(gcalApi, 'listEvents').mockResolvedValue({
      items: [selfEvent('needsaction-invite-1', 'needsAction')],
      nextSyncToken: 'tok-needsaction'
    });
    var result = await gcalAdapter.listEvents('mock-token', '2026-07-01', '2026-07-08', null);
    expect(result.find(function(e) { return e.id === 'needsaction-invite-1'; })).toBeDefined();
    expect(result).toHaveLength(1);
  });

  it('keeps an owner-created event with no attendees array at all', async () => {
    jest.spyOn(gcalApi, 'listEvents').mockResolvedValue({
      items: [{
        id: 'owner-event-1',
        status: 'confirmed',
        summary: 'My own task block',
        start: { dateTime: '2026-07-05T10:00:00-04:00' },
        end: { dateTime: '2026-07-05T10:30:00-04:00' }
        // no attendees field — solo owner-created event
      }],
      nextSyncToken: 'tok-owner'
    });
    var result = await gcalAdapter.listEvents('mock-token', '2026-07-01', '2026-07-08', null);
    expect(result.find(function(e) { return e.id === 'owner-event-1'; })).toBeDefined();
    expect(result).toHaveLength(1);
  });

  it('keeps an event with an attendees array but no self:true entry (another attendee declined, not the user)', async () => {
    jest.spyOn(gcalApi, 'listEvents').mockResolvedValue({
      items: [{
        id: 'other-declined-1',
        status: 'confirmed',
        summary: 'Team sync — someone else declined',
        start: { dateTime: '2026-07-05T10:00:00-04:00' },
        end: { dateTime: '2026-07-05T10:30:00-04:00' },
        attendees: [
          { email: 'organizer@example.com', organizer: true, responseStatus: 'accepted' },
          { email: 'other-attendee@example.com', responseStatus: 'declined' }
          // no entry has self:true — Google's calendarList export for a
          // shared calendar, or a self-attendee entry the API omitted
        ]
      }],
      nextSyncToken: 'tok-other-declined'
    });
    var result = await gcalAdapter.listEvents('mock-token', '2026-07-01', '2026-07-08', null);
    expect(result.find(function(e) { return e.id === 'other-declined-1'; })).toBeDefined();
    expect(result).toHaveLength(1);
  });
});

// ─── SECONDARY (end-to-end, DB-backed): a PULLED gcal-origin task whose event
// flips to self-declined is DELETED after MISS_THRESHOLD (=3) syncs — mirrors
// 12-sync-deletion.test.js's miss-count ladder, but for a declined-invite
// event rather than a hard-deleted one, and mocked at gcalApi.listEvents (no
// live GCal credentials needed — same technique as 18-sync-recurring.test.js's
// "task&&!event — past recurring instance protection" block) so it runs in
// any environment with the test-bed DB (3407) up, credentials or not.
//
// Uses assertDbAvailable (TEST-FR-001): FAILS LOUD if the test-bed DB is down
// — never silently skips/passes with zero assertions.

var {
  db, TEST_USER_ID, isDbAvailable, seedTestUser, cleanupTestData, destroyTestUser,
  mockReq, mockRes
} = require('./helpers/test-setup');
var { assertDbAvailable } = require('../helpers/requireDB');
var { makeTask, makeLedgerRow, makeTaskId } = require('./helpers/test-fixtures');
var { sync } = require('../../src/controllers/cal-sync.controller');

function e2eSelfEvent(id, responseStatus, startISO, endISO) {
  return {
    id: id,
    status: 'confirmed',
    summary: 'E2E Invite ' + id,
    start: { dateTime: startISO },
    end: { dateTime: endISO },
    attendees: [
      { email: 'organizer@example.com', organizer: true, responseStatus: 'accepted' },
      { email: 'calsync-test@test.com', self: true, responseStatus: responseStatus }
    ]
  };
}

describe('BUG-999.999 E2E: PULLED gcal task deleted after MISS_THRESHOLD when invite is declined', () => {
  var GCAL_ONLY_FAKE = {
    gcal_refresh_token: 'fake-refresh-token-declined-invite-e2e',
    gcal_access_token: 'fake-access-token',
    gcal_token_expiry: new Date(Date.now() + 60 * 60 * 1000), // short-circuits real oauth refresh
    gcal_sync_token: null,
    msft_cal_refresh_token: null,
    apple_cal_username: null,
    apple_cal_password: null,
    apple_cal_server_url: null,
    apple_cal_calendar_url: null
  };

  beforeEach(async () => {
    await assertDbAvailable();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (await isDbAvailable()) await cleanupTestData();
  });

  afterAll(async () => {
    if (await isDbAvailable()) await destroyTestUser();
    await db.destroy();
  });

  it('deletes the task after 3 syncs when the pulled event flips to self responseStatus:"declined"', async () => {
    await assertDbAvailable();
    var user = await seedTestUser(GCAL_ONLY_FAKE);

    var eventId = 'declined-e2e-' + makeTaskId('evt');
    var eventStart = new Date(Date.now() + 24 * 60 * 60 * 1000); // tomorrow
    eventStart.setHours(10, 0, 0, 0);
    var eventEnd = new Date(eventStart.getTime() + 30 * 60000);

    var task = await makeTask({
      text: 'E2E Declined Invite Task',
      scheduled_at: eventStart,
      dur: 30,
      when: 'morning'
    });

    var ledgerRow = await makeLedgerRow({
      user_id: TEST_USER_ID,
      provider: 'gcal',
      task_id: task.id,
      provider_event_id: eventId,
      origin: 'gcal', // PULLED task (created from a calendar event, not pushed by juggler)
      status: 'active',
      miss_count: 0,
      event_start: eventStart
    });
    var ledgerId = ledgerRow.id;

    // Every sync, GCal's events.list still returns this event (top-level
    // status:'confirmed') but the user's own attendee entry now shows
    // responseStatus:'declined' — the exact shape of a declined/deleted
    // invitation per the bug report.
    jest.spyOn(gcalApi, 'listEvents').mockResolvedValue({
      items: [e2eSelfEvent(eventId, 'declined', eventStart.toISOString(), eventEnd.toISOString())],
      nextSyncToken: 'tok-e2e-declined'
    });

    // Sync 3 times (MISS_THRESHOLD = 3 in cal-sync.controller.js)
    for (var i = 0; i < 3; i++) {
      user = await db('users').where('id', TEST_USER_ID).first();
      var req = mockReq(user);
      var res = mockRes();
      await sync(req, res);
    }

    var taskGone = await db('tasks_v').where('id', task.id).first();
    expect(taskGone).toBeFalsy();

    var ledgerAfter = await db('cal_sync_ledger').where('id', ledgerId).first();
    expect(ledgerAfter).toBeTruthy();
    expect(ledgerAfter.status).toBe('deleted_remote');
  });

  // AC3 negative at the E2E layer: an accepted invite must NEVER be deleted by
  // this ladder, even across repeated syncs — guards against an overzealous
  // fix that treats any attendees array as grounds for exclusion.
  it('does NOT delete the task across 3 syncs when the self responseStatus stays "accepted"', async () => {
    await assertDbAvailable();
    var user = await seedTestUser(GCAL_ONLY_FAKE);

    var eventId = 'accepted-e2e-' + makeTaskId('evt');
    var eventStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    eventStart.setHours(14, 0, 0, 0);
    var eventEnd = new Date(eventStart.getTime() + 30 * 60000);

    var task = await makeTask({
      text: 'E2E Accepted Invite Task',
      scheduled_at: eventStart,
      dur: 30,
      when: 'afternoon'
    });

    var ledgerRow = await makeLedgerRow({
      user_id: TEST_USER_ID,
      provider: 'gcal',
      task_id: task.id,
      provider_event_id: eventId,
      origin: 'gcal',
      status: 'active',
      miss_count: 0,
      event_start: eventStart
    });

    jest.spyOn(gcalApi, 'listEvents').mockResolvedValue({
      items: [e2eSelfEvent(eventId, 'accepted', eventStart.toISOString(), eventEnd.toISOString())],
      nextSyncToken: 'tok-e2e-accepted'
    });

    for (var i = 0; i < 3; i++) {
      user = await db('users').where('id', TEST_USER_ID).first();
      var req = mockReq(user);
      var res = mockRes();
      await sync(req, res);
    }

    var taskStill = await db('tasks_v').where('id', task.id).first();
    expect(taskStill).toBeTruthy();

    var ledgerAfter = await db('cal_sync_ledger').where('id', ledgerRow.id).first();
    expect(ledgerAfter).toBeTruthy();
    expect(ledgerAfter.status).toBe('active');
    expect(ledgerAfter.miss_count).toBe(0);
  });
});
