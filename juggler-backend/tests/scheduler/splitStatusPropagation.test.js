// TELLY-17a: Adversarial HIGH gap tests TS-309 to TS-312
// G-005: Split status propagation
// File: splitStatusPropagation.test.js
//
// A4-R1 (sched-audit AUDIT-REGISTER.md REG-33, leg L4): this file was entirely
// `describe.skip` since 999.876, pending a David ruling on split-sibling status
// propagation, with a header note that the fixtures "also need rework."
//
// RE-ASSESSED this leg: the feature the header called "speculative/not shipped"
// IS live in production today —
//   src/slices/task/application/commands/UpdateTaskStatus.js:238-249 — when a
//   status update lands on a task_instances row with `split_total > 1` AND a
//   non-null `source_id` (source_id is a `tasks_v` VIEW-computed column, ONLY
//   populated `CASE WHEN m.recurring = 1 THEN m.id ELSE NULL END` — i.e. it is
//   the RECURRING discriminator, not merely "has a master_id") AND a non-null
//   `occurrence_ordinal`, the command loads every sibling row sharing
//   (user, source_id, occurrence_ordinal) via
//   `TaskRepositoryPort.getSplitSiblingIds` (KnexTaskRepository.js:498-501,
//   `task_instances WHERE user_id=? AND master_id=? AND occurrence_ordinal=?`)
//   and applies the SAME status write to each. For a non-recurring inline
//   split, `source_id` is always NULL regardless of split_total/occurrence_ordinal,
//   so the guard never fires — no propagation. This exactly matches this file's
//   TS-309 (recurring → propagates) vs TS-310 (non-recurring → does not)
//   split, confirming the feature exists and the two contracts are real.
//
// The header's OTHER claim ("fixtures also need rework") was also confirmed
// TRUE and is now fixed below:
//   1. The chunk fixtures never set `split_total` (defaults to 1 via the
//      `task_instances` column default), so `split_total > 1` was FALSE and
//      the propagation guard could never have fired even post-ruling — fixed:
//      chunks now explicitly carry `split_total: <chunk count>`.
//   2. `updateTaskInstance()` (test-helpers/tasks.js:255) is a raw
//      `db('task_instances').update()` call that bypasses the production
//      UpdateTaskStatus use-case ENTIRELY — a test using it would never
//      exercise the sibling-propagation code above no matter how the guard
//      conditions were fixed. Fixed: the repaired tests below call the REAL
//      write path, `taskFacade.updateTaskStatus({ id, userId, body })`
//      (src/slices/task/facade.js:1191 -> UpdateTaskStatus.execute), the same
//      seam test-helpers/scheduler.js's `markInstanceStatus` already uses for
//      the tpc*.test.js family.
//
// Disposition (this leg, un-skip + repair the cheapest tests that pin the
// real behavior; delete the rest with a pointer + backlog-note text — kept
// BOTH sides of the propagation gate, not just one block, because they are
// equally cheap (no scheduler run, 4-row DB fixture) and no other test in the
// repo exercises this guard at all — the mocked-`loadSplitSiblings: () => []`
// unit tests in commands.db.test.js / commands-status-delete-misc.test.js
// stub the collaborator out and assert nothing about real DB propagation):
//   - TS-309 (recurring split propagates) — KEPT, un-skipped, repaired (all
//     3 cases: main, middle-chunk, cross-occurrence-independence — cheap,
//     reuse the same 4-chunk fixture shape).
//   - TS-310 Main scenario (non-recurring split does NOT propagate) — KEPT,
//     un-skipped, repaired. This is the negative case of the SAME guard
//     TS-309 pins; deleting it would leave the `source_id`/recurring branch
//     of the gate completely unpinned.
//   - TS-310 SUB-310a/SUB-310c, TS-311 (WIP-only independence), TS-312
//     (early-completion + scheduler-materialization interaction) — DELETED.
//     SUB-310a/SUB-310c restate TS-310 Main's same fact with a different
//     chunk index / an added irrelevant `runScheduler()` call. TS-311 is a
//     narrower variant of the same "non-recurring never propagates" fact
//     with 'wip'+time_remaining instead of 'done'. TS-312 couples the
//     propagation contract to unrelated recurring-instance materialization
//     behavior (occurrence-2 fresh-chunk generation) that belongs to the
//     recurring-lifecycle/tpc suites, not this file.
//   BACKLOG NOTE (recorded here for Kermit — not filed by telly per dispatch
//   scope): if WIP/time_remaining sibling-independence (former TS-311) or the
//   early-completion + materialization interaction (former TS-312) need
//   dedicated regression coverage, re-author them against the REAL
//   `taskFacade.updateTaskStatus` seam (not `updateTaskInstance`), with
//   explicit `split_total`/`occurrence_ordinal` set on every fixture row —
//   this file's git history has the pre-repair versions for reference.
//
// Tests kept: TS-309 (all 3), TS-310 (Main only).

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const { setupTestDB, teardownTestDB } = require('../../test-helpers/db');
const { createTask } = require('../../test-helpers/tasks');
const { getTaskInstances } = require('../../test-helpers/queries');
const taskFacade = require('../../src/slices/task/facade');

const USER_ID = '1';

function markDone(id) {
  return taskFacade.updateTaskStatus({ id: id, userId: USER_ID, body: { status: 'done' } });
}

/**
 * TS-309: Recurring split, mark one chunk done -> all chunks in same occurrence_ordinal get done
 * Domain: Split × Status / Recurring
 */
describe('TS-309: Recurring split - done propagates to all chunks in occurrence', () => {
  beforeAll(async () => {
    await setupTestDB();
  }, 30000);

  afterAll(async () => {
    await teardownTestDB();
  }, 30000);

  it('Main scenario: mark one chunk done -> all sibling chunks propagate', async () => {
    // Create recurring split master (source_id resolves non-null via tasks_v
    // ONLY when recurring=1 — this is what makes the propagation guard fire).
    const masterTask = await createTask({
      text: 'Recurring split done propagation',
      dur: 120,
      split: true,
      split_min: 30,
      recurring: true,
      recur: { type: 'daily' },
      recurStart: '2026-06-15'
    });

    // Create 4 pre-materialized chunks for occurrence 1 (2026-06-15).
    // split_total MUST be set (default column value is 1) — this is the
    // fixture bug the header comment flagged ("fixtures also need rework").
    const chunk1 = await createTask({
      master_id: masterTask.id, text: masterTask.text, dur: 30,
      split_group: `${masterTask.id}-2026-06-15`, occurrence_ordinal: 1,
      split_ordinal: 1, split_total: 4, scheduled_at: '2026-06-15T08:00:00Z', status: ''
    });
    const chunk2 = await createTask({
      master_id: masterTask.id, text: masterTask.text, dur: 30,
      split_group: `${masterTask.id}-2026-06-15`, occurrence_ordinal: 1,
      split_ordinal: 2, split_total: 4, scheduled_at: '2026-06-15T08:30:00Z', status: ''
    });
    const chunk3 = await createTask({
      master_id: masterTask.id, text: masterTask.text, dur: 30,
      split_group: `${masterTask.id}-2026-06-15`, occurrence_ordinal: 1,
      split_ordinal: 3, split_total: 4, scheduled_at: '2026-06-15T09:00:00Z', status: ''
    });
    const chunk4 = await createTask({
      master_id: masterTask.id, text: masterTask.text, dur: 30,
      split_group: `${masterTask.id}-2026-06-15`, occurrence_ordinal: 1,
      split_ordinal: 4, split_total: 4, scheduled_at: '2026-06-15T09:30:00Z', status: ''
    });
    void chunk2; void chunk3; void chunk4;

    // Mark chunk 1 done through the REAL production write path (not a raw
    // DB update) — only this exercises UpdateTaskStatus's sibling-propagation
    // block.
    const result = await markDone(chunk1.id);
    expect(result.status).toBe(200);
    expect(result.body.siblingsUpdated).toBe(3); // chunks 2,3,4

    const instances = await getTaskInstances(masterTask.id);
    const occurrence1Chunks = instances.filter(i => i.occurrence_ordinal === 1);

    expect(occurrence1Chunks.length).toBe(4);
    occurrence1Chunks.forEach(chunk => {
      expect(chunk.status).toBe('done');
    });
  });

  it('SUB-309a: Mark middle chunk done -> all propagate', async () => {
    const masterTask = await createTask({
      text: 'Middle chunk done', dur: 120, split: true, split_min: 30,
      recurring: true, recur: { type: 'daily' }, recurStart: '2026-06-15'
    });

    const chunks = [];
    for (let i = 1; i <= 4; i++) {
      const chunk = await createTask({
        master_id: masterTask.id, text: masterTask.text, dur: 30,
        split_group: `${masterTask.id}-2026-06-15`, occurrence_ordinal: 1,
        split_ordinal: i, split_total: 4,
        scheduled_at: `2026-06-15T${String(8 + (i - 1)).padStart(2, '0')}:00:00Z`, status: ''
      });
      chunks.push(chunk);
    }

    const result = await markDone(chunks[1].id); // middle chunk (ordinal 2)
    expect(result.status).toBe(200);
    expect(result.body.siblingsUpdated).toBe(3);

    const instances = await getTaskInstances(masterTask.id);
    const occurrence1Chunks = instances.filter(i => i.occurrence_ordinal === 1);
    expect(occurrence1Chunks.length).toBe(4);
    occurrence1Chunks.forEach(chunk => {
      expect(chunk.status).toBe('done');
    });
  });

  it('SUB-309e: Occurrence 1 done, Occurrence 2 remains pending -> cross-occurrence independence', async () => {
    const masterTask = await createTask({
      text: 'Cross occurrence test', dur: 120, split: true, split_min: 30,
      recurring: true, recur: { type: 'daily' }, recurStart: '2026-06-15'
    });

    for (let i = 1; i <= 4; i++) {
      await createTask({
        master_id: masterTask.id, text: masterTask.text, dur: 30,
        split_group: `${masterTask.id}-2026-06-15`, occurrence_ordinal: 1,
        split_ordinal: i, split_total: 4,
        scheduled_at: `2026-06-15T${String(8 + (i - 1)).padStart(2, '0')}:00:00Z`, status: ''
      });
    }
    for (let i = 1; i <= 4; i++) {
      await createTask({
        master_id: masterTask.id, text: masterTask.text, dur: 30,
        split_group: `${masterTask.id}-2026-06-16`, occurrence_ordinal: 2,
        split_ordinal: i, split_total: 4,
        scheduled_at: `2026-06-16T${String(8 + (i - 1)).padStart(2, '0')}:00:00Z`, status: ''
      });
    }

    const chunk1 = (await getTaskInstances(masterTask.id))
      .find(i => i.occurrence_ordinal === 1 && i.split_ordinal === 1);
    await markDone(chunk1.id);

    const instances = await getTaskInstances(masterTask.id);

    const occurrence1Chunks = instances.filter(i => i.occurrence_ordinal === 1);
    occurrence1Chunks.forEach(chunk => {
      expect(chunk.status).toBe('done');
    });

    // Different occurrence_ordinal -> outside the sibling query's WHERE clause
    // -> must stay untouched.
    const occurrence2Chunks = instances.filter(i => i.occurrence_ordinal === 2);
    expect(occurrence2Chunks.length).toBe(4);
    occurrence2Chunks.forEach(chunk => {
      expect(chunk.status).toBe('');
    });
  });
});

/**
 * TS-310 (Main scenario only — see file-header disposition note for
 * SUB-310a/SUB-310c/TS-311/TS-312 deletion rationale): Non-recurring inline
 * split, mark one chunk done -> does NOT propagate (source_id is NULL for a
 * non-recurring task regardless of split_total/occurrence_ordinal, so
 * UpdateTaskStatus's propagation guard never fires).
 * Domain: Split × Status / Non-Recurring / Inline
 */
describe('TS-310: Non-recurring inline split - done does NOT propagate', () => {
  beforeAll(async () => {
    await setupTestDB();
  }, 30000);

  afterAll(async () => {
    await teardownTestDB();
  }, 30000);

  it('Main scenario: mark one chunk done -> only that chunk affected', async () => {
    const masterTask = await createTask({
      text: 'Non-recurring inline split', dur: 120, split: true, split_min: 30,
      recurring: false
    });

    // Same shape as TS-309's fixture (split_total: 4, occurrence_ordinal: 1
    // set on every chunk) EXCEPT `recurring: false` on the master — isolates
    // source_id/recurring as the ONE variable that flips the propagation
    // guard, rather than accidentally passing because occurrence_ordinal was
    // left unset.
    const chunk1 = await createTask({
      master_id: masterTask.id, text: masterTask.text, dur: 30,
      split_group: masterTask.id, occurrence_ordinal: 1, split_ordinal: 1,
      split_total: 4, scheduled_at: '2026-06-15T08:00:00Z', status: ''
    });
    await createTask({
      master_id: masterTask.id, text: masterTask.text, dur: 30,
      split_group: masterTask.id, occurrence_ordinal: 1, split_ordinal: 2,
      split_total: 4, scheduled_at: '2026-06-15T08:30:00Z', status: ''
    });
    await createTask({
      master_id: masterTask.id, text: masterTask.text, dur: 30,
      split_group: masterTask.id, occurrence_ordinal: 1, split_ordinal: 3,
      split_total: 4, scheduled_at: '2026-06-15T09:00:00Z', status: ''
    });
    await createTask({
      master_id: masterTask.id, text: masterTask.text, dur: 30,
      split_group: masterTask.id, occurrence_ordinal: 1, split_ordinal: 4,
      split_total: 4, scheduled_at: '2026-06-15T09:30:00Z', status: ''
    });

    const result = await markDone(chunk1.id);
    expect(result.status).toBe(200);
    expect(result.body.siblingsUpdated).toBe(0); // guard never fires: source_id is NULL

    const instances = await getTaskInstances(masterTask.id);
    expect(instances.find(i => i.split_ordinal === 1).status).toBe('done');
    expect(instances.find(i => i.split_ordinal === 2).status).toBe('');
    expect(instances.find(i => i.split_ordinal === 3).status).toBe('');
    expect(instances.find(i => i.split_ordinal === 4).status).toBe('');
  });
});
