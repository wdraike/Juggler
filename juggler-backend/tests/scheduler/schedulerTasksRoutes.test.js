/**
 * Unit tests for routes/scheduler-tasks.routes.js (999.627).
 *
 * Pure supertest against a minimal express app — no DB, no JWT stack.
 * scheduleQueue.runScheduleForPush is mocked so we test the push-handler in
 * isolation: auth-guarding (shared-secret + bypass), payload validation,
 * job dispatch, and the status-code → Cloud-Tasks-retry contract.
 */

const mockRunScheduleForPush = jest.fn();
jest.mock('../../src/scheduler/scheduleQueue', () => ({
  runScheduleForPush: mockRunScheduleForPush,
}));

const request = require('supertest');
const express = require('express');

const AUTH_ENV = ['JUGGLER_TASK_SECRET', 'INTERNAL_SERVICE_KEY', 'SKIP_SCHEDULER_TASK_AUTH',
  'JUGGLER_WORKER_BASE_URL', 'CLOUD_TASKS_INVOKER_SA'];

function makeApp() {
  const app = express();
  app.use('/tasks', require('../../src/routes/scheduler-tasks.routes'));
  return app;
}

describe('scheduler-tasks push-handler', () => {
  const saved = {};
  beforeAll(() => { AUTH_ENV.forEach(k => { saved[k] = process.env[k]; }); });
  afterAll(() => {
    AUTH_ENV.forEach(k => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    AUTH_ENV.forEach(k => delete process.env[k]);
  });

  describe('auth guard', () => {
    test('401 when no credentials presented', async () => {
      process.env.JUGGLER_TASK_SECRET = 'topsecret';
      const res = await request(makeApp())
        .post('/tasks/juggler-scheduler-runs')
        .send({ userId: 'u1' });
      expect(res.status).toBe(401);
      expect(mockRunScheduleForPush).not.toHaveBeenCalled();
    });

    test('403 when shared-secret header is wrong', async () => {
      process.env.JUGGLER_TASK_SECRET = 'topsecret';
      const res = await request(makeApp())
        .post('/tasks/q')
        .set('X-Scheduler-Task-Key', 'wrong')
        .send({ userId: 'u1' });
      expect(res.status).toBe(403);
      expect(mockRunScheduleForPush).not.toHaveBeenCalled();
    });

    test('runs when shared-secret header matches JUGGLER_TASK_SECRET', async () => {
      process.env.JUGGLER_TASK_SECRET = 'topsecret';
      mockRunScheduleForPush.mockResolvedValueOnce({ claimed: true, success: true });
      const res = await request(makeApp())
        .post('/tasks/q')
        .set('X-Scheduler-Task-Key', 'topsecret')
        .send({ userId: 'u1' });
      expect(res.status).toBe(200);
      expect(mockRunScheduleForPush).toHaveBeenCalledWith('u1');
    });

    test('falls back to INTERNAL_SERVICE_KEY when JUGGLER_TASK_SECRET unset', async () => {
      process.env.INTERNAL_SERVICE_KEY = 'shared-internal';
      mockRunScheduleForPush.mockResolvedValueOnce({ claimed: true, success: true });
      const res = await request(makeApp())
        .post('/tasks/q')
        .set('X-Scheduler-Task-Key', 'shared-internal')
        .send({ userId: 'u1' });
      expect(res.status).toBe(200);
    });

    test('SKIP_SCHEDULER_TASK_AUTH=true bypasses auth (dev only)', async () => {
      process.env.SKIP_SCHEDULER_TASK_AUTH = 'true';
      mockRunScheduleForPush.mockResolvedValueOnce({ claimed: true, success: true });
      const res = await request(makeApp()).post('/tasks/q').send({ userId: 'u1' });
      expect(res.status).toBe(200);
    });

    test('a presented shared-secret header does NOT authenticate when no secret is configured', async () => {
      // No JUGGLER_TASK_SECRET / INTERNAL_SERVICE_KEY set, and no OIDC bearer.
      const res = await request(makeApp())
        .post('/tasks/q')
        .set('X-Scheduler-Task-Key', 'anything')
        .send({ userId: 'u1' });
      expect(res.status).toBe(401);
      expect(mockRunScheduleForPush).not.toHaveBeenCalled();
    });
  });

  describe('payload + result mapping (auth bypassed)', () => {
    beforeEach(() => { process.env.SKIP_SCHEDULER_TASK_AUTH = 'true'; });

    test('400 (non-retryable) when userId missing', async () => {
      const res = await request(makeApp()).post('/tasks/q').send({ source: 'x' });
      expect(res.status).toBe(400);
      expect(mockRunScheduleForPush).not.toHaveBeenCalled();
    });

    // 999.996: Zod validation (scheduler-task.schema.js) — proves the schema
    // rejects a malformed type, not just an absent key (the pre-existing
    // `if (!userId)` check happened to also catch missing-key, but not e.g.
    // a non-string userId, which would have reached runScheduleForPush).
    test('400 (non-retryable) when userId is not a string', async () => {
      const res = await request(makeApp()).post('/tasks/q').send({ userId: 12345 });
      expect(res.status).toBe(400);
      expect(mockRunScheduleForPush).not.toHaveBeenCalled();
    });

    test('200 when run succeeds', async () => {
      mockRunScheduleForPush.mockResolvedValueOnce({ claimed: true, success: true });
      const res = await request(makeApp()).post('/tasks/q').send({ userId: 'u1' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    test('200 (benign no-op) when claim was lost to another runner', async () => {
      mockRunScheduleForPush.mockResolvedValueOnce({ claimed: false, reason: 'already_claimed' });
      const res = await request(makeApp()).post('/tasks/q').send({ userId: 'u1' });
      expect(res.status).toBe(200);
    });

    test('500 (retryable → Cloud Tasks retries/dead-letters) when the scheduler run fails', async () => {
      mockRunScheduleForPush.mockResolvedValueOnce({ claimed: true, success: false, error: 'boom' });
      const res = await request(makeApp()).post('/tasks/q').send({ userId: 'u1' });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('boom');
    });

    test('500 when the handler throws', async () => {
      mockRunScheduleForPush.mockRejectedValueOnce(new Error('kaboom'));
      const res = await request(makeApp()).post('/tasks/q').send({ userId: 'u1' });
      expect(res.status).toBe(500);
    });

    test('forwards Cloud Tasks retry-count header into the response', async () => {
      mockRunScheduleForPush.mockResolvedValueOnce({ claimed: true, success: true });
      const res = await request(makeApp())
        .post('/tasks/q')
        .set('X-CloudTasks-TaskRetryCount', '3')
        .send({ userId: 'u1' });
      expect(res.body.retryCount).toBe(3);
    });
  });

  test('_health probe responds ok', async () => {
    const res = await request(makeApp()).get('/tasks/_health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
