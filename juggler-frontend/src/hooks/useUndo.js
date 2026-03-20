/**
 * useUndo — 30-step undo stack
 */

import { useCallback, useRef } from 'react';

const MAX_UNDO = 30;

export default function useUndo(taskStateRef, dispatch, dispatchPersist) {
  const undoStackRef = useRef([]);

  const pushUndo = useCallback((label) => {
    var s = taskStateRef.current;
    undoStackRef.current = undoStackRef.current.concat([{
      label: label || "action",
      extraTasks: JSON.parse(JSON.stringify(s.tasks)),
      statuses: Object.assign({}, s.statuses),
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
    return snap.label;
  }, [dispatchPersist]);

  const canUndo = useCallback(() => {
    return undoStackRef.current.length > 0;
  }, []);

  return { pushUndo, popUndo, canUndo };
}
