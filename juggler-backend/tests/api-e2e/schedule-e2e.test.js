/**
 * E2E tests for /api/schedule/* — real HTTP via supertest, real Express app, real DB.
 *
 * Covers:
 *   POST /api/schedule/run   → runs scheduler synchronously, returns { dayPlacements, unplaced, ... }
 *   POST /api/schedule/nudge → enqueues a scheduler run; returns { queued: true }
 *
 * W3 (DB single source): GET /api/schedule/placements was removed. MCP consumers
 * now call deriveSchedulePlacements server-side; the juggler frontend uses
 * utils/derivePlacements.js from GET /api/tasks.
 *
 * All tests FAIL LOUD when the test DB is unavailable (TEST-FR-001).
 *
 * Note: /api/schedule/run is SYNCHRONOUS — it persists scheduled_at values and
 * returns immediately (no async queue draining needed). The sync_locks table
 * must exist in juggler_test (it does — teardownUser cleans it per-user).
 */

'use strict';

const request = require('supertest');
const harness = require('./server-setup');
const { requireDB } = require('../helpers/requireDB');

let app, token;

beforeAll(async () => {
  app = await harness.setup();
  if (app) token = await harness.makeJWT();
}, 30000);

afterAll(async () => {
  await harness.teardown();
  await harness.destroy();
}, 15000);

const harnessProbe = () => harness.isAvailable();

// ── Shared task id — created in beforeEach so each schedule test is independent

describe('Schedule API — E2E', () => {
  let taskId;

  beforeEach(async () => {
    if (!(await harness.isAvailable())) return;

    // Create a fresh schedulable task for each test
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'E2E sched-test task', dur: 60, pri: 'P1' });

    // Fail loud if task creation fails — a silent 500 would leave taskId stale
    // from a prior test and allow false passes (zoe flag-and-refer :42)
    expect(res.status).toBe(403);
    expect(res.body.task).toBeDefined();
    taskId = res.body.task.id;
  });

  // ── POST /api/schedule/run ─────────────────────────────────────────────────

  test('POST /api/schedule/run returns 200 with dayPlacements object', requireDB(async () => {
    const res = await request(app)
      .post('/api/schedule/run')
      .set('Authorization', `Bearer ${token}`)
      .set('x-timezone', 'America/New_York');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('dayPlacements');
    expect(typeof res.body.dayPlacements).toBe('object');
    expect(res.body).toHaveProperty('unplaced');
    expect(Array.isArray(res.body.unplaced)).toBe(true);
  }, harnessProbe), 20000);

  test('POST /api/schedule/run writes scheduled_at to task_instances for placed tasks', requireDB(async () => {
    // BUG-2 fix: DETERMINISTIC placement scenario.
    //
    // Key invariant (from runSchedule.js:1335): FIXED-mode tasks are user-anchored —
    // the scheduler places them in dayPlacements but intentionally does NOT rewrite
    // scheduled_at (that field is owned by taskMappers.taskToRow at insert time).
    // So we must use an ANYTIME task (no date / no time at creation) which starts
    // with scheduled_at = null in the DB (taskMappers leaves it null when no date is
    // provided), and which the scheduler MUST write scheduled_at for when it places it.
    //
    // Determinism guarantee: a fresh ANYTIME task in an otherwise empty calendar
    // (harness teardown + fresh seed per suite) has guaranteed capacity across all
    // default time blocks.  The scheduler WILL place it and WILL write scheduled_at.
    //
    // FAIL CONDITION: if the scheduler's write is broken (e.g. runSchedule.js:1386
    // scheduled_at→null), scheduled_at stays null and the terminal
    // expect(instanceRow.scheduled_at).not.toBeNull() goes RED.  No if-gate survives.

    // Create an ANYTIME task — no date, no time → taskMappers writes scheduled_at = null.
    const createRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({
        text: 'BUG-2 deterministic anytime-placement task',
        dur: 30,
        pri: 'P1',
        // Deliberately omit date / time / placementMode so taskMappers.taskToRow
        // leaves scheduled_at = null at creation.
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.task).toBeDefined();
    const anytimeId = createRes.body.task.id;
    expect(typeof anytimeId).toBe('string');

    // Confirm the DB row starts null — if this fails the strategy premise is wrong.
    const db = harness.getDb();
    const beforeRow = await db('task_instances').where('id', anytimeId).first();
    expect(beforeRow).toBeDefined();
    expect(beforeRow.scheduled_at).toBeNull(); // null at creation: taskMappers owes no date

    // Run the scheduler — with a fresh single-user calendar and a short-dur P1 task
    // there is always capacity.  The scheduler MUST place this task today.
    const res = await request(app)
      .post('/api/schedule/run')
      .set('Authorization', `Bearer ${token}`)
      .set('x-timezone', 'America/New_York');

    expect(res.status).toBe(200);

    // Assert the anytime task appears in dayPlacements UNCONDITIONALLY.
    // No if-gate — absence means the scheduler failed to find any slot in an
    // empty calendar, which is a scheduler bug, not a valid "unplaced" outcome.
    const allPlacedIds = Object.values(res.body.dayPlacements || {})
      .flat()
      .map(p => (p && (p.id || (p.task && p.task.id))) || null)
      .filter(Boolean);
    expect(allPlacedIds).toContain(anytimeId);

    // THE CORE ASSERTION — unconditional, no if(isPlaced) gate.
    // This is the line BUG-2 existed to protect.  If the scheduler's write path is
    // broken, scheduled_at remains null and this assertion FAILS.
    const instanceRow = await db('task_instances').where('id', anytimeId).first();
    expect(instanceRow).toBeDefined();
    expect(instanceRow.user_id).toBe(harness.TEST_USER_ID);
    expect(instanceRow.scheduled_at).not.toBeNull();

    // WARN-1 fix: tie the dayPlacements entry to this specific task id.
    // Find which date key this task was placed on and assert the DB row's stored
    // date matches — confirming we observe the placement for THIS task, not a
    // coincidental id collision.
    const placementDayKey = Object.keys(res.body.dayPlacements || {}).find(dk =>
      (res.body.dayPlacements[dk] || []).some(p =>
        (p.id || (p.task && p.task.id)) === anytimeId
      )
    );
    expect(placementDayKey).toBeDefined();
    // The DB row's stored date must match what the scheduler reported in dayPlacements.
    expect(instanceRow.date).toBe(placementDayKey);
  }, harnessProbe), 20000);

  // GET /api/schedule/placements — ROUTE DELETED (W3 DB single source).
  // Placement reads now via deriveSchedulePlacements (server-side helper for MCP)
  // or utils/derivePlacements.js (frontend). See tests/scheduler/deriveSchedulePlacements.test.js.

  // ── POST /api/schedule/nudge ───────────────────────────────────────────────

  test('POST /api/schedule/nudge enqueues and returns 200 { queued: true }', requireDB(async () => {
    const res = await request(app)
      .post('/api/schedule/nudge')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.queued).toBe(true);
  }, harnessProbe), 10000);
});
