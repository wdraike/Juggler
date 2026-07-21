// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../../src/lib/audit-context').stampInsert(rows);
// TELLY-17a: fixed+recurring contract tests TS-301 to TS-304
// CONTRA-1: fixed+recurring placement-mode combination
// File: fixedRecurringGap.test.js
// Tests: TS-301, TS-302, TS-303, TS-304
//
// AUTHORITATIVE CONTRACT (999.867): `fixed ⊕ recurring` is REJECTED.
// validateTaskInput (src/slices/task/domain/validation/taskValidation.js:314-315)
// returns ['invalid_combination'] when placementMode === 'fixed' && recurring === true.
// The HTTP create/update path and the MCP create path both flow through it. These
// tests assert the REAL emitted contract on each path — not an idealized one — and
// flag the ONE real remaining divergence (MCP update; see TS-303).

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const { setupTestDB, teardownTestDB } = require('../../test-helpers/db');
const { createTask, updateTask } = require('../../test-helpers/tasks');
const { mockUIValidation } = require('../../test-helpers/ui');
const db = require('../../test-helpers/test-db');

// ── Real MCP handler harness ──────────────────────────────────────────────
// The shared MCP helper (test-helpers/mcp.js) cannot be required from this suite:
// `test-helpers` is a symlink to `tests/helpers/`, so the helper's
// `require('../src/mcp/tools/tasks')` resolves to the non-existent `tests/src/...`.
// We therefore register the REAL production tool handlers directly here — the same
// capturing-fake-server pattern every other MCP suite uses
// (tests/mcp-create-task-boundary.test.js). This invokes the real handler and the
// real validation/write path; no task logic is reimplemented. A handler that
// returns isError:true is the product's REJECTION; we surface its actual message.
const { registerTaskTools } = require('../../src/mcp/tools/tasks');

function mcpHandlers(userId) {
  const handlers = {};
  registerTaskTools({ tool: (name, _desc, _schema, h) => { handlers[name] = h; } }, userId || '1');
  return handlers;
}

// Invoke a real MCP tool handler; resolve with the parsed task on success, reject
// with the REAL handler error text on isError (mirrors test-helpers/mcp.js intent).
async function mcpCall(toolName, params, userId) {
  const handler = mcpHandlers(userId)[toolName];
  if (!handler) throw new Error(toolName + ' handler not registered');
  const result = await handler(Object.assign({}, params));
  const text = result && result.content && result.content[0] ? result.content[0].text : '';
  if (result && result.isError) {
    const err = new Error(text);
    err.error = text;
    err.isError = true;
    throw err;
  }
  try { return JSON.parse(text); } catch (e) { return text; }
}

// Count task_masters rows by text (the canonical place a created master lands).
// NOTE: getTasks({text}) cannot be used to verify (non-)creation — task_instances
// has no `text` column, so that query throws. Query task_masters directly instead.
async function countMastersByText(text) {
  const row = await db('task_masters').where({ text }).count({ c: 'id' }).first();
  return Number(row && row.c) || 0;
}

// Seed an EXISTING task_masters row directly (a precondition, not the unit under
// test). createTask() routes any payload carrying a `time`/`date`/instance-signal
// field to task_instances and validates fixed-mode scheduling, so it cannot stand
// up a pre-existing fixed master; we INSERT the master row directly instead. The
// subsequent updateTask() then exercises the real merged-state validator.
async function seedMaster(fields) {
  const now = new Date();
  const id = 'tm-' + require('crypto').randomBytes(6).toString('hex');
  await db('task_masters').insert(__stampFixture(Object.assign({
    id,
    user_id: '1',
    dur: 30,
    pri: 'P3',
    status: '',
    created_at: now,
    updated_at: now
  }, fields)));
  return id;
}

/**
 * TS-301: fixed+recurring via UI — the FRONTEND blocks the combination before any
 * API call (mockUIValidation models the React rule). 301a/301b assert the pure UI
 * rule. 301c/301d attempt the corresponding backend create/update and assert that
 * the BACKEND also rejects fixed+recurring with `invalid_combination` (999.867).
 */
describe('TS-301: fixed+recurring blocked at UI and backend', () => {
  beforeAll(async () => {
    // Date-only fake timers (999.2157): Date frozen, every timer API real — no hangs
    installDateOnlyFakeTimers(new Date('2026-01-15T12:00:00Z'));
    await setupTestDB();
  });

  afterAll(async () => {
    jest.useRealTimers();
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

  it('SUB-301b: User sets recurring first, then selects fixed → fixed rejected', async () => {
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

  it('SUB-301c: Editing a fixed task to enable recurring → backend rejects (invalid_combination)', async () => {
    // Precondition: an existing fixed, non-recurring master.
    const id = await seedMaster({ text: 'Fixed task 301c', placement_mode: 'fixed', recurring: 0 });

    // Enabling recurring on a fixed task is the rejected combination — the backend
    // validator (merged with the existing fixed row) throws invalid_combination.
    await expect(updateTask(id, {
      recurring: true,
      recur: { type: 'daily' }
    })).rejects.toMatchObject({
      status: 400,
      error: 'invalid_combination'
    });

    // Task unchanged — still non-recurring.
    const after = await db('task_masters').where({ id }).first();
    expect(!!after.recurring).toBe(false);
  });

  it('SUB-301d: Editing a recurring task to fixed → backend rejects (invalid_combination)', async () => {
    // Create a valid recurring anytime task.
    const task = await createTask({
      text: 'Recurring task 301d',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'daily' }
    });

    // Switching it to fixed is the rejected combination (merged: recurring + fixed).
    await expect(updateTask(task.id, {
      placementMode: 'fixed',
      time: '9:00 AM'
    })).rejects.toMatchObject({
      status: 400,
      error: 'invalid_combination'
    });

    // Task unchanged — still anytime.
    const after = await db('task_masters').where({ id: task.id }).first();
    expect(after.placement_mode).toBe('anytime');
  });
});

/**
 * TS-302: fixed+recurring via the HTTP/use-case path is REJECTED (999.867).
 * (Formerly asserted the pre-999.867 GAP that the backend ACCEPTED the combination —
 * that premise is dead: validateTaskInput now returns ['invalid_combination'].)
 * Covers both create and both update directions.
 */
describe('TS-302: HTTP path rejects fixed+recurring (invalid_combination)', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('SUB-302a: API create with fixed + recurring → rejected, not created', async () => {
    // The combination rule returns ['invalid_combination'] as the SOLE error before
    // the fixed-requires-time rule, so no `time` is needed to trigger the rejection.
    await expect(createTask({
      text: 'Fixed recurring 302a',
      dur: 30,
      placementMode: 'fixed',
      recurring: true,
      recur: { type: 'daily' },
      recurStart: '2026-06-15'
    })).rejects.toMatchObject({
      status: 400,
      error: 'invalid_combination'
    });

    expect(await countMastersByText('Fixed recurring 302a')).toBe(0);
  });

  it('SUB-302b: API create with fixed + recurring + no time → still rejected (combination, not time)', async () => {
    // fixed+recurring is rejected up front by the combination rule regardless of
    // whether a time is supplied — invalid_combination is the SOLE returned error.
    await expect(createTask({
      text: 'Fixed recurring 302b',
      dur: 30,
      placementMode: 'fixed',
      recurring: true,
      recur: { type: 'daily' },
      recurStart: '2026-06-15'
    })).rejects.toMatchObject({
      status: 400,
      error: 'invalid_combination'
    });

    expect(await countMastersByText('Fixed recurring 302b')).toBe(0);
  });

  it('SUB-302c: API update: change existing recurring task to fixed → rejected, unchanged', async () => {
    const task = await createTask({
      text: 'Recurring 302c',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'daily' }
    });

    await expect(updateTask(task.id, {
      placementMode: 'fixed',
      time: '9:00 AM'
    })).rejects.toMatchObject({
      status: 400,
      error: 'invalid_combination'
    });

    const after = await db('task_masters').where({ id: task.id }).first();
    expect(after.placement_mode).toBe('anytime');
  });

  it('SUB-302d: API update: change existing fixed task to recurring → rejected, unchanged', async () => {
    const id = await seedMaster({ text: 'Fixed 302d', placement_mode: 'fixed', recurring: 0 });

    await expect(updateTask(id, {
      recurring: true,
      recur: { type: 'daily' }
    })).rejects.toMatchObject({
      status: 400,
      error: 'invalid_combination'
    });

    const after = await db('task_masters').where({ id }).first();
    expect(!!after.recurring).toBe(false);
  });
});

/**
 * TS-303: fixed+recurring via MCP.
 *  - MCP create REJECTS (validateTaskInput runs in create_task) → real error text
 *    "Validation error: invalid_combination".
 *  - MCP UPDATE (recurring→fixed) now ALSO REJECTS — the former divergence is CLOSED.
 *    update_task validates the MERGED record (not just the patch), so a patch carrying
 *    placementMode='fixed' against a recurring master trips the combination rule, exactly
 *    like the HTTP path (SUB-302c). The MCP/HTTP gap no longer exists.
 */
describe('TS-303: MCP fixed+recurring — create rejects, update also rejects (gap closed)', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('SUB-303a: MCP create_task with fixed+recurring → rejected (invalid_combination)', async () => {
    await expect(mcpCall('create_task', {
      text: 'MCP fixed recurring 303a',
      dur: 45,
      placementMode: 'fixed',
      time: '9:00 AM',
      recurring: true,
      recur: { type: 'weekly', days: 'MWF' },
      recurStart: '2026-06-15'
    })).rejects.toMatchObject({
      isError: true,
      error: 'Validation error: invalid_combination'
    });

    expect(await countMastersByText('MCP fixed recurring 303a')).toBe(0);
  });

  it('SUB-303b: MCP update_task recurring→fixed → rejected (divergence closed; matches HTTP)', async () => {
    // Create a valid recurring anytime master via MCP.
    const created = await mcpCall('create_task', {
      text: 'MCP recurring 303b',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'daily' }
    });
    expect(created.id).toBeDefined();

    // The former MCP-update gap (update_task validated only the patch and so accepted
    // recurring→fixed, persisting an invalid fixed+recurring master) is now CLOSED:
    // update_task validates the MERGED record, so this transition is rejected with
    // invalid_combination — matching the HTTP path (SUB-302c). Assert the rejection.
    await expect(mcpCall('update_task', {
      id: created.id,
      placementMode: 'fixed',
      time: '10:00 AM'
    })).rejects.toMatchObject({
      isError: true,
      error: 'Validation error: invalid_combination'
    });

    // The master row stays unchanged — still recurring anytime, not fixed.
    const after = await db('task_masters').where({ id: created.id }).first();
    expect(after.placement_mode).toBe('anytime');
    expect(!!after.recurring).toBe(true);
  });
});

/**
 * TS-304: the validated contract — fixed+recurring rejected with 400 across paths.
 * Each sub-case drives the REAL validated path and asserts the SHAPE that path emits:
 *  - HTTP create/update helpers throw { status:400, error:'invalid_combination' }.
 *  - MCP create_task rejects with text "Validation error: invalid_combination".
 *  - Batch import (per-row MCP create) reports the bad row with that same text.
 */
describe('TS-304: validated path rejects fixed+recurring with 400', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('SUB-304a: POST create with fixed+recurring → 400, task not created', async () => {
    await expect(createTask({
      text: 'Fixed recurring 304a',
      dur: 30,
      placementMode: 'fixed',
      recurring: true,
      recur: { type: 'daily' }
    })).rejects.toMatchObject({
      status: 400,
      error: 'invalid_combination'
    });

    expect(await countMastersByText('Fixed recurring 304a')).toBe(0);
  });

  it('SUB-304b: PUT update: change existing recurring task to fixed → 400, unchanged', async () => {
    const task = await createTask({
      text: 'Recurring 304b',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'daily' }
    });

    await expect(updateTask(task.id, {
      placementMode: 'fixed',
      time: '9:00 AM'
    })).rejects.toMatchObject({
      status: 400,
      error: 'invalid_combination'
    });

    const after = await db('task_masters').where({ id: task.id }).first();
    expect(after.placement_mode).toBe('anytime');
  });

  it('SUB-304c: PUT update: change existing fixed task to recurring → 400, unchanged', async () => {
    const id = await seedMaster({ text: 'Fixed 304c', placement_mode: 'fixed', recurring: 0 });

    await expect(updateTask(id, {
      recurring: true,
      recur: { type: 'daily' }
    })).rejects.toMatchObject({
      status: 400,
      error: 'invalid_combination'
    });

    const after = await db('task_masters').where({ id }).first();
    expect(!!after.recurring).toBe(false);
  });

  it('SUB-304d: MCP create with fixed+recurring → MCP returns isError', async () => {
    await expect(mcpCall('create_task', {
      text: 'MCP fixed recurring 304d',
      dur: 45,
      placementMode: 'fixed',
      time: '9:00 AM',
      recurring: true,
      recur: { type: 'daily' }
    })).rejects.toMatchObject({
      isError: true,
      error: 'Validation error: invalid_combination'
    });

    expect(await countMastersByText('MCP fixed recurring 304d')).toBe(0);
  });

  it('SUB-304e: Batch import: row with fixed+recurring → that row rejected', async () => {
    // No dedicated bulk-import use-case exists; the real per-row path is MCP
    // create_task (same as test-helpers/import.js). Drive each row through the real
    // handler and aggregate the actual per-row outcome.
    const rows = [
      { text: 'Valid task 304e', dur: 30, placementMode: 'anytime', recurring: false },
      { text: 'Invalid fixed recurring 304e', dur: 30, placementMode: 'fixed', time: '7:00 AM', recurring: true, recur: { type: 'daily' } }
    ];

    const result = { successful: 0, failed: 0, errors: [] };
    for (let i = 0; i < rows.length; i++) {
      try {
        await mcpCall('create_task', rows[i]);
        result.successful += 1;
      } catch (e) {
        result.failed += 1;
        result.errors.push({ row: i, error: e.error || e.message });
      }
    }

    expect(result.successful).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toMatchObject({
      row: 1,
      error: 'Validation error: invalid_combination'
    });

    // The valid row landed; the invalid row did not.
    expect(await countMastersByText('Valid task 304e')).toBe(1);
    expect(await countMastersByText('Invalid fixed recurring 304e')).toBe(0);
  });
});
