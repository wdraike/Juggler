'use strict';

/**
 * 999.15605 — the contract the frontend's save routing depends on.
 *
 * "Next Cycle Starts" (nextStart) is refused by PUT /tasks/batch on purpose:
 * BatchUpdateTasks has neither resolveNextStartAnchor validation nor the
 * resetRecurringInstances redraw, so persisting the anchor there would be
 * silently wrong. The UI now peels that ONE field off into its own
 * PUT /tasks/:id, which does have the wiring.
 *
 * Peeling it off — rather than sending the whole edit — is not cosmetic. The
 * two routes validate differently: /tasks/batch is a passthrough shape guard,
 * while /tasks/:id runs taskUpdateSchema, whose `date`/`time` regexes REJECT
 * the shapes the edit form actually sends (12-hour "2:00 PM" from fromTime24,
 * and '' for a cleared field). Routing a whole edit-form payload there would
 * 400 the entire save, including the anchor this ticket exists to make
 * editable. These tests pin both halves of that, so a future schema or routing
 * change cannot quietly re-break it.
 */

const { taskUpdateSchema } = require('../../src/schemas/task.schema');

describe('999.15605: PUT /tasks/:id accepts the peeled anchor payload', () => {
  test('setting the anchor SURVIVES validation, not merely passes it', () => {
    // nextStart is not a declared key — it rides .passthrough(), and the
    // middleware replaces req.body with the PARSED output. Drop passthrough and
    // safeParse still succeeds while the field is silently stripped, the fast
    // path takes over, and the anchor is unchangeable again — with this very
    // test reporting PASS. Assert the value, not the verdict.
    const result = taskUpdateSchema.safeParse({ id: 't1-1', nextStart: '2026-09-01' });
    expect(result.success).toBe(true);
    expect(result.data.nextStart).toBe('2026-09-01');
  });

  test('clearing the anchor survives validation as an explicit null', () => {
    const result = taskUpdateSchema.safeParse({ id: 't1-1', nextStart: null });
    expect(result.success).toBe(true);
    expect(result.data.nextStart).toBeNull();
  });

  test('the WHOLE edit-form payload does NOT — which is why only the anchor is peeled off', () => {
    // If this ever starts passing, the frontend may stop splitting; until then,
    // sending the whole update to this route 400s the entire save.
    const result = taskUpdateSchema.safeParse({
      id: 't1-1', nextStart: '2026-09-01', time: '2:00 PM', date: '', text: 'renamed',
    });
    expect(result.success).toBe(false);
    const paths = result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['date', 'time']));
  });
});

describe('999.15605: the anchor is refused LOUDLY while the calendar lock is held', () => {
  const UpdateTask = require('../../src/slices/task/application/commands/UpdateTask');

  function makeCmd(locked) {
    // Only the collaborators this path reaches before the lock check.
    const cmd = Object.create(UpdateTask.prototype);
    cmd.isLocked = async () => locked;
    // Real validation module — stubbing its members one at a time proves nothing
    // about the path the request actually takes.
    cmd.validation = require('../../src/slices/task/domain/validation/taskValidation');
    cmd.repo = {
      fetchTaskWithEventIds: async () => ({
        id: 't1-1', user_id: 'u1', task_type: 'recurring_instance', source_id: 't1',
        recurring: 1, status: '', placement_mode: 'anytime',
        recur: JSON.stringify({ type: 'daily' }), recur_start: '2026-08-01',
      }),
      updateTaskById: async () => 1,
      fetchTaskRecurring: async () => ({ id: 't1', recurring: 1, recur: JSON.stringify({ type: 'daily' }) }),
    };
    cmd.safeTimezone = () => 'America/New_York';
    cmd.mappers = require('../../src/slices/task/domain/mappers/taskMappers');
    cmd.dateHelpers = require('juggler-shared/scheduler/dateHelpers');
    cmd.validateReferences = async () => [];
    cmd.PLACEMENT_MODES = { FIXED: 'fixed', ALL_DAY: 'all_day', ANYTIME: 'anytime', REMINDER: 'reminder', TIME_WINDOW: 'time_window' };
    cmd._lockPath = async () => ({ status: 200, body: { queued: true } });
    cmd.cache = { invalidateTasks: async () => {} };
    cmd.events = { emit: () => {}, publishTaskUpdated: () => {} };
    cmd.enqueueScheduleRun = async () => {};
    cmd.hasSchedulingFields = () => false;
    return cmd;
  }

  test('an anchor edit under lock is a 409, never a 200 that writes nothing', async () => {
    // _lockPath queues next_start as a scheduling field and the flush applies it
    // with the URL id — for an instance id that is an UPDATE of task_masters by
    // a row id that does not exist, i.e. zero rows, after the API already said
    // 200 {queued:true} and the client cleared its dirty markers. Silent loss.
    const cmd = makeCmd(true);
    const res = await UpdateTask.prototype.execute.call(cmd, {
      id: 't1-1', userId: 'u1', body: { nextStart: '2026-09-07' }, timezoneHeader: 'America/New_York',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Next Cycle Starts/);
    expect(res.body.error).not.toMatch(/queue|enqueue|lock path/i);
  });

  test('turning recurrence OFF with an anchor present is NOT refused', async () => {
    // _lockPath routes recurring===0 into the full recurCleanup transaction,
    // which applies next_start and redraws — the one locked shape that is not
    // silently wrong. Refusing it would 409 a user merely un-checking "repeats",
    // since the edit form nulls the anchor as part of that change.
    const cmd = makeCmd(true);
    const res = await UpdateTask.prototype.execute.call(cmd, {
      id: 't1-1', userId: 'u1', body: { recurring: false, nextStart: null },
      timezoneHeader: 'America/New_York',
    });
    expect(res.status).not.toBe(409);
  });

  test('an ordinary edit that REACHES the lock check is NOT refused', async () => {
    // `when` is a complex-path trigger, so this actually reaches the lock check
    // (a text-only edit returns via the fast path and never gets there, pinning
    // nothing about the guard).
    const cmd = makeCmd(true);
    const res = await UpdateTask.prototype.execute.call(cmd, {
      id: 't1-1', userId: 'u1', body: { when: 'today' }, timezoneHeader: 'America/New_York',
    });
    expect(res.status).toBe(200);
  });
});

describe('999.15605: the batch guard still refuses the anchor', () => {
  const BatchUpdateTasks = require('../../src/slices/task/application/commands/BatchUpdateTasks');

  test('the refused list is exported, so the client can be checked against it', () => {
    expect(BatchUpdateTasks.BATCH_REFUSED_FIELDS).toEqual(['nextStart']);
  });

  test('every refused field has a user-facing label for the error text', () => {
    // The message quotes this label, and the client derives the sentence it
    // shows from it — an unlabelled field would print `undefined` at the user.
    BatchUpdateTasks.BATCH_REFUSED_FIELDS.forEach((f) => {
      expect(typeof BatchUpdateTasks.BATCH_REFUSED_LABELS[f]).toBe('string');
      expect(BatchUpdateTasks.BATCH_REFUSED_LABELS[f].length).toBeGreaterThan(0);
    });
  });

  test('the client routes away every field this list refuses', () => {
    // The two packages live in one repo, so the drift this guards is a real
    // possibility and a cheap check: a field refused here but absent from the
    // client's SINGLE_ONLY_FIELDS goes straight back to surfacing a raw 400.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../../juggler-frontend/src/utils/saveRouting.js'),
      'utf8'
    );
    // Match uniquely — a comment quoting this declaration would otherwise
    // shadow the real one and the guard would compare against prose.
    const all = src.match(/export var SINGLE_ONLY_FIELDS = \[[^\]]*\]/g) || [];
    expect(all).toHaveLength(1);
    const m = /export var SINGLE_ONLY_FIELDS = \[([^\]]*)\]/.exec(src);
    expect(m).not.toBeNull();
    const clientList = m[1].split(',')
      .map((x) => x.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    expect(clientList).toEqual(BatchUpdateTasks.BATCH_REFUSED_FIELDS);
  });
});
