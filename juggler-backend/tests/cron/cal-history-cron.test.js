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
// Same require-cache entry (absolute path) as cal-history-cron.js's own
// `require('../lib/db')` — getDefaultDb() returns the IDENTICAL cached knex
// instance the cron uses internally, so a 'query' listener attached here
// observes the cron's REAL executed SQL (not a re-derived copy of it).
const { getDefaultDb } = require('../../src/lib/db');

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

  // Leg D / no-auto-miss (David 2026-06-24): the cron must NEVER terminal-mark a past
  // task 'missed' — that's the auto-miss feature Leg D removed from the scheduler, and
  // this cron was a second auto-miss path. Past-due incomplete stays a LIVE, VISIBLE
  // commitment: flagged overdue (status unchanged, non-terminal), never closed.
  test('markMissedTasks flags a past-due non-terminal instance OVERDUE, never terminal missed', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await db('task_masters').insert({ id: 'cm-master-1', user_id: TEST_USER, text: 'Cron mark-missed master' });
    await db('task_instances').insert({
      id: 'cm-inst-1', master_id: 'cm-master-1', user_id: TEST_USER,
      scheduled_at: threeDaysAgo, status: '',
    });

    await markMissedTasks();

    const inst = await db('task_instances').where('id', 'cm-inst-1').first();
    expect(inst.status).not.toBe('missed');   // never auto-missed
    expect(inst.status).toBe('');              // status unchanged (non-terminal)
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
      scheduled_at: oneHourAgo, status: '',
    });

    await markMissedTasks();

    const inst = await db('task_instances').where('id', 'cm-inst-2').first();
    expect(inst.status).toBe('');
  });

  test('runCalHistoryCron runs mark + purge end-to-end without throwing', async () => {
    await expect(runCalHistoryCron()).resolves.toBeUndefined();
  });

  // ---------------------------------------------------------------------
  // 999.956 — never-missing characterization for the index + predicate push.
  //
  // The change under test is PERF-ONLY (jug956): a new covering index
  // idx_task_instances_missed_scan(overdue, scheduled_at) + pushing the
  // loop's existing `!task.overdue` guard into the SQL as
  // `.where('task_instances.overdue', 0)`. The governing invariant
  // (project memory `juggler-never-missing-invariant`) requires the set of
  // rows that receive overdue=1 to be BYTE-IDENTICAL before and after.
  //
  // We intercept the cron's REAL executed SQL via getDefaultDb()'s 'query'
  // event (same cached knex instance the cron uses internally — see the
  // require comment above) rather than asserting only on final row state,
  // because final-state alone cannot distinguish "never touched" from
  // "redundantly re-set to the same value" for the already-overdue row —
  // the UPDATE statement only sets `overdue`, so a no-op double-update
  // would be invisible in the row's final columns. Capturing the actual
  // `UPDATE task_instances SET overdue = ...` statements and asserting
  // which ids appear as bindings is the only way to prove the already-
  // overdue row was excluded from the UPDATE SET ENTIRELY, not just that
  // it ended up correct by coincidence.
  // ---------------------------------------------------------------------
  describe('999.956 — never-missing characterization (overdue=0 pushed into SQL)', () => {
    const ALREADY_OVERDUE_ID = 'nm-already-overdue';
    const FRESH_FLAG_ID = 'nm-fresh-flag';
    const CONTROL_ID = 'nm-control';
    const FAR_PAST_ID = 'nm-far-past';
    const MASTER_ID = 'nm-master';

    async function seedFixture() {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      // Far-past row characterizes the "no lower date bound" acceptance
      // criterion (WBS jug956 W2): a very old un-flagged instance must
      // still be caught, never excluded by an accidental floor.
      const fourHundredDaysAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);

      await db('task_masters').insert({ id: MASTER_ID, user_id: TEST_USER, text: 'never-missing characterization master' });
      await db('task_instances').insert([
        // (a) already-overdue, past-due, non-terminal — MUST be left untouched.
        { id: ALREADY_OVERDUE_ID, master_id: MASTER_ID, user_id: TEST_USER, occurrence_ordinal: 1, scheduled_at: threeDaysAgo, status: '', overdue: 1 },
        // (b) fresh non-overdue >24h-past, non-terminal — MUST be flagged overdue=1.
        { id: FRESH_FLAG_ID, master_id: MASTER_ID, user_id: TEST_USER, occurrence_ordinal: 2, scheduled_at: threeDaysAgo, status: '', overdue: 0 },
        // (c) control row NOT yet 24h past — MUST stay overdue=0.
        { id: CONTROL_ID, master_id: MASTER_ID, user_id: TEST_USER, occurrence_ordinal: 3, scheduled_at: oneHourAgo, status: '', overdue: 0 },
        // (d) far-past, non-overdue — MUST also be flagged (no lower bound).
        { id: FAR_PAST_ID, master_id: MASTER_ID, user_id: TEST_USER, occurrence_ordinal: 4, scheduled_at: fourHundredDaysAgo, status: '', overdue: 0 },
      ]);
    }

    function isOverdueUpdate(q) {
      return /update\s+`?task_instances`?\s+set\s+`?overdue`?/i.test(q.sql);
    }
    function isTasksToMarkSelect(q) {
      return /select\s+`?task_instances`?\.\*/i.test(q.sql) && /task_masters/i.test(q.sql);
    }

    async function runMarkMissedWithCapture() {
      const cronDb = getDefaultDb();
      const captured = [];
      const onQuery = (q) => captured.push(q);
      cronDb.on('query', onQuery);
      try {
        await markMissedTasks();
      } finally {
        cronDb.removeListener('query', onQuery);
      }
      return captured;
    }

    test('exact UPDATE set is correct: already-overdue excluded from the UPDATE entirely, fresh + far-past flagged, control untouched', async () => {
      await seedFixture();

      const captured = await runMarkMissedWithCapture();

      const updateQueries = captured.filter(isOverdueUpdate);
      // `update \`task_instances\` set \`overdue\` = ? where \`id\` = ?`
      // — the id is the last binding.
      const updatedIds = updateQueries.map((q) => q.bindings[q.bindings.length - 1]).sort();

      expect(updatedIds).toEqual([FAR_PAST_ID, FRESH_FLAG_ID].sort());
      expect(updatedIds).not.toContain(ALREADY_OVERDUE_ID);
      expect(updatedIds).not.toContain(CONTROL_ID);

      const rows = await db('task_instances')
        .whereIn('id', [ALREADY_OVERDUE_ID, FRESH_FLAG_ID, CONTROL_ID, FAR_PAST_ID])
        .select('id', 'overdue');
      const overdueById = {};
      rows.forEach((r) => { overdueById[r.id] = !!r.overdue; });

      expect(overdueById[ALREADY_OVERDUE_ID]).toBe(true);  // unchanged — was already 1
      expect(overdueById[FRESH_FLAG_ID]).toBe(true);        // newly flagged
      expect(overdueById[CONTROL_ID]).toBe(false);          // untouched — not yet 24h past
      expect(overdueById[FAR_PAST_ID]).toBe(true);          // no lower bound — still caught
    });

    // Informational/non-blocking per WBS jug956 ("Non-blocking if EXPLAIN is
    // awkward in the harness — note it"): on a fresh ephemeral test-bed slot
    // running ONLY this suite, task_instances/task_masters hold a handful of
    // rows total. MySQL's cost-based optimizer makes index-choice decisions
    // off table cardinality/selectivity estimates — on a table this small it
    // can legitimately pick a different access path (e.g. the join-driving
    // uq_instance_ordinals lookup by master_id) than it would against a
    // production-scale table, with NO correctness implication either way.
    // We therefore CAPTURE and REPORT the real EXPLAIN plan as evidence
    // (visible in the test-run log for cookie/Oscar to review) rather than
    // hard-asserting a specific `key`, which would make this suite flake on
    // table-size-dependent optimizer choices unrelated to the change's
    // correctness. See TEST-CATALOG.md Coverage Map / Findings for the
    // explicit WARN this produces (index-usage NOT proven at this row count).
    test('EXPLAIN: report the tasksToMark SELECT access path (informational — see Findings)', async () => {
      await seedFixture();

      const captured = await runMarkMissedWithCapture();
      const selectQuery = captured.find(isTasksToMarkSelect);

      expect(selectQuery).toBeDefined(); // we MUST have captured the real SELECT

      const cronDb = getDefaultDb();
      const explainRows = await cronDb.raw('EXPLAIN ' + selectQuery.sql, selectQuery.bindings);
      const rows = explainRows[0];
      const taskInstancesRow = rows.find((r) => String(r.table).replace(/`/g, '') === 'task_instances');

      expect(taskInstancesRow).toBeDefined();
      // eslint-disable-next-line no-console
      console.log(
        '[999.956 EXPLAIN evidence] task_instances access: type=' + taskInstancesRow.type +
        ' key=' + taskInstancesRow.key + ' rows=' + taskInstancesRow.rows +
        ' Extra=' + taskInstancesRow.Extra +
        ' (fixture row count is small — see test comment; this is reported, not gated)'
      );
    });
  });
});
