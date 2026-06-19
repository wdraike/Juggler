/**
 * Unit tests for scheduler/cloud-tasks-driver.js (999.627).
 *
 * No live Cloud Tasks / emulator: @google-cloud/tasks is mocked so we can
 * assert the createTask REQUEST SHAPE (url, OIDC token, base64 body, dedup
 * task name) and the ALREADY_EXISTS dedup-swallow behavior.
 */

// Mock the SDK before requiring the driver (lazy-required inside client()).
const mockCreateTask = jest.fn();
const mockQueuePath = jest.fn((p, l, q) => `projects/${p}/locations/${l}/queues/${q}`);
jest.mock('@google-cloud/tasks', () => ({
  CloudTasksClient: jest.fn().mockImplementation(() => ({
    queuePath: mockQueuePath,
    createTask: mockCreateTask,
  })),
}), { virtual: true });

const ENV_KEYS = ['GCP_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_REGION',
  'JUGGLER_WORKER_BASE_URL', 'CLOUD_TASKS_INVOKER_SA', 'CLOUD_TASKS_EMULATOR_HOST'];

describe('cloud-tasks-driver (scheduler)', () => {
  let driver;
  const saved = {};

  beforeAll(() => { ENV_KEYS.forEach(k => { saved[k] = process.env[k]; }); });
  afterAll(() => {
    ENV_KEYS.forEach(k => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    ENV_KEYS.forEach(k => delete process.env[k]);
    process.env.GCP_PROJECT = 'test-proj';
    process.env.GCP_REGION = 'us-central1';
    process.env.JUGGLER_WORKER_BASE_URL = 'https://juggler-worker.example.run.app';
    driver = require('../../src/scheduler/cloud-tasks-driver');
    driver._resetClient();
  });

  test('buildCreateTaskRequest builds a POST to /tasks/:queueName with base64 body', () => {
    const { parent, task } = driver.buildCreateTaskRequest(
      'juggler-scheduler-runs',
      { userId: 'u1', source: 'api:updateTask' }
    );
    expect(parent).toBe('projects/test-proj/locations/us-central1/queues/juggler-scheduler-runs');
    expect(task.httpRequest.httpMethod).toBe('POST');
    expect(task.httpRequest.url).toBe('https://juggler-worker.example.run.app/tasks/juggler-scheduler-runs');
    expect(task.httpRequest.headers['Content-Type']).toBe('application/json');
    const decoded = JSON.parse(Buffer.from(task.httpRequest.body, 'base64').toString());
    expect(decoded).toEqual({ userId: 'u1', source: 'api:updateTask' });
  });

  test('attaches OIDC token when CLOUD_TASKS_INVOKER_SA is set', () => {
    process.env.CLOUD_TASKS_INVOKER_SA = 'invoker@test-proj.iam.gserviceaccount.com';
    const { task } = driver.buildCreateTaskRequest('q', { userId: 'u1' });
    expect(task.httpRequest.oidcToken).toEqual({
      serviceAccountEmail: 'invoker@test-proj.iam.gserviceaccount.com',
      audience: 'https://juggler-worker.example.run.app',
    });
  });

  test('omits OIDC token when no invoker SA configured (emulator/dev)', () => {
    const { task } = driver.buildCreateTaskRequest('q', { userId: 'u1' });
    expect(task.httpRequest.oidcToken).toBeUndefined();
  });

  test('dedupKey sets a sanitized task.name for idempotency', () => {
    const { task } = driver.buildCreateTaskRequest('q', { userId: 'u1' }, { dedupKey: 'sched/u 1@!' });
    expect(task.name).toMatch(/\/tasks\/sched_u_1__$/);
  });

  test('delaySeconds sets scheduleTime', () => {
    const { task } = driver.buildCreateTaskRequest('q', {}, { delaySeconds: 30 });
    expect(task.scheduleTime.seconds).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test('throws when GCP_PROJECT missing', () => {
    delete process.env.GCP_PROJECT;
    expect(() => driver.buildCreateTaskRequest('q', {})).toThrow(/GCP_PROJECT is required/);
  });

  test('throws when JUGGLER_WORKER_BASE_URL missing', () => {
    delete process.env.JUGGLER_WORKER_BASE_URL;
    expect(() => driver.buildCreateTaskRequest('q', {})).toThrow(/JUGGLER_WORKER_BASE_URL is required/);
  });

  test('createTask returns the created task name on success', async () => {
    mockCreateTask.mockResolvedValueOnce([{ name: 'projects/x/locations/y/queues/q/tasks/abc' }]);
    const res = await driver.createTask('q', { userId: 'u1' });
    expect(res).toEqual({ name: 'projects/x/locations/y/queues/q/tasks/abc' });
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
  });

  test('createTask swallows ALREADY_EXISTS (code 6) as a dedup success', async () => {
    const err = new Error('ALREADY_EXISTS: task exists');
    err.code = 6;
    mockCreateTask.mockRejectedValueOnce(err);
    const res = await driver.createTask('q', { userId: 'u1' }, { dedupKey: 'k1' });
    expect(res.deduped).toBe(true);
  });

  test('createTask rethrows non-dedup errors', async () => {
    const err = new Error('PERMISSION_DENIED');
    err.code = 7;
    mockCreateTask.mockRejectedValueOnce(err);
    await expect(driver.createTask('q', { userId: 'u1' })).rejects.toThrow(/PERMISSION_DENIED/);
  });
});
