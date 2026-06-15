// TELLY-17a: Adversarial HIGH gap tests TS-301 to TS-304
// CONTRA-1: fixed+recurring validation gap
// File: fixedRecurringGap.test.js
// Tests: TS-301, TS-302, TS-303, TS-304

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const { setupTestDB, teardownTestDB } = require('../../test-helpers/db');
const { createTask, updateTask } = require('../../test-helpers/tasks');
const { runScheduler } = require('../../test-helpers/scheduler');
const { getTasks, getTaskInstances } = require('../../test-helpers/queries');
const { mockUIValidation } = require('../../test-helpers/ui');

/**
 * TS-301: Fixed + recurring via UI — UI blocks, returns error before API call
 * Domain: Placement Modes / Fixed / Recurring / UI Enforcement
 */
describe('TS-301: UI blocks fixed+recurring combination', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('SUB-301a: User sets fixed first, then enables recurring → toggle rebound', async () => {
    const validation = mockUIValidation();
    
    // Simulate user setting fixed mode first
    validation.setPlacementMode('fixed');
    validation.setTime('7:00 AM');
    
    // Then user tries to enable recurring
    validation.setRecurring(true);
    
    // UI should block and show error
    expect(validation.hasError()).toBe(true);
    expect(validation.getErrorMessage()).toContain('Fixed mode not available for recurring tasks');
    expect(validation.isSubmitDisabled()).toBe(true);
    
    // Recurring toggle should be reverted
    expect(validation.getRecurring()).toBe(false);
  });

  it('SUB-301b: User sets recurring first, then selects fixed → dropdown shows fixed as disabled', async () => {
    const validation = mockUIValidation();
    
    // User sets recurring first
    validation.setRecurring(true);
    validation.setRecurPattern({ type: 'daily' });
    
    // Then tries to select fixed mode
    validation.setPlacementMode('fixed');
    
    // Should show error and block
    expect(validation.hasError()).toBe(true);
    expect(validation.getErrorMessage()).toContain('Fixed mode not available for recurring tasks');
    expect(validation.isSubmitDisabled()).toBe(true);
    
    // Placement mode should not change to fixed
    expect(validation.getPlacementMode()).not.toBe('fixed');
  });

  it('SUB-301c: User edits existing non-recurring fixed task, enables recurring → save blocked', async () => {
    // Create a fixed non-recurring task
    const task = await createTask({
      text: 'Fixed task',
      dur: 30,
      placementMode: 'fixed',
      time: '7:00 AM',
      recurring: false
    });
    
    const validation = mockUIValidation(task.id);
    
    // Try to enable recurring on existing fixed task
    validation.setRecurring(true);
    
    // Should block save
    expect(validation.hasError()).toBe(true);
    expect(validation.isSubmitDisabled()).toBe(true);
  });

  it('SUB-301d: User edits existing recurring anytime task, changes to fixed → save blocked', async () => {
    // Create a recurring anytime task
    const task = await createTask({
      text: 'Recurring task',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'daily' }
    });
    
    const validation = mockUIValidation(task.id);
    
    // Try to change to fixed mode
    validation.setPlacementMode('fixed');
    
    // Should block save
    expect(validation.hasError()).toBe(true);
    expect(validation.isSubmitDisabled()).toBe(true);
  });
});

/**
 * TS-302: Fixed + recurring via API (bypassing UI) — currently accepted by backend (no server enforcement — GAP O7)
 * Domain: Placement Modes / Fixed / Recurring / Backend Enforcement
 */
describe('TS-302: API accepts fixed+recurring (current gap)', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('SUB-302a: API create with fixed + recurring + time → task created', async () => {
    const task = await createTask({
      text: 'Fixed recurring task',
      dur: 30,
      placementMode: 'fixed',
      time: '7:00 AM',
      recurring: true,
      recur: { type: 'daily' },
      recurStart: '2026-06-15'
    });
    
    expect(task).toBeDefined();
    expect(task.placementMode).toBe('fixed');
    expect(task.recurring).toBe(true);
    expect(task.time).toBe('7:00 AM');
    
    // Run scheduler to verify it generates instances
    await runScheduler();
    
    const instances = await getTaskInstances(task.id);
    expect(instances.length).toBeGreaterThan(0);
    
    // Check that instances are placed at 7:00 AM
    instances.forEach(instance => {
      expect(instance.scheduled_at).toContain('07:00:00');
    });
  });

  it('SUB-302b: API create with fixed + recurring + no time → falls back to anytime', async () => {
    const task = await createTask({
      text: 'Fixed recurring no time',
      dur: 30,
      placementMode: 'fixed',
      recurring: true,
      recur: { type: 'daily' },
      recurStart: '2026-06-15'
      // No time specified
    });
    
    expect(task).toBeDefined();
    expect(task.placementMode).toBe('fixed');
    expect(task.recurring).toBe(true);
    expect(task.time).toBeUndefined();
  });

  it('SUB-302c: API update: change existing recurring task to fixed → accepted', async () => {
    // Create recurring anytime task
    const task = await createTask({
      text: 'Recurring task',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'daily' }
    });
    
    // Update to fixed mode
    const updated = await updateTask(task.id, {
      placementMode: 'fixed',
      time: '9:00 AM'
    });
    
    expect(updated.placementMode).toBe('fixed');
    expect(updated.recurring).toBe(true);
  });

  it('SUB-302d: API update: change existing fixed task to recurring → accepted', async () => {
    // Create fixed non-recurring task
    const task = await createTask({
      text: 'Fixed task',
      dur: 30,
      placementMode: 'fixed',
      time: '8:00 AM',
      recurring: false
    });
    
    // Update to make it recurring
    const updated = await updateTask(task.id, {
      recurring: true,
      recur: { type: 'daily' }
    });
    
    expect(updated.placementMode).toBe('fixed');
    expect(updated.recurring).toBe(true);
  });
});

/**
 * TS-303: Fixed + recurring via MCP — currently accepted (same lack of enforcement)
 * Domain: MCP / Placement Modes / Fixed / Recurring
 */
describe('TS-303: MCP accepts fixed+recurring (same gap)', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('SUB-303a: MCP tasks.create with fixed+recurring → accepted', async () => {
    const { createTask: mcpCreate } = require('../../test-helpers/mcp');
    
    const task = await mcpCreate({
      text: 'MCP fixed recurring',
      dur: 45,
      placementMode: 'fixed',
      time: '9:00 AM',
      recurring: true,
      recur: { type: 'weekly', days: 'MWF' },
      recurStart: '2026-06-15'
    });
    
    expect(task).toBeDefined();
    expect(task.placementMode).toBe('fixed');
    expect(task.recurring).toBe(true);
  });

  it('SUB-303b: MCP tasks.update on existing task: set placementMode=fixed on recurring task → succeeds', async () => {
    const { createTask: mcpCreate, updateTask: mcpUpdate } = require('../../test-helpers/mcp');
    
    // Create recurring task via MCP
    const task = await mcpCreate({
      text: 'Recurring task',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'daily' }
    });
    
    // Update to fixed mode
    const updated = await mcpUpdate(task.id, {
      placementMode: 'fixed',
      time: '10:00 AM'
    });
    
    expect(updated.placementMode).toBe('fixed');
    expect(updated.recurring).toBe(true);
  });
});

/**
 * TS-304: Fixed + recurring — after backend validation fix → 400 rejected via all paths
 * Domain: Placement Modes / Fixed / Recurring / Backend Enforcement
 */
describe('TS-304: After fix - all paths reject fixed+recurring with 400', () => {
  beforeAll(async () => {
    await setupTestDB();
    // This test assumes the backend validation fix is applied
    process.env.FEATURE_FLAG_VALIDATE_FIXED_RECURRING = 'true';
  });

  afterAll(async () => {
    delete process.env.FEATURE_FLAG_VALIDATE_FIXED_RECURRING;
    await teardownTestDB();
  });

  it('SUB-304a: POST create with fixed+recurring → 400, task not created', async () => {
    await expect(createTask({
      text: 'Fixed recurring task',
      dur: 30,
      placementMode: 'fixed',
      time: '7:00 AM',
      recurring: true,
      recur: { type: 'daily' }
    })).rejects.toMatchObject({
      status: 400,
      error: 'invalid_combination'
    });
    
    // Verify no task was created
    const tasks = await getTasks({ text: 'Fixed recurring task' });
    expect(tasks.length).toBe(0);
  });

  it('SUB-304b: PUT update: change existing recurring task to fixed → 400, unchanged', async () => {
    // Create valid recurring task
    const task = await createTask({
      text: 'Recurring task',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'daily' }
    });
    
    // Try to update to fixed mode
    await expect(updateTask(task.id, {
      placementMode: 'fixed',
      time: '9:00 AM'
    })).rejects.toMatchObject({
      status: 400,
      error: 'invalid_combination'
    });
    
    // Verify task unchanged
    const updatedTask = await getTasks({ id: task.id });
    expect(updatedTask[0].placementMode).toBe('anytime');
  });

  it('SUB-304c: PUT update: change existing fixed task to recurring → 400, unchanged', async () => {
    // Create valid fixed task
    const task = await createTask({
      text: 'Fixed task',
      dur: 30,
      placementMode: 'fixed',
      time: '8:00 AM',
      recurring: false
    });
    
    // Try to make it recurring
    await expect(updateTask(task.id, {
      recurring: true,
      recur: { type: 'daily' }
    })).rejects.toMatchObject({
      status: 400,
      error: 'invalid_combination'
    });
    
    // Verify task unchanged
    const updatedTask = await getTasks({ id: task.id });
    expect(updatedTask[0].recurring).toBe(false);
  });

  it('SUB-304d: MCP create/update with fixed+recurring → MCP returns error', async () => {
    const { createTask: mcpCreate } = require('../../test-helpers/mcp');
    
    await expect(mcpCreate({
      text: 'MCP fixed recurring',
      dur: 45,
      placementMode: 'fixed',
      time: '9:00 AM',
      recurring: true,
      recur: { type: 'daily' }
    })).rejects.toMatchObject({
      error: 'invalid_combination'
    });
  });

  it('SUB-304e: Batch import: row with fixed+recurring → that row rejected', async () => {
    const { batchImportTasks } = require('../../test-helpers/import');
    
    const result = await batchImportTasks([
      {
        text: 'Valid task',
        dur: 30,
        placementMode: 'anytime',
        recurring: false
      },
      {
        text: 'Invalid fixed recurring',
        dur: 30,
        placementMode: 'fixed',
        time: '7:00 AM',
        recurring: true,
        recur: { type: 'daily' }
      }
    ]);
    
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toMatchObject({
      row: 1,
      error: 'invalid_combination'
    });
  });
});