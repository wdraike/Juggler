/**
 * GCal adapter integration tests — runs against the real Google Calendar API.
 * Requires TEST_GCAL_REFRESH_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET in .env.test
 */

var {
  db, TEST_USER_ID, TEST_TIMEZONE,
  hasGCalCredentials, getGCalToken, seedTestUser, cleanupTestData, destroyTestUser
} = require('./helpers/test-setup');

var { assertDbAvailable } = require('../helpers/requireDB');

var { makeTask, makeGCalEvent, deleteGCalEvent, deleteAllGCalTestEvents } = require('./helpers/test-fixtures');
var { getGCalEvent, listGCalEvents, waitForPropagation } = require('./helpers/api-helpers');

var gcalAdapter = require('../../src/lib/cal-adapters/gcal.adapter');
var { PLACEMENT_MODES } = require('../../src/lib/placementModes');
var { describeWithCreds } = require('./helpers/credentialGate');

jest.setTimeout(30000);

var token = null;
var createdEventIds = [];
var skip = false;

beforeAll(async function () {
  // Date-only fake timers (999.2157): Date frozen, every timer API real — no hangs
  installDateOnlyFakeTimers(new Date('2026-01-15T12:00:00Z'));
  await assertDbAvailable();
  if (!hasGCalCredentials()) {
    skip = true;
    console.warn('Skipping GCal adapter tests — no credentials');
    return;
  }
  try {
    token = await getGCalToken();
  } catch (e) {
    throw new Error('[TEST-FR-002] GCal live credentials present but token/client acquisition failed: ' + e.message);
  }
  if (!token) {
    throw new Error('[TEST-FR-002] GCal live credentials present but could not acquire access token/client');
  }
  // Clean up any leftover test events from previous runs
  await deleteAllGCalTestEvents(token);
});

afterAll(async function () {
  jest.useRealTimers();
  if (skip) return;
  // Clean up all events created during tests
  for (var i = 0; i < createdEventIds.length; i++) {
    await deleteGCalEvent(token, createdEventIds[i]);
  }
  await deleteAllGCalTestEvents(token);
});

// ─── 1. normalizeEvent ───

describeWithCreds(hasGCalCredentials, 'GCal adapter — normalizeEvent', function () {
  it('should normalize a real GCal timed event to unified shape', async function () {
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
//
// 999.5271 (sync audit): eventHash is a PURE function over a hand-built event
// object — it needs neither live credentials nor a DB. It was gated behind
// hasGCalCredentials() like every other block in this file, so it never ran
// in CI/local/`make test-juggler` (RUN_LIVE_CALENDAR_TESTS is off by default —
// see test-setup.js). Verified clean (both assertions still hold against the
// current adapter) before un-gating.

describe('GCal adapter — eventHash', function () {
  it('should produce a consistent 64-char SHA-256 hex hash', function () {
    // 999.5271 (sync audit): the implementation uses SHA-256 (64 hex chars),
    // not MD5 (32 hex chars) — this assertion was stale (never ran; the
    // enclosing block was creds-gated). The historical VARCHAR(32) truncation
    // risk on cal_sync_ledger's hash columns (see 02-adapter-msft.test.js's
    // identical eventHash test comment) was already fixed by migration
    // 20260521000000_widen_cal_sync_ledger_hash_columns.js (widened to 64) —
    // confirmed by reading the migration, not assumed.
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

    expect(hash1).toHaveLength(64);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    expect(hash1).toBe(hash2);
  });

  it('should change when fields change', function () {
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
//
// 999.5271 (sync audit): buildEventBody is PURE (no network/DB) and was
// investigated for the same dark-test un-gating as eventHash above, but its
// "should build an all-day event body" case FAILED against the (then)
// current adapter (fixture sets only task.when='allday', no placement_mode;
// GCal's buildEventBody checked placement_mode/placementMode only — no
// legacy task.when==='allday' fallback, unlike
// MicrosoftCalendarAdapter.js's). That was a real cross-provider fork
// (TRAPS.md "Calendar adapters must stay behavior-identical").
//
// 999.5285: resolved. Reachability confirmed — taskToRow (taskMappers.js)
// only writes `row.when` when the incoming body explicitly includes it, so a
// caller that flips placement_mode away from ALL_DAY without also sending
// `when` (any non-WhenSection-UI writer, e.g. MCP/API update_task) leaves a
// stale when='allday' row with a non-all_day placement_mode — a real,
// reachable drift, not dead-fixture defensiveness. Fix: matched GCal/Apple's
// isAllDay check onto MSFT's (add the when==='allday' fallback), rather than
// removing it from MSFT — other app subsystems (scheduler skip-gate,
// AllDayBanner, CalendarView per cal-sync.controller.js's own comment) still
// treat `when==='allday'` as a legacy-but-live signal, so MSFT's stance was
// the more consistent one. Un-gated: every case in this block is pure
// (no network/DB) and now passes.

describe('GCal adapter — buildEventBody', function () {
  it('should build a timed event body', function () {
    var task = { id: 'test-1', text: 'Timed Task', date: '4/15', time: '2:30 PM', dur: 45, when: 'afternoon' };
    var body = gcalAdapter.buildEventBody(task, 2026, TEST_TIMEZONE);

    expect(body.summary).toBe('Timed Task');
    expect(body.start.dateTime).toContain('2026-04-15T14:30');
    expect(body.start.timeZone).toBe(TEST_TIMEZONE);
    expect(body.end.timeZone).toBe(TEST_TIMEZONE);
    expect(body.transparency).toBeUndefined();
  });

  it('should build an all-day event body', function () {
    var task = { id: 'test-2', text: 'All Day Task', date: '4/15', when: 'allday', dur: 30 };
    var body = gcalAdapter.buildEventBody(task, 2026, TEST_TIMEZONE);

    expect(body.start.date).toBe('2026-04-15');
    expect(body.end.date).toBe('2026-04-16');
    expect(body.start.dateTime).toBeUndefined();
  });

  it('should mark done tasks as transparent', function () {
    var task = { id: 'test-3', text: 'Done Task', date: '4/15', time: '9:00 AM', dur: 30, status: 'done', when: 'morning' };
    var body = gcalAdapter.buildEventBody(task, 2026, TEST_TIMEZONE);

    expect(body.summary).toContain('\u2713');
    expect(body.transparency).toBe('transparent');
  });

  it('should mark marker tasks as transparent', function () {
    var task = { id: 'test-4', text: 'Marker Task', date: '4/15', time: '9:00 AM', dur: 30, marker: true, when: 'morning' };
    var body = gcalAdapter.buildEventBody(task, 2026, TEST_TIMEZONE);

    expect(body.transparency).toBe('transparent');
  });
});

// ─── 4. applyEventToTaskFields ───
//
// 999.5284 (sync audit follow-up): applyEventToTaskFields is a PURE function
// (hand-built event + currentTask, no network/DB) — it was gated behind
// hasGCalCredentials() like every other block in this file and never ran in
// CI/local (RUN_LIVE_CALENDAR_TESTS is off by default — see test-setup.js).
// Un-gated after fixing 3 stale assertions found by direct node execution:
// (1) 'date_pinned' — the column was removed (TASK-PROPERTIES.md, 999.867 XOR
// invariant); placement_mode==='fixed' is the sole immovability signal now.
// (2) 'fields.marker' — applyEventToTaskFields hasn't set a `marker` field
// since 999.4671 (marker is now a computed tasks_v column derived from
// placement_mode==='reminder', not a stored write). (3) the allday-to-timed
// promotion test's currentTask fixture (see below) — verified NOT a code bug.

describe('GCal adapter — applyEventToTaskFields', function () {
  it('should promote to fixed when time changes', function () {
    var event = {
      title: 'Moved Task',
      startDateTime: '2026-04-15T14:00:00',
      endDateTime: '2026-04-15T14:30:00',
      isAllDay: false,
      durationMinutes: 30,
      isTransparent: false,
      description: ''
    };
    var currentTask = { when: 'morning', time: '9:00 AM', date: '2026-04-15' };
    var fields = gcalAdapter.applyEventToTaskFields(event, TEST_TIMEZONE, currentTask);

    expect(fields.placement_mode).toBe(PLACEMENT_MODES.FIXED);
  });

  it('should promote to fixed when date changes', function () {
    var event = {
      title: 'Date Moved',
      startDateTime: '2026-04-16T09:00:00',
      endDateTime: '2026-04-16T09:30:00',
      isAllDay: false,
      durationMinutes: 30,
      isTransparent: false,
      description: ''
    };
    var currentTask = { when: 'morning', time: '9:00 AM', date: '2026-04-15' };
    var fields = gcalAdapter.applyEventToTaskFields(event, TEST_TIMEZONE, currentTask);

    expect(fields.placement_mode).toBe(PLACEMENT_MODES.FIXED);
    // date_pinned column removed — placement_mode === 'fixed' is the sole immovability signal
    expect(fields.date_pinned).toBeUndefined();
  });

  // 999.5284 finding 3 (was AMBIGUOUS — resolved CODE-IS-RIGHT, fixture was stale):
  // the original fixture `currentTask = { when: 'allday', date: '2026-04-15' }`
  // (no `time`) never matches real production data, so the null->value time
  // transition guard (999.012: "a flexible task gaining its first computed
  // anchor is NOT a promotion trigger") always suppressed the promotion —
  // returning undefined, not FIXED. But a real all-day task's currentTask is
  // never built from a hand literal; it comes from rowToTask() (facade.js
  // allTasks map), and an all_day task's scheduled_at is stored at midnight
  // (applyEventToTaskFields's own ALL_DAY branch: `localToUtc(jd.date, '12:00
  // AM', tz)`), which rowToTask unconditionally converts to a NON-null
  // `time: '12:00 AM'` — confirmed by direct execution of the real insert ->
  // read -> rowToTask -> applyEventToTaskFields pipeline against test-bed
  // MySQL (999.5284 evidence), which returned placement_mode='fixed' for this
  // exact scenario once currentTask.time was populated realistically. So an
  // all-day task ALWAYS has a prior non-null time anchor once read via the
  // real mapper — the 999.012 guard's precondition is satisfied, and CAL-12
  // (SCHEDULER-SPEC.md: "a genuine date/time move promotes the task to
  // FIXED") + the live-creds integration test 'all-day -> timed -> promoted'
  // (14-sync-promotion.test.js) both already encode "promoted" as the correct
  // outcome. Fixture repaired to the realistic shape; code unchanged.
  it('should promote allday-to-timed to fixed', function () {
    var event = {
      title: 'Was AllDay',
      startDateTime: '2026-04-15T10:00:00',
      endDateTime: '2026-04-15T10:30:00',
      isAllDay: false,
      durationMinutes: 30,
      isTransparent: false,
      description: ''
    };
    var currentTask = { when: 'allday', date: '2026-04-15', time: '12:00 AM' };
    var fields = gcalAdapter.applyEventToTaskFields(event, TEST_TIMEZONE, currentTask);

    expect(fields.placement_mode).toBe(PLACEMENT_MODES.FIXED);
  });

  it('should not rewrite placement_mode when event loses transparency (no marker field written)', function () {
    var event = {
      title: 'Not Marker Anymore',
      startDateTime: '2026-04-15T10:00:00',
      endDateTime: '2026-04-15T10:30:00',
      isAllDay: false,
      durationMinutes: 30,
      isTransparent: false,
      description: ''
    };
    var currentTask = { when: 'fixed', placement_mode: 'reminder', date: '2026-04-15', time: '10:00 AM' };
    var fields = gcalAdapter.applyEventToTaskFields(event, TEST_TIMEZONE, currentTask);

    // 999.4671: losing transparency no longer rewrites placement at all — the
    // reminder is the user's Juggler-side choice. (This assertion was already
    // stale after 999.2030 flipped it to 'fixed'; it never ran because the
    // enclosing block was creds-gated. Also: applyEventToTaskFields hasn't set
    // a `marker` field since 999.4671 — marker is a computed tasks_v column.)
    expect(fields.placement_mode).toBeUndefined();
    expect(fields.marker).toBeUndefined();
  });

  // Regression guard: adapter must write snake_case `placement_mode`, not
  // camelCase `placementMode` — tasks-write.js splitUpdateFields routes only
  // snake_case keys, so camelCase would be silently dropped before reaching
  // the DB (no test-DB needed; pure shape assertion).
  it('writes snake_case placement_mode, never camelCase placementMode', function () {
    var event = {
      title: 'Promote Snake-Case',
      startDateTime: '2026-04-15T14:00:00',
      endDateTime: '2026-04-15T14:30:00',
      isAllDay: false,
      durationMinutes: 30,
      isTransparent: false,
      description: ''
    };
    var currentTask = { when: 'morning', time: '9:00 AM', date: '2026-04-15' };
    var fields = gcalAdapter.applyEventToTaskFields(event, 'America/New_York', currentTask);
    expect(fields.placement_mode).toBeDefined();
    expect(fields.placementMode).toBeUndefined();
  });
});

// ─── 4b. applyEventToTaskFields — REMINDER→FIXED combined scenario ───
//
// Block 3 (GCal): event was a REMINDER (transparent), now loses transparency AND
// date/time changes in the same sync. Must produce FIXED, not ANYTIME.

describe('GCal adapter — applyEventToTaskFields REMINDER→FIXED ordering', function () {
  it('formerly-reminder event with date/time change → placement_mode fixed (not anytime)', function () {
    // currentTask was synced as a REMINDER (transparent, placement_mode=reminder)
    var currentTask = { date: '2026-05-20', time: '9:00 AM', placement_mode: 'reminder' };

    // Event: no longer transparent, date+time changed.
    var event = {
      title: 'Formerly Reminder GCal',
      startDateTime: '2026-05-25T10:00:00',
      endDateTime: '2026-05-25T11:00:00',
      isAllDay: false,
      durationMinutes: 60,
      isTransparent: false,
      description: ''
    };

    var fields = gcalAdapter.applyEventToTaskFields(event, 'UTC', currentTask);

    // 999.4671 REVERSAL: transparency no longer creates reminders, so a synced
    // task in REMINDER is there because the USER chose it in Juggler — and a
    // provider-side reschedule is not a request to take that back. The move
    // still lands (scheduled_at), the placement is left alone.
    expect(fields.placement_mode).toBeUndefined();
    expect(fields.scheduled_at).toBeDefined();
  });
});

// ─── 5. createEvent + getEvent ───

describeWithCreds(hasGCalCredentials, 'GCal adapter — createEvent', function () {
  it('should create an event and verify via direct API', async function () {
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

describeWithCreds(hasGCalCredentials, 'GCal adapter — updateEvent', function () {
  it('should create an event, update title, and verify', async function () {
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

describeWithCreds(hasGCalCredentials, 'GCal adapter — deleteEvent', function () {
  it('should create an event, delete it, and verify it is gone', async function () {
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

describeWithCreds(hasGCalCredentials, 'GCal adapter — batchCreateEvents', function () {
  it('should create 3 events in a batch and verify all exist', async function () {
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

describeWithCreds(hasGCalCredentials, 'GCal adapter — batchDeleteEvents', function () {
  it('should delete 3 events in a batch', async function () {
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

describeWithCreds(hasGCalCredentials, 'GCal adapter — batchUpdateEvents', function () {
  it('should create 3 events, batch update titles, and verify', async function () {
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

describeWithCreds(hasGCalCredentials, 'GCal adapter — listEvents', function () {
  it('should create 2 events and list them in the correct time window', async function () {
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

describeWithCreds(hasGCalCredentials, 'GCal adapter — hasChanges', function () {
  it('should detect changes after creating a new event', async function () {
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

// ─── 13. buildEventBody — checkmark idempotency ───

describe('buildEventBody — checkmark idempotency', function () {
  it('should produce single checkmark when task is done and text has no prefix', function () {
    var task = { id: 'ck-1', text: 'My Task', date: '4/15', time: '9:00 AM', dur: 30, status: 'done', when: 'morning' };
    var body = gcalAdapter.buildEventBody(task, 2026, 'America/New_York');
    expect(body.summary).toBe('✓ My Task');
  });

  it('should strip one leading checkmark when task is done and text already has prefix', function () {
    var task = { id: 'ck-2', text: '✓ My Task', date: '4/15', time: '9:00 AM', dur: 30, status: 'done', when: 'morning' };
    var body = gcalAdapter.buildEventBody(task, 2026, 'America/New_York');
    expect(body.summary).toBe('✓ My Task');
    expect(body.summary).not.toBe('✓ ✓ My Task');
  });

  it('should strip multiple leading checkmarks when task is done', function () {
    var task = { id: 'ck-3', text: '✓ ✓ My Task', date: '4/15', time: '9:00 AM', dur: 30, status: 'done', when: 'morning' };
    var body = gcalAdapter.buildEventBody(task, 2026, 'America/New_York');
    expect(body.summary).toBe('✓ My Task');
  });

  it('should not add checkmark when task is active', function () {
    var task = { id: 'ck-4', text: 'My Task', date: '4/15', time: '9:00 AM', dur: 30, status: 'active', when: 'morning' };
    var body = gcalAdapter.buildEventBody(task, 2026, 'America/New_York');
    expect(body.summary).toBe('My Task');
  });
});
