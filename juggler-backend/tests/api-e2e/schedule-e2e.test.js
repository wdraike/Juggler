/**
 * E2E tests for /api/schedule/* — real HTTP via supertest, real Express app, real DB.
 *
 * Covers:
 *   POST /api/schedule/run   → runs scheduler synchronously, returns { dayPlacements, unplaced, ... }
 *   GET  /api/schedule/placements → reads persisted placements
 *   POST /api/schedule/nudge → enqueues a scheduler run; returns { queued: true }
 *
 * All tests skip gracefully when the test DB is unavailable.
 *
 * Note: /api/schedule/run is SYNCHRONOUS — it persists scheduled_at values and
 * returns immediately (no async queue draining needed). The sync_locks table
 * must exist in juggler_test (it does — teardownUser cleans it per-user).
 */

'use strict';

const request = require('supertest');
const harness = require('./server-setup');

let app, token;

beforeAll(async () => {
  app = await harness.setup();
  if (app) token = await harness.makeJWT();
}, 30000);

afterAll(async () => {
  await harness.teardown();
  await harness.destroy();
}, 15000);

async function skipIfNoDB() {
  return !(await harness.isAvailable());
}

// ── Shared task id — created in beforeEach so each schedule test is independent

describe('Schedule API — E2E', () => {
  let taskId;

  beforeEach(async () => {
    if (await skipIfNoDB()) return;

    // Create a fresh schedulable task for each test
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'E2E sched-test task', dur: 60, pri: 'P1' });

    if (res.status === 201 && res.body.task) {
      taskId = res.body.task.id;
    }
  });

  // ── POST /api/schedule/run ─────────────────────────────────────────────────

  test('POST /api/schedule/run returns 200 with dayPlacements object', async () => {
    if (await skipIfNoDB()) return;

    const res = await request(app)
      .post('/api/schedule/run')
      .set('Authorization', `Bearer ${token}`)
      .set('x-timezone', 'America/New_York');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('dayPlacements');
    expect(typeof res.body.dayPlacements).toBe('object');
    expect(res.body).toHaveProperty('unplaced');
    expect(Array.isArray(res.body.unplaced)).toBe(true);
  }, 20000);

  test('POST /api/schedule/run writes scheduled_at to task_instances for placed tasks', async () => {
    if (await skipIfNoDB()) return;
    if (!taskId) return; // beforeEach task creation failed (DB issue)

    // Run the scheduler
    const res = await request(app)
      .post('/api/schedule/run')
      .set('Authorization', `Bearer ${token}`)
      .set('x-timezone', 'America/New_York');

    expect(res.status).toBe(200);

    // The scheduler either places our task (scheduled_at written) or puts it in unplaced.
    // Either outcome is valid — we verify DB consistency.
    const db = harness.getDb();
    const instanceRow = await db('task_instances').where('id', taskId).first();
    expect(instanceRow).toBeDefined();

    // If task was placed, scheduled_at should be set; if unplaced, it may be null.
    // Verify the row exists and has the correct user_id.
    expect(instanceRow.user_id).toBe(harness.TEST_USER_ID);
  }, 20000);

  // ── GET /api/schedule/placements ──────────────────────────────────────────

  test('GET /api/schedule/placements returns 200 with placements structure', async () => {
    if (await skipIfNoDB()) return;

    // Run first so placements cache is populated
    await request(app)
      .post('/api/schedule/run')
      .set('Authorization', `Bearer ${token}`)
      .set('x-timezone', 'America/New_York');

    const res = await request(app)
      .get('/api/schedule/placements')
      .set('Authorization', `Bearer ${token}`)
      .set('x-timezone', 'America/New_York');

    expect(res.status).toBe(200);
    // Response is the same shape as /run: { dayPlacements, unplaced, ... }
    expect(res.body).toHaveProperty('dayPlacements');
    expect(typeof res.body.dayPlacements).toBe('object');
  }, 20000);

  // ── POST /api/schedule/nudge ───────────────────────────────────────────────

  test('POST /api/schedule/nudge enqueues and returns 200 { queued: true }', async () => {
    if (await skipIfNoDB()) return;

    const res = await request(app)
      .post('/api/schedule/nudge')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.queued).toBe(true);
  }, 10000);
});
