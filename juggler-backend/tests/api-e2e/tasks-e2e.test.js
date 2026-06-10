/**
 * E2E tests for /api/tasks — real HTTP via supertest, real Express app, real DB.
 *
 * Uses the server-setup harness which:
 *   - Boots the real Express app against juggler_test (test-bed port 3407)
 *   - Starts a local JWKS server so jwt-auth middleware verifies our RS256 tokens
 *   - Starts a local payment-service mock so resolvePlanFeatures resolves correctly
 *
 * All tests FAIL LOUD when the test DB is unavailable (TEST-FR-001).
 *
 * Response shape notes (from actual task.controller.js):
 *   POST /api/tasks  → 201 { task: { id, text, ... } }
 *   GET  /api/tasks  → 200 { tasks: [...], version: N }
 *   GET  /api/tasks/:id → 200 { task: {...} }
 *   PUT  /api/tasks/:id → 200 { task: {...} } (or { task: {...}, queued: true })
 *   DELETE /api/tasks/:id → 200 { message: 'Task deleted', id }
 *   PUT  /api/tasks/:id/unpin → 200 { success: true, action: 'unpinned', ... }
 *
 * DB field notes (two-table model: task_masters + task_instances):
 *   text, pri, dur → task_masters
 *   date_pinned, scheduled_at → task_instances
 */

'use strict';

const request = require('supertest');
const harness = require('./server-setup');
const { requireDB } = require('../helpers/requireDB');

let app;
let token;

beforeAll(async () => {
  app = await harness.setup();
  if (app) token = await harness.makeJWT();
}, 30000);

afterAll(async () => {
  await harness.teardown();
  await harness.destroy();
}, 15000);

const harnessProbe = () => harness.isAvailable();

// ── Full task lifecycle: CREATE → GET-LIST → GET-SINGLE → UPDATE → DELETE ────

describe('Tasks API — E2E (real Express + real DB)', () => {
  // Shared across tests in this suite — created in the first test
  let createdTaskId;

  // ── POST /api/tasks — create ───────────────────────────────────────────────

  test('POST /api/tasks creates a task and returns 201 with id', requireDB(async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'E2E lifecycle task', dur: 30, pri: 'P3' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('task');
    expect(res.body.task).toHaveProperty('id');
    expect(typeof res.body.task.id).toBe('string');
    createdTaskId = res.body.task.id;

    // Verify row was written to DB
    const db = harness.getDb();
    const masterRow = await db('task_masters').where('id', createdTaskId).first();
    expect(masterRow).toBeDefined();
    expect(masterRow.text).toBe('E2E lifecycle task');
    expect(masterRow.user_id).toBe(harness.TEST_USER_ID);
  }, harnessProbe));

  // ── GET /api/tasks — list ──────────────────────────────────────────────────

  test('GET /api/tasks returns array including the created task', requireDB(async () => {
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Response shape: { tasks: [...], version: N }
    expect(Array.isArray(res.body.tasks)).toBe(true);
    const taskIds = res.body.tasks.map(t => t.id);
    expect(taskIds).toContain(createdTaskId);
  }, harnessProbe));

  // ── GET /api/tasks/:id — single fetch ─────────────────────────────────────

  test('GET /api/tasks/:id returns the specific task', requireDB(async () => {
    const res = await request(app)
      .get(`/api/tasks/${createdTaskId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('task');
    expect(res.body.task.id).toBe(createdTaskId);
    expect(res.body.task.text).toBe('E2E lifecycle task');
  }, harnessProbe));

  // ── PUT /api/tasks/:id — update ────────────────────────────────────────────

  test('PUT /api/tasks/:id updates the task text and reflects in DB', requireDB(async () => {
    const res = await request(app)
      .put(`/api/tasks/${createdTaskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'E2E lifecycle task (updated)' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('task');

    // Verify update landed on task_masters (text is a MASTER_FIELD)
    const db = harness.getDb();
    const masterRow = await db('task_masters').where('id', createdTaskId).first();
    expect(masterRow).toBeDefined();
    expect(masterRow.text).toBe('E2E lifecycle task (updated)');
  }, harnessProbe));

  // ── DELETE /api/tasks/:id — delete ────────────────────────────────────────

  test('DELETE /api/tasks/:id removes task from DB', requireDB(async () => {
    const res = await request(app)
      .delete(`/api/tasks/${createdTaskId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');

    // Verify removal from both tables
    const db = harness.getDb();
    const instanceRow = await db('task_instances').where('id', createdTaskId).first();
    const masterRow = await db('task_masters').where('id', createdTaskId).first();
    expect(instanceRow).toBeUndefined();
    expect(masterRow).toBeUndefined();
  }, harnessProbe));

  // ── PUT /api/tasks/:id/unpin — unpin a pinned task ────────────────────────

  test('PUT /api/tasks/:id/unpin works on a date-pinned task', requireDB(async () => {
    // Create a task with a pinned date
    const createRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'pin-test task', dur: 30, date: '2026-06-01', datePinned: true });

    expect(createRes.status).toBe(201);
    const pinnedId = createRes.body.task.id;

    // Unpin it
    const unpinRes = await request(app)
      .put(`/api/tasks/${pinnedId}/unpin`)
      .set('Authorization', `Bearer ${token}`);

    expect(unpinRes.status).toBe(200);
    expect(unpinRes.body.success).toBe(true);

    // Verify date_pinned was cleared in task_instances
    const db = harness.getDb();
    const instanceRow = await db('task_instances').where('id', pinnedId).first();
    expect(instanceRow).toBeDefined();
    expect(!instanceRow.date_pinned).toBe(true); // falsy: 0 or null
  }, harnessProbe));
});

// ── Cross-user isolation ───────────────────────────────────────────────────────

describe('Tasks API — cross-user isolation', () => {
  test('User A cannot access User B tasks (GET by id returns 404)', requireDB(async () => {
    // Create a task as the test user (User A)
    const createRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'User A private task', dur: 30 });
    expect(createRes.status).toBe(201);
    const taskId = createRes.body.task.id;

    // Mint a JWT for User B — different sub + email
    // The email does NOT exist in the DB, so jwt-auth resolves partial user from JWT only
    const userBToken = await harness.makeJWT({
      sub: 'e2e-user-b-999',
      email: 'userb@e2e-juggler.local',
      apps: ['juggler']
    });

    const res = await request(app)
      .get(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${userBToken}`);

    // Should be 404: task not found for this user (controller filters by user_id)
    expect(res.status).toBe(404);
  }, harnessProbe));

  test('GET /api/tasks for User B returns empty list (no cross-user leak)', requireDB(async () => {
    const userBToken = await harness.makeJWT({
      sub: 'e2e-user-b-999',
      email: 'userb@e2e-juggler.local',
      apps: ['juggler']
    });

    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${userBToken}`);

    expect(res.status).toBe(200);
    const tasks = res.body.tasks || [];
    // None of these tasks should belong to User A
    const userATaskIds = tasks.filter(t => t.userId === harness.TEST_USER_ID || t.user_id === harness.TEST_USER_ID);
    expect(userATaskIds.length).toBe(0);
  }, harnessProbe));
});
