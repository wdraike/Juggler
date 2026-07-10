/**
 * useUndo hook tests (999.1211 — behavioral pin for undo, cf. contested
 * semantics 999.844).
 *
 * Pins the CURRENT contract:
 *  - pushUndo snapshots taskStateRef.current at call time: tasks deep-copied,
 *    statuses shallow-copied (top-level isolation)
 *  - popUndo is LIFO, dispatches a persisted RESTORE ({type:'RESTORE',
 *    statuses, extraTasks}) via dispatchPersist (NOT the plain dispatch),
 *    and returns the snapshot label ('action' when none given)
 *  - empty stack: canUndo() false, popUndo() returns null and dispatches
 *    nothing
 *  - stack is capped at 30 — oldest snapshots fall off
 */

import { renderHook, act } from '@testing-library/react';
import useUndo from '../useUndo';

function setup(initialState) {
  const taskStateRef = { current: initialState };
  const dispatch = jest.fn();
  const dispatchPersist = jest.fn();
  const rendered = renderHook(() => useUndo(taskStateRef, dispatch, dispatchPersist));
  return { taskStateRef, dispatch, dispatchPersist, result: rendered.result };
}

const STATE_A = {
  tasks: [{ id: 't1', text: 'original', recur: { type: 'weekly' } }],
  statuses: { t1: 'open' },
};

describe('useUndo', () => {
  it('starts empty: canUndo false, popUndo returns null and dispatches nothing', () => {
    const { result, dispatch, dispatchPersist } = setup(STATE_A);

    expect(result.current.canUndo()).toBe(false);

    let popped;
    act(() => { popped = result.current.popUndo(); });

    expect(popped).toBeNull();
    expect(dispatchPersist).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('push then pop restores the snapshot via a persisted RESTORE and returns the label', () => {
    const { result, taskStateRef, dispatch, dispatchPersist } = setup({
      tasks: [{ id: 't1', text: 'before delete' }],
      statuses: { t1: 'open' },
    });

    act(() => { result.current.pushUndo('delete task'); });
    expect(result.current.canUndo()).toBe(true);

    // State moves on after the snapshot (the change being undone)
    taskStateRef.current = { tasks: [], statuses: {} };

    let label;
    act(() => { label = result.current.popUndo(); });

    expect(label).toBe('delete task');
    expect(dispatchPersist).toHaveBeenCalledTimes(1);
    expect(dispatchPersist).toHaveBeenCalledWith({
      type: 'RESTORE',
      statuses: { t1: 'open' },
      extraTasks: [{ id: 't1', text: 'before delete' }],
    });
    // Restore goes through the PERSISTED dispatch path only — undo must
    // survive a reload, not just patch local state.
    expect(dispatch).not.toHaveBeenCalled();
    expect(result.current.canUndo()).toBe(false);
  });

  it('defaults the label to "action" when pushUndo is called without one', () => {
    const { result } = setup(STATE_A);

    act(() => { result.current.pushUndo(); });

    let label;
    act(() => { label = result.current.popUndo(); });
    expect(label).toBe('action');
  });

  it('pops LIFO: each pop restores the state captured at that push', () => {
    const { result, taskStateRef, dispatchPersist } = setup({
      tasks: [{ id: 't1', text: 'v1' }],
      statuses: { t1: 'open' },
    });

    act(() => { result.current.pushUndo('first'); });

    taskStateRef.current = {
      tasks: [{ id: 't1', text: 'v2' }],
      statuses: { t1: 'done' },
    };
    act(() => { result.current.pushUndo('second'); });

    let label;
    act(() => { label = result.current.popUndo(); });
    expect(label).toBe('second');
    expect(dispatchPersist).toHaveBeenLastCalledWith({
      type: 'RESTORE',
      statuses: { t1: 'done' },
      extraTasks: [{ id: 't1', text: 'v2' }],
    });

    act(() => { label = result.current.popUndo(); });
    expect(label).toBe('first');
    expect(dispatchPersist).toHaveBeenLastCalledWith({
      type: 'RESTORE',
      statuses: { t1: 'open' },
      extraTasks: [{ id: 't1', text: 'v1' }],
    });
  });

  it('snapshots are isolated from later mutation (tasks deep, statuses top-level)', () => {
    const state = {
      tasks: [{ id: 't1', text: 'pristine', recur: { type: 'weekly' } }],
      statuses: { t1: 'open' },
    };
    const { result, dispatchPersist } = setup(state);

    act(() => { result.current.pushUndo('mutation guard'); });

    // Mutate the live state IN PLACE after the snapshot — including a nested
    // object (deep-copy guarantee for tasks) and a top-level status key.
    state.tasks[0].text = 'mutated';
    state.tasks[0].recur.type = 'daily';
    state.statuses.t1 = 'done';

    act(() => { result.current.popUndo(); });

    expect(dispatchPersist).toHaveBeenCalledWith({
      type: 'RESTORE',
      statuses: { t1: 'open' },
      extraTasks: [{ id: 't1', text: 'pristine', recur: { type: 'weekly' } }],
    });
  });

  // 999.1227 — delete-undo: pushUndo accepts an optional server-side revert
  // callback (e.g. un-cancel a soft-cancelled delete); popUndo runs it AFTER
  // dispatching the client RESTORE, and only for the entry that carried it.
  it('runs the revert callback on pop, after the RESTORE dispatch', () => {
    const calls = [];
    const dispatchPersist = jest.fn(() => calls.push('restore'));
    const taskStateRef = { current: STATE_A };
    const { result } = renderHook(() => useUndo(taskStateRef, jest.fn(), dispatchPersist));

    const revert = jest.fn(() => calls.push('revert'));
    act(() => { result.current.pushUndo('delete task', revert); });
    act(() => { result.current.popUndo(); });

    expect(revert).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['restore', 'revert']); // client state back FIRST, then server un-cancel
  });

  it('does not run a revert for entries that did not carry one, and ignores non-function reverts', () => {
    const { result } = setup(STATE_A);
    const revert = jest.fn();

    act(() => { result.current.pushUndo('delete task', revert); });
    act(() => { result.current.pushUndo('status change'); });       // no revert
    act(() => { result.current.pushUndo('weird', 'not-a-function'); });

    act(() => { result.current.popUndo(); });  // 'weird' — non-function ignored
    act(() => { result.current.popUndo(); });  // 'status change' — no revert
    expect(revert).not.toHaveBeenCalled();

    act(() => { result.current.popUndo(); });  // 'delete task'
    expect(revert).toHaveBeenCalledTimes(1);
  });

  it('caps the stack at 30 snapshots, dropping the oldest', () => {
    const { result, taskStateRef } = setup({ tasks: [], statuses: {} });

    for (let i = 1; i <= 35; i++) {
      taskStateRef.current = { tasks: [{ id: 'seq', n: i }], statuses: {} };
      act(() => { result.current.pushUndo('step-' + i); });
    }

    const popped = [];
    for (let i = 0; i < 40; i++) {
      let label;
      act(() => { label = result.current.popUndo(); });
      if (label === null) break;
      popped.push(label);
    }

    expect(popped).toHaveLength(30);
    expect(popped[0]).toBe('step-35');       // newest first
    expect(popped[29]).toBe('step-6');       // steps 1-5 fell off the cap
    expect(result.current.canUndo()).toBe(false);
  });
});
