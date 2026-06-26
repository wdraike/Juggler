// Tests for cal-history cron job (999.313 — replaced 3× expect(true).toBe(true)
// coverage-theater placeholders with real DB-backed assertions against test-bed).
//
// The cron functions resolve their handle via lib/db getDefaultDb() →
// knexfile[NODE_ENV='test'] → juggler_test, the SAME database the test helper
// connects to, so fixtures inserted here are visible to the cron and vice-versa.
const db = require('../helpers/test-db');
const {
  markMissedTasks,
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
      { id: 'ch-old', master_id: 'ch-master', user_id: TEST_USER, scheduled_at: thirteenMonthsAgo, status: 'wip', occurrence_ordinal: 1 },
      { id: 'ch-new', master_id: 'ch-master', user_id: TEST_USER, scheduled_at: new Date(), status: 'wip', occurrence_ordinal: 2 },
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

  // Leg D / no-auto-miss (David 2026-06-24): the cron must NEVER terminal-mark a past
  // task 'missed' — that's the auto-miss feature Leg D removed from the scheduler, and
  // this cron was a second auto-miss path. Past-due incomplete stays a LIVE, VISIBLE
  // commitment: flagged overdue (status unchanged, non-terminal), never closed.
  test('markMissedTasks flags a past-due non-terminal instance OVERDUE, never terminal missed', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await db('task_masters').insert({ id: 'cm-master-1', user_id: TEST_USER, text: 'Cron mark-missed master' });
    await db('task_instances').insert({
      id: 'cm-inst-1', master_id: 'cm-master-1', user_id: TEST_USER,
      scheduled_at: threeDaysAgo, status: 'wip',
    });

    await markMissedTasks();

    const inst = await db('task_instances').where('id', 'cm-inst-1').first();
    expect(inst.status).not.toBe('missed');   // never auto-missed
    expect(inst.status).toBe('wip');           // status unchanged (non-terminal)
    expect(!!inst.overdue).toBe(true);         // flagged overdue — visible, never-missing
    expect(inst.completed_at).toBeFalsy();     // not closed

    // No 'missed' cal_history event — there is no missed event anymore.
    const hist = await db('cal_history').where({ task_id: 'cm-inst-1', status: 'missed' }).first();
    expect(hist).toBeFalsy();
  });

  test('markMissedTasks leaves a recently-scheduled instance untouched (within resolution window)', async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await db('task_masters').insert({ id: 'cm-master-2', user_id: TEST_USER, text: 'Recent master' });
    await db('task_instances').insert({
      id: 'cm-inst-2', master_id: 'cm-master-2', user_id: TEST_USER,
      scheduled_at: oneHourAgo, status: 'wip',
    });

    await markMissedTasks();

    const inst = await db('task_instances').where('id', 'cm-inst-2').first();
    expect(inst.status).toBe('wip');
  });

  test('runCalHistoryCron runs mark + purge end-to-end without throwing', async () => {
    await expect(runCalHistoryCron()).resolves.toBeUndefined();
  });
});
