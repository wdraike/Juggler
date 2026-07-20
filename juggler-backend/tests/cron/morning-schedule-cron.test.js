// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../../src/lib/audit-context').stampInsert(rows);
// Tests for morning-schedule-cron (999.1408).
//
// Root cause: unifiedScheduleV2's nowSlot gate is correct — it refuses to
// place anytime-flexible tasks before "now". But a schedule run only fires
// on user-mutation, so a user who makes no task edit until midday never
// gets a run while their morning work block is open, and nowSlot's
// snapshot at that first-of-the-day run permanently excludes the morning.
// morning-schedule-cron proactively enqueues one run per user shortly
// after their own local midnight so the day's first run happens before
// any work block opens.
const db = require('../helpers/test-db');
const MorningScheduleCron = require('../../src/jobs/morning-schedule-cron');

const TEST_USER_A = 'test-morningcron-a';
const TEST_USER_B = 'test-morningcron-b';

async function clearOurRows() {
  await db('users').whereIn('id', [TEST_USER_A, TEST_USER_B]).del();
  await db('cron_locks').where('lock_name', 'like', 'morning-schedule-cron%').del();
}

function fakeClock(nowMinsByTz) {
  return function getNowInTimezone(tz) {
    return { todayKey: '2026-07-08', nowMins: nowMinsByTz[tz] };
  };
}

describe('MorningScheduleCron', () => {
  beforeAll(async () => {
    if (!(await db.isAvailable())) throw new Error('Test database is not available');
  });
  beforeEach(clearOurRows);
  afterEach(clearOurRows);
  afterAll(async () => { await db.destroy(); });

  test('enqueues a run for a user within 15 min of local midnight, not for one at midday', async () => {
    await db('users').insert(__stampFixture([
      { id: TEST_USER_A, email: 'morningcron-a@test.local', timezone: 'Pacific/Auckland' },
      { id: TEST_USER_B, email: 'morningcron-b@test.local', timezone: 'America/New_York' }
    ]));
    const enqueueScheduleRun = jest.fn();
    const cron = new MorningScheduleCron({
      enqueueScheduleRun,
      getNowInTimezone: fakeClock({ 'Pacific/Auckland': 5, 'America/New_York': 780 })
    });

    await cron.sweep();

    const triggeredIds = enqueueScheduleRun.mock.calls.map(function(c) { return c[0]; });
    expect(triggeredIds).toContain(TEST_USER_A);
    expect(triggeredIds).not.toContain(TEST_USER_B);
  });

  test('does not enqueue twice for the same user on the same local day', async () => {
    await db('users').insert(__stampFixture({ id: TEST_USER_A, email: 'morningcron-a@test.local', timezone: 'Pacific/Auckland' }));
    const enqueueScheduleRun = jest.fn();
    const cron = new MorningScheduleCron({
      enqueueScheduleRun,
      getNowInTimezone: fakeClock({ 'Pacific/Auckland': 5 })
    });

    await cron.sweep();
    await cron.sweep();

    const triggeredCount = enqueueScheduleRun.mock.calls.filter(function(c) { return c[0] === TEST_USER_A; }).length;
    expect(triggeredCount).toBe(1);
  });

  test('re-enqueues once the local day rolls over to a new early-morning window', async () => {
    await db('users').insert(__stampFixture({ id: TEST_USER_A, email: 'morningcron-a@test.local', timezone: 'Pacific/Auckland' }));
    const enqueueScheduleRun = jest.fn();
    var todayKey = '2026-07-08';
    const cron = new MorningScheduleCron({
      enqueueScheduleRun,
      getNowInTimezone: function() { return { todayKey: todayKey, nowMins: 5 }; }
    });

    await cron.sweep();           // day 1, early — triggers
    todayKey = '2026-07-09';
    await cron.sweep();           // day 2, early — should trigger again (new local day)

    const triggeredCount = enqueueScheduleRun.mock.calls.filter(function(c) { return c[0] === TEST_USER_A; }).length;
    expect(triggeredCount).toBe(2);
  });
});
