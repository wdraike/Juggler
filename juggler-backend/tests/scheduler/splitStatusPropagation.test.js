// 999.1220 — Split-chunk done semantics: CHUNK-ONLY (David ruling 2026-07-06).
//
// RULING: done = THIS CHUNK ONLY, everywhere — one-time AND recurring splits.
// This REVERSED the prior recurring propagate-to-all behavior this file used
// to pin (TS-309 "recurring → propagates" vs TS-310 "non-recurring → does
// not"; pre-rewrite versions in git history). TS-126/TS-126af spec text
// rewritten in docs/TASK-SETTINGS-TREE.md.
//
// Production seam under test (same as before the ruling):
//   src/slices/task/application/commands/UpdateTaskStatus.js — the split-chunk
//   sibling-propagation block. Post-ruling it is GATED: a 'done' write (and
//   the reopen of a done chunk, status '') never touches siblings; NON-done
//   statuses (skip/cancel — TS-126ag/ah) still propagate across the
//   occurrence's siblings — but only for recurring splits, because the guard
//   requires a non-null `source_id` (the tasks_v recurring discriminator,
//   `CASE WHEN m.recurring = 1 THEN m.id ELSE NULL END`). Non-recurring
//   splits never propagated any status and still don't.
//
// Fixture notes (inherited from the A4-R1 repair):
//   - chunks MUST carry split_total > 1 explicitly (column default is 1,
//     which keeps the guard from ever firing);
//   - status writes go through the REAL production write path,
//     taskFacade.updateTaskStatus (a raw db().update() would bypass the
//     UpdateTaskStatus use-case entirely).
//
// The old cross-occurrence-independence case was dropped: with done now
// chunk-only, "done never leaks to another occurrence" is subsumed by "done
// never leaks to ANY other row" (asserted in every done test below).
// Occurrence scoping of the still-propagating statuses stays pinned by the
// skip test (its sibling query is WHERE-scoped to occurrence_ordinal).

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const { setupTestDB, teardownTestDB } = require('../../test-helpers/db');
const { createTask } = require('../../test-helpers/tasks');
const { getTaskInstances } = require('../../test-helpers/queries');
const taskFacade = require('../../src/slices/task/facade');

const USER_ID = '1';

function setStatus(id, status) {
  return taskFacade.updateTaskStatus({ id: id, userId: USER_ID, body: { status: status } });
}

function markDone(id) {
  return setStatus(id, 'done');
}

async function makeRecurringSplit(text, chunkCount) {
  const masterTask = await createTask({
    text: text,
    dur: 30 * chunkCount,
    split: true,
    split_min: 30,
    recurring: true,
    recur: { type: 'daily' },
    recurStart: '2026-06-15'
  });
  const chunks = [];
  for (let i = 1; i <= chunkCount; i++) {
    chunks.push(await createTask({
      master_id: masterTask.id, text: masterTask.text, dur: 30,
      split_group: `${masterTask.id}-2026-06-15`, occurrence_ordinal: 1,
      split_ordinal: i, split_total: chunkCount,
      scheduled_at: `2026-06-15T${String(7 + i).padStart(2, '0')}:00:00Z`, status: ''
    }));
  }
  return { masterTask, chunks };
}

/**
 * TS-309 (rewritten per 999.1220): Recurring split — done is CHUNK-ONLY.
 * Domain: Split × Status / Recurring
 */
describe('TS-309: Recurring split - done is chunk-only (999.1220)', () => {
  beforeAll(async () => {
    await setupTestDB();
  }, 30000);

  afterAll(async () => {
    await teardownTestDB();
  }, 30000);

  it('Main scenario: mark chunk 1 done -> siblings untouched', async () => {
    const { masterTask, chunks } = await makeRecurringSplit('Recurring split chunk-only done', 4);

    const result = await markDone(chunks[0].id);
    expect(result.status).toBe(200);
    expect(result.body.siblingsUpdated).toBe(0); // done never propagates

    const instances = await getTaskInstances(masterTask.id);
    const occurrence1Chunks = instances.filter(i => i.occurrence_ordinal === 1);
    expect(occurrence1Chunks.length).toBe(4);
    occurrence1Chunks.forEach(chunk => {
      expect(chunk.status).toBe(chunk.split_ordinal === 1 ? 'done' : '');
    });
  });

  it('SUB-309a: mark MIDDLE chunk (2 of 3) done -> only chunk 2 done', async () => {
    const { masterTask, chunks } = await makeRecurringSplit('Middle chunk chunk-only done', 3);

    const result = await markDone(chunks[1].id); // ordinal 2
    expect(result.status).toBe(200);
    expect(result.body.siblingsUpdated).toBe(0);

    const instances = await getTaskInstances(masterTask.id);
    const occurrence1Chunks = instances.filter(i => i.occurrence_ordinal === 1);
    expect(occurrence1Chunks.length).toBe(3);
    occurrence1Chunks.forEach(chunk => {
      expect(chunk.status).toBe(chunk.split_ordinal === 2 ? 'done' : '');
    });
  });

  it('SUB-309b: reopening a done chunk (status "") is equally chunk-only', async () => {
    const { masterTask, chunks } = await makeRecurringSplit('Reopen chunk-only', 3);

    await markDone(chunks[0].id);
    await markDone(chunks[1].id);

    const result = await setStatus(chunks[1].id, ''); // reopen chunk 2 only
    expect(result.status).toBe(200);
    expect(result.body.siblingsUpdated).toBe(0);

    const instances = await getTaskInstances(masterTask.id);
    const byOrdinal = {};
    instances.filter(i => i.occurrence_ordinal === 1)
      .forEach(i => { byOrdinal[i.split_ordinal] = i.status; });
    expect(byOrdinal[1]).toBe('done'); // chunk 1's completion survives the undo
    expect(byOrdinal[2]).toBe('');
    expect(byOrdinal[3]).toBe('');
  });

  it('TS-126ag: skip STILL propagates to all sibling chunks (non-done statuses unchanged)', async () => {
    const { masterTask, chunks } = await makeRecurringSplit('Skip still propagates', 4);

    const result = await setStatus(chunks[0].id, 'skip');
    expect(result.status).toBe(200);
    expect(result.body.siblingsUpdated).toBe(3); // chunks 2,3,4

    const instances = await getTaskInstances(masterTask.id);
    const occurrence1Chunks = instances.filter(i => i.occurrence_ordinal === 1);
    expect(occurrence1Chunks.length).toBe(4);
    occurrence1Chunks.forEach(chunk => {
      expect(chunk.status).toBe('skip');
    });
  });
});

/**
 * TS-310: One-time (non-recurring inline) split — done is chunk-only.
 * Pre-999.1220 this was already true mechanically (source_id is NULL for a
 * non-recurring task, so the propagation guard never fired); post-ruling it
 * is the SPECIFIED behavior for one-time and recurring alike.
 * Domain: Split × Status / Non-Recurring / Inline
 */
describe('TS-310: One-time split - done is chunk-only', () => {
  beforeAll(async () => {
    await setupTestDB();
  }, 30000);

  afterAll(async () => {
    await teardownTestDB();
  }, 30000);

  it('Main scenario: 3 chunks, mark chunk 2 done -> only chunk 2 done', async () => {
    const masterTask = await createTask({
      text: 'One-time split chunk-only done', dur: 90, split: true, split_min: 30,
      recurring: false
    });

    const chunks = [];
    for (let i = 1; i <= 3; i++) {
      chunks.push(await createTask({
        master_id: masterTask.id, text: masterTask.text, dur: 30,
        split_group: masterTask.id, occurrence_ordinal: 1, split_ordinal: i,
        split_total: 3, scheduled_at: `2026-06-15T${String(7 + i).padStart(2, '0')}:00:00Z`, status: ''
      }));
    }

    const result = await markDone(chunks[1].id); // ordinal 2
    expect(result.status).toBe(200);
    expect(result.body.siblingsUpdated).toBe(0);

    const instances = await getTaskInstances(masterTask.id);
    expect(instances.find(i => i.split_ordinal === 1).status).toBe('');
    expect(instances.find(i => i.split_ordinal === 2).status).toBe('done');
    expect(instances.find(i => i.split_ordinal === 3).status).toBe('');
  });
});
