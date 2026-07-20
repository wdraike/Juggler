// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../../../../src/lib/audit-context').stampInsert(rows);
/**
 * JUG-FACADE-DB-VIOLATIONS stage 2b — db-backed pin for KnexImportRowClock.now(),
 * moved verbatim out of user-config/facade.js's importBuildTaskRow (the
 * created_at/updated_at server-clock source on the v7 import task-row path).
 *
 * Pins: now() resolves to a raw expression that, when written into a real
 * timestamp column, lands at the DB server's current time (not a JS Date, not
 * a string) — the exact `db.fn.now()` contract the legacy inline call had.
 *
 * Requires: test-bed DB at 127.0.0.1:3407 (make test-juggler[-pool]).
 */

'use strict';

var db = require('../../../../src/db');
var { assertDbAvailable } = require('../../../helpers/requireDB');
var importRowClock = require('../../../../src/slices/user-config/adapters/KnexImportRowClock');

jest.mock('../../../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
}));

var USER_ID = 'knex-import-row-clock-user-001';
var available = false;

async function cleanup() {
  await db('user_config').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
}

beforeAll(async () => {
  await assertDbAvailable();
  available = true;
  await cleanup();
  await db('users').insert(__stampFixture({
    id: USER_ID, email: 'importrowclock@test.com', name: 'Import Row Clock',
    timezone: 'America/New_York', created_at: db.fn.now(), updated_at: db.fn.now()
  }));
}, 20000);

afterAll(async () => {
  if (available) await cleanup();
  await db.destroy();
});

describe('KnexImportRowClock.now', () => {
  // mysql2 dateStrings:true returns tz-less strings; new Date(thatString) parses
  // LOCAL and fakes a tz offset vs process time (repo trap — see TRAPS.md "Dates
  // / time"). Comparing two now()-written values to EACH OTHER (both parsed with
  // the same bias) sidesteps that trap while still pinning the live-clock
  // contract: every call reflects the CURRENT db server time, not a value
  // captured once (e.g. at module load).
  test('is a live server clock — a later write is strictly later than an earlier one', async () => {
    await db('users').where('id', USER_ID).update({ updated_at: importRowClock.now() });
    var first = (await db('users').where('id', USER_ID).first()).updated_at;

    await db.raw('SELECT SLEEP(1.2)');

    await db('users').where('id', USER_ID).update({ updated_at: importRowClock.now() });
    var second = (await db('users').where('id', USER_ID).first()).updated_at;

    expect(new Date(second).getTime()).toBeGreaterThan(new Date(first).getTime());
  }, 15000);

  test('is a raw expression, not a JS Date or string, before the write', () => {
    var expr = importRowClock.now();
    expect(expr).not.toBeInstanceOf(Date);
    expect(typeof expr).not.toBe('string');
  });
});
