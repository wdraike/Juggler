/**
 * orphan-donemark-match-999-5274.test.js — 999.5274 regression guard.
 *
 * cal-sync's orphan-match (:1329 area) and possible-duplicate hint (:1475
 * area) compared a DECORATED provider title against a CLEAN stored task
 * title, so a DONE task's orphaned event never matched — the match missed
 * and control reached the orphan-DELETE branch, which calls the real
 * adapter.deleteEvent against the user's live calendar. This drives the
 * REAL sync() controller end-to-end against test-bed MySQL, with the
 * provider network boundary faked via the W4 golden-master harness's
 * ProviderSim (no real GCal credentials needed — the harness spies on the
 * adapter's own network methods, same technique 22-sync-declined-invite-
 * parity.test.js uses at the API layer).
 *
 * DESTRUCTIVE-PATH CAUTION (per dispatch): this is the one code path that
 * deletes events from a user's real calendar. The assertions below prove
 * BOTH directions — the fixed behavior (reclaim, event survives, ledger
 * relinks) AND, via the RED proof in the foreman's receipt, that reverting
 * the controller fix makes this test fail exactly the way 999.5274
 * describes (deleteEvent called, event removed).
 */

'use strict';

jest.setTimeout(30000);

jest.mock('../../src/scheduler/scheduleQueue', () => ({ enqueueScheduleRun: jest.fn() }));
jest.mock('../../src/lib/sse-emitter', () => ({ emit: jest.fn() }));

var {
  db, TEST_USER_ID, isDbAvailable, seedTestUser, destroyTestUser, mockReq, mockRes
} = require('./helpers/test-setup');
var { requireDB } = require('../helpers/requireDB');
var { makeTask } = require('./helpers/test-fixtures');
var { sync } = require('../../src/controllers/cal-sync.controller');
var H = require('./characterization/harness/syncGoldenHarness');

var NO_PROVIDERS = {
  gcal_refresh_token: null, gcal_access_token: null, gcal_token_expiry: null,
  msft_cal_refresh_token: null, msft_cal_access_token: null,
  apple_cal_username: null, apple_cal_password: null,
  apple_cal_server_url: null, apple_cal_calendar_url: null
};
var GCAL_ONLY = Object.assign({}, NO_PROVIDERS, { gcal_refresh_token: '5274-fake-gcal-refresh' });

var sim = new H.ProviderSim();

beforeAll(async () => {
  if (!(await isDbAvailable())) return;
  sim.install();
});

beforeEach(async () => {
  if (!(await isDbAvailable())) return;
  sim.reset();
  await destroyTestUser();
});

afterAll(async () => {
  sim.uninstall();
  if (await isDbAvailable()) await destroyTestUser();
  await db.destroy();
});

// A few minutes ago — NOT tomorrow. taskMappers.js's rowToTask (line ~461)
// clamps a TERMINAL task's scheduled_at to updated_at/now whenever the raw
// value is in the future ("terminal-status tasks must never appear in the
// future"), so a done task fixture scheduled for tomorrow silently reads
// back as scheduled TODAY — a real production invariant, not a test bug,
// but it means the calendar event's date must match what the DONE task
// reads back as, not the literal value written to the row. A few minutes in
// the past sidesteps the clamp entirely (sa < now already) while staying
// well inside today (isEventPast compares calendar DATE against midnight,
// not the exact clock instant, so this is not "past" for ingest purposes).
function recentMoment() {
  return new Date(Date.now() - 5 * 60000);
}

describe('999.5274 — orphan-match strips the done-mark before comparing titles', function () {
  it('reclaims (does NOT delete) an unlinked provider event whose title carries a done-mark the stored task text lacks', requireDB(async function () {
    var user = await seedTestUser(GCAL_ONLY);

    var task = await makeTask({
      text: 'Buy milk',
      scheduled_at: recentMoment(),
      dur: 30,
      when: 'morning',
      status: ''
    });

    // First sync: push creates the gcal event + ledger link. The W4 harness's
    // ProviderSim fakes createEvent at the NETWORK boundary (never calls the
    // real buildEventBody), so its fabricated event carries an empty
    // description — set the real marker text buildEventBody would have
    // composited ("Synced from Raike & Sons" is unconditionally appended)
    // directly, matching production shape without re-implementing the
    // adapter's push builder in the test.
    await sync(mockReq(user), mockRes());

    var ev = sim.store('gcal').find(function (e) { return e.title === 'Buy milk'; });
    expect(ev).toBeTruthy();
    var evId = ev.id;
    ev.description = '\nSynced from Raike & Sons';

    // The task completes and its link to THIS event is severed — the exact
    // "recurring instance regenerated with a new id" class ingest-event-
    // decision.js's orphan-delete branch documents. Ledger row dropped so
    // Phase 3b treats the still-live remote event as unclaimed; status
    // flipped to done on both master+instance (status lives on BOTH per
    // tasks-write.js's MASTER_FIELDS/INSTANCE_FIELDS comment).
    await db('task_masters').where({ id: task.id, user_id: TEST_USER_ID }).update({ status: 'done' });
    await db('task_instances').where({ id: task.id, user_id: TEST_USER_ID }).update({ status: 'done' });
    await db('cal_sync_ledger').where({ user_id: TEST_USER_ID, task_id: task.id }).del();

    // Simulate the provider-side echo of the done-mark this task's OWN next
    // real push would carry (999.5272's buildEventBody: applyDoneMark) — done
    // directly since severing the ledger above means no real repush happens
    // in this fixture.
    ev.title = '✓ ' + ev.title;

    await sync(mockReq(user), mockRes());

    var deleteCalls = sim.calls.gcal.filter(function (c) { return c.method === 'deleteEvent'; });
    expect(deleteCalls).toHaveLength(0);
    expect(sim.store('gcal').some(function (e) { return e.id === evId; })).toBe(true);

    var relinked = await db('cal_sync_ledger').where({ user_id: TEST_USER_ID, provider_event_id: evId }).first();
    expect(relinked).toBeTruthy();
    expect(relinked.task_id).toBe(task.id);
    expect(relinked.status).toBe('active');
  }));

  it('records a possible_duplicate hint when a genuinely NEW (non-Juggler-origin) event\'s decorated title matches a done task by date', requireDB(async function () {
    var user = await seedTestUser(GCAL_ONLY);

    // Done task, never linked/pushed — stored text is clean by design.
    var task = await makeTask({
      text: 'Buy milk',
      scheduled_at: recentMoment(),
      dur: 30,
      when: 'morning',
      status: 'done'
    });

    // A remote event with NO Juggler marker (genuinely external), same date,
    // decorated title — the possibleDupTask compare's own inputs.
    sim.store('gcal').push({
      id: 'ev-gcal-5274-dup-1',
      title: '✓ Buy milk',
      description: '',
      startDateTime: task.scheduled_at instanceof Date ? task.scheduled_at.toISOString() : new Date(String(task.scheduled_at).replace(' ', 'T') + 'Z').toISOString(),
      endDateTime: new Date(new Date(task.scheduled_at).getTime() + 30 * 60000).toISOString(),
      isAllDay: false,
      durationMinutes: 30,
      isTransparent: false,
      lastModified: '2026-01-01T00:00:00.000Z',
      _url: null, _etag: null, _raw: null
    });

    await sync(mockReq(user), mockRes());

    var hint = await db('sync_history')
      .where({ user_id: TEST_USER_ID, provider: 'gcal', action: 'possible_duplicate' })
      .first();
    expect(hint).toBeTruthy();
    expect(hint.detail).toContain(task.id);
  }));
});
