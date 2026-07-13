/**
 * JUG-FACADE-DB-VIOLATIONS stage 2 — db-backed pin for checkAndIncrement,
 * moved verbatim from user-config/facade.js (L394-415) into
 * adapters/KnexPlanUsageRepository.js.
 *
 * Pins the entitlement-metering contract (999.1516 risk register):
 *  - fresh (user, key, period) row → INSERT with count 1
 *  - existing row → single-statement ON DUPLICATE KEY atomic increment
 *  - allowed boundary is count <= limit (inclusive)
 *  - limit_value refreshed to the CURRENT limit on every call
 *
 * Requires: test-bed DB at 127.0.0.1:3407 (make test-juggler[-pool]).
 */

'use strict';

var db = require('../../../../src/db');
var { assertDbAvailable } = require('../../../helpers/requireDB');
var planUsage = require('../../../../src/slices/user-config/adapters/KnexPlanUsageRepository');

jest.mock('../../../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
}));

var USER_ID = 'knex-plan-usage-user-001';
var KEY = 'ai_commands_per_month';
var START = '2026-07-01 00:00:00';
var END = '2026-08-01 00:00:00';
var available = false;

async function cleanup() {
  await db('plan_usage').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
}

beforeAll(async () => {
  await assertDbAvailable();
  available = true;
  await cleanup();
  await db('users').insert({
    id: USER_ID, email: 'planusage@test.com', name: 'Plan Usage',
    timezone: 'America/New_York', created_at: db.fn.now(), updated_at: db.fn.now()
  });
}, 20000);

beforeEach(async () => {
  await db('plan_usage').where('user_id', USER_ID).del();
});

afterAll(async () => {
  if (available) await cleanup();
  await db.destroy();
});

describe('KnexPlanUsageRepository.checkAndIncrement', () => {
  test('fresh row inserts count 1 and allows under the limit', async () => {
    var res = await planUsage.checkAndIncrement(USER_ID, KEY, 5, START, END);
    expect(res).toEqual({ allowed: true, currentCount: 1, limit: 5 });
  });

  test('repeat calls atomically increment; allowed is inclusive at the limit', async () => {
    var res;
    for (var i = 1; i <= 3; i++) {
      res = await planUsage.checkAndIncrement(USER_ID, KEY, 3, START, END);
    }
    expect(res).toEqual({ allowed: true, currentCount: 3, limit: 3 }); // count == limit still allowed
    res = await planUsage.checkAndIncrement(USER_ID, KEY, 3, START, END);
    expect(res).toEqual({ allowed: false, currentCount: 4, limit: 3 });
  });

  test('concurrent calls never lose an increment (single-statement upsert atomicity)', async () => {
    var N = 8;
    await Promise.all(Array.from({ length: N }, function () {
      return planUsage.checkAndIncrement(USER_ID, KEY, 100, START, END);
    }));
    var row = await db('plan_usage').where({ user_id: USER_ID, usage_key: KEY }).first();
    expect(Number(row.count)).toBe(N); // read-then-write regression would lose increments
  });

  test('limit_value refreshes to the current limit on every call (plan upgrades apply immediately)', async () => {
    await planUsage.checkAndIncrement(USER_ID, KEY, 3, START, END);
    var res = await planUsage.checkAndIncrement(USER_ID, KEY, 10, START, END);
    expect(res.limit).toBe(10);
    var row = await db('plan_usage').where({ user_id: USER_ID, usage_key: KEY }).first();
    expect(Number(row.limit_value)).toBe(10);
    expect(Number(row.count)).toBe(2);
  });
});
