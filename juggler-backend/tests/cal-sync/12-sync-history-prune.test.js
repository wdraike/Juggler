/**
 * 12-sync-history-prune.test.js — Inline sync_history retention prune (D-11 + D-13)
 *
 * Verifies that at the end of each sync run:
 *   • sync_history rows older than 7 days are deleted (D-11)
 *   • the delete is scoped to the syncing user only — other users' rows are preserved (D-13)
 *
 * Uses a stub gcal adapter (no network) so sync() reaches the write transaction
 * with empty buffers. The pre-seeded sync_history rows are then verified after the
 * write transaction's prune queries run.
 */

jest.setTimeout(60000);

var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.test') });

// ─── Mocks ──────────────────────────────────────────────────────────────────
// Mock the scheduler queue + SSE emitter so sync() doesn't enqueue real work.
jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn()
}));
jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn()
}));

// Replace the cal-adapters registry with a stub gcal adapter so the controller
// reaches the write transaction (and thus the D-09/D-13 prunes) without real
// network traffic.
jest.mock('../../src/lib/cal-adapters', () => {
  var fakeGcal = {
    providerId: 'gcal',
    isConnected: function(user) { return !!user && !!user.gcal_refresh_token; },
    getValidAccessToken: function() { return Promise.resolve('fake-access-token'); },
    listEvents: function() { return Promise.resolve([]); },
    hasChanges: function() { return Promise.resolve({ hasChanges: false }); },
    normalizeEvent: function(raw) { return raw; },
    eventHash: function() { return 'h'; },
    applyEventToTaskFields: function() { return {}; },
    buildEventBody: function() { return {}; },
    createEvent: function() { return Promise.resolve({ id: 'ev', raw: {} }); },
    updateEvent: function() { return Promise.resolve({}); },
    deleteEvent: function() { return Promise.resolve(); },
    batchCreateEvents: function() { return Promise.resolve([]); },
    batchDeleteEvents: function() { return Promise.resolve([]); },
    batchUpdateEvents: function() { return Promise.resolve([]); },
    getEventIdColumn: function() { return 'gcal_event_id'; },
    getLastSyncedColumn: function() { return 'gcal_last_synced_at'; }
  };
  var adapters = { gcal: fakeGcal };
  return {
    getAllAdapters: function() { return [fakeGcal]; },
    getConnectedAdapters: function(user) {
      return [fakeGcal].filter(function(a) { return a.isConnected(user); });
    },
    getAdapter: function(id) { return adapters[id] || null; },
    registerAdapter: function() {}
  };
});

var db = require('../../src/db');
var { sync } = require('../../src/controllers/cal-sync.controller');

var TEST_TIMEZONE = 'America/New_York';
var USER_PRIMARY = 'd13-prune-user-primary';
var USER_OTHER = 'd13-prune-user-other';

var _dbAvailable = null;
async function isDbAvailable() {
  if (_dbAvailable !== null) return _dbAvailable;
  try {
    await db.raw('SELECT 1');
    _dbAvailable = true;
  } catch (e) {
    console.warn('Test DB not available:', e.message);
    _dbAvailable = false;
  }
  return _dbAvailable;
}

function skipIfNoDB(fn) {
  return async () => {
    if (!await isDbAvailable()) return;
    await fn();
  };
}

async function seedUser(id) {
  await db('users').where('id', id).del();
  await db('users').insert({
    id: id,
    email: id + '@test.com',
    name: 'Prune Test ' + id,
    timezone: TEST_TIMEZONE,
    gcal_refresh_token: 'fake-refresh-' + id,
    gcal_access_token: null,
    gcal_token_expiry: null,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
  return db('users').where('id', id).first();
}

async function insertHistoryRow(userId, ageDays) {
  var ts = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
  var rows = await db('sync_history').insert({
    user_id: userId,
    sync_run_id: 'run-' + userId + '-' + ageDays,
    provider: 'gcal',
    action: 'pushed',
    task_id: null,
    task_text: 'age=' + ageDays + 'd',
    event_id: null,
    created_at: ts
  });
  return rows[0];
}

function mockReq(user) {
  return {
    user: user,
    headers: { 'x-timezone': TEST_TIMEZONE },
    params: {},
    query: {},
    body: {}
  };
}

function mockRes() {
  var res = {
    statusCode: 200,
    _json: null,
    status: function(c) { res.statusCode = c; return res; },
    json: function(d) { res._json = d; return res; }
  };
  return res;
}

async function cleanupAll() {
  for (var uid of [USER_PRIMARY, USER_OTHER]) {
    await db('sync_history').where('user_id', uid).del();
    await db('cal_sync_ledger').where('user_id', uid).del();
    await db('sync_locks').where('user_id', uid).del();
    await db('task_instances').where('user_id', uid).del();
    await db('task_masters').where('user_id', uid).del();
    await db('users').where('id', uid).del();
  }
}

beforeAll(async () => {
  if (!await isDbAvailable()) return;
  await cleanupAll();
});

afterEach(async () => {
  if (!await isDbAvailable()) return;
  // Wipe history + ledger + locks between tests, but keep users.
  for (var uid of [USER_PRIMARY, USER_OTHER]) {
    await db('sync_history').where('user_id', uid).del();
    await db('cal_sync_ledger').where('user_id', uid).del();
    await db('sync_locks').where('user_id', uid).del();
  }
});

afterAll(async () => {
  if (!await isDbAvailable()) return;
  await cleanupAll();
  await db.destroy();
});

describe('Inline sync_history prune at end of sync run (D-11)', () => {

  test('rows older than 7 days are deleted for the syncing user after sync', skipIfNoDB(async () => {
    var user = await seedUser(USER_PRIMARY);

    var oldId = await insertHistoryRow(USER_PRIMARY, 8);   // > 7d → must be pruned
    var newId = await insertHistoryRow(USER_PRIMARY, 6);   // < 7d → must remain

    var res = mockRes();
    await sync(mockReq(user), res);

    // Sync must have entered the write transaction. A 200 status confirms it didn't
    // bail out at the early-exit branches (no connected adapters / lock failure / timeout).
    expect(res.statusCode).toBe(200);

    var oldRow = await db('sync_history').where('id', oldId).first();
    var newRow = await db('sync_history').where('id', newId).first();

    expect(oldRow).toBeFalsy(); // 8-day-old row must be gone
    expect(newRow).toBeTruthy(); // 6-day-old row must remain
  }));

  test('boundary: rows just under 7 days survive; rows just over 7 days are pruned', skipIfNoDB(async () => {
    var user = await seedUser(USER_PRIMARY);
    var insideId = await insertHistoryRow(USER_PRIMARY, 6.9);
    var outsideId = await insertHistoryRow(USER_PRIMARY, 7.1);

    var res = mockRes();
    await sync(mockReq(user), res);
    expect(res.statusCode).toBe(200);

    var inside = await db('sync_history').where('id', insideId).first();
    var outside = await db('sync_history').where('id', outsideId).first();
    expect(inside).toBeTruthy();
    expect(outside).toBeFalsy();
  }));

});

describe('Inline sync_history prune is per-user scoped (D-13)', () => {

  test('old rows for OTHER users are NOT touched when a different user syncs', skipIfNoDB(async () => {
    var primary = await seedUser(USER_PRIMARY);
    await seedUser(USER_OTHER);

    // Primary user — has a stale row that should be pruned by their own sync.
    var primaryOld = await insertHistoryRow(USER_PRIMARY, 14);
    // Other user — also has a stale row, but their sync is NOT running here.
    var otherOld = await insertHistoryRow(USER_OTHER, 14);
    var otherNew = await insertHistoryRow(USER_OTHER, 1);

    var res = mockRes();
    await sync(mockReq(primary), res);
    expect(res.statusCode).toBe(200);

    // Primary's old row gone (own-user prune fired)
    var primaryFound = await db('sync_history').where('id', primaryOld).first();
    expect(primaryFound).toBeFalsy();

    // Other user's rows untouched (different user_id — outside the WHERE clause)
    var otherOldFound = await db('sync_history').where('id', otherOld).first();
    var otherNewFound = await db('sync_history').where('id', otherNew).first();
    expect(otherOldFound).toBeTruthy();
    expect(otherNewFound).toBeTruthy();
  }));

});
