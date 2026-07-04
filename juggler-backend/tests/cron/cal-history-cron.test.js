// Tests for cal-history cron job (999.313 — replaced 3× expect(true).toBe(true)
// coverage-theater placeholders with real DB-backed assertions against test-bed).
//
// sched-drop-overdue-column / M-5 (999.1085): markMissedTasks and its
// characterization coverage (the 999.956 never-missing describe block) are
// REMOVED here, not just left to bit-rot — markMissedTasks itself is retired
// (src/cron/cal-history-cron.js) because its entire purpose was writing
// task_instances.overdue, a column this leg drops. purgeOldEntries/
// runCalHistoryCron are untouched by this leg (unrelated cal_history-purge
// logic) and keep their coverage below.
//
// The cron functions resolve their handle via lib/db getDefaultDb() →
// knexfile[NODE_ENV='test'] → juggler_test, the SAME database the test helper
// connects to, so fixtures inserted here are visible to the cron and vice-versa.
const db = require('../helpers/test-db');
const {
  purgeOldEntries,
  runCalHistoryCron,
} = require('../../src/cron/cal-history-cron');

const TEST_USER = 'test-calhist-cron-user';

async function clearOurRows() {
  await db('cal_history').where('user_id', TEST_USER).del();
  await db('task_instances').where('user_id', TEST_USER).del();
  await db('task_masters').where('user_id', TEST_USER).del();
  // users is the FK parent of task_masters/task_instances (ON DELETE CASCADE) —
  // delete it last so a re-run starts clean.
  await db('users').where('id', TEST_USER).del();
  // release any cron-leader locks this suite acquired so a re-run / sibling test
  // is not blocked by a stale lock row.
  await db('cron_locks').where('lock_name', 'like', 'cal-history-cron%').del();
}

async function seedUser() {
  // task_masters.user_id / task_instances.user_id FK → users.id.
  await db('users').insert({ id: TEST_USER, email: 'calhist-cron@test.local' });
}

describe('Cal History Cron Job', () => {
  beforeAll(async () => {
    if (!(await db.isAvailable())) throw new Error('Test database is not available');
  });
  beforeEach(async () => { await clearOurRows(); await seedUser(); });
  afterEach(clearOurRows);
  afterAll(async () => { await db.destroy(); });

  test('purgeOldEntries deletes cal_history rows older than 12 months and keeps recent ones', async () => {
    const thirteenMonthsAgo = new Date();
    thirteenMonthsAgo.setMonth(thirteenMonthsAgo.getMonth() - 13);
    // cal_history.task_id FK → task_instances(id) (fk_cal_history_task_id, added by
    // a later migration). Production cal_history rows always reference a real
    // instance; seed the parent master + instances so the fixture satisfies the FK.
    await db('task_masters').insert({ id: 'ch-master', user_id: TEST_USER, text: 'Cal-history purge master' });
    // Distinct occurrence_ordinal per instance — uq_instance_ordinals is
    // (master_id, occurrence_ordinal, split_ordinal), both default 1, so two
    // instances under one master collide unless the ordinal differs.
    await db('task_instances').insert([
      { id: 'ch-old', master_id: 'ch-master', user_id: TEST_USER, scheduled_at: thirteenMonthsAgo, status: '', occurrence_ordinal: 1 },
      { id: 'ch-new', master_id: 'ch-master', user_id: TEST_USER, scheduled_at: new Date(), status: '', occurrence_ordinal: 2 },
    ]);
    await db('cal_history').insert([
      { task_id: 'ch-old', user_id: TEST_USER, status: 'missed', created_by: 'test', scheduled_at: thirteenMonthsAgo, created_at: thirteenMonthsAgo },
      { task_id: 'ch-new', user_id: TEST_USER, status: 'missed', created_by: 'test', scheduled_at: new Date(), created_at: new Date() },
    ]);

    await purgeOldEntries();

    const remaining = await db('cal_history').where('user_id', TEST_USER).pluck('task_id');
    expect(remaining).toContain('ch-new');
    expect(remaining).not.toContain('ch-old');
  });

  test('runCalHistoryCron runs purge end-to-end without throwing (markMissedTasks retired, M-5)', async () => {
    await expect(runCalHistoryCron()).resolves.toBeUndefined();
  });
});
