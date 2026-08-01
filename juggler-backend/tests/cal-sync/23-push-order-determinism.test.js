/**
 * 23-push-order-determinism.test.js — 999.5074
 *
 * The cal-sync read of tasks_v carried no ORDER BY, so `allTasks` — and
 * therefore pushQueue, the batchCreateEvents payload order, and the order
 * cal_sync_ledger rows are INSERTED (their auto-increment ids) — was whatever
 * order MySQL felt like returning. It matched insert order on the dev boxes
 * and the other order in CI, where it showed up as a pure swap in W4 case N's
 * golden master (CI Gate run 30711870846).
 *
 * Pinning this needs care: "no ORDER BY" is UNSPECIFIED, not "reversed", so a
 * test can only be reliably RED if the unordered result is predictable. It is
 * for this fixture — the plan drives off task_instances_user_id_date_index
 * (user_id, date), makeTask leaves `date` NULL on both rows, so they tie there
 * and fall through to the primary-key suffix. The ids below therefore sort
 * OPPOSITE to scheduled_at ('ord-a' is the LATER task), and pre-fix the read
 * yields ['ord-a','ord-b'] (RED). Post-fix the ORDER BY decides and the plan
 * stops mattering — so this is a RED that a future optimizer change could
 * quietly turn green; it is the fix's guard, not its only justification.
 *
 * Ordering is asserted on the adapter's own call payload, which is what
 * actually reaches the calendar.
 */
jest.setTimeout(60000);
jest.mock('../../src/scheduler/scheduleQueue', () => ({ enqueueScheduleRun: jest.fn() }));
jest.mock('../../src/lib/sse-emitter', () => ({ emit: jest.fn() }));

var {
  db, isDbAvailable, seedTestUser, cleanupTestData, destroyTestUser, mockReq, mockRes
} = require('./helpers/test-setup');
var { assertDbAvailable } = require('../helpers/requireDB');
var { makeTask } = require('./helpers/test-fixtures');
var { sync } = require('../../src/controllers/cal-sync.controller');
var gcalAdapter = require('../../src/lib/cal-adapters/gcal.adapter');

// gcal_refresh_token EXPLICITLY, never the buildTestUser default — that reads
// process.env.TEST_GCAL_REFRESH_TOKEN, which lives only in the gitignored
// tests/.env.test, so the suite would pass on a dev box and fail in CI with
// zero connected adapters (that is 999.5070, next door in 22-sync-error-paths).
var GCAL_ONLY = {
  gcal_refresh_token: 'mock-gcal-token',
  msft_cal_refresh_token: null, apple_cal_username: null,
  apple_cal_password: null, apple_cal_server_url: null, apple_cal_calendar_url: null
};

beforeAll(async () => {
  await assertDbAvailable();
  await destroyTestUser();
});
afterEach(async () => {
  jest.restoreAllMocks();
  if (await isDbAvailable()) await cleanupTestData();
});
afterAll(async () => {
  if (await isDbAvailable()) await destroyTestUser();
  await db.destroy();
});

test('999.5074: tasks are pushed in scheduled_at order regardless of insert order', async () => {
  await assertDbAvailable();
  var user = await seedTestUser(GCAL_ONLY);

  var base = Date.now() + 24 * 60 * 60 * 1000;
  // 'ord-a' is the LATER task — id order is deliberately the opposite of
  // schedule order, so a PK-ordered (unordered) read is visibly wrong.
  await makeTask({
    id: 'ord-a', user_id: user.id, text: 'Later task',
    scheduled_at: new Date(base + 2 * 60 * 60 * 1000), dur: 30, when: 'morning'
  });
  await makeTask({
    id: 'ord-b', user_id: user.id, text: 'Earlier task',
    scheduled_at: new Date(base), dur: 30, when: 'morning'
  });

  jest.spyOn(gcalAdapter, 'getValidAccessToken').mockResolvedValue('mock-token');
  jest.spyOn(gcalAdapter, 'listEvents').mockResolvedValue([]);
  // Without this the batch results' null `raw` throws inside normalizeEvent,
  // and the controller's documented catch re-pushes the whole queue
  // sequentially — which would make this assert order twice over.
  jest.spyOn(gcalAdapter, 'normalizeEvent').mockReturnValue(null);

  var pushedOrder = [];
  jest.spyOn(gcalAdapter, 'batchCreateEvents').mockImplementation(async function (token, queue) {
    queue.forEach(function (q) { pushedOrder.push(q.task.id); });
    return queue.map(function (q) {
      return { taskId: q.task.id, providerEventId: 'evt-' + q.task.id, raw: null, error: null };
    });
  });
  jest.spyOn(gcalAdapter, 'createEvent').mockImplementation(async function (token, task) {
    pushedOrder.push('UNEXPECTED-SEQUENTIAL:' + task.id);
    return { eventId: 'evt-' + task.id, url: null, etag: null };
  });

  await sync(mockReq(user), mockRes());

  expect(pushedOrder).toEqual(['ord-b', 'ord-a']);

  // The ledger ids follow push order, which is the half that actually broke
  // W4's golden (its <N1>/<N2> labels are assigned by ascending id).
  var ledger = await db('cal_sync_ledger')
    .where({ user_id: user.id, provider: 'gcal' })
    .whereIn('task_id', ['ord-a', 'ord-b'])
    .orderBy('id', 'asc')
    .select('task_id');
  expect(ledger.map(function (r) { return r.task_id; })).toEqual(['ord-b', 'ord-a']);
});
