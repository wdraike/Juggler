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
  const TZ = 'America/New_York';
  // scheduled_at is the UTC source of truth; date/time/day are derived from it
  // MySQL returns "YYYY-MM-DD HH:MM:SS" format (UTC)
  // 2026-03-15 13:00:00 UTC = 9:00 AM EDT (March 15 is in EDT, UTC-4)
  const sampleRow = {
    id: 't01',
    text: 'Test task',
    scheduled_at: '2026-03-15 13:00:00',
    dur: 30,
    time_remaining: null,
    pri: 'P2',
    project: 'proj1',
    status: 'wip',
    direction: 'some dir',
    section: 'sec',
    notes: 'some notes',
    deadline: '2026-03-20',
    start_after_at: '2026-03-10',
    location: '["home","work"]',
    tools: '["phone"]',
    when: 'morning',
    day_req: 'weekday',
    recurring: 1,
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
      const task = rowToTask(sampleRow, TZ);
      expect(task.id).toBe('t01');
      expect(task.text).toBe('Test task');
      expect(task.date).toBe('2026-03-15');
      expect(task.time).toBe('9:00 AM');
      expect(task.timeRemaining).toBeNull();
      expect(task.location).toEqual(['home', 'work']);
      expect(task.tools).toEqual(['phone']);
      expect(task.recurring).toBe(true);
      expect(task.placementMode).toBe('anytime'); // rigid removed; placementMode is the authoritative field
      expect(task.split).toBe(true);
      expect(task.recur).toEqual({ type: 'daily' });
      expect(task.dependsOn).toEqual(['t00']);
      expect(task.datePinned).toBe(true);
      expect(task.gcalEventId).toBe('gcal_123');
      expect(task.deadline).toBe('2026-03-20');
      expect(task.startAfter).toBe('2026-03-10');
    });

    it('handles already-parsed JSON fields', () => {
      const row = { ...sampleRow, location: ['home'], tools: [], depends_on: [], recur: null };
      const task = rowToTask(row, TZ);
      expect(task.location).toEqual(['home']);
      expect(task.tools).toEqual([]);
      expect(task.dependsOn).toEqual([]);
      expect(task.recur).toBeNull();
    });
  });

  describe('taskToRow', () => {
    it('maps API task to DB row', () => {
      const task = {
        id: 't01', text: 'Test', date: '2026-03-15', location: ['home'],
        tools: ['phone'], recurring: true, rigid: false, dependsOn: ['t00'],
        recur: { type: 'daily' }, split: true, datePinned: true
      };
      const row = taskToRow(task, 'user1');
      expect(row.user_id).toBe('user1');
      expect(row.id).toBe('t01');
      expect(row.location).toBe('["home"]');
      expect(row.tools).toBe('["phone"]');
      expect(row.recurring).toBe(1);
      // placement_mode is only written when client explicitly supplies placementMode.
      // No placementMode in the task above → undefined (no server-side derivation).
      expect(row.placement_mode).toBeUndefined();
      expect(row.rigid).toBeUndefined();
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

    it('does NOT derive placement_mode from currentTask fields — only explicit placementMode is written', () => {
      // After 09-03: server never derives placement_mode from when/recurring/rigid/preferredTimeMins.
      // An update that only touches `when` leaves placement_mode undefined in the row.
      const existing = {
        recurring: 1,
        preferred_time_mins: 1140,
        rigid: 0,
        marker: 0,
        when: 'morning',
        placement_mode: 'time_window'
      };
      const row = taskToRow({ when: 'evening' }, 'user1', null, existing);
      expect(row.placement_mode).toBeUndefined();
      expect(row.when).toBe('evening');
    });

    it('does not set placement_mode when placementMode absent (create path, recurring with preferredTimeMins)', () => {
      // After 09-03: no server-side derivation — client must supply placementMode explicitly.
      const row = taskToRow({ recurring: true, preferredTimeMins: 1140, when: 'evening' }, 'user1');
      expect(row.placement_mode).toBeUndefined();
    });

    it('writes placement_mode when client explicitly supplies placementMode alongside when', () => {
      // Correct post-09-03 pattern: UI sends placementMode in the patch.
      const dbRow = {
        task_type: 'recurring_template',
        recurring: 1,
        preferred_time_mins: 1140,
        rigid: 0,
        marker: 0,
        when: 'morning',
        placement_mode: 'time_window'
      };
      const row = taskToRow({ when: 'evening', placementMode: 'time_window' }, 'user1', null, dbRow);
      expect(row.placement_mode).toBe('time_window');
      expect(row.when).toBe('evening');
    });
  });

  describe('round-trip', () => {
    it('taskToRow -> rowToTask preserves data', () => {
      const original = {
        id: 't01', text: 'Round trip', date: '2026-03-15', day: 'Sun',
        time: '9:00 AM', dur: 45, pri: 'P1', project: 'test',
        status: 'wip', location: ['home', 'work'], tools: ['phone'],
        when: 'morning', recurring: true, rigid: false, split: false,
        dependsOn: ['t00'], datePinned: true
      };
      const row = taskToRow(original, 'user1', TZ);
      const result = rowToTask(row, TZ);
      expect(result.id).toBe(original.id);
      expect(result.text).toBe(original.text);
      expect(result.location).toEqual(original.location);
      expect(result.tools).toEqual(original.tools);
      expect(result.recurring).toBe(original.recurring);
      expect(result.dependsOn).toEqual(original.dependsOn);
    });
  });
});
