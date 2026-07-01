/**
 * W1 Characterization tests — hasChanges(req, res)
 * cal-sync.controller.js:2287-2353
 *
 * PRE-REFACTOR BASELINE (999.942 W1). Pins the CURRENT behavior of the
 * exported `hasChanges` handler so the extraction into the calendar slice
 * facade can be proven byte-for-byte identical afterward. All tests call the
 * REAL exported handler directly (not through supertest).
 *
 * PASS-2 FIX (ernie CODE-REVIEW.md BLOCK, 999.942): the original version of
 * this file wholesale-mocked `slices/calendar/facade.js` and the mock
 * REIMPLEMENTED `countLocalChangesSince` inline as a copy of the query chain
 * — so the test could never catch a regression in the REAL facade function
 * (e.g. a dropped `.whereNotNull()`, a wrong table/column). Fixed: the facade
 * is now PARTIAL-mocked — only `getConnectedAdapters` (and the individual
 * per-adapter `hasChanges`/`getValidAccessToken` methods, constructed by each
 * test) are mocked; `countLocalChangesSince` is the REAL function from
 * `src/slices/calendar/facade.js`, executed against the real test-bed MySQL
 * (127.0.0.1:3407 / juggler_test) via real `task_masters`/`task_instances`
 * rows. The local-changes tests (W1-7, W1-8, W1-10, W1-11) now seed real
 * rows and assert on the REAL query's filtering behavior (e.g. W1-8 proves
 * the "most recent of the three provider timestamps" selection by seeding a
 * row that must be EXCLUDED under the correct timestamp and INCLUDED under a
 * wrong one — a real regression in the facade query would flip the count).
 *
 * Traceability: TRACEABILITY.md B1 (W1 column).
 *
 * Matrix covered:
 *   W1-1  0 connected adapters (early-return shape)
 *   W1-2  adapter without .hasChanges support (assume-changes fallback)
 *   W1-3  adapter with hasChanges=true
 *   W1-4  adapter with hasChanges=false (no other signal → overall false)
 *   W1-5  adapter throwing a RE_AUTH_ERR-matching error → tokenExpired
 *   W1-6  adapter throwing a non-auth error → surfaced as hasChanges+error
 *   W1-7  local-changes-only: a connected adapter reports hasChanges:false,
 *         but real DB rows updated since the most-recent of gcal/msft/apple
 *         last-synced timestamps flips the overall result (REAL DB read)
 *   W1-8  local-changes timestamp selection uses the MOST RECENT of the three
 *         provider timestamps (msft newer than gcal) — proven against REAL
 *         seeded rows straddling the two candidate cutoffs
 *   W1-9  mixed adapters (one true, one false) → overall hasChanges true,
 *         both provider entries present
 *   W1-10 zero local-changes count (cnt=0, no matching real rows) does not
 *         flip hasChanges/localChanges
 *   W1-11 CHARACTERIZATION DISCOVERY: hasChanges(req,res) has an EARLY RETURN
 *         at connectedAdapters.length===0 (line 2290-2292) — the local-changes
 *         DB check is UNREACHABLE with zero adapters, even with a stale
 *         last-synced timestamp AND a real matching row seeded in the DB.
 *         Pinned as current behavior; not asserted to be correct/incorrect
 *         (out of scope for a refactor characterization pass — flagged to
 *         Oscar as an INFO finding).
 *   W1-12 outer catch — getConnectedAdapters throws synchronously → 500
 */

'use strict';

var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.test') });

var crypto = require('crypto');

jest.mock('../../../src/lib/sse-emitter', () => ({ emit: jest.fn(), addClient: jest.fn() }));
jest.mock('../../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
}));
jest.mock('../../../src/lib/sync-lock', () => ({
  withSyncLock: (fn) => fn,
  acquireLock: jest.fn(() => Promise.resolve(true)),
  releaseLock: jest.fn(() => Promise.resolve()),
  refreshLock: jest.fn(() => Promise.resolve())
}));

// PARTIAL mock of the calendar facade: only `getConnectedAdapters` is
// replaced. `countLocalChangesSince` (and every other export) is the REAL
// jest.requireActual implementation, so it runs the real query against the
// real test-bed DB — this is the fix for ernie's finding (no reimplemented
// query logic inside a mock).
var mockGetConnectedAdapters = jest.fn();
jest.mock('../../../src/slices/calendar/facade', () => {
  var actual = jest.requireActual('../../../src/slices/calendar/facade');
  return Object.assign({}, actual, {
    getConnectedAdapters: (...args) => mockGetConnectedAdapters(...args)
  });
});

var { hasChanges } = require('../../../src/controllers/cal-sync.controller');
var { requireDB, assertDbAvailable } = require('../../helpers/requireDB');
// Real db connection — the SAME singleton the real facade's
// countLocalChangesSince uses internally (src/db.js -> lib/db.getDefaultDb()).
var db = require('../../../src/db');

var USER_ID = '999942-w1-charz-user';

function makeUser(overrides) {
  return Object.assign({
    id: USER_ID,
    gcal_last_synced_at: null,
    msft_cal_last_synced_at: null,
    apple_cal_last_synced_at: null
  }, overrides || {});
}

function makeRes() {
  return { json: jest.fn(), status: jest.fn().mockReturnThis() };
}

async function seedUser() {
  await db('users').where('id', USER_ID).del();
  await db('users').insert({
    id: USER_ID,
    email: USER_ID + '@test.com',
    name: 'W1 Characterization User',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
}

async function cleanupTasks() {
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
}

/**
 * Seed one real task_masters + task_instances row for USER_ID with an
 * explicit `updated_at` (the column countLocalChangesSince filters on) and a
 * non-null `scheduled_at` (required by the real query's `.whereNotNull`).
 */
async function insertLocalChangeRow(updatedAt) {
  var masterId = 'w1-master-' + crypto.randomBytes(6).toString('hex');
  var instanceId = 'w1-inst-' + crypto.randomBytes(6).toString('hex');
  await db('task_masters').insert({
    id: masterId,
    user_id: USER_ID,
    text: 'W1 local-change fixture',
    dur: 30,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
  await db('task_instances').insert({
    id: instanceId,
    master_id: masterId,
    user_id: USER_ID,
    scheduled_at: new Date('2026-06-01T09:00:00Z'),
    created_at: updatedAt,
    updated_at: updatedAt
  });
  return instanceId;
}

beforeAll(async () => {
  await assertDbAvailable();
  await seedUser();
});

afterEach(async () => {
  await cleanupTasks();
  jest.clearAllMocks();
});

afterAll(async () => {
  await cleanupTasks();
  await db('users').where('id', USER_ID).del();
  await db.destroy();
});

describe('W1: hasChanges(req, res) — characterization (pre-refactor baseline)', () => {
  it('W1-1: 0 connected adapters → { hasChanges: false, providers: {} }, no DB call made', requireDB(async () => {
    mockGetConnectedAdapters.mockReturnValue([]);
    const req = { user: makeUser() };
    const res = makeRes();

    await hasChanges(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ hasChanges: false, providers: {} });
  }));

  it('W1-2: adapter without .hasChanges → assume-changes fallback with reason', requireDB(async () => {
    mockGetConnectedAdapters.mockReturnValue([
      { providerId: 'apple' /* no .hasChanges method */ }
    ]);
    const req = { user: makeUser() };
    const res = makeRes();

    await hasChanges(req, res);

    expect(res.json).toHaveBeenCalledWith({
      hasChanges: true,
      providers: { apple: { hasChanges: true, reason: 'no_sync_token_support' } }
    });
  }));

  it('W1-3: adapter with hasChanges=true → surfaced verbatim, overall true', requireDB(async () => {
    const checkResult = { hasChanges: true, changedCalendars: ['primary'] };
    mockGetConnectedAdapters.mockReturnValue([
      {
        providerId: 'gcal',
        getValidAccessToken: jest.fn().mockResolvedValue('tok-gcal'),
        hasChanges: jest.fn().mockResolvedValue(checkResult)
      }
    ]);
    const req = { user: makeUser() };
    const res = makeRes();

    await hasChanges(req, res);

    expect(res.json).toHaveBeenCalledWith({
      hasChanges: true,
      providers: { gcal: checkResult }
    });
  }));

  it('W1-4: adapter with hasChanges=false and no local changes → overall false', requireDB(async () => {
    const checkResult = { hasChanges: false };
    mockGetConnectedAdapters.mockReturnValue([
      {
        providerId: 'msft',
        getValidAccessToken: jest.fn().mockResolvedValue('tok-msft'),
        hasChanges: jest.fn().mockResolvedValue(checkResult)
      }
    ]);
    const req = { user: makeUser() };
    const res = makeRes();

    await hasChanges(req, res);

    expect(res.json).toHaveBeenCalledWith({
      hasChanges: false,
      providers: { msft: checkResult }
    });
  }));

  it('W1-5: adapter throws a RE_AUTH_ERR-matching error → tokenExpired:true, hasChanges:false for that provider', requireDB(async () => {
    mockGetConnectedAdapters.mockReturnValue([
      {
        providerId: 'gcal',
        getValidAccessToken: jest.fn().mockRejectedValue(new Error('invalid_grant: token expired')),
        hasChanges: jest.fn()
      }
    ]);
    const req = { user: makeUser() };
    const res = makeRes();

    await hasChanges(req, res);

    expect(res.json).toHaveBeenCalledWith({
      hasChanges: false,
      providers: { gcal: { hasChanges: false, tokenExpired: true } }
    });
  }));

  it('W1-6: adapter throws a non-auth error → surfaced as hasChanges:true with the raw error message', requireDB(async () => {
    mockGetConnectedAdapters.mockReturnValue([
      {
        providerId: 'apple',
        getValidAccessToken: jest.fn().mockResolvedValue('tok-apple'),
        hasChanges: jest.fn().mockRejectedValue(new Error('CalDAV 500 Internal Server Error'))
      }
    ]);
    const req = { user: makeUser() };
    const res = makeRes();

    await hasChanges(req, res);

    expect(res.json).toHaveBeenCalledWith({
      hasChanges: true,
      providers: { apple: { hasChanges: true, error: 'CalDAV 500 Internal Server Error' } }
    });
  }));

  it('W1-7: local-changes-only — connected adapter reports no changes, but REAL DB rows updated since last sync → hasChanges true + localChanges count', requireDB(async () => {
    mockGetConnectedAdapters.mockReturnValue([
      {
        providerId: 'gcal',
        getValidAccessToken: jest.fn().mockResolvedValue('tok-gcal'),
        hasChanges: jest.fn().mockResolvedValue({ hasChanges: false })
      }
    ]);
    const req = { user: makeUser({ gcal_last_synced_at: '2026-06-01 00:00:00' }) };
    const res = makeRes();

    // Two REAL rows updated after the last-synced cutoff — the real facade
    // query (whereNotNull(scheduled_at) + updated_at > cutoff) must count
    // both.
    await insertLocalChangeRow('2026-06-05 00:00:00');
    await insertLocalChangeRow('2026-06-06 00:00:00');

    await hasChanges(req, res);

    expect(res.json).toHaveBeenCalledWith({
      hasChanges: true,
      providers: { gcal: { hasChanges: false } },
      localChanges: 2
    });
  }));

  it('W1-8: local-changes timestamp selection uses the MOST RECENT of the three provider timestamps (msft newer than gcal) — proven against real seeded rows', requireDB(async () => {
    mockGetConnectedAdapters.mockReturnValue([
      {
        providerId: 'msft',
        getValidAccessToken: jest.fn().mockResolvedValue('tok-msft'),
        hasChanges: jest.fn().mockResolvedValue({ hasChanges: false })
      }
    ]);
    const req = {
      user: makeUser({
        gcal_last_synced_at: '2026-05-01 00:00:00',
        msft_cal_last_synced_at: '2026-06-15 00:00:00', // most recent — should be used
        apple_cal_last_synced_at: '2026-04-01 00:00:00'
      })
    };
    const res = makeRes();

    // Rows A1/A2: updated AFTER gcal's (older) timestamp but BEFORE msft's
    // (most recent) timestamp. If the real query correctly uses msft's
    // cutoff, BOTH must be EXCLUDED (localChanges stays 1, from row B below).
    // If a regression made it fall back to gcal's (or the earliest)
    // timestamp — or flipped the comparison direction — these would be
    // wrongly included/excluded and localChanges would read 3 or 2 instead
    // of 1. Two "before" rows (vs. one "after") makes a comparison-direction
    // flip produce a DIFFERENT count in both directions, so this pin cannot
    // coincidentally match under a reversed operator (self-mutation
    // verified: flipping `>` to `<` in the real facade flips this count).
    await insertLocalChangeRow('2026-05-18 00:00:00');
    await insertLocalChangeRow('2026-05-20 00:00:00');
    // Row B: updated AFTER msft's (most recent) timestamp — must be counted
    // under any correct-or-buggy timestamp selection.
    await insertLocalChangeRow('2026-06-20 00:00:00');

    await hasChanges(req, res);

    expect(res.json).toHaveBeenCalledWith({
      hasChanges: true,
      providers: { msft: { hasChanges: false } },
      localChanges: 1
    });
  }));

  it('W1-9: mixed adapters — one hasChanges:true, one hasChanges:false → overall true, both entries present', requireDB(async () => {
    mockGetConnectedAdapters.mockReturnValue([
      {
        providerId: 'gcal',
        getValidAccessToken: jest.fn().mockResolvedValue('tok-gcal'),
        hasChanges: jest.fn().mockResolvedValue({ hasChanges: true })
      },
      {
        providerId: 'msft',
        getValidAccessToken: jest.fn().mockResolvedValue('tok-msft'),
        hasChanges: jest.fn().mockResolvedValue({ hasChanges: false })
      }
    ]);
    const req = { user: makeUser() };
    const res = makeRes();

    await hasChanges(req, res);

    expect(res.json).toHaveBeenCalledWith({
      hasChanges: true,
      providers: {
        gcal: { hasChanges: true },
        msft: { hasChanges: false }
      }
    });
  }));

  it('W1-10: zero local-changes count (no real rows updated since last sync) does NOT flip hasChanges/localChanges (parseInt(cnt) > 0 guard)', requireDB(async () => {
    mockGetConnectedAdapters.mockReturnValue([
      {
        providerId: 'gcal',
        getValidAccessToken: jest.fn().mockResolvedValue('tok-gcal'),
        hasChanges: jest.fn().mockResolvedValue({ hasChanges: false })
      }
    ]);
    const req = { user: makeUser({ gcal_last_synced_at: '2026-06-01 00:00:00' }) };
    const res = makeRes();
    // Deliberately seed NOTHING — the real query must return cnt=0 for this
    // user, and the result must NOT carry a localChanges key.

    await hasChanges(req, res);

    expect(res.json).toHaveBeenCalledWith({
      hasChanges: false,
      providers: { gcal: { hasChanges: false } }
    });
  }));

  it('W1-11: 0 connected adapters short-circuits BEFORE the local-changes DB check (early-return, even with a REAL matching row seeded and a stale last-synced timestamp)', requireDB(async () => {
    mockGetConnectedAdapters.mockReturnValue([]);
    const req = { user: makeUser({ gcal_last_synced_at: '2020-01-01 00:00:00' }) };
    const res = makeRes();
    // Seed a REAL row that WOULD be counted (updated_at far after the stale
    // 2020 cutoff, scheduled_at non-null) if the local-changes DB check were
    // ever reached — this proves the early return short-circuits before the
    // query runs, not merely that no rows happen to match.
    await insertLocalChangeRow('2026-06-30 00:00:00');

    await hasChanges(req, res);

    // Exact-shape assertion: no `localChanges` key present despite real
    // matching data existing in the DB — confirms the DB path was never
    // reached.
    expect(res.json).toHaveBeenCalledWith({ hasChanges: false, providers: {} });
  }));

  it('W1-12: outer catch — getConnectedAdapters throws synchronously → 500 { error: "Failed to check for changes" }', requireDB(async () => {
    mockGetConnectedAdapters.mockImplementation(() => { throw new Error('facade blew up'); });
    const req = { user: makeUser() };
    const res = makeRes();

    await hasChanges(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to check for changes' });
  }));
});
