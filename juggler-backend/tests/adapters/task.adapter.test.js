/**
 * Task adapter tests — demonstrates DI with InMemoryTaskRepository.
 *
 * This test suite shows how to test an adapter layer in isolation
 * from the database by injecting an in-memory test double.
 */

var InMemoryTaskRepository = require('../test-doubles/InMemoryTaskRepository');
var taskFactory = require('../factories/task.factory');
var injector = require('../helpers/test-injector');

var TEST_USER_ID = 'test-user-001';

// The "adapter" — in a real app this would import and use the db module.
// For this test, we create a simple adapter that wraps a repository.
var TaskAdapter = {
  repo: null,

  init: function (repo) {
    this.repo = repo;
  },

  createTask: function (props) {
    var task = taskFactory.createTask(TEST_USER_ID, props);
    return this.repo.create(task.master);
  },

  getTask: function (id) {
    return this.repo.findById(id, TEST_USER_ID);
  },

  updateTask: function (id, updates) {
    var task = this.repo.findById(id, TEST_USER_ID);
    if (!task) return null;
    // Small delay to ensure timestamp difference
    var now = new Date();
    now.setMilliseconds(now.getMilliseconds() + 1);
    var updated = Object.assign({}, task, updates, {
      updated_at: now.toISOString()
    });
    return this.repo.update(id, updated, TEST_USER_ID);
  },

  deleteTask: function (id) {
    return this.repo.delete(id, TEST_USER_ID);
  },

  listTasks: function () {
    return this.repo.findByUserId(TEST_USER_ID);
  }
};

// ─── Jest Tests ──────────────────────────────────────────────────────────────

describe('TaskAdapter with InMemoryTaskRepository', function () {
  var repo;

  beforeAll(function () {
    repo = new InMemoryTaskRepository();
    TaskAdapter.init(repo);
  });

  beforeEach(async function () {
    await repo.clear();
  });

  afterAll(function () {
    injector.reset();
  });

  describe('create → save → retrieve flow', function () {
    it('should create a new task and retrieve it by ID', async function () {
      var created = await TaskAdapter.createTask({
        text: 'Write adapter tests',
        dur: 45,
        project: 'juggler'
      });

      expect(created.id).toBeDefined();
      expect(created.text).toBe('Write adapter tests');
      expect(created.dur).toBe(45);
      expect(created.project).toBe('juggler');
      expect(created.user_id).toBe(TEST_USER_ID);
      expect(created.created_at).toBeDefined();
      expect(created.updated_at).toBeDefined();

      var retrieved = await TaskAdapter.getTask(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.text).toBe(created.text);
      expect(retrieved.dur).toBe(created.dur);
      expect(retrieved.project).toBe(created.project);
    });

    it('should generate unique IDs for multiple tasks', async function () {
      var t1 = await TaskAdapter.createTask({ text: 'Task 1' });
      var t2 = await TaskAdapter.createTask({ text: 'Task 2' });
      var t3 = await TaskAdapter.createTask({ text: 'Task 3' });

      expect(t1.id).not.toBe(t2.id);
      expect(t2.id).not.toBe(t3.id);
      expect(t1.id).not.toBe(t3.id);

      var all = await TaskAdapter.listTasks();
      expect(all).toHaveLength(3);
    });

    it('should return null for non-existent task', async function () {
      var result = await TaskAdapter.getTask('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('update flow', function () {
    it('should update an existing task and persist changes', async function () {
      var created = await TaskAdapter.createTask({
        text: 'Initial title',
        dur: 30,
        status: ''
      });

      var updated = await TaskAdapter.updateTask(created.id, {
        text: 'Updated title',
        status: 'in-progress'
      });

      expect(updated).not.toBeNull();
      expect(updated.text).toBe('Updated title');
      expect(updated.status).toBe('in-progress');
      expect(updated.dur).toBe(30);
      expect(updated.updated_at).not.toBe(created.updated_at);

      var retrieved = await TaskAdapter.getTask(created.id);
      expect(retrieved.text).toBe('Updated title');
      expect(retrieved.status).toBe('in-progress');
    });

    it('should return null when updating non-existent task', async function () {
      var result = await TaskAdapter.updateTask('non-existent', { text: 'New title' });
      expect(result).toBeNull();
    });
  });

  describe('delete flow', function () {
    it('should delete a task and confirm it is gone', async function () {
      var created = await TaskAdapter.createTask({ text: 'Task to delete' });

      var before = await TaskAdapter.getTask(created.id);
      expect(before).not.toBeNull();

      var deleted = await TaskAdapter.deleteTask(created.id);
      expect(deleted).not.toBeNull();
      expect(deleted.id).toBe(created.id);

      var after = await TaskAdapter.getTask(created.id);
      expect(after).toBeNull();
    });

    it('should return false when deleting non-existent task', async function () {
      var result = await TaskAdapter.deleteTask('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('list tasks', function () {
    it('should list only tasks for the test user', async function () {
      await TaskAdapter.createTask({ text: 'User task 1' });
      await TaskAdapter.createTask({ text: 'User task 2' });

      var otherUserTask = taskFactory.createTask('other-user', {
        text: 'Other user task'
      });
      await repo.create(otherUserTask.master);

      var list = await TaskAdapter.listTasks();
      expect(list).toHaveLength(2);
      expect(list.map(function (t) { return t.text; })).toContain('User task 1');
      expect(list.map(function (t) { return t.text; })).toContain('User task 2');
      expect(list.map(function (t) { return t.text; })).not.toContain('Other user task');
    });
  });

  describe('DI verification', function () {
    it('should use injected repository, not real DB', async function () {
      var count = repo.size;
      expect(count).toBe(0);

      await TaskAdapter.createTask({ text: 'DI test' });

      count = repo.size;
      expect(count).toBe(1);
    });
  });
});