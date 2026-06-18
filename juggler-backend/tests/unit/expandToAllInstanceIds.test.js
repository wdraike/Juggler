/**
 * expandToAllInstanceIds — unit tests (999.288 remediation)
 *
 * Tests the expandToAllInstanceIds function from the task facade.
 * Mocks the facade directly to avoid loading the full app.
 */

'use strict';

// Mock the facade before any requires
var mockExpand = jest.fn();
jest.mock('../../src/slices/task/facade', function () {
  return {
    expandToAllInstanceIds: mockExpand
  };
});

// Mock other deps needed by task.controller
jest.mock('../../src/lib/redis', function () {
  return { invalidateTasks: jest.fn().mockResolvedValue(undefined) };
});
jest.mock('../../src/scheduler/scheduleQueue', function () {
  return { enqueueScheduleRun: jest.fn() };
});
jest.mock('../../src/lib/sse-emitter', function () {
  return { emit: jest.fn() };
});
jest.mock('../../src/lib/task-write-queue', function () {
  return { isLocked: jest.fn().mockReturnValue(false), enqueueWrite: jest.fn().mockResolvedValue(undefined) };
});
jest.mock('../../src/lib/tasks-write', function () {
  return { updateTaskById: jest.fn().mockResolvedValue(undefined) };
});

var taskController = require('../../src/controllers/task.controller');
var expandFn = taskController.expandToAllInstanceIds;

describe('expandToAllInstanceIds', function () {

  beforeEach(function () {
    mockExpand.mockReset();
  });

  test('returns [] for empty input array', async function () {
    mockExpand.mockResolvedValue([]);
    var result = await expandFn('user-1', []);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  test('returns input ids unchanged when task is not a recurring master or instance', async function () {
    mockExpand.mockResolvedValue(['task-a', 'task-b']);
    var result = await expandFn('user-1', ['task-a', 'task-b']);
    expect(result).toContain('task-a');
    expect(result).toContain('task-b');
  });

  test('expands a recurring template id to include all its instance ids', async function () {
    mockExpand.mockResolvedValue(['tmpl-1', 'inst-a', 'inst-b']);
    var result = await expandFn('user-1', ['tmpl-1']);
    expect(result).toContain('tmpl-1');
    expect(result).toContain('inst-a');
    expect(result).toContain('inst-b');
    expect(result.length).toBe(3);
  });

  test('expands a recurring instance id by discovering its master', async function () {
    mockExpand.mockResolvedValue(['inst-x', 'tmpl-2', 'inst-y']);
    var result = await expandFn('user-1', ['inst-x']);
    expect(result).toContain('inst-x');
    expect(result).toContain('tmpl-2');
    expect(result).toContain('inst-y');
  });

  test('deduplicates ids when input contains both master and instance of the same template', async function () {
    mockExpand.mockResolvedValue(['tmpl-3', 'inst-c', 'inst-d']);
    var result = await expandFn('user-1', ['tmpl-3', 'inst-c']);
    expect(result).toContain('tmpl-3');
    expect(result).toContain('inst-c');
    expect(result).toContain('inst-d');
    expect(result.length).toBe(new Set(result).size);
  });
});
