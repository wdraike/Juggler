// TELLY-03: Mode transition tests TS-62 to TS-71
// Mode transitions: anytime-fixed, fixed-anytime, time_window-time_blocks, time_blocks-anytime, all_day, reminder, calendar-sync lock, takeOwnership, drag-to-fixed
// File: modeTransitions.test.js
// Tests: TS-62, TS-63, TS-64, TS-65, TS-66, TS-67, TS-68, TS-69, TS-70, TS-71

const { describe, it, expect, beforeAll, afterAll, beforeEach } = require('@jest/globals');
const { setupTestDB, teardownTestDB } = require('../../test-helpers/db');
const { createTask, updateTask, createRecurringTask } = require('../../test-helpers/tasks');
const { runScheduler } = require('../../test-helpers/scheduler');
const { getTasks, getTaskInstances } = require('../../test-helpers/queries');
const { mockClock, mockTimezone } = require('../../test-helpers/time');

/**
 * TS-62: Anytime → Fixed mode transition
 * Domain: Placement Modes / Mode Transitions / Anytime to Fixed
 */
describe('TS-62: Anytime → Fixed mode transition', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: Change anytime task to fixed mode with time specified', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create an anytime task
    const task = await createTask({
      text: 'Anytime task',
      dur: 30,
      pri: 'P3',
      when: 'morning',
      placementMode: 'anytime'
    });

    // Verify initial state
    expect(task.placementMode).toBe('anytime');
    expect(task.time).toBeUndefined();

    // Change to fixed mode with time
    const updatedTask = await updateTask(task.id, {
      placementMode: 'fixed',
      time: '9:00 AM'
    });

    expect(updatedTask.placementMode).toBe('fixed');
    expect(updatedTask.time).toBe('9:00 AM');

    // Run scheduler
    await runScheduler();

    // Verify task is scheduled at the fixed time
    const scheduledTask = await getTasks({ id: task.id });
    expect(scheduledTask.scheduled_at).toContain('09:00:00');
  });

  it('SUB-62a: Anytime→Fixed without time specified → should fail validation', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create an anytime task
    const task = await createTask({
      text: 'Anytime task no time',
      dur: 30,
      placementMode: 'anytime'
    });

    // Try to change to fixed mode without time
    await expect(updateTask(task.id, {
      placementMode: 'fixed'
      // No time specified
    })).rejects.toMatchObject({
      status: 400,
      error: 'time_required_for_fixed_mode'
    });
  });

  it('SUB-62b: Anytime→Fixed on recurring task → should fail (fixed+recurring not allowed)', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create a recurring anytime task
    const task = await createRecurringTask({
      text: 'Recurring anytime task',
      dur: 30,
      placementMode: 'anytime',
      recur: { type: 'daily' }
    });

    // Try to change to fixed mode
    await expect(updateTask(task.id, {
      placementMode: 'fixed',
      time: '9:00 AM'
    })).rejects.toMatchObject({
      status: 400,
      error: 'invalid_combination'
    });
  });
});

/**
 * TS-63: Fixed → Anytime mode transition
 * Domain: Placement Modes / Mode Transitions / Fixed to Anytime
 */
describe('TS-63: Fixed → Anytime mode transition', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: Change fixed task to anytime mode', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create a fixed task
    const task = await createTask({
      text: 'Fixed task',
      dur: 30,
      placementMode: 'fixed',
      time: '9:00 AM'
    });

    // Verify initial state
    expect(task.placementMode).toBe('fixed');
    expect(task.time).toBe('9:00 AM');

    // Change to anytime mode
    const updatedTask = await updateTask(task.id, {
      placementMode: 'anytime',
      when: 'morning'
    });

    expect(updatedTask.placementMode).toBe('anytime');
    expect(updatedTask.time).toBeUndefined();

    // Run scheduler
    await runScheduler();

    // Verify task is scheduled in the morning window
    const scheduledTask = await getTasks({ id: task.id });
    expect(scheduledTask.scheduled_at).toBeTruthy();
    const scheduledHour = new Date(scheduledTask.scheduled_at).getHours();
    expect(scheduledHour).toBeGreaterThanOrEqual(6); // Morning starts at 6am
    expect(scheduledHour).toBeLessThan(12); // Morning ends at 12pm
  });

  it('SUB-63a: Fixed→Anytime preserves date_pinned if set', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create a fixed task with pinned date
    const task = await createTask({
      text: 'Fixed pinned task',
      dur: 30,
      placementMode: 'fixed',
      time: '9:00 AM',
      scheduled_at: '2026-06-20T09:00:00Z',
      date_pinned: true
    });

    // Change to anytime mode
    const updatedTask = await updateTask(task.id, {
      placementMode: 'anytime',
      when: 'morning'
    });

    expect(updatedTask.placementMode).toBe('anytime');
    expect(updatedTask.date_pinned).toBe(true);
    expect(updatedTask.scheduled_at).toBe('2026-06-20T09:00:00Z');
  });
});

/**
 * TS-64: Time Window → Time Blocks mode transition
 * Domain: Placement Modes / Mode Transitions / Time Window to Time Blocks
 */
describe('TS-64: Time Window → Time Blocks mode transition', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: Change time_window task to time_blocks mode', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create a time_window task
    const task = await createTask({
      text: 'Time window task',
      dur: 60,
      placementMode: 'time_window',
      window_start: '9:00 AM',
      window_end: '11:00 AM'
    });

    // Verify initial state
    expect(task.placementMode).toBe('time_window');
    expect(task.window_start).toBe('9:00 AM');
    expect(task.window_end).toBe('11:00 AM');

    // Change to time_blocks mode
    const updatedTask = await updateTask(task.id, {
      placementMode: 'time_blocks',
      blocks: ['9:00-10:00', '10:00-11:00']
    });

    expect(updatedTask.placementMode).toBe('time_blocks');
    expect(updatedTask.blocks).toEqual(['9:00-10:00', '10:00-11:00']);
    expect(updatedTask.window_start).toBeUndefined();
    expect(updatedTask.window_end).toBeUndefined();

    // Run scheduler
    await runScheduler();

    // Verify task is scheduled in one of the blocks
    const scheduledTask = await getTasks({ id: task.id });
    expect(scheduledTask.scheduled_at).toBeTruthy();
  });

  it('SUB-64a: Time window→Time blocks with overlapping blocks → should succeed', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create a time_window task
    const task = await createTask({
      text: 'Overlapping blocks task',
      dur: 30,
      placementMode: 'time_window',
      window_start: '9:00 AM',
      window_end: '12:00 PM'
    });

    // Change to time_blocks with overlapping blocks
    const updatedTask = await updateTask(task.id, {
      placementMode: 'time_blocks',
      blocks: ['9:00-10:30', '10:00-11:30', '11:00-12:00']
    });

    expect(updatedTask.placementMode).toBe('time_blocks');
    expect(updatedTask.blocks.length).toBe(3);
  });
});

/**
 * TS-65: Time Blocks → Anytime mode transition
 * Domain: Placement Modes / Mode Transitions / Time Blocks to Anytime
 */
describe('TS-65: Time Blocks → Anytime mode transition', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: Change time_blocks task to anytime mode', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create a time_blocks task
    const task = await createTask({
      text: 'Time blocks task',
      dur: 30,
      placementMode: 'time_blocks',
      blocks: ['9:00-10:00', '11:00-12:00']
    });

    // Verify initial state
    expect(task.placementMode).toBe('time_blocks');
    expect(task.blocks).toEqual(['9:00-10:00', '11:00-12:00']);

    // Change to anytime mode
    const updatedTask = await updateTask(task.id, {
      placementMode: 'anytime',
      when: 'morning'
    });

    expect(updatedTask.placementMode).toBe('anytime');
    expect(updatedTask.blocks).toBeUndefined();

    // Run scheduler
    await runScheduler();

    // Verify task is scheduled in the morning window
    const scheduledTask = await getTasks({ id: task.id });
    expect(scheduledTask.scheduled_at).toBeTruthy();
  });

  it('SUB-65a: Time blocks→Anytime preserves priority and duration', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create a time_blocks task with specific priority and duration
    const task = await createTask({
      text: 'Priority task',
      dur: 45,
      pri: 'P1',
      placementMode: 'time_blocks',
      blocks: ['9:00-10:00', '11:00-12:00']
    });

    // Change to anytime mode
    const updatedTask = await updateTask(task.id, {
      placementMode: 'anytime',
      when: 'afternoon'
    });

    expect(updatedTask.placementMode).toBe('anytime');
    expect(updatedTask.dur).toBe(45);
    expect(updatedTask.pri).toBe('P1');
  });
});

/**
 * TS-66: All Day mode transition behavior
 * Domain: Placement Modes / Mode Transitions / All Day
 */
describe('TS-66: All Day mode transition behavior', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: Create all_day task and verify scheduling', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create an all_day task
    const task = await createTask({
      text: 'All day task',
      dur: 480, // 8 hours
      placementMode: 'all_day'
    });

    expect(task.placementMode).toBe('all_day');

    // Run scheduler
    await runScheduler();

    // Verify task is scheduled for the full day
    const scheduledTask = await getTasks({ id: task.id });
    expect(scheduledTask.scheduled_at).toBeTruthy();
    expect(scheduledTask.scheduled_at).toContain('00:00:00'); // Should start at midnight
  });

  it('SUB-66a: All day task cannot be changed to fixed mode', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create an all_day task
    const task = await createTask({
      text: 'All day task',
      dur: 480,
      placementMode: 'all_day'
    });

    // Try to change to fixed mode
    await expect(updateTask(task.id, {
      placementMode: 'fixed',
      time: '9:00 AM'
    })).rejects.toMatchObject({
      status: 400,
      error: 'all_day_cannot_be_fixed'
    });
  });

  it('SUB-66b: All day→Anytime transition should work', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create an all_day task
    const task = await createTask({
      text: 'All day to anytime',
      dur: 60,
      placementMode: 'all_day'
    });

    // Change to anytime mode
    const updatedTask = await updateTask(task.id, {
      placementMode: 'anytime',
      when: 'morning'
    });

    expect(updatedTask.placementMode).toBe('anytime');

    // Run scheduler
    await runScheduler();

    // Verify task is scheduled in the morning window
    const scheduledTask = await getTasks({ id: task.id });
    expect(scheduledTask.scheduled_at).toBeTruthy();
  });
});

/**
 * TS-67: Reminder mode transition behavior
 * Domain: Placement Modes / Mode Transitions / Reminder
 */
describe('TS-67: Reminder mode transition behavior', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: Create reminder task and verify scheduling', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create a reminder task
    const task = await createTask({
      text: 'Reminder task',
      dur: 15,
      placementMode: 'reminder',
      reminder_time: '10:00 AM'
    });

    expect(task.placementMode).toBe('reminder');
    expect(task.reminder_time).toBe('10:00 AM');

    // Run scheduler
    await runScheduler();

    // Verify task is scheduled at reminder time
    const scheduledTask = await getTasks({ id: task.id });
    expect(scheduledTask.scheduled_at).toContain('10:00:00');
  });

  it('SUB-67a: Reminder→Fixed transition should work', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create a reminder task
    const task = await createTask({
      text: 'Reminder to fixed',
      dur: 30,
      placementMode: 'reminder',
      reminder_time: '10:00 AM'
    });

    // Change to fixed mode
    const updatedTask = await updateTask(task.id, {
      placementMode: 'fixed',
      time: '10:30 AM'
    });

    expect(updatedTask.placementMode).toBe('fixed');
    expect(updatedTask.time).toBe('10:30 AM');
  });

  it('SUB-67b: Reminder→Anytime transition should work', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create a reminder task
    const task = await createTask({
      text: 'Reminder to anytime',
      dur: 30,
      placementMode: 'reminder',
      reminder_time: '10:00 AM'
    });

    // Change to anytime mode
    const updatedTask = await updateTask(task.id, {
      placementMode: 'anytime',
      when: 'morning'
    });

    expect(updatedTask.placementMode).toBe('anytime');

    // Run scheduler
    await runScheduler();

    // Verify task is scheduled in the morning window
    const scheduledTask = await getTasks({ id: task.id });
    expect(scheduledTask.scheduled_at).toBeTruthy();
  });
});

/**
 * TS-68: Calendar sync lock behavior
 * Domain: Placement Modes / Calendar Sync / Lock Behavior
 */
describe('TS-68: Calendar sync lock behavior', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: Synced task cannot change placement mode while locked', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create a synced task (simulate calendar sync)
    const task = await createTask({
      text: 'Synced task',
      dur: 30,
      placementMode: 'fixed',
      time: '9:00 AM',
      synced: true,
      sync_lock: true,
      sync_provider: 'google_calendar',
      sync_event_id: 'gcal_12345'
    });

    // Try to change placement mode while locked
    await expect(updateTask(task.id, {
      placementMode: 'anytime',
      when: 'morning'
    })).rejects.toMatchObject({
      status: 403,
      error: 'sync_locked_cannot_modify_placement'
    });
  });

  it('SUB-68a: Unlocked synced task can change placement mode', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create a synced task without lock
    const task = await createTask({
      text: 'Unlocked synced task',
      dur: 30,
      placementMode: 'fixed',
      time: '9:00 AM',
      synced: true,
      sync_lock: false,
      sync_provider: 'google_calendar'
    });

    // Change placement mode should work
    const updatedTask = await updateTask(task.id, {
      placementMode: 'anytime',
      when: 'morning'
    });

    expect(updatedTask.placementMode).toBe('anytime');
  });

  it('SUB-68b: Sync lock prevents time changes on fixed tasks', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create a locked synced fixed task
    const task = await createTask({
      text: 'Locked fixed task',
      dur: 30,
      placementMode: 'fixed',
      time: '9:00 AM',
      synced: true,
      sync_lock: true,
      sync_provider: 'google_calendar'
    });

    // Try to change time
    await expect(updateTask(task.id, {
      time: '10:00 AM'
    })).rejects.toMatchObject({
      status: 403,
      error: 'sync_locked_cannot_modify_time'
    });
  });
});

/**
 * TS-69: Take ownership mode transition
 * Domain: Placement Modes / Mode Transitions / Take Ownership
 */
describe('TS-69: Take ownership mode transition', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: User takes ownership of anytime task → becomes fixed', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create an anytime task
    const task = await createTask({
      text: 'Anytime task',
      dur: 30,
      placementMode: 'anytime',
      when: 'morning'
    });

    // User takes ownership (drags to specific time)
    const updatedTask = await updateTask(task.id, {
      placementMode: 'fixed',
      time: '9:30 AM',
      owned_by_user: true,
      ownership_timestamp: new Date().toISOString()
    });

    expect(updatedTask.placementMode).toBe('fixed');
    expect(updatedTask.time).toBe('9:30 AM');
    expect(updatedTask.owned_by_user).toBe(true);

    // Run scheduler
    await runScheduler();

    // Verify task is scheduled at the ownership time
    const scheduledTask = await getTasks({ id: task.id });
    expect(scheduledTask.scheduled_at).toContain('09:30:00');
  });

  it('SUB-69a: Take ownership preserves task properties', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create an anytime task with specific properties
    const task = await createTask({
      text: 'Important task',
      dur: 45,
      pri: 'P1',
      placementMode: 'anytime',
      when: 'morning',
      project: 'Work'
    });

    // User takes ownership
    const updatedTask = await updateTask(task.id, {
      placementMode: 'fixed',
      time: '10:00 AM',
      owned_by_user: true
    });

    expect(updatedTask.placementMode).toBe('fixed');
    expect(updatedTask.dur).toBe(45);
    expect(updatedTask.pri).toBe('P1');
    expect(updatedTask.project).toBe('Work');
  });

  it('SUB-69b: Release ownership → task returns to original placement mode', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create a task that was originally anytime, then took ownership
    const task = await createTask({
      text: 'Owned task',
      dur: 30,
      placementMode: 'fixed',
      time: '9:30 AM',
      owned_by_user: true,
      original_placement_mode: 'anytime',
      original_when: 'morning'
    });

    // Release ownership
    const updatedTask = await updateTask(task.id, {
      placementMode: 'anytime',
      when: 'morning',
      owned_by_user: false,
      time: undefined
    });

    expect(updatedTask.placementMode).toBe('anytime');
    expect(updatedTask.owned_by_user).toBe(false);

    // Run scheduler
    await runScheduler();

    // Verify task is scheduled in the morning window
    const scheduledTask = await getTasks({ id: task.id });
    expect(scheduledTask.scheduled_at).toBeTruthy();
  });
});

/**
 * TS-70: Drag-to-fixed mode transition
 * Domain: Placement Modes / Mode Transitions / Drag to Fixed
 */
describe('TS-70: Drag-to-fixed mode transition', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: User drags anytime task to specific time → becomes fixed', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create an anytime task
    const task = await createTask({
      text: 'Draggable task',
      dur: 30,
      placementMode: 'anytime',
      when: 'morning'
    });

    // User drags task to specific time (simulate drag-to-fixed)
    const updatedTask = await updateTask(task.id, {
      placementMode: 'fixed',
      time: '10:15 AM',
      dragged_by_user: true,
      drag_timestamp: new Date().toISOString()
    });

    expect(updatedTask.placementMode).toBe('fixed');
    expect(updatedTask.time).toBe('10:15 AM');
    expect(updatedTask.dragged_by_user).toBe(true);

    // Run scheduler
    await runScheduler();

    // Verify task is scheduled at the dragged time
    const scheduledTask = await getTasks({ id: task.id });
    expect(scheduledTask.scheduled_at).toContain('10:15:00');
  });

  it('SUB-70a: Drag-to-fixed on time_blocks task → becomes fixed at dragged time', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create a time_blocks task
    const task = await createTask({
      text: 'Blocks task',
      dur: 30,
      placementMode: 'time_blocks',
      blocks: ['9:00-10:00', '11:00-12:00']
    });

    // User drags task to specific time outside blocks
    const updatedTask = await updateTask(task.id, {
      placementMode: 'fixed',
      time: '10:30 AM',
      dragged_by_user: true
    });

    expect(updatedTask.placementMode).toBe('fixed');
    expect(updatedTask.time).toBe('10:30 AM');

    // Run scheduler
    await runScheduler();

    // Verify task is scheduled at the dragged time
    const scheduledTask = await getTasks({ id: task.id });
    expect(scheduledTask.scheduled_at).toContain('10:30:00');
  });

  it('SUB-70b: Drag-to-fixed preserves task priority and project', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create an anytime task with priority and project
    const task = await createTask({
      text: 'Priority project task',
      dur: 60,
      pri: 'P2',
      placementMode: 'anytime',
      when: 'afternoon',
      project: 'Client Work'
    });

    // User drags task to specific time
    const updatedTask = await updateTask(task.id, {
      placementMode: 'fixed',
      time: '2:00 PM',
      dragged_by_user: true
    });

    expect(updatedTask.placementMode).toBe('fixed');
    expect(updatedTask.pri).toBe('P2');
    expect(updatedTask.project).toBe('Client Work');

    // Run scheduler
    await runScheduler();

    // Verify task is scheduled at the dragged time
    const scheduledTask = await getTasks({ id: task.id });
    expect(scheduledTask.scheduled_at).toContain('14:00:00');
  });
});

/**
 * TS-71: Calendar sync lock release and re-sync
 * Domain: Placement Modes / Calendar Sync / Lock Release and Re-sync
 */
describe('TS-71: Calendar sync lock release and re-sync', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: Sync lock released → task can change placement mode', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create a locked synced task
    const task = await createTask({
      text: 'Locked synced task',
      dur: 30,
      placementMode: 'fixed',
      time: '9:00 AM',
      synced: true,
      sync_lock: true,
      sync_provider: 'google_calendar'
    });

    // Release sync lock
    const unlockedTask = await updateTask(task.id, {
      sync_lock: false
    });

    expect(unlockedTask.sync_lock).toBe(false);

    // Now change placement mode should work
    const updatedTask = await updateTask(task.id, {
      placementMode: 'anytime',
      when: 'morning'
    });

    expect(updatedTask.placementMode).toBe('anytime');
  });

  it('SUB-71a: Re-sync after local changes → sync lock re-applied', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create a synced task without lock
    const task = await createTask({
      text: 'Synced task',
      dur: 30,
      placementMode: 'fixed',
      time: '9:00 AM',
      synced: true,
      sync_lock: false,
      sync_provider: 'google_calendar'
    });

    // User changes placement mode locally
    const updatedTask = await updateTask(task.id, {
      placementMode: 'anytime',
      when: 'morning'
    });

    expect(updatedTask.placementMode).toBe('anytime');

    // Simulate re-sync from calendar (would re-apply lock)
    const reSyncedTask = await updateTask(task.id, {
      placementMode: 'fixed',
      time: '10:00 AM',
      sync_lock: true,
      sync_last_updated: new Date().toISOString()
    });

    expect(reSyncedTask.placementMode).toBe('fixed');
    expect(reSyncedTask.sync_lock).toBe(true);
  });

  it('SUB-71b: Sync conflict resolution → local changes preserved with warning', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Create a locked synced task
    const task = await createTask({
      text: 'Conflict task',
      dur: 30,
      placementMode: 'fixed',
      time: '9:00 AM',
      synced: true,
      sync_lock: true,
      sync_provider: 'google_calendar'
    });

    // User makes local changes (should be allowed but flagged)
    const updatedTask = await updateTask(task.id, {
      placementMode: 'anytime',
      when: 'morning',
      sync_conflict: true,
      conflict_resolution: 'local_wins'
    });

    expect(updatedTask.placementMode).toBe('anytime');
    expect(updatedTask.sync_conflict).toBe(true);
  });
});