/**
 * useUndo — 30-step undo stack
 */

import { useCallback, useRef } from 'react';

const MAX_UNDO = 30;

export default function useUndo(taskStateRef, dispatch, dispatchPersist) {
  const undoStackRef = useRef([]);

  // 999.1227: `revert` is an optional server-side companion to the client
  // snapshot — e.g. delete-undo passes an un-cancel call (the server delete is
  // a soft-cancel, R55). popUndo runs it AFTER restoring the client snapshot.
  const pushUndo = useCallback((label, revert) => {
    var s = taskStateRef.current;
    undoStackRef.current = undoStackRef.current.concat([{
      label: label || "action",
      extraTasks: JSON.parse(JSON.stringify(s.tasks)),
      statuses: Object.assign({}, s.statuses),
      revert: typeof revert === 'function' ? revert : null,
    }]);
    if (undoStackRef.current.length > MAX_UNDO) {
      undoStackRef.current = undoStackRef.current.slice(-MAX_UNDO);
    }
  }, [taskStateRef]);

  const popUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return null;
    var snap = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    dispatchPersist({
      type: 'RESTORE',
      statuses: snap.statuses,
      extraTasks: snap.extraTasks
    });
    if (snap.revert) snap.revert(); // errors are the callback's own concern
    return snap.label;
  }, [dispatchPersist]);

  const canUndo = useCallback(() => {
    return undoStackRef.current.length > 0;
  }, []);

  return { pushUndo, popUndo, canUndo };
}
