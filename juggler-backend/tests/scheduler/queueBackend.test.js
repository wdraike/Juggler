/**
 * Unit tests for scheduler/queue-backend.js (999.627).
 *
 * The DRIVER is read from JUGGLER_QUEUE_DRIVER at module load, so each scenario
 * sets the env then jest.isolateModules() to get a fresh module instance. The
 * cloud-tasks driver is mocked — no SDK/emulator needed.
 */

describe('queue-backend', () => {
  const saved = process.env.JUGGLER_QUEUE_DRIVER;
  afterAll(() => {
    if (saved === undefined) delete process.env.JUGGLER_QUEUE_DRIVER;
    else process.env.JUGGLER_QUEUE_DRIVER = saved;
  });

  afterEach(() => { jest.resetModules(); });

  test('default driver is db; dispatchScheduleRun is a no-op pass-through', async () => {
    delete process.env.JUGGLER_QUEUE_DRIVER;
    await jest.isolateModulesAsync(async () => {
      const backend = require('../../src/scheduler/queue-backend');
      expect(backend.DRIVER).toBe('db');
      expect(backend.isCloudTasks()).toBe(false);
      const res = await backend.dispatchScheduleRun('u1', 'api:test');
      expect(res).toEqual({ backend: 'db', dispatched: false });
    });
  });

  test('cloud-tasks driver dispatches via the driver and reports dispatched:true', async () => {
    process.env.JUGGLER_QUEUE_DRIVER = 'cloud-tasks';
    const createTask = jest.fn().mockResolvedValue({ name: 'projects/x/.../tasks/abc' });
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../src/scheduler/cloud-tasks-driver', () => ({ createTask }));
      const backend = require('../../src/scheduler/queue-backend');
      expect(backend.isCloudTasks()).toBe(true);
      const res = await backend.dispatchScheduleRun('u1', 'api:updateTask');
      expect(res.backend).toBe('cloud-tasks');
      expect(res.dispatched).toBe(true);
      expect(createTask).toHaveBeenCalledTimes(1);
      const [queueName, payload] = createTask.mock.calls[0];
      expect(queueName).toBe('juggler-scheduler-runs');
      expect(payload.userId).toBe('u1');
      expect(payload.source).toBe('api:updateTask');
    });
  });

  test('reports deduped:true when the driver swallows ALREADY_EXISTS', async () => {
    process.env.JUGGLER_QUEUE_DRIVER = 'cloud-tasks';
    const createTask = jest.fn().mockResolvedValue({ name: 'x', deduped: true });
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../src/scheduler/cloud-tasks-driver', () => ({ createTask }));
      const backend = require('../../src/scheduler/queue-backend');
      const res = await backend.dispatchScheduleRun('u1', 's');
      expect(res.deduped).toBe(true);
    });
  });

  test('falls back (fellBack:true, dispatched:false) when the driver throws — never drops the trigger', async () => {
    process.env.JUGGLER_QUEUE_DRIVER = 'cloud-tasks';
    const createTask = jest.fn().mockRejectedValue(new Error('network down'));
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../src/scheduler/cloud-tasks-driver', () => ({ createTask }));
      const backend = require('../../src/scheduler/queue-backend');
      const res = await backend.dispatchScheduleRun('u1', 's');
      expect(res.dispatched).toBe(false);
      expect(res.fellBack).toBe(true);
    });
  });

  test('honors JUGGLER_SCHEDULER_QUEUE override', async () => {
    process.env.JUGGLER_QUEUE_DRIVER = 'cloud-tasks';
    process.env.JUGGLER_SCHEDULER_QUEUE = 'custom-queue';
    const createTask = jest.fn().mockResolvedValue({ name: 'x' });
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../src/scheduler/cloud-tasks-driver', () => ({ createTask }));
      const backend = require('../../src/scheduler/queue-backend');
      await backend.dispatchScheduleRun('u1', 's');
      expect(createTask.mock.calls[0][0]).toBe('custom-queue');
    });
    delete process.env.JUGGLER_SCHEDULER_QUEUE;
  });
});
