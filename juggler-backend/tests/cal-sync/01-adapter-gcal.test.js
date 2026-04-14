/**
 * GCal adapter integration tests — runs against the real Google Calendar API.
 * Requires TEST_GCAL_REFRESH_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET in .env.test
 */

var {
  db, TEST_USER_ID, TEST_TIMEZONE,
  hasGCalCredentials, getGCalToken, seedTestUser, cleanupTestData, destroyTestUser
} = require('./helpers/test-setup');

var { makeTask, makeGCalEvent, deleteGCalEvent, deleteAllGCalTestEvents } = require('./helpers/test-fixtures');
var { getGCalEvent, listGCalEvents, waitForPropagation } = require('./helpers/api-helpers');

var gcalAdapter = require('../../src/lib/cal-adapters/gcal.adapter');

jest.setTimeout(30000);

var token = null;
var createdEventIds = [];
var skip = false;

beforeAll(async function () {
  if (!hasGCalCredentials()) {
    skip = true;
    console.warn('Skipping GCal adapter tests — no credentials');
    return;
  }
  token = await getGCalToken();
  if (!token) {
    skip = true;
    console.warn('Skipping GCal adapter tests — could not get access token');
    return;
  }
  // Clean up any leftover test events from previous runs
  await deleteAllGCalTestEvents(token);
});

afterAll(async function () {
  if (skip) return;
  // Clean up all events created during tests
  for (var i = 0; i < createdEventIds.length; i++) {
    await deleteGCalEvent(token, createdEventIds[i]);
  }
  await deleteAllGCalTestEvents(token);
});

function skipIfNoCreds() {
  if (skip) {
    return true;
  }
  return false;
}

// ─── 1. normalizeEvent ───

describe('GCal adapter — normalizeEvent', function () {
  it('should normalize a real GCal timed event to unified shape', async function () {
    if (skipIfNoCreds()) return;

    var raw = await makeGCalEvent(token, {
      summary: 'Test Event Normalize',
      description: 'desc for normalize test'
    });
    createdEventIds.push(raw.id);

    var normalized = gcalAdapter.normalizeEvent(raw);

    expect(normalized.id).toBe(raw.id);
    expect(normalized.title).toBe('Test Event Normalize');
    expect(normalized.description).toBe('desc for normalize test');
    expect(normalized.startDateTime).toBeTruthy();
    expect(normalized.endDateTime).toBeTruthy();
    expect(normalized.isAllDay).toBe(false);
    expect(typeof normalized.durationMinutes).toBe('number');
    expect(normalized.durationMinutes).toBe(30);
    expect(normalized.lastModified).toBeTruthy();
    expect(normalized.isTransparent).toBe(false);
    expect(normalized._raw).toBeTruthy();
  });

  it('should normalize an all-day event correctly', async function () {
    if (skipIfNoCreds()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    var dateStr = tomorrow.getFullYear() + '-' +
      String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' +
      String(tomorrow.getDate()).padStart(2, '0');

    var raw = await makeGCalEvent(token, {
      summary: 'Test Event AllDay Normalize',
      start: { date: dateStr },
      end: { date: dateStr }
    });
    createdEventIds.push(raw.id);

    var normalized = gcalAdapter.normalizeEvent(raw);

    expect(normalized.isAllDay).toBe(true);
    expect(normalized.title).toBe('Test Event AllDay Normalize');
  });
});

// ─── 2. eventHash ───

describe('GCal adapter — eventHash', function () {
  it('should produce a consistent 32-char MD5 hex hash', function () {
    if (skipIfNoCreds()) return;

    var event = {
      title: 'Hash Test',
      startDateTime: '2026-04-14T10:00:00',
      endDateTime: '2026-04-14T10:30:00',
      description: 'testing hash',
      isTransparent: false,
      isAllDay: false
    };
    var hash1 = gcalAdapter.eventHash(event);
    var hash2 = gcalAdapter.eventHash(event);

    expect(hash1).toHaveLength(32);
    expect(hash1).toMatch(/^[a-f0-9]{32}$/);
    expect(hash1).toBe(hash2);
  });

  it('should change when fields change', function () {
    if (skipIfNoCreds()) return;

    var event1 = {
      title: 'Hash A',
      startDateTime: '2026-04-14T10:00:00',
      endDateTime: '2026-04-14T10:30:00',
      description: '',
      isTransparent: false,
      isAllDay: false
    };
    var event2 = Object.assign({}, event1, { title: 'Hash B' });
    var event3 = Object.assign({}, event1, { isTransparent: true });

    expect(gcalAdapter.eventHash(event1)).not.toBe(gcalAdapter.eventHash(event2));
    expect(gcalAdapter.eventHash(event1)).not.toBe(gcalAdapter.eventHash(event3));
  });
});

// ─── 3. buildEventBody ───

describe('GCal adapter — buildEventBody', function () {
  it('should build a timed event body', function () {
    if (skipIfNoCreds()) return;

    var task = { id: 'test-1', text: 'Timed Task', date: '4/15', time: '2:30 PM', dur: 45, when: 'afternoon' };
    var body = gcalAdapter.buildEventBody(task, 2026, TEST_TIMEZONE);

    expect(body.summary).toBe('Timed Task');
    expect(body.start.dateTime).toContain('2026-04-15T14:30');
    expect(body.start.timeZone).toBe(TEST_TIMEZONE);
    expect(body.end.timeZone).toBe(TEST_TIMEZONE);
    expect(body.transparency).toBeUndefined();
  });

  it('should build an all-day event body', function () {
    if (skipIfNoCreds()) return;

    var task = { id: 'test-2', text: 'All Day Task', date: '4/15', when: 'allday', dur: 30 };
    var body = gcalAdapter.buildEventBody(task, 2026, TEST_TIMEZONE);

    expect(body.start.date).toBe('2026-04-15');
    expect(body.end.date).toBe('2026-04-16');
    expect(body.start.dateTime).toBeUndefined();
  });

  it('should mark done tasks as transparent', function () {
    if (skipIfNoCreds()) return;

    var task = { id: 'test-3', text: 'Done Task', date: '4/15', time: '9:00 AM', dur: 30, status: 'done', when: 'morning' };
    var body = gcalAdapter.buildEventBody(task, 2026, TEST_TIMEZONE);

    expect(body.summary).toContain('\u2713');
    expect(body.transparency).toBe('transparent');
  });

  it('should mark marker tasks as transparent', function () {
    if (skipIfNoCreds()) return;

    var task = { id: 'test-4', text: 'Marker Task', date: '4/15', time: '9:00 AM', dur: 30, marker: true, when: 'morning' };
    var body = gcalAdapter.buildEventBody(task, 2026, TEST_TIMEZONE);

    expect(body.transparency).toBe('transparent');
  });
});

// ─── 4. applyEventToTaskFields ───

describe('GCal adapter — applyEventToTaskFields', function () {
  it('should promote to fixed when time changes', function () {
    if (skipIfNoCreds()) return;

    var event = {
      title: 'Moved Task',
      startDateTime: '2026-04-15T14:00:00',
      endDateTime: '2026-04-15T14:30:00',
      isAllDay: false,
      durationMinutes: 30,
      isTransparent: false,
      description: ''
    };
    var currentTask = { when: 'morning', time: '9:00 AM', date: '4/15' };
    var fields = gcalAdapter.applyEventToTaskFields(event, TEST_TIMEZONE, currentTask);

    expect(fields.when).toBe('fixed');
    expect(fields.prev_when).toBe('morning');
  });

  it('should set date_pinned when date changes', function () {
    if (skipIfNoCreds()) return;

    var event = {
      title: 'Date Moved',
      startDateTime: '2026-04-16T09:00:00',
      endDateTime: '2026-04-16T09:30:00',
      isAllDay: false,
      durationMinutes: 30,
      isTransparent: false,
      description: ''
    };
    var currentTask = { when: 'morning', time: '9:00 AM', date: '4/15' };
    var fields = gcalAdapter.applyEventToTaskFields(event, TEST_TIMEZONE, currentTask);

    expect(fields.when).toBe('fixed');
    expect(fields.date_pinned).toBe(1);
  });

  it('should promote allday-to-timed to fixed', function () {
    if (skipIfNoCreds()) return;

    var event = {
      title: 'Was AllDay',
      startDateTime: '2026-04-15T10:00:00',
      endDateTime: '2026-04-15T10:30:00',
      isAllDay: false,
      durationMinutes: 30,
      isTransparent: false,
      description: ''
    };
    var currentTask = { when: 'allday', date: '4/15' };
    var fields = gcalAdapter.applyEventToTaskFields(event, TEST_TIMEZONE, currentTask);

    expect(fields.when).toBe('fixed');
    expect(fields.prev_when).toBe('allday');
  });

  it('should clear marker when event is no longer transparent', function () {
    if (skipIfNoCreds()) return;

    var event = {
      title: 'Not Marker Anymore',
      startDateTime: '2026-04-15T10:00:00',
      endDateTime: '2026-04-15T10:30:00',
      isAllDay: false,
      durationMinutes: 30,
      isTransparent: false,
      description: ''
    };
    var currentTask = { when: 'fixed', marker: true, date: '4/15', time: '10:00 AM' };
    var fields = gcalAdapter.applyEventToTaskFields(event, TEST_TIMEZONE, currentTask);

    expect(fields.marker).toBe(false);
  });
});

// ─── 5. createEvent + getEvent ───

describe('GCal adapter — createEvent', function () {
  it('should create an event and verify via direct API', async function () {
    if (skipIfNoCreds()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    var month = tomorrow.getMonth() + 1;
    var day = tomorrow.getDate();

    var task = {
      id: 'gcal-create-test-001',
      user_id: TEST_USER_ID,
      text: 'Test Event Create Verify',
      date: month + '/' + day,
      time: '10:00 AM',
      dur: 30,
      when: 'morning'
    };

    var result = await gcalAdapter.createEvent(token, task, tomorrow.getFullYear(), TEST_TIMEZONE);
    createdEventIds.push(result.providerEventId);

    expect(result.providerEventId).toBeTruthy();
    expect(result.raw).toBeTruthy();

    await waitForPropagation(2000);

    var fetched = await getGCalEvent(token, result.providerEventId);
    expect(fetched).not.toBeNull();
    expect(fetched.summary).toBe('Test Event Create Verify');
  });
});

// ─── 6. updateEvent ───

describe('GCal adapter — updateEvent', function () {
  it('should create an event, update title, and verify', async function () {
    if (skipIfNoCreds()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    var month = tomorrow.getMonth() + 1;
    var day = tomorrow.getDate();

    var task = {
      id: 'gcal-update-test-001',
      user_id: TEST_USER_ID,
      text: 'Test Event Before Update',
      date: month + '/' + day,
      time: '11:00 AM',
      dur: 30,
      when: 'morning'
    };

    var result = await gcalAdapter.createEvent(token, task, tomorrow.getFullYear(), TEST_TIMEZONE);
    createdEventIds.push(result.providerEventId);

    var updatedTask = Object.assign({}, task, { text: 'Test Event After Update' });
    await gcalAdapter.updateEvent(token, result.providerEventId, updatedTask, tomorrow.getFullYear(), TEST_TIMEZONE);

    await waitForPropagation(2000);

    var fetched = await getGCalEvent(token, result.providerEventId);
    expect(fetched).not.toBeNull();
    expect(fetched.summary).toBe('Test Event After Update');
  });
});

// ─── 7. deleteEvent ───

describe('GCal adapter — deleteEvent', function () {
  it('should create an event, delete it, and verify it is gone', async function () {
    if (skipIfNoCreds()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    var month = tomorrow.getMonth() + 1;
    var day = tomorrow.getDate();

    var task = {
      id: 'gcal-delete-test-001',
      user_id: TEST_USER_ID,
      text: 'Test Event To Delete',
      date: month + '/' + day,
      time: '1:00 PM',
      dur: 30,
      when: 'afternoon'
    };

    var result = await gcalAdapter.createEvent(token, task, tomorrow.getFullYear(), TEST_TIMEZONE);
    // Do NOT push to createdEventIds — we are deleting it

    await gcalAdapter.deleteEvent(token, result.providerEventId);

    await waitForPropagation(2000);

    var fetched = await getGCalEvent(token, result.providerEventId);
    // GCal returns cancelled events with status, or null
    expect(!fetched || fetched.status === 'cancelled').toBe(true);
  });
});

// ─── 8. batchCreateEvents ───

describe('GCal adapter — batchCreateEvents', function () {
  it('should create 3 events in a batch and verify all exist', async function () {
    if (skipIfNoCreds()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    var month = tomorrow.getMonth() + 1;
    var day = tomorrow.getDate();
    var year = tomorrow.getFullYear();

    var pairs = [
      { task: { id: 'gcal-batch-c1', user_id: TEST_USER_ID, text: 'Test Event Batch 1', date: month + '/' + day, time: '9:00 AM', dur: 15, when: 'morning' } },
      { task: { id: 'gcal-batch-c2', user_id: TEST_USER_ID, text: 'Test Event Batch 2', date: month + '/' + day, time: '9:30 AM', dur: 15, when: 'morning' } },
      { task: { id: 'gcal-batch-c3', user_id: TEST_USER_ID, text: 'Test Event Batch 3', date: month + '/' + day, time: '10:00 AM', dur: 15, when: 'morning' } }
    ];

    var results = await gcalAdapter.batchCreateEvents(token, pairs, year, TEST_TIMEZONE);

    expect(results).toHaveLength(3);
    for (var i = 0; i < results.length; i++) {
      expect(results[i].error).toBeNull();
      expect(results[i].providerEventId).toBeTruthy();
      createdEventIds.push(results[i].providerEventId);
    }

    await waitForPropagation(2000);

    for (var j = 0; j < results.length; j++) {
      var fetched = await getGCalEvent(token, results[j].providerEventId);
      expect(fetched).not.toBeNull();
      expect(fetched.summary).toContain('Test Event Batch');
    }
  });
});

// ─── 9. batchDeleteEvents ───

describe('GCal adapter — batchDeleteEvents', function () {
  it('should delete 3 events in a batch', async function () {
    if (skipIfNoCreds()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    var month = tomorrow.getMonth() + 1;
    var day = tomorrow.getDate();
    var year = tomorrow.getFullYear();

    // Create 3 events to delete
    var pairs = [
      { task: { id: 'gcal-batch-d1', user_id: TEST_USER_ID, text: 'Test Event BatchDel 1', date: month + '/' + day, time: '2:00 PM', dur: 15, when: 'afternoon' } },
      { task: { id: 'gcal-batch-d2', user_id: TEST_USER_ID, text: 'Test Event BatchDel 2', date: month + '/' + day, time: '2:30 PM', dur: 15, when: 'afternoon' } },
      { task: { id: 'gcal-batch-d3', user_id: TEST_USER_ID, text: 'Test Event BatchDel 3', date: month + '/' + day, time: '3:00 PM', dur: 15, when: 'afternoon' } }
    ];

    var created = await gcalAdapter.batchCreateEvents(token, pairs, year, TEST_TIMEZONE);
    var eventIds = created.map(function (r) { return r.providerEventId; });

    await waitForPropagation(1000);

    var deleteResults = await gcalAdapter.batchDeleteEvents(token, eventIds);

    expect(deleteResults).toHaveLength(3);
    for (var i = 0; i < deleteResults.length; i++) {
      expect(deleteResults[i].error).toBeNull();
    }

    await waitForPropagation(2000);

    for (var j = 0; j < eventIds.length; j++) {
      var fetched = await getGCalEvent(token, eventIds[j]);
      expect(!fetched || fetched.status === 'cancelled').toBe(true);
    }
  });
});

// ─── 10. batchUpdateEvents ───

describe('GCal adapter — batchUpdateEvents', function () {
  it('should create 3 events, batch update titles, and verify', async function () {
    if (skipIfNoCreds()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    var month = tomorrow.getMonth() + 1;
    var day = tomorrow.getDate();
    var year = tomorrow.getFullYear();

    var pairs = [
      { task: { id: 'gcal-batch-u1', user_id: TEST_USER_ID, text: 'Test Event BatchUpd 1', date: month + '/' + day, time: '4:00 PM', dur: 15, when: 'afternoon' } },
      { task: { id: 'gcal-batch-u2', user_id: TEST_USER_ID, text: 'Test Event BatchUpd 2', date: month + '/' + day, time: '4:30 PM', dur: 15, when: 'afternoon' } },
      { task: { id: 'gcal-batch-u3', user_id: TEST_USER_ID, text: 'Test Event BatchUpd 3', date: month + '/' + day, time: '5:00 PM', dur: 15, when: 'afternoon' } }
    ];

    var created = await gcalAdapter.batchCreateEvents(token, pairs, year, TEST_TIMEZONE);
    for (var i = 0; i < created.length; i++) {
      createdEventIds.push(created[i].providerEventId);
    }

    await waitForPropagation(1000);

    var updatePairs = created.map(function (r, idx) {
      return {
        eventId: r.providerEventId,
        task: Object.assign({}, pairs[idx].task, { text: 'Test Event Updated Title ' + (idx + 1) })
      };
    });

    var updateResults = await gcalAdapter.batchUpdateEvents(token, updatePairs, year, TEST_TIMEZONE);

    expect(updateResults).toHaveLength(3);
    for (var k = 0; k < updateResults.length; k++) {
      expect(updateResults[k].error).toBeNull();
    }

    await waitForPropagation(2000);

    for (var j = 0; j < created.length; j++) {
      var fetched = await getGCalEvent(token, created[j].providerEventId);
      expect(fetched).not.toBeNull();
      expect(fetched.summary).toContain('Test Event Updated Title');
    }
  });
});

// ─── 11. listEvents ───

describe('GCal adapter — listEvents', function () {
  it('should create 2 events and list them in the correct time window', async function () {
    if (skipIfNoCreds()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 3);
    var month = tomorrow.getMonth() + 1;
    var day = tomorrow.getDate();
    var year = tomorrow.getFullYear();

    var task1 = { id: 'gcal-list-1', user_id: TEST_USER_ID, text: 'Test Event List A', date: month + '/' + day, time: '8:00 AM', dur: 30, when: 'morning' };
    var task2 = { id: 'gcal-list-2', user_id: TEST_USER_ID, text: 'Test Event List B', date: month + '/' + day, time: '8:30 AM', dur: 30, when: 'morning' };

    var r1 = await gcalAdapter.createEvent(token, task1, year, TEST_TIMEZONE);
    var r2 = await gcalAdapter.createEvent(token, task2, year, TEST_TIMEZONE);
    createdEventIds.push(r1.providerEventId);
    createdEventIds.push(r2.providerEventId);

    await waitForPropagation(2000);

    var windowStart = new Date(year, month - 1, day, 0, 0, 0);
    var windowEnd = new Date(year, month - 1, day, 23, 59, 59);
    var events = await gcalAdapter.listEvents(token, windowStart.toISOString(), windowEnd.toISOString());

    var titles = events.map(function (e) { return e.title; });
    expect(titles).toContain('Test Event List A');
    expect(titles).toContain('Test Event List B');

    // Verify normalized shape
    var found = events.find(function (e) { return e.title === 'Test Event List A'; });
    expect(found.id).toBeTruthy();
    expect(found.startDateTime).toBeTruthy();
    expect(found.isAllDay).toBe(false);
  });
});

// ─── 12. hasChanges ───

describe('GCal adapter — hasChanges', function () {
  it('should detect changes after creating a new event', async function () {
    if (skipIfNoCreds()) return;

    // First, do a listEvents to establish a sync token
    var now = new Date();
    var start = new Date(now);
    start.setDate(start.getDate() - 1);
    var end = new Date(now);
    end.setDate(end.getDate() + 7);

    // Seed a user so we can store the sync token
    var user = await seedTestUser();

    await gcalAdapter.listEvents(token, start.toISOString(), end.toISOString(), TEST_USER_ID);

    // Read back the user to get the stored sync token
    user = await db('users').where('id', TEST_USER_ID).first();

    if (!user.gcal_sync_token) {
      // Some accounts may not return sync tokens; skip gracefully
      console.warn('No sync token returned — skipping hasChanges verification');
      await destroyTestUser();
      return;
    }

    // hasChanges with no new events should return false (or at least not error)
    var result1 = await gcalAdapter.hasChanges(token, user);
    // result1.hasChanges can be true or false depending on timing; just verify shape
    expect(typeof result1.hasChanges).toBe('boolean');

    // Create a new event to trigger a change
    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    var raw = await makeGCalEvent(token, { summary: 'Test Event HasChanges' });
    createdEventIds.push(raw.id);

    await waitForPropagation(2000);

    var result2 = await gcalAdapter.hasChanges(token, user);
    expect(result2.hasChanges).toBe(true);

    await destroyTestUser();
  });
});
