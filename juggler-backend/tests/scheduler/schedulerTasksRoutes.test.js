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

const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken: mockVerifyIdToken })),
}));

const request = require('supertest');
const express = require('express');

const AUTH_ENV = ['JUGGLER_TASK_SECRET', 'INTERNAL_SERVICE_KEY', 'SKIP_SCHEDULER_TASK_AUTH',
  'JUGGLER_WORKER_BASE_URL', 'CLOUD_TASKS_INVOKER_SA', 'NODE_ENV', 'K_SERVICE'];

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
    jest.resetModules();
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
      process.env.NODE_ENV = 'development';
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
    beforeEach(() => { process.env.SKIP_SCHEDULER_TASK_AUTH = 'true'; process.env.NODE_ENV = 'development'; });

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

  describe('OIDC fail-closed (999.15739)', () => {
    const REAL_SA = 'cloud-tasks-invoker@lexical-period-466519-s0.iam.gserviceaccount.com';

    beforeEach(() => {
      process.env.JUGGLER_WORKER_BASE_URL = 'https://worker.example.com';
      delete process.env.JUGGLER_TASK_SECRET;
      delete process.env.INTERNAL_SERVICE_KEY;
      delete process.env.SKIP_SCHEDULER_TASK_AUTH;
      delete process.env.K_SERVICE;
      mockVerifyIdToken.mockReset();
      mockRunScheduleForPush.mockResolvedValueOnce({ claimed: true, success: true });
    });

    /** Helper: POST with a Bearer token — the route is reached only if auth passed. */
    function postWithToken(app, token) {
      return request(app).post('/tasks/some-queue')
        .set('Authorization', 'Bearer ' + (token || 'fake-token'))
        .send({ userId: 'u1' });
    }

    test('REFUSES when CLOUD_TASKS_INVOKER_SA is unset, even with a valid Google token', async () => {
      delete process.env.CLOUD_TASKS_INVOKER_SA;
      mockVerifyIdToken.mockResolvedValueOnce({
        getPayload: () => ({ email: 'anyone@some-other-project.iam.gserviceaccount.com' }),
      });
      const res = await postWithToken(makeApp());
      expect(res.status).toBe(500); // config-absent refusal, not a token failure
    });

    test('REFUSES a token from a different service account', async () => {
      process.env.CLOUD_TASKS_INVOKER_SA = REAL_SA;
      mockVerifyIdToken.mockResolvedValueOnce({
        getPayload: () => ({ email: 'attacker@evil.iam.gserviceaccount.com' }),
      });
      const res = await postWithToken(makeApp());
      expect(res.status).toBe(403);
    });

    test('ACCEPTS the configured service account and binds to our audience', async () => {
      process.env.CLOUD_TASKS_INVOKER_SA = REAL_SA;
      mockVerifyIdToken.mockResolvedValueOnce({
        getPayload: () => ({ email: REAL_SA }),
      });
      const res = await postWithToken(makeApp());
      expect(res.status).toBe(200);
      expect(mockVerifyIdToken).toHaveBeenCalledWith({
        idToken: 'fake-token',
        audience: 'https://worker.example.com',
      });
    });

    // ALLOWLIST, not denylist — 'Production', 'PRODUCTION', 'prod', 'staging', '' and
    // unset all sailed through the old `!== 'production'` check.
    test.each([
      ['production'], ['Production'], ['PRODUCTION'], ['prod'],
      ['production '], ['staging'], [''], [undefined],
    ])('REFUSES the SKIP_SCHEDULER_TASK_AUTH bypass when NODE_ENV=%p', async (nodeEnv) => {
      if (nodeEnv === undefined) { delete process.env.NODE_ENV; }
      else { process.env.NODE_ENV = nodeEnv; }
      process.env.SKIP_SCHEDULER_TASK_AUTH = 'true';
      process.env.CLOUD_TASKS_INVOKER_SA = REAL_SA;
      mockVerifyIdToken.mockRejectedValueOnce(new Error('not a real token'));
      const res = await postWithToken(makeApp());
      expect(res.status).toBe(500);
    });

    test('REFUSES the bypass on a deployed Cloud Run service even with NODE_ENV=development', async () => {
      process.env.NODE_ENV = 'development';
      process.env.K_SERVICE = 'juggler-backend';
      process.env.SKIP_SCHEDULER_TASK_AUTH = 'true';
      process.env.CLOUD_TASKS_INVOKER_SA = REAL_SA;
      mockVerifyIdToken.mockRejectedValueOnce(new Error('not a real token'));
      const res = await postWithToken(makeApp());
      expect(res.status).toBe(500);
    });

    test('REFUSES a token whose email claim only matches after trimming', async () => {
      process.env.CLOUD_TASKS_INVOKER_SA = REAL_SA;
      mockVerifyIdToken.mockResolvedValueOnce({
        getPayload: () => ({ email: REAL_SA + '\n' }),
      });
      const res = await postWithToken(makeApp());
      expect(res.status).toBe(403);
    });

    test('accepts a configured SA carrying a trailing newline (Secret Manager shape)', async () => {
      process.env.CLOUD_TASKS_INVOKER_SA = REAL_SA + '\n';
      mockVerifyIdToken.mockResolvedValueOnce({
        getPayload: () => ({ email: REAL_SA }),
      });
      const res = await postWithToken(makeApp());
      expect(res.status).toBe(200);
    });

    test.each([['development'], ['test'], ['Development'], ['TEST'], [' development ']])(
      'still honours SKIP_SCHEDULER_TASK_AUTH when NODE_ENV=%p (dev escape)',
      async (nodeEnv) => {
        process.env.NODE_ENV = nodeEnv;
        process.env.SKIP_SCHEDULER_TASK_AUTH = 'true';
        delete process.env.CLOUD_TASKS_INVOKER_SA;
        const res = await postWithToken(makeApp());
        expect(res.status).toBe(200); // reached the handler
      },
    );
  });

  test('_health probe responds ok', async () => {
    const res = await request(makeApp()).get('/tasks/_health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
