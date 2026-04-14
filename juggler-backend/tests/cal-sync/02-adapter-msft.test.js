/**
 * MSFT Calendar adapter integration tests — runs against the real Microsoft Graph API.
 * Requires TEST_MSFT_REFRESH_TOKEN, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET in .env.test
 */

var {
  db, TEST_USER_ID, TEST_TIMEZONE,
  hasMsftCredentials, getMsftToken, seedTestUser, cleanupTestData, destroyTestUser
} = require('./helpers/test-setup');

var { makeTask, makeMSFTEvent, deleteMSFTEvent, deleteAllMSFTTestEvents } = require('./helpers/test-fixtures');
var { getMSFTEvent, listMSFTEvents, waitForPropagation } = require('./helpers/api-helpers');

var msftAdapter = require('../../src/lib/cal-adapters/msft.adapter');

jest.setTimeout(30000);

var token = null;
var createdEventIds = [];
var skip = false;

beforeAll(async function () {
  if (!hasMsftCredentials()) {
    skip = true;
    console.warn('Skipping MSFT adapter tests — no credentials');
    return;
  }
  token = await getMsftToken();
  if (!token) {
    skip = true;
    console.warn('Skipping MSFT adapter tests — could not get access token');
    return;
  }
  await deleteAllMSFTTestEvents(token);
});

afterAll(async function () {
  if (skip) return;
  for (var i = 0; i < createdEventIds.length; i++) {
    await deleteMSFTEvent(token, createdEventIds[i]);
  }
  await deleteAllMSFTTestEvents(token);
});

function skipIfNoCreds() {
  if (skip) return true;
  return false;
}

// ─── 1. normalizeEvent ───

describe('MSFT adapter — normalizeEvent', function () {
  it('should normalize a real MSFT event to unified shape', async function () {
    if (skipIfNoCreds()) return;

    var raw = await makeMSFTEvent(token, {
      subject: 'Test Event Normalize MSFT',
      body: { contentType: 'text', content: 'msft desc test' }
    });
    createdEventIds.push(raw.id);

    var normalized = msftAdapter.normalizeEvent(raw);

    expect(normalized.id).toBe(raw.id);
    expect(normalized.title).toBe('Test Event Normalize MSFT');
    expect(normalized.description).toBe('msft desc test');
    expect(normalized.startDateTime).toBeTruthy();
    expect(normalized.endDateTime).toBeTruthy();
    expect(normalized.isAllDay).toBe(false);
    expect(typeof normalized.durationMinutes).toBe('number');
    expect(normalized.durationMinutes).toBe(30);
    expect(normalized.lastModified).toBeTruthy();
    expect(normalized.isTransparent).toBe(false);
    expect(normalized._raw).toBeTruthy();
  });

  it('should map showAs=free to isTransparent', async function () {
    if (skipIfNoCreds()) return;

    var raw = await makeMSFTEvent(token, {
      subject: 'Test Event Transparent MSFT',
      showAs: 'free'
    });
    createdEventIds.push(raw.id);

    var normalized = msftAdapter.normalizeEvent(raw);
    expect(normalized.isTransparent).toBe(true);
  });

  it('should handle 7-digit fractional seconds via truncateDateTime', async function () {
    if (skipIfNoCreds()) return;

    // MSFT Graph often returns 7-digit fractional seconds
    var fakeEvent = {
      id: 'test-truncate',
      subject: 'Truncate Test',
      body: { content: '' },
      start: { dateTime: '2026-04-15T10:00:00.4777274', timeZone: 'Eastern Standard Time' },
      end: { dateTime: '2026-04-15T10:30:00.4777274', timeZone: 'Eastern Standard Time' },
      isAllDay: false,
      showAs: 'busy',
      lastModifiedDateTime: '2026-04-15T10:00:00.4777274Z'
    };

    var normalized = msftAdapter.normalizeEvent(fakeEvent);

    // Fractional seconds should be truncated to 6 digits max
    expect(normalized.startDateTime).not.toContain('.4777274');
    expect(normalized.startDateTime).toContain('.477727');
    expect(normalized.lastModified).not.toContain('.4777274');
  });
});

// ─── 2. eventHash ───

describe('MSFT adapter — eventHash', function () {
  it('should produce a consistent 32-char MD5 hex hash', function () {
    if (skipIfNoCreds()) return;

    var event = {
      title: 'Hash Test MSFT',
      startDateTime: '2026-04-14T10:00:00',
      endDateTime: '2026-04-14T10:30:00',
      description: 'testing hash',
      isTransparent: false,
      isAllDay: false
    };
    var hash1 = msftAdapter.eventHash(event);
    var hash2 = msftAdapter.eventHash(event);

    expect(hash1).toHaveLength(32);
    expect(hash1).toMatch(/^[a-f0-9]{32}$/);
    expect(hash1).toBe(hash2);
  });

  it('should change when fields change', function () {
    if (skipIfNoCreds()) return;

    var event1 = {
      title: 'Hash MSFT A',
      startDateTime: '2026-04-14T10:00:00',
      endDateTime: '2026-04-14T10:30:00',
      description: '',
      isTransparent: false,
      isAllDay: false
    };
    var event2 = Object.assign({}, event1, { title: 'Hash MSFT B' });
    var event3 = Object.assign({}, event1, { isTransparent: true });

    expect(msftAdapter.eventHash(event1)).not.toBe(msftAdapter.eventHash(event2));
    expect(msftAdapter.eventHash(event1)).not.toBe(msftAdapter.eventHash(event3));
  });
});

// ─── 3. buildMsftEventBody ───

describe('MSFT adapter — buildMsftEventBody', function () {
  it('should build a timed event body with Windows timezone', function () {
    if (skipIfNoCreds()) return;

    var task = { id: 'test-m1', text: 'Timed Task MSFT', date: '4/15', time: '2:30 PM', dur: 45, when: 'afternoon' };
    var body = msftAdapter.buildMsftEventBody(task, 2026, TEST_TIMEZONE);

    expect(body.subject).toBe('Timed Task MSFT');
    expect(body.start.timeZone).toBe('Eastern Standard Time');
    expect(body.end.timeZone).toBe('Eastern Standard Time');
    expect(body.body.contentType).toBe('text');
    expect(body.showAs).toBeUndefined();
  });

  it('should build an all-day event body', function () {
    if (skipIfNoCreds()) return;

    var task = { id: 'test-m2', text: 'All Day MSFT', date: '4/15', when: 'allday', dur: 30 };
    var body = msftAdapter.buildMsftEventBody(task, 2026, TEST_TIMEZONE);

    expect(body.isAllDay).toBe(true);
    expect(body.start.dateTime).toContain('2026-04-15');
    expect(body.end.dateTime).toContain('2026-04-16');
  });

  it('should set showAs=free for done tasks', function () {
    if (skipIfNoCreds()) return;

    var task = { id: 'test-m3', text: 'Done Task MSFT', date: '4/15', time: '9:00 AM', dur: 30, status: 'done', when: 'morning' };
    var body = msftAdapter.buildMsftEventBody(task, 2026, TEST_TIMEZONE);

    expect(body.subject).toContain('\u2713');
    expect(body.showAs).toBe('free');
  });

  it('should set showAs=free for marker tasks', function () {
    if (skipIfNoCreds()) return;

    var task = { id: 'test-m4', text: 'Marker MSFT', date: '4/15', time: '9:00 AM', dur: 30, marker: true, when: 'morning' };
    var body = msftAdapter.buildMsftEventBody(task, 2026, TEST_TIMEZONE);

    expect(body.showAs).toBe('free');
  });

  it('should use UTC when scheduledAt is provided', function () {
    if (skipIfNoCreds()) return;

    var task = {
      id: 'test-m5', text: 'UTC Task', date: '4/15', time: '2:00 PM', dur: 60,
      when: 'afternoon', scheduledAt: '2026-04-15T18:00:00.000Z'
    };
    var body = msftAdapter.buildMsftEventBody(task, 2026, TEST_TIMEZONE);

    expect(body.start.timeZone).toBe('UTC');
    expect(body.end.timeZone).toBe('UTC');
  });
});

// ─── 4. applyEventToTaskFields ───

describe('MSFT adapter — applyEventToTaskFields', function () {
  it('should promote to fixed when time changes', function () {
    if (skipIfNoCreds()) return;

    var event = {
      title: 'Moved Task MSFT',
      startDateTime: '2026-04-15T14:00:00',
      endDateTime: '2026-04-15T14:30:00',
      startTimezone: 'Eastern Standard Time',
      isAllDay: false,
      durationMinutes: 30,
      isTransparent: false,
      description: ''
    };
    var currentTask = { when: 'morning', time: '9:00 AM', date: '4/15' };
    var fields = msftAdapter.applyEventToTaskFields(event, TEST_TIMEZONE, currentTask);

    expect(fields.when).toBe('fixed');
    expect(fields.prev_when).toBe('morning');
  });

  it('should set date_pinned when date changes', function () {
    if (skipIfNoCreds()) return;

    var event = {
      title: 'Date Moved MSFT',
      startDateTime: '2026-04-16T09:00:00',
      endDateTime: '2026-04-16T09:30:00',
      startTimezone: 'Eastern Standard Time',
      isAllDay: false,
      durationMinutes: 30,
      isTransparent: false,
      description: ''
    };
    var currentTask = { when: 'morning', time: '9:00 AM', date: '4/15' };
    var fields = msftAdapter.applyEventToTaskFields(event, TEST_TIMEZONE, currentTask);

    expect(fields.when).toBe('fixed');
    expect(fields.date_pinned).toBe(1);
  });

  it('should promote allday-to-timed to fixed', function () {
    if (skipIfNoCreds()) return;

    var event = {
      title: 'Was AllDay MSFT',
      startDateTime: '2026-04-15T10:00:00',
      endDateTime: '2026-04-15T10:30:00',
      startTimezone: 'Eastern Standard Time',
      isAllDay: false,
      durationMinutes: 30,
      isTransparent: false,
      description: ''
    };
    var currentTask = { when: 'allday', date: '4/15' };
    var fields = msftAdapter.applyEventToTaskFields(event, TEST_TIMEZONE, currentTask);

    expect(fields.when).toBe('fixed');
    expect(fields.prev_when).toBe('allday');
  });

  it('should clear marker when event is no longer transparent', function () {
    if (skipIfNoCreds()) return;

    var event = {
      title: 'Not Marker MSFT',
      startDateTime: '2026-04-15T10:00:00',
      endDateTime: '2026-04-15T10:30:00',
      startTimezone: 'Eastern Standard Time',
      isAllDay: false,
      durationMinutes: 30,
      isTransparent: false,
      description: ''
    };
    var currentTask = { when: 'fixed', marker: true, date: '4/15', time: '10:00 AM' };
    var fields = msftAdapter.applyEventToTaskFields(event, TEST_TIMEZONE, currentTask);

    expect(fields.marker).toBe(false);
  });
});

// ─── 5. createEvent + getEvent ───

describe('MSFT adapter — createEvent', function () {
  it('should create an event and verify via direct API', async function () {
    if (skipIfNoCreds()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    var month = tomorrow.getMonth() + 1;
    var day = tomorrow.getDate();

    var task = {
      id: 'msft-create-test-001',
      user_id: TEST_USER_ID,
      text: 'Test Event Create Verify MSFT',
      date: month + '/' + day,
      time: '10:00 AM',
      dur: 30,
      when: 'morning'
    };

    var result = await msftAdapter.createEvent(token, task, tomorrow.getFullYear(), TEST_TIMEZONE);
    createdEventIds.push(result.providerEventId);

    expect(result.providerEventId).toBeTruthy();
    expect(result.raw).toBeTruthy();

    await waitForPropagation(2000);

    var fetched = await getMSFTEvent(token, result.providerEventId);
    expect(fetched).not.toBeNull();
    expect(fetched.subject).toBe('Test Event Create Verify MSFT');
  });
});

// ─── 6. updateEvent ───

describe('MSFT adapter — updateEvent', function () {
  it('should create an event, update title, and verify', async function () {
    if (skipIfNoCreds()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    var month = tomorrow.getMonth() + 1;
    var day = tomorrow.getDate();

    var task = {
      id: 'msft-update-test-001',
      user_id: TEST_USER_ID,
      text: 'Test Event Before Update MSFT',
      date: month + '/' + day,
      time: '11:00 AM',
      dur: 30,
      when: 'morning'
    };

    var result = await msftAdapter.createEvent(token, task, tomorrow.getFullYear(), TEST_TIMEZONE);
    createdEventIds.push(result.providerEventId);

    var updatedTask = Object.assign({}, task, { text: 'Test Event After Update MSFT' });
    await msftAdapter.updateEvent(token, result.providerEventId, updatedTask, tomorrow.getFullYear(), TEST_TIMEZONE);

    await waitForPropagation(2000);

    var fetched = await getMSFTEvent(token, result.providerEventId);
    expect(fetched).not.toBeNull();
    expect(fetched.subject).toBe('Test Event After Update MSFT');
  });
});

// ─── 7. deleteEvent ───

describe('MSFT adapter — deleteEvent', function () {
  it('should create an event, delete it, and verify it is gone', async function () {
    if (skipIfNoCreds()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    var month = tomorrow.getMonth() + 1;
    var day = tomorrow.getDate();

    var task = {
      id: 'msft-delete-test-001',
      user_id: TEST_USER_ID,
      text: 'Test Event To Delete MSFT',
      date: month + '/' + day,
      time: '1:00 PM',
      dur: 30,
      when: 'afternoon'
    };

    var result = await msftAdapter.createEvent(token, task, tomorrow.getFullYear(), TEST_TIMEZONE);

    await msftAdapter.deleteEvent(token, result.providerEventId);

    await waitForPropagation(2000);

    var fetched = await getMSFTEvent(token, result.providerEventId);
    expect(fetched).toBeNull();
  });
});

// ─── 8. batchCreateEvents ───

describe('MSFT adapter — batchCreateEvents', function () {
  it('should create 3 events in a batch and verify all exist', async function () {
    if (skipIfNoCreds()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    var month = tomorrow.getMonth() + 1;
    var day = tomorrow.getDate();
    var year = tomorrow.getFullYear();

    var pairs = [
      { task: { id: 'msft-batch-c1', user_id: TEST_USER_ID, text: 'Test Event Batch MSFT 1', date: month + '/' + day, time: '9:00 AM', dur: 15, when: 'morning' } },
      { task: { id: 'msft-batch-c2', user_id: TEST_USER_ID, text: 'Test Event Batch MSFT 2', date: month + '/' + day, time: '9:30 AM', dur: 15, when: 'morning' } },
      { task: { id: 'msft-batch-c3', user_id: TEST_USER_ID, text: 'Test Event Batch MSFT 3', date: month + '/' + day, time: '10:00 AM', dur: 15, when: 'morning' } }
    ];

    var results = await msftAdapter.batchCreateEvents(token, pairs, year, TEST_TIMEZONE);

    expect(results).toHaveLength(3);
    for (var i = 0; i < results.length; i++) {
      expect(results[i].error).toBeNull();
      expect(results[i].providerEventId).toBeTruthy();
      createdEventIds.push(results[i].providerEventId);
    }

    await waitForPropagation(2000);

    for (var j = 0; j < results.length; j++) {
      var fetched = await getMSFTEvent(token, results[j].providerEventId);
      expect(fetched).not.toBeNull();
      expect(fetched.subject).toContain('Test Event Batch MSFT');
    }
  });
});

// ─── 9. batchDeleteEvents ───

describe('MSFT adapter — batchDeleteEvents', function () {
  it('should delete 3 events in a batch', async function () {
    if (skipIfNoCreds()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    var month = tomorrow.getMonth() + 1;
    var day = tomorrow.getDate();
    var year = tomorrow.getFullYear();

    var pairs = [
      { task: { id: 'msft-batch-d1', user_id: TEST_USER_ID, text: 'Test Event BatchDel MSFT 1', date: month + '/' + day, time: '2:00 PM', dur: 15, when: 'afternoon' } },
      { task: { id: 'msft-batch-d2', user_id: TEST_USER_ID, text: 'Test Event BatchDel MSFT 2', date: month + '/' + day, time: '2:30 PM', dur: 15, when: 'afternoon' } },
      { task: { id: 'msft-batch-d3', user_id: TEST_USER_ID, text: 'Test Event BatchDel MSFT 3', date: month + '/' + day, time: '3:00 PM', dur: 15, when: 'afternoon' } }
    ];

    var created = await msftAdapter.batchCreateEvents(token, pairs, year, TEST_TIMEZONE);
    var eventIds = created.map(function (r) { return r.providerEventId; });

    await waitForPropagation(1000);

    var deleteResults = await msftAdapter.batchDeleteEvents(token, eventIds);

    expect(deleteResults).toHaveLength(3);
    for (var i = 0; i < deleteResults.length; i++) {
      expect(deleteResults[i].error).toBeNull();
    }

    await waitForPropagation(2000);

    for (var j = 0; j < eventIds.length; j++) {
      var fetched = await getMSFTEvent(token, eventIds[j]);
      expect(fetched).toBeNull();
    }
  });
});

// ─── 10. batchUpdateEvents ───

describe('MSFT adapter — batchUpdateEvents', function () {
  it('should create 3 events, batch update titles, and verify', async function () {
    if (skipIfNoCreds()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    var month = tomorrow.getMonth() + 1;
    var day = tomorrow.getDate();
    var year = tomorrow.getFullYear();

    var pairs = [
      { task: { id: 'msft-batch-u1', user_id: TEST_USER_ID, text: 'Test Event BatchUpd MSFT 1', date: month + '/' + day, time: '4:00 PM', dur: 15, when: 'afternoon' } },
      { task: { id: 'msft-batch-u2', user_id: TEST_USER_ID, text: 'Test Event BatchUpd MSFT 2', date: month + '/' + day, time: '4:30 PM', dur: 15, when: 'afternoon' } },
      { task: { id: 'msft-batch-u3', user_id: TEST_USER_ID, text: 'Test Event BatchUpd MSFT 3', date: month + '/' + day, time: '5:00 PM', dur: 15, when: 'afternoon' } }
    ];

    var created = await msftAdapter.batchCreateEvents(token, pairs, year, TEST_TIMEZONE);
    for (var i = 0; i < created.length; i++) {
      createdEventIds.push(created[i].providerEventId);
    }

    await waitForPropagation(1000);

    var updatePairs = created.map(function (r, idx) {
      return {
        eventId: r.providerEventId,
        task: Object.assign({}, pairs[idx].task, { text: 'Test Event Updated MSFT ' + (idx + 1) })
      };
    });

    var updateResults = await msftAdapter.batchUpdateEvents(token, updatePairs, year, TEST_TIMEZONE);

    expect(updateResults).toHaveLength(3);
    for (var k = 0; k < updateResults.length; k++) {
      expect(updateResults[k].error).toBeNull();
    }

    await waitForPropagation(2000);

    for (var j = 0; j < created.length; j++) {
      var fetched = await getMSFTEvent(token, created[j].providerEventId);
      expect(fetched).not.toBeNull();
      expect(fetched.subject).toContain('Test Event Updated MSFT');
    }
  });
});

// ─── 11. listEvents ───

describe('MSFT adapter — listEvents', function () {
  it('should create 2 events and list them in the correct time window', async function () {
    if (skipIfNoCreds()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 3);
    var month = tomorrow.getMonth() + 1;
    var day = tomorrow.getDate();
    var year = tomorrow.getFullYear();

    var task1 = { id: 'msft-list-1', user_id: TEST_USER_ID, text: 'Test Event List MSFT A', date: month + '/' + day, time: '8:00 AM', dur: 30, when: 'morning' };
    var task2 = { id: 'msft-list-2', user_id: TEST_USER_ID, text: 'Test Event List MSFT B', date: month + '/' + day, time: '8:30 AM', dur: 30, when: 'morning' };

    var r1 = await msftAdapter.createEvent(token, task1, year, TEST_TIMEZONE);
    var r2 = await msftAdapter.createEvent(token, task2, year, TEST_TIMEZONE);
    createdEventIds.push(r1.providerEventId);
    createdEventIds.push(r2.providerEventId);

    await waitForPropagation(2000);

    var windowStart = new Date(year, month - 1, day, 0, 0, 0);
    var windowEnd = new Date(year, month - 1, day, 23, 59, 59);
    var events = await msftAdapter.listEvents(token, windowStart.toISOString(), windowEnd.toISOString());

    var titles = events.map(function (e) { return e.title; });
    expect(titles).toContain('Test Event List MSFT A');
    expect(titles).toContain('Test Event List MSFT B');

    // Verify normalized shape
    var found = events.find(function (e) { return e.title === 'Test Event List MSFT A'; });
    expect(found.id).toBeTruthy();
    expect(found.startDateTime).toBeTruthy();
    expect(found.isAllDay).toBe(false);
  });
});

// ─── 12. hasChanges ───

describe('MSFT adapter — hasChanges', function () {
  it('should report hasChanges when no delta link exists', async function () {
    if (skipIfNoCreds()) return;

    // With no delta link, hasChanges should return true (needs full sync)
    var user = { id: TEST_USER_ID, msft_cal_delta_link: null };
    var result = await msftAdapter.hasChanges(token, user);

    expect(result.hasChanges).toBe(true);
  });
});
