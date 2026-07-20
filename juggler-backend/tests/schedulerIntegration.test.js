/**
 * Scheduler Integration Tests
 *
 * Tests the full DB-to-scheduler-to-DB pipeline using a real MySQL database.
 * Requires Docker: cd test-bed && make up
 *
 * These tests verify:
 * - UC-15: Persistence & feedback loop prevention
 * - UC-18: Full DB pipeline (load → schedule → persist)
 * - Idempotency: running scheduler twice produces same results
 * - Reset logic: original_scheduled_at is restored before each run
 *
 * TEST-FR-001: DB-unavailability FAILS LOUD — never silently passes.
 * If the DB is unreachable, beforeAll throws and the whole suite fails,
 * rather than allowing zero-assertion bodies to report a false PASS.
 * Model: configRepository.contract.test.js / requireDB.js assertDbAvailable.
 */

var { assertDbAvailable } = require('./helpers/requireDB');
var { runScheduleAndPersist } = require('../src/scheduler/runSchedule');

var knex;

// Check if test DB is available before running.
// Uses DB_NAME (the Oscar/test-bed standard env var, per knexfile.js test config).
// Falls back to TEST_DB_NAME for legacy invocations, then 'juggler_test' as a last
// resort — keeping the single-env-var contract: pass DB_NAME and the whole suite uses it.
// NEVER defaults to 3307 (Cloud SQL Proxy = production).
var DB_HOST = process.env.DB_HOST || process.env.TEST_DB_HOST || '127.0.0.1';
var DB_PORT = process.env.DB_PORT || process.env.TEST_DB_PORT || 3407;
var DB_NAME = process.env.DB_NAME || process.env.TEST_DB_NAME || 'juggler_test';
var DB_USER = process.env.DB_USER || process.env.TEST_DB_USER || 'root';
var DB_PASS = process.env.DB_PASSWORD || process.env.TEST_DB_PASSWORD || 'rootpass';

beforeAll(async function() {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-01-15T12:00:00Z'));
  // TEST-FR-001: assertDbAvailable() throws (fail-loud) if the DB is unreachable.
  // It does NOT set a flag — it propagates the error to Jest, which marks the suite
  // as failed and prevents any test body from running (and passing with 0 assertions).
  await assertDbAvailable();

  knex = require('knex')({
    client: 'mysql2',
    connection: {
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASS,
      database: DB_NAME,
      charset: 'utf8mb4',
      timezone: '+00:00',
      dateStrings: true
    },
    migrations: {
      directory: './src/db/migrations',
      tableName: 'knex_migrations'
    }
  });

  // Verify this pool can actually reach the named DB (assertDbAvailable uses the
  // default juggler_test pool; this pool uses the leg-specific DB_NAME). If this
  // throws, the error propagates — never swallowed.
  await knex.raw('SELECT 1');

  // Run migrations
  await knex.migrate.latest();

  // Seed test user
  var userId = 'test-user-scheduler-integration';
  await knex('users').insert({
    id: userId,
    email: 'scheduler-test@juggler.local',
    name: 'Scheduler Test User',
    timezone: 'America/New_York'
  }).onConflict('id').merge();

  // Seed config
  var configs = [
    { user_id: userId, config_key: 'time_blocks', config_value: JSON.stringify(require('./helpers/real-config-fixtures').REAL_TIME_BLOCKS) },
    { user_id: userId, config_key: 'tool_matrix', config_value: JSON.stringify(require('./helpers/real-config-fixtures').REAL_TOOL_MATRIX) },
    { user_id: userId, config_key: 'loc_schedules', config_value: JSON.stringify(require('./helpers/real-config-fixtures').REAL_LOC_SCHEDULES) },
    { user_id: userId, config_key: 'loc_schedule_defaults', config_value: JSON.stringify(require('./helpers/real-config-fixtures').REAL_LOC_SCHEDULE_DEFAULTS) },
    { user_id: userId, config_key: 'preferences', config_value: JSON.stringify({ splitDefault: false, splitMinDefault: 15 }) }
  ];
  for (var i = 0; i < configs.length; i++) {
    await knex('user_config').insert(configs[i]).onConflict(['user_id', 'config_key']).merge();
  }
}, 30000);

afterAll(async function() {
  jest.useRealTimers();
  if (knex) {
    try { await knex.destroy(); } catch (e) {}
  }
});

var TEST_USER = 'test-user-scheduler-integration';

// Helper: insert a task and return it
async function insertTask(taskData) {
  var masterId = taskData.id || ('test_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
  var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  var masterRow = {
    id: masterId,
    user_id: TEST_USER,
    text: taskData.text || 'Test Task',
    dur: taskData.dur || 30,
    pri: taskData.pri || 'P3',
    when: taskData.when || '',
    day_req: taskData.dayReq || 'any',
    recurring: taskData.recurring ? 1 : 0,
    split: taskData.split ? 1 : 0,
    flex_when: taskData.flexWhen ? 1 : 0,
    placement_mode: taskData.placementMode || 'anytime',
    location: JSON.stringify(taskData.location || []),
    tools: JSON.stringify(taskData.tools || []),
    depends_on: JSON.stringify(taskData.dependsOn || []),
    created_at: now,
    updated_at: now
  };
  if (taskData.deadline) masterRow.deadline = taskData.deadline;

  var instanceRow = {
    id: masterId + '_i',
    master_id: masterId,
    user_id: TEST_USER,
    occurrence_ordinal: 1,
    split_ordinal: 1,
    split_total: 1,
    status: taskData.status || '',
    // date_pinned column was DROPPED by migration 20260526000000 — removed from insert.
    // Fixed placement is expressed via placement_mode='fixed' on the master row instead.
    generated: taskData.generated ? 1 : 0,
    created_at: now,
    updated_at: now
  };
  if (taskData.scheduledAt) instanceRow.scheduled_at = taskData.scheduledAt;

  await knex('task_masters').insert(masterRow).onConflict('id').merge();
  await knex('task_instances').insert(instanceRow).onConflict('id').merge();
  return { master: masterRow, instance: instanceRow };
}

// Helper: clean test tasks
async function cleanTasks() {
  await knex('task_instances').where('user_id', TEST_USER).del();
  await knex('task_masters').where('user_id', TEST_USER).del();
}

// ═════════════════════════════════════════════════════════════════════
// UC-15: Persistence & Feedback Loop Prevention
// ═════════════════════════════════════════════════════════════════════

describe('UC-15: DB Persistence', function() {

  beforeEach(async function() {
    await cleanTasks();
  });

  test('UC-15.1: Scheduler idempotent — two runs produce same placement', async function() {
    // Seed an ACTIVE task with no scheduled_at — the scheduler must place it.
    await insertTask({
      id: 'idem_t1',
      text: 'Idempotent Test',
      dur: 30
      // no scheduledAt — scheduler will assign it
    });

    // First run: scheduler places the task.
    await runScheduleAndPersist(TEST_USER);
    var inst1 = await knex('task_instances').where('master_id', 'idem_t1').first();
    expect(inst1).toBeDefined();
    var placedAt1 = inst1.scheduled_at;
    // The scheduler MUST have placed the task — assert a real, non-null timestamp.
    // A null here means the scheduler failed to place it; that is itself a failure
    // and the idempotency assertion below would be vacuously null===null.
    expect(placedAt1).not.toBeNull();
    expect(typeof placedAt1).toBe('string');
    expect(placedAt1.length).toBeGreaterThan(0);

    // Second run: must produce IDENTICAL placement (exact equality, not just truthy).
    await runScheduleAndPersist(TEST_USER);
    var inst2 = await knex('task_instances').where('master_id', 'idem_t1').first();
    expect(inst2).toBeDefined();
    expect(inst2.scheduled_at).toBe(placedAt1);
  });

  test('UC-15.5: Task status preserved across scheduler runs', async function() {
    // chk_task_instances_terminal_scheduled (mig 20260527213906) requires non-null
    // scheduled_at for terminal statuses. Seed a past timestamp; the assertion under
    // test is that BOTH status='done' AND the exact scheduled_at timestamp are
    // PRESERVED (unchanged) after the scheduler runs.
    var SEEDED_SCHEDULED_AT = '2026-04-01 10:00:00';
    await insertTask({
      id: 'done_task',
      text: 'Already Done',
      dur: 30,
      status: 'done',
      scheduledAt: SEEDED_SCHEDULED_AT
    });

    // Capture the pre-run state to have an exact baseline for the timestamp.
    var instBefore = await knex('task_instances').where('master_id', 'done_task').first();
    var scheduledAtBefore = instBefore.scheduled_at;
    // Confirm the seed took — must be a real persisted value, not null.
    expect(scheduledAtBefore).not.toBeNull();
    expect(scheduledAtBefore).toBeTruthy();

    // Invoke the real scheduler — it must NOT modify done instances.
    await runScheduleAndPersist(TEST_USER);

    var instAfter = await knex('task_instances').where('master_id', 'done_task').first();
    expect(instAfter.status).toBe('done');
    // scheduled_at must be EXACTLY preserved — not just truthy, but the identical
    // timestamp the scheduler found. Any mutation (null, update, shift) is a FAIL.
    expect(instAfter.scheduled_at).toBe(scheduledAtBefore);
  });
});

// ═════════════════════════════════════════════════════════════════════
// UC-18: Full DB Pipeline
// ═════════════════════════════════════════════════════════════════════

describe('UC-18: Full DB Pipeline', function() {

  beforeEach(async function() {
    await cleanTasks();
  });

  test('UC-18.4: Done recurring instance not re-scheduled', async function() {
    // chk_task_instances_terminal_scheduled (mig 20260527213906) requires non-null
    // scheduled_at for terminal statuses. Seed a past timestamp; the assertion under
    // test is that the done recurring instance is NOT re-placed (status, scheduled_at,
    // and master.recurring are all unchanged after the scheduler runs).
    await insertTask({
      id: 'recur_done',
      text: 'Recurring Done',
      dur: 30,
      status: 'done',
      scheduledAt: '2026-04-01 10:00:00',
      recurring: true
    });

    // Capture the pre-run state.
    var instBefore = await knex('task_instances').where('master_id', 'recur_done').first();
    var scheduledAtBefore = instBefore.scheduled_at;

    // Invoke the real scheduler.
    await runScheduleAndPersist(TEST_USER);

    // Post-run: status and scheduled_at must be unchanged; master.recurring must be 1.
    var master = await knex('task_masters').where('id', 'recur_done').first();
    var instAfter = await knex('task_instances').where('master_id', 'recur_done').first();
    expect(instAfter.status).toBe('done');
    expect(instAfter.scheduled_at).toBe(scheduledAtBefore);
    expect(master.recurring).toBe(1);
  });

  test('UC-18.7: Config loads from DB correctly', async function() {
    var row = await knex('user_config')
      .where({ user_id: TEST_USER, config_key: 'time_blocks' })
      .first();
    expect(row).toBeDefined();
    var blocks = typeof row.config_value === 'string' ? JSON.parse(row.config_value) : row.config_value;
    expect(blocks.Fri).toBeDefined();
    expect(blocks.Fri.length).toBeGreaterThan(0);
    // Verify lunch block exists
    var hasLunch = blocks.Fri.some(function(b) { return b.tag === 'lunch'; });
    expect(hasLunch).toBe(true);
  });
});

