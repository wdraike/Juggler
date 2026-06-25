// TELLY-17a: Adversarial HIGH gap tests TS-309 to TS-312
// G-005: Split status propagation - speculative rule clarification
// SKIPPED pending David ruling — backlog 999.876. Asserts a SPECULATIVE
// split-sibling status-propagation rule that is NOT shipped and is unclear vs the
// 999.841 separate-rows ruling; the split-chunk fixtures also need rework.
// Unskip + implement once the propagation semantics are ruled.
// File: splitStatusPropagation.test.js
// Tests: TS-309, TS-310, TS-311, TS-312

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const { setupTestDB, teardownTestDB } = require('../../test-helpers/db');
const { createTask, updateTaskInstance } = require('../../test-helpers/tasks');
const { runScheduler } = require('../../test-helpers/scheduler');
const { getTaskInstances } = require('../../test-helpers/queries');

/**
 * TS-309: Recurring split, mark one chunk done → all chunks in same occurrence_ordinal get done
 * Domain: Split × Status / Recurring
 */
describe.skip('TS-309: Recurring split - done propagates to all chunks in occurrence', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: mark one chunk done → all sibling chunks propagate', async () => {
    // Create recurring split task
    const masterTask = await createTask({
      text: 'Recurring split done propagation',
      dur: 120,
      split: true,
      split_min: 30,
      recurring: true,
      recur: { type: 'daily' },
      recurStart: '2026-06-15'
    });

    // Create 4 pre-materialized chunks for occurrence 1 (2026-06-15)
    const chunk1 = await createTask({
      master_id: masterTask.id,
      text: masterTask.text,
      dur: 30,
      split_group: `${masterTask.id}-2026-06-15`,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      scheduled_at: '2026-06-15T08:00:00Z',
      status: ''
    });

    const chunk2 = await createTask({
      master_id: masterTask.id,
      text: masterTask.text,
      dur: 30,
      split_group: `${masterTask.id}-2026-06-15`,
      occurrence_ordinal: 1,
      split_ordinal: 2,
      scheduled_at: '2026-06-15T08:30:00Z',
      status: ''
    });

    const chunk3 = await createTask({
      master_id: masterTask.id,
      text: masterTask.text,
      dur: 30,
      split_group: `${masterTask.id}-2026-06-15`,
      occurrence_ordinal: 1,
      split_ordinal: 3,
      scheduled_at: '2026-06-15T09:00:00Z',
      status: ''
    });

    const chunk4 = await createTask({
      master_id: masterTask.id,
      text: masterTask.text,
      dur: 30,
      split_group: `${masterTask.id}-2026-06-15`,
      occurrence_ordinal: 1,
      split_ordinal: 4,
      scheduled_at: '2026-06-15T09:30:00Z',
      status: ''
    });

    // Mark chunk 1 as done
    await updateTaskInstance(chunk1.id, { status: 'done' });

    // Check that all chunks in the same occurrence are now done
    const instances = await getTaskInstances(masterTask.id);
    const occurrence1Chunks = instances.filter(i => i.occurrence_ordinal === 1);
    
    expect(occurrence1Chunks.length).toBe(4);
    occurrence1Chunks.forEach(chunk => {
      expect(chunk.status).toBe('done');
    });
  });

  it('SUB-309a: Mark middle chunk done → all propagate', async () => {
    const masterTask = await createTask({
      text: 'Middle chunk done',
      dur: 120,
      split: true,
      split_min: 30,
      recurring: true,
      recur: { type: 'daily' },
      recurStart: '2026-06-15'
    });

    // Create 4 chunks
    const chunks = [];
    for (let i = 1; i <= 4; i++) {
      const chunk = await createTask({
        master_id: masterTask.id,
        text: masterTask.text,
        dur: 30,
        split_group: `${masterTask.id}-2026-06-15`,
        occurrence_ordinal: 1,
        split_ordinal: i,
        scheduled_at: `2026-06-15T0${8 + (i-1)}:00:00Z`,
        status: ''
      });
      chunks.push(chunk);
    }

    // Mark middle chunk (chunk 2) done
    await updateTaskInstance(chunks[1].id, { status: 'done' });

    const instances = await getTaskInstances(masterTask.id);
    const occurrence1Chunks = instances.filter(i => i.occurrence_ordinal === 1);
    
    // All should be done
    occurrence1Chunks.forEach(chunk => {
      expect(chunk.status).toBe('done');
    });
  });

  it('SUB-309e: Occurrence 1 done, Occurrence 2 remains pending → cross-occurrence independence', async () => {
    const masterTask = await createTask({
      text: 'Cross occurrence test',
      dur: 120,
      split: true,
      split_min: 30,
      recurring: true,
      recur: { type: 'daily' },
      recurStart: '2026-06-15'
    });

    // Create chunks for occurrence 1
    for (let i = 1; i <= 4; i++) {
      await createTask({
        master_id: masterTask.id,
        text: masterTask.text,
        dur: 30,
        split_group: `${masterTask.id}-2026-06-15`,
        occurrence_ordinal: 1,
        split_ordinal: i,
        scheduled_at: `2026-06-15T0${8 + (i-1)}:00:00Z`,
        status: ''
      });
    }

    // Create chunks for occurrence 2
    for (let i = 1; i <= 4; i++) {
      await createTask({
        master_id: masterTask.id,
        text: masterTask.text,
        dur: 30,
        split_group: `${masterTask.id}-2026-06-16`,
        occurrence_ordinal: 2,
        split_ordinal: i,
        scheduled_at: `2026-06-16T0${8 + (i-1)}:00:00Z`,
        status: ''
      });
    }

    // Mark first chunk of occurrence 1 as done
    const chunk1 = (await getTaskInstances(masterTask.id)).find(i => i.occurrence_ordinal === 1 && i.split_ordinal === 1);
    await updateTaskInstance(chunk1.id, { status: 'done' });

    const instances = await getTaskInstances(masterTask.id);
    
    // Occurrence 1 should all be done
    const occurrence1Chunks = instances.filter(i => i.occurrence_ordinal === 1);
    occurrence1Chunks.forEach(chunk => {
      expect(chunk.status).toBe('done');
    });

    // Occurrence 2 should still be pending
    const occurrence2Chunks = instances.filter(i => i.occurrence_ordinal === 2);
    occurrence2Chunks.forEach(chunk => {
      expect(chunk.status).toBe('');
    });
  });
});

/**
 * TS-310: Non-recurring inline split, mark one chunk done → does NOT propagate
 * Domain: Split × Status / Non-Recurring / Inline
 */
describe.skip('TS-310: Non-recurring inline split - done does NOT propagate', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: mark one chunk done → only that chunk affected', async () => {
    // Create non-recurring split task
    const masterTask = await createTask({
      text: 'Non-recurring inline split',
      dur: 120,
      split: true,
      split_min: 30,
      recurring: false
    });

    // Create 4 inline chunks (independent rows)
    const chunk1 = await createTask({
      master_id: masterTask.id,
      text: masterTask.text,
      dur: 30,
      split_group: masterTask.id,
      split_ordinal: 1,
      scheduled_at: '2026-06-15T08:00:00Z',
      status: ''
    });

    const chunk2 = await createTask({
      master_id: masterTask.id,
      text: masterTask.text,
      dur: 30,
      split_group: masterTask.id,
      split_ordinal: 2,
      scheduled_at: '2026-06-15T08:30:00Z',
      status: ''
    });

    const chunk3 = await createTask({
      master_id: masterTask.id,
      text: masterTask.text,
      dur: 30,
      split_group: masterTask.id,
      split_ordinal: 3,
      scheduled_at: '2026-06-15T09:00:00Z',
      status: ''
    });

    const chunk4 = await createTask({
      master_id: masterTask.id,
      text: masterTask.text,
      dur: 30,
      split_group: masterTask.id,
      split_ordinal: 4,
      scheduled_at: '2026-06-15T09:30:00Z',
      status: ''
    });

    // Mark chunk 1 as done
    await updateTaskInstance(chunk1.id, { status: 'done' });

    // Check that only chunk 1 is done
    const instances = await getTaskInstances(masterTask.id);
    
    expect(instances.find(i => i.split_ordinal === 1).status).toBe('done');
    expect(instances.find(i => i.split_ordinal === 2).status).toBe('');
    expect(instances.find(i => i.split_ordinal === 3).status).toBe('');
    expect(instances.find(i => i.split_ordinal === 4).status).toBe('');
  });

  it('SUB-310a: Mark chunk 2 done → only chunk 2 changed', async () => {
    const masterTask = await createTask({
      text: 'Mark chunk 2 done',
      dur: 120,
      split: true,
      split_min: 30,
      recurring: false
    });

    // Create 4 chunks
    const chunks = [];
    for (let i = 1; i <= 4; i++) {
      const chunk = await createTask({
        master_id: masterTask.id,
        text: masterTask.text,
        dur: 30,
        split_group: masterTask.id,
        split_ordinal: i,
        scheduled_at: `2026-06-15T0${8 + (i-1)}:00:00Z`,
        status: ''
      });
      chunks.push(chunk);
    }

    // Mark chunk 2 done
    await updateTaskInstance(chunks[1].id, { status: 'done' });

    const instances = await getTaskInstances(masterTask.id);
    
    // Only chunk 2 should be done
    for (let i = 1; i <= 4; i++) {
      const chunkStatus = instances.find(c => c.split_ordinal === i).status;
      if (i === 2) {
        expect(chunkStatus).toBe('done');
      } else {
        expect(chunkStatus).toBe('');
      }
    }
  });

  it('SUB-310c: Mark chunk 1 done, then run scheduler → chunks 2-4 still pending', async () => {
    const masterTask = await createTask({
      text: 'Scheduler after partial done',
      dur: 120,
      split: true,
      split_min: 30,
      recurring: false
    });

    // Create 4 chunks
    const chunks = [];
    for (let i = 1; i <= 4; i++) {
      const chunk = await createTask({
        master_id: masterTask.id,
        text: masterTask.text,
        dur: 30,
        split_group: masterTask.id,
        split_ordinal: i,
        scheduled_at: `2026-06-15T0${8 + (i-1)}:00:00Z`,
        status: ''
      });
      chunks.push(chunk);
    }

    // Mark chunk 1 done
    await updateTaskInstance(chunks[0].id, { status: 'done' });

    // Run scheduler
    await runScheduler();

    const instances = await getTaskInstances(masterTask.id);
    
    // Chunk 1 should be done, others still pending
    expect(instances.find(i => i.split_ordinal === 1).status).toBe('done');
    expect(instances.find(i => i.split_ordinal === 2).status).toBe('');
    expect(instances.find(i => i.split_ordinal === 3).status).toBe('');
    expect(instances.find(i => i.split_ordinal === 4).status).toBe('');
  });
});

/**
 * TS-311: Split chunk marked WIP → time_remaining affects that chunk only
 * Domain: Split × Status / WIP / Time Remaining
 */
describe.skip('TS-311: WIP marking affects only that chunk', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: WIP + time_remaining on one chunk → others unaffected', async () => {
    // Create non-recurring split task
    const masterTask = await createTask({
      text: 'WIP time remaining test',
      dur: 180,
      split: true,
      split_min: 30,
      recurring: false
    });

    // Create 6 chunks
    const chunks = [];
    for (let i = 1; i <= 6; i++) {
      const chunk = await createTask({
        master_id: masterTask.id,
        text: masterTask.text,
        dur: 30,
        split_group: masterTask.id,
        split_ordinal: i,
        scheduled_at: `2026-06-15T0${8 + (i-1)}:00:00Z`,
        status: ''
      });
      chunks.push(chunk);
    }

    // Mark chunk 3 as WIP with 15 minutes remaining
    await updateTaskInstance(chunks[2].id, { 
      status: 'wip',
      time_remaining: 15
    });

    const instances = await getTaskInstances(masterTask.id);
    
    // Chunk 3 should have WIP status and time_remaining
    const chunk3 = instances.find(i => i.split_ordinal === 3);
    expect(chunk3.status).toBe('wip');
    expect(chunk3.time_remaining).toBe(15);

    // Other chunks should be unaffected
    for (let i = 1; i <= 6; i++) {
      if (i !== 3) {
        const chunk = instances.find(c => c.split_ordinal === i);
        expect(chunk.status).toBe('');
        expect(chunk.time_remaining).toBeUndefined();
      }
    }
  });

  it('SUB-311a: WIP + time_remaining=0 → chunk effectively done', async () => {
    const masterTask = await createTask({
      text: 'WIP time remaining 0',
      dur: 180,
      split: true,
      split_min: 30,
      recurring: false
    });

    // Create 3 chunks
    const chunks = [];
    for (let i = 1; i <= 3; i++) {
      const chunk = await createTask({
        master_id: masterTask.id,
        text: masterTask.text,
        dur: 30,
        split_group: masterTask.id,
        split_ordinal: i,
        scheduled_at: `2026-06-15T0${8 + (i-1)}:00:00Z`,
        status: ''
      });
      chunks.push(chunk);
    }

    // Mark chunk 2 as WIP with 0 remaining
    await updateTaskInstance(chunks[1].id, { 
      status: 'wip',
      time_remaining: 0
    });

    const instances = await getTaskInstances(masterTask.id);
    const chunk2 = instances.find(i => i.split_ordinal === 2);
    
    // Should be effectively done (0 remaining)
    expect(chunk2.status).toBe('wip');
    expect(chunk2.time_remaining).toBe(0);
  });

  it('SUB-311b: WIP on multiple chunks with different time_remaining → each independent', async () => {
    const masterTask = await createTask({
      text: 'Multiple WIP chunks',
      dur: 180,
      split: true,
      split_min: 30,
      recurring: false
    });

    // Create 4 chunks
    const chunks = [];
    for (let i = 1; i <= 4; i++) {
      const chunk = await createTask({
        master_id: masterTask.id,
        text: masterTask.text,
        dur: 30,
        split_group: masterTask.id,
        split_ordinal: i,
        scheduled_at: `2026-06-15T0${8 + (i-1)}:00:00Z`,
        status: ''
      });
      chunks.push(chunk);
    }

    // Mark chunk 1 and 3 as WIP with different remaining times
    await updateTaskInstance(chunks[0].id, { status: 'wip', time_remaining: 10 });
    await updateTaskInstance(chunks[2].id, { status: 'wip', time_remaining: 20 });

    const instances = await getTaskInstances(masterTask.id);
    
    // Each should have its own time_remaining
    expect(instances.find(i => i.split_ordinal === 1).time_remaining).toBe(10);
    expect(instances.find(i => i.split_ordinal === 2).time_remaining).toBeUndefined();
    expect(instances.find(i => i.split_ordinal === 3).time_remaining).toBe(20);
    expect(instances.find(i => i.split_ordinal === 4).time_remaining).toBeUndefined();
  });
});

/**
 * TS-312: Split chunk marked done before all chunks placed → remaining chunks still placed
 * Domain: Split × Status / Early Completion
 */
describe.skip('TS-312: Early completion - remaining chunks still placed', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: recurring split, mark chunk done → remaining chunks in occurrence also done', async () => {
    const masterTask = await createTask({
      text: 'Early completion split',
      dur: 180,
      split: true,
      split_min: 30,
      recurring: true,
      recur: { type: 'daily' },
      recurStart: '2026-06-15'
    });

    // Create 4 of 6 chunks for occurrence 1 (partial materialization)
    const chunks = [];
    for (let i = 1; i <= 4; i++) {
      const chunk = await createTask({
        master_id: masterTask.id,
        text: masterTask.text,
        dur: 30,
        split_group: `${masterTask.id}-2026-06-15`,
        occurrence_ordinal: 1,
        split_ordinal: i,
        scheduled_at: `2026-06-15T0${8 + (i-1)}:00:00Z`,
        status: ''
      });
      chunks.push(chunk);
    }

    // Mark chunk 1 as done
    await updateTaskInstance(chunks[0].id, { status: 'done' });

    // Run scheduler (status change triggers enqueueScheduleRun)
    await runScheduler();

    const instances = await getTaskInstances(masterTask.id);
    const occurrence1Chunks = instances.filter(i => i.occurrence_ordinal === 1);
    
    // All materialized chunks should be done (propagation)
    occurrence1Chunks.forEach(chunk => {
      expect(chunk.status).toBe('done');
    });

    // Occurrence 2 should have fresh chunks
    const occurrence2Chunks = instances.filter(i => i.occurrence_ordinal === 2);
    expect(occurrence2Chunks.length).toBeGreaterThan(0);
    occurrence2Chunks.forEach(chunk => {
      expect(chunk.status).toBe(''); // Pending
    });
  });

  it('SUB-312a: Non-recurring inline: chunk 1 done, chunks 2-4 pending, chunks 5-6 not materialized → scheduler materializes 5-6', async () => {
    const masterTask = await createTask({
      text: 'Non-recurring early done',
      dur: 180,
      split: true,
      split_min: 30,
      recurring: false
    });

    // Create 4 chunks (1-4)
    const chunks = [];
    for (let i = 1; i <= 4; i++) {
      const chunk = await createTask({
        master_id: masterTask.id,
        text: masterTask.text,
        dur: 30,
        split_group: masterTask.id,
        split_ordinal: i,
        scheduled_at: `2026-06-15T0${8 + (i-1)}:00:00Z`,
        status: ''
      });
      chunks.push(chunk);
    }

    // Mark chunk 1 done
    await updateTaskInstance(chunks[0].id, { status: 'done' });

    // Run scheduler
    await runScheduler();

    const instances = await getTaskInstances(masterTask.id);
    
    // Chunk 1 should be done
    expect(instances.find(i => i.split_ordinal === 1).status).toBe('done');
    
    // Chunks 2-4 should still be pending
    for (let i = 2; i <= 4; i++) {
      expect(instances.find(c => c.split_ordinal === i).status).toBe('');
    }

    // Chunks 5-6 should be materialized as new pending rows
    expect(instances.some(i => i.split_ordinal === 5)).toBe(true);
    expect(instances.some(i => i.split_ordinal === 6)).toBe(true);
    expect(instances.find(i => i.split_ordinal === 5).status).toBe('');
    expect(instances.find(i => i.split_ordinal === 6).status).toBe('');
  });
});