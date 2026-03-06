// Test rowToTask / taskToRow mapping round-trips
// We need to mock the db module since taskToRow uses db.fn.now()
jest.mock('../src/db', () => {
  const fn = { now: () => 'MOCK_NOW' };
  const mock = () => mock;
  mock.fn = fn;
  return mock;
});

const { rowToTask, taskToRow } = require('../src/controllers/task.controller');

describe('task mapping', () => {
  const sampleRow = {
    id: 't01',
    text: 'Test task',
    date: '3/15',
    day: 'Sun',
    time: '9:00 AM',
    dur: 30,
    time_remaining: null,
    pri: 'P2',
    project: 'proj1',
    status: 'wip',
    direction: 'some dir',
    section: 'sec',
    notes: 'some notes',
    due: '3/20',
    start_after: '3/10',
    location: '["home","work"]',
    tools: '["phone"]',
    when: 'morning',
    day_req: 'weekday',
    habit: 1,
    rigid: 0,
    split: 1,
    split_min: 15,
    recur: '{"type":"daily"}',
    source_id: 'src1',
    generated: 0,
    gcal_event_id: 'gcal_123',
    depends_on: '["t00"]',
    date_pinned: 1
  };

  describe('rowToTask', () => {
    it('maps DB row to API format', () => {
      const task = rowToTask(sampleRow);
      expect(task.id).toBe('t01');
      expect(task.text).toBe('Test task');
      expect(task.date).toBe('3/15');
      expect(task.timeRemaining).toBeNull();
      expect(task.location).toEqual(['home', 'work']);
      expect(task.tools).toEqual(['phone']);
      expect(task.habit).toBe(true);
      expect(task.rigid).toBe(false);
      expect(task.split).toBe(true);
      expect(task.recur).toEqual({ type: 'daily' });
      expect(task.dependsOn).toEqual(['t00']);
      expect(task.datePinned).toBe(true);
      expect(task.gcalEventId).toBe('gcal_123');
      expect(task.startAfter).toBe('3/10');
    });

    it('handles already-parsed JSON fields', () => {
      const row = { ...sampleRow, location: ['home'], tools: [], depends_on: [], recur: null };
      const task = rowToTask(row);
      expect(task.location).toEqual(['home']);
      expect(task.tools).toEqual([]);
      expect(task.dependsOn).toEqual([]);
      expect(task.recur).toBeNull();
    });
  });

  describe('taskToRow', () => {
    it('maps API task to DB row', () => {
      const task = {
        id: 't01', text: 'Test', date: '3/15', location: ['home'],
        tools: ['phone'], habit: true, rigid: false, dependsOn: ['t00'],
        recur: { type: 'daily' }, split: true, datePinned: true
      };
      const row = taskToRow(task, 'user1');
      expect(row.user_id).toBe('user1');
      expect(row.id).toBe('t01');
      expect(row.location).toBe('["home"]');
      expect(row.tools).toBe('["phone"]');
      expect(row.habit).toBe(1);
      expect(row.rigid).toBe(0);
      expect(row.depends_on).toBe('["t00"]');
      expect(row.recur).toBe('{"type":"daily"}');
      expect(row.split).toBe(1);
      expect(row.date_pinned).toBe(1);
    });

    it('only includes defined fields', () => {
      const row = taskToRow({ text: 'Minimal' }, 'user1');
      expect(row.text).toBe('Minimal');
      expect(row.date).toBeUndefined();
      expect(row.location).toBeUndefined();
    });
  });

  describe('round-trip', () => {
    it('taskToRow -> rowToTask preserves data', () => {
      const original = {
        id: 't01', text: 'Round trip', date: '3/15', day: 'Sun',
        time: '9:00 AM', dur: 45, pri: 'P1', project: 'test',
        status: 'wip', location: ['home', 'work'], tools: ['phone'],
        when: 'morning', habit: true, rigid: false, split: false,
        dependsOn: ['t00'], datePinned: true
      };
      const row = taskToRow(original, 'user1');
      const result = rowToTask(row);
      expect(result.id).toBe(original.id);
      expect(result.text).toBe(original.text);
      expect(result.location).toEqual(original.location);
      expect(result.tools).toEqual(original.tools);
      expect(result.habit).toBe(original.habit);
      expect(result.dependsOn).toEqual(original.dependsOn);
    });
  });
});
