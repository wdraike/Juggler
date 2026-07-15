/**
 * Tests for taskReducer — focuses on TEMPLATE_PROPS propagation (CR-JUG-W5).
 * rigid must NOT propagate to sibling recurring instances when one instance is edited.
 */
import taskReducer, { TASK_STATE_INIT } from '../taskReducer';

describe('taskReducer — TEMPLATE_PROPS propagation (CR-JUG-W5)', () => {
  const sourceTask = {
    id: 'source-1',
    text: 'Weekly review',
    dur: 60,
    pri: 2,
    rigid: true,   // set on the source
    timeFlex: false,
    sourceId: null,
  };
  const instance1 = {
    id: 'inst-1',
    text: 'Weekly review',
    dur: 60,
    pri: 2,
    rigid: false,  // instance may differ
    timeFlex: false,
    sourceId: 'source-1',
  };
  const instance2 = {
    id: 'inst-2',
    text: 'Weekly review',
    dur: 60,
    pri: 2,
    rigid: false,
    timeFlex: false,
    sourceId: 'source-1',
  };

  const initState = {
    ...TASK_STATE_INIT,
    tasks: [sourceTask, instance1, instance2],
  };

  it('does NOT propagate rigid to sibling instances when updating an instance', () => {
    const action = {
      type: 'UPDATE_TASK',
      id: 'inst-1',
      fields: { rigid: true, text: 'Weekly review (updated)' },
    };
    const nextState = taskReducer(initState, action);

    // inst-1 should be updated
    const updatedInst1 = nextState.tasks.find(t => t.id === 'inst-1');
    expect(updatedInst1.rigid).toBe(true);
    expect(updatedInst1.text).toBe('Weekly review (updated)');

    // inst-2 should NOT have rigid propagated (rigid is not in TEMPLATE_PROPS)
    const updatedInst2 = nextState.tasks.find(t => t.id === 'inst-2');
    expect(updatedInst2.rigid).toBe(false);

    // source task should NOT have rigid propagated either
    const updatedSource = nextState.tasks.find(t => t.id === 'source-1');
    expect(updatedSource.rigid).toBe(true); // source keeps its own rigid value
  });

  it('DOES propagate text (a TEMPLATE_PROP) to sibling instances', () => {
    const action = {
      type: 'UPDATE_TASK',
      id: 'inst-1',
      fields: { text: 'New title' },
    };
    const nextState = taskReducer(initState, action);

    const updatedInst2 = nextState.tasks.find(t => t.id === 'inst-2');
    expect(updatedInst2.text).toBe('New title');
  });

  it('DOES propagate dur (a TEMPLATE_PROP) to sibling instances', () => {
    const action = {
      type: 'UPDATE_TASK',
      id: 'inst-1',
      fields: { dur: 90 },
    };
    const nextState = taskReducer(initState, action);

    const updatedInst2 = nextState.tasks.find(t => t.id === 'inst-2');
    expect(updatedInst2.dur).toBe(90);
  });
});

/**
 * BUG1 (W1) frontend part — RED repro, leg sched-anchor-split-bugs.
 *
 * Traceability: .planning/kermit/sched-anchor-split-bugs/TRACEABILITY.md BUG1
 * ("...a redundant post-setStatus flushSave also hits this path due to an
 * uncleared dirty flag").
 *
 * SET_STATUS (taskReducer.js:59-77), when called with `opts.taskFields` (the
 * real call shape `useTaskState.js`'s `setStatus(id, val, { taskFields })` uses
 * for e.g. a recurring-completion date advance), marks BOTH:
 *   - `_dirtyStatuses[id]`        (line 70)
 *   - `_dirtyTaskIds[id][field]`  (lines 72-75, via markDirtyFields)
 *
 * `useTaskState.js`'s setStatus, on server confirmation of the status write
 * (the `.then()` at useTaskState.js:230-237), dispatches `CLEAR_DIRTY_STATUS`
 * carrying the SAME `taskFields` object it passed to `SET_STATUS`
 * (`dispatch({ type: 'CLEAR_DIRTY_STATUS', id, taskFields: opts.taskFields })`,
 * useTaskState.js:237) — never `CLEAR_DIRTY_TASKS` for the SAME id. Pre-fix,
 * reading the reducer (taskReducer.js:227-231) confirmed `CLEAR_DIRTY_STATUS`
 * touched `_dirtyStatuses` ONLY:
 *
 *   case 'CLEAR_DIRTY_STATUS': {
 *     var cd = Object.assign({}, state._dirtyStatuses || {});
 *     delete cd[action.id];
 *     return Object.assign({}, state, { _dirtyStatuses: cd });
 *   }
 *
 * — `_dirtyTaskIds` was passed through untouched. The taskFields dirty flag
 * set by SET_STATUS survived that dispatch. (In the live app it was
 * EVENTUALLY cleared by a SEPARATE, debounced `scheduleSave()` ->
 * `flushSave()` -> `CLEAR_DIRTY_TASKS` round-trip — a redundant extra network
 * write for fields the status endpoint already persisted server-side,
 * matching the TRACEABILITY.md note.) This test asserts the dirty flag is
 * gone immediately after the status-update completes (i.e. after the SAME
 * dispatch sequence useTaskState.js's setStatus success handler performs),
 * not "eventually, via a second unrelated save cycle".
 *
 * This test drives the reducer DIRECTLY (no hook, no async, no API mock) —
 * dispatch SET_STATUS with taskFields, then CLEAR_DIRTY_STATUS carrying THAT
 * SAME taskFields object (the real production dispatch shape per
 * useTaskState.js:237 — every real setStatus caller supplies a taskFields
 * value, so CLEAR_DIRTY_STATUS is ALWAYS dispatched with taskFields in
 * production; dispatching it bare would instead exercise the reducer's
 * unreachable whole-entry-delete fallback branch, taskReducer.js's
 * `else { delete cti[action.id]; }` — see zoe-REVIEW.md WARN#1), and asserts
 * `_dirtyTaskIds[id]` is cleared via the real per-field branch
 * (taskReducer.js:249-256).
 */
describe('BUG1 (W1) taskReducer: CLEAR_DIRTY_STATUS must also clear the _dirtyTaskIds flag SET_STATUS sets', () => {
  it('a status update with taskFields, once confirmed (CLEAR_DIRTY_STATUS dispatched with the same taskFields), should leave NO dirty task-field flag behind — CURRENTLY FAILS', () => {
    const task = {
      id: 'inst-rolling-1',
      text: 'Water plants',
      rollingAnchor: '2026-06-15',
    };
    const initState = {
      ...TASK_STATE_INIT,
      tasks: [task],
    };

    // 1) setStatus(id, 'done', { taskFields: { rollingAnchor: '2026-06-20' } }) —
    // the real useTaskState.js call shape for a recurring completion that
    // advances a field alongside the status.
    const afterSetStatus = taskReducer(initState, {
      type: 'SET_STATUS',
      id: 'inst-rolling-1',
      val: 'done',
      taskFields: { rollingAnchor: '2026-06-20' },
    });
    // Sanity: SET_STATUS DID mark the field dirty (this part is correct today).
    expect(afterSetStatus._dirtyTaskIds['inst-rolling-1']).toEqual({ rollingAnchor: true });
    expect(afterSetStatus._dirtyStatuses['inst-rolling-1']).toBe('done');

    // 2) Server confirms the status write — useTaskState.js's setStatus success
    // handler dispatches CLEAR_DIRTY_STATUS carrying the SAME taskFields it
    // passed to SET_STATUS (useTaskState.js:237: `taskFields: opts.taskFields`).
    // This is the real production dispatch shape — every setStatus call site
    // (AppLayout.jsx:822/841/949) supplies a taskFields value, so production
    // NEVER dispatches CLEAR_DIRTY_STATUS bare.
    const afterClear = taskReducer(afterSetStatus, {
      type: 'CLEAR_DIRTY_STATUS',
      id: 'inst-rolling-1',
      taskFields: { rollingAnchor: '2026-06-20' },
    });

    // The status dirty flag is correctly gone.
    expect(afterClear._dirtyStatuses['inst-rolling-1']).toBeUndefined();

    // RED: the taskFields dirty flag SET_STATUS set is NOT cleared by
    // CLEAR_DIRTY_STATUS — it is still { rollingAnchor: true } here, instead
    // of being gone. (It only disappears later via a SEPARATE debounced
    // flushSave()->CLEAR_DIRTY_TASKS round-trip, not as part of this
    // status-update-complete sequence.)
    expect(afterClear._dirtyTaskIds['inst-rolling-1']).toBeUndefined();
  });
});

/**
 * WARN ernie-w2-cleardirty-overbroad / cookie-C1-adjacent (fix-loop iteration 2,
 * leg sched-anchor-split-bugs, 2026-07-04) — regression for the co-pending-field
 * race the BUG1 (W1) fix above introduced: CLEAR_DIRTY_STATUS must clear ONLY the
 * field(s) that THIS status update itself dirtied (via SET_STATUS's taskFields),
 * NOT the whole per-id _dirtyTaskIds[id] entry — an UNRELATED field dirtied by a
 * separate UPDATE_TASK (e.g. a pending `dur` edit) for the SAME task id must
 * survive a CLEAR_DIRTY_STATUS dispatch for that id.
 *
 * Race modeled (useTaskState.js): user edits `dur` (UPDATE_TASK, debounced save
 * pending) -> before that debounce flushes, user marks the task done (setStatus,
 * a fast dedicated-endpoint PUT that can resolve first) -> the status PUT
 * resolves -> setStatus's success handler dispatches ONLY CLEAR_DIRTY_STATUS
 * (now carrying `taskFields: opts.taskFields`, i.e. exactly what SET_STATUS
 * dirtied — `{ status: true }` in the real app, since every setStatus call site
 * passes `taskFields: { status: val }`). The pending `dur` edit must remain
 * dirty so the debounced flushSave() still sends it.
 */
describe('WARN2 (fix-loop iter2) taskReducer: CLEAR_DIRTY_STATUS must not drop a co-pending non-status field edit', () => {
  it('a pending UPDATE_TASK field edit (dur) survives a CLEAR_DIRTY_STATUS for the same task id', () => {
    const task = { id: 'inst-1', text: 'Water plants', dur: 30, status: '' };
    const initState = { ...TASK_STATE_INIT, tasks: [task] };

    // 1) User edits `dur` — UPDATE_TASK dirties _dirtyTaskIds['inst-1'] = { dur: true }.
    const afterUpdate = taskReducer(initState, {
      type: 'UPDATE_TASK',
      id: 'inst-1',
      fields: { dur: 45 },
    });
    expect(afterUpdate._dirtyTaskIds['inst-1']).toEqual({ dur: true });

    // 2) Before the debounced save flushes, user marks the task done —
    // setStatus(id, 'done', { taskFields: { status: 'done' } }), the real
    // production call shape (AppLayout.jsx handleStatusChange).
    const afterSetStatus = taskReducer(afterUpdate, {
      type: 'SET_STATUS',
      id: 'inst-1',
      val: 'done',
      taskFields: { status: 'done' },
    });
    expect(afterSetStatus._dirtyTaskIds['inst-1']).toEqual({ dur: true, status: true });

    // 3) The status PUT resolves first — useTaskState.js's setStatus success
    // handler dispatches CLEAR_DIRTY_STATUS with taskFields: { status: 'done' }
    // (the same object it passed to SET_STATUS).
    const afterClear = taskReducer(afterSetStatus, {
      type: 'CLEAR_DIRTY_STATUS',
      id: 'inst-1',
      taskFields: { status: 'done' },
    });

    // The status dirty flag is gone...
    expect(afterClear._dirtyStatuses['inst-1']).toBeUndefined();
    // ...but the co-pending `dur` edit MUST survive (not the whole entry wiped).
    expect(afterClear._dirtyTaskIds['inst-1']).toEqual({ dur: true });
  });
});

// ---------------------------------------------------------------------------
// INIT — _addFailed phantom carry-over (999.1571, harrison WARN-1)
// A preserved-but-unsaved bulk-add failure exists ONLY client-side; a full
// INIT reload must not silently drop it (that would re-discard the user's
// work and turn retryAddTasks into a no-op).
// ---------------------------------------------------------------------------

describe('taskReducer — INIT _addFailed carry-over (999.1571 WARN-1)', () => {
  test('INIT preserves _addFailed phantoms absent from the server payload (fields intact)', () => {
    const state = {
      ...TASK_STATE_INIT,
      tasks: [
        { id: 'ph-1', text: 'Edited before retry', dur: 45, _addFailed: true },
        { id: 'srv-1', text: 'stale local copy' },
      ],
    };
    const next = taskReducer(state, {
      type: 'INIT',
      tasks: [{ id: 'srv-1', text: 'fresh server copy' }],
      statuses: {},
    });
    const phantom = next.tasks.find((t) => t.id === 'ph-1');
    expect(phantom).toBeTruthy();
    expect(phantom._addFailed).toBe(true);
    expect(phantom.text).toBe('Edited before retry');
    expect(phantom.dur).toBe(45);
    // Server-known row still comes from the payload, untouched by carry-over.
    expect(next.tasks.find((t) => t.id === 'srv-1').text).toBe('fresh server copy');
  });

  test('INIT lets the server row WIN when it contains the phantom id (commit-succeeded-response-lost) — flag drops, no duplicate', () => {
    const state = {
      ...TASK_STATE_INIT,
      tasks: [{ id: 'ph-1', text: 'local flagged copy', _addFailed: true }],
    };
    const next = taskReducer(state, {
      type: 'INIT',
      tasks: [{ id: 'ph-1', text: 'server accepted it after all' }],
      statuses: {},
    });
    const rows = next.tasks.filter((t) => t.id === 'ph-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('server accepted it after all');
    expect(rows[0]._addFailed).toBeUndefined();
  });
});
