/**
 * Task state reducer — single source of truth for statuses + tasks
 *
 * _dirtyTaskIds tracks which fields changed per task:
 *   { taskId: { field1: true, field2: true }, ... }
 * This enables field-level partial saves so concurrent editors (MCP, GCal)
 * don't have their changes overwritten.
 */

export const TASK_STATE_INIT = { statuses: {}, tasks: [], _dirtyStatuses: {}, _dirtyTaskIds: {} };

// Merge new dirty fields into existing dirty entry for a task
function markDirtyFields(dirtyTaskIds, id, fields) {
  var existing = dirtyTaskIds[id] || {};
  var merged = Object.assign({}, existing);
  if (fields) {
    Object.keys(fields).forEach(function(k) { merged[k] = true; });
  }
  var result = Object.assign({}, dirtyTaskIds);
  result[id] = merged;
  return result;
}

export default function taskReducer(state, action) {
  switch (action.type) {
    case 'INIT': {
      // Merge: preserve any locally-changed statuses that haven't round-tripped yet
      var merged = Object.assign({}, action.statuses || {});
      var dirty = state._dirtyStatuses || {};
      Object.keys(dirty).forEach(function(id) {
        merged[id] = dirty[id];
      });
      // Re-apply dirty task fields on top of freshly loaded tasks
      var dirtyTaskIds = state._dirtyTaskIds || {};
      var tasks = action.tasks || [];
      var dirtyKeys = Object.keys(dirtyTaskIds);
      if (dirtyKeys.length > 0) {
        var oldTaskMap = {};
        state.tasks.forEach(function(t) { oldTaskMap[t.id] = t; });
        tasks = tasks.map(function(t) {
          var dirtyFields = dirtyTaskIds[t.id];
          var oldTask = oldTaskMap[t.id];
          if (!dirtyFields || !oldTask) return t;
          // Re-apply only the dirty fields from the old in-memory task
          var patch = {};
          Object.keys(dirtyFields).forEach(function(f) {
            if (oldTask[f] !== undefined) patch[f] = oldTask[f];
          });
          return Object.keys(patch).length > 0 ? Object.assign({}, t, patch) : t;
        });
      }
      // 999.1571 (harrison WARN-1) — carry over _addFailed phantoms. A
      // preserved-but-unsaved bulk-add failure exists only client-side; the
      // server payload can never contain it, so without this a full reload
      // (SSE schedule:changed without changeset, version-bump poll, etc.)
      // silently re-discarded the user's work and left retryAddTasks a
      // no-op. If the server DOES return the id (commit succeeded but the
      // response was lost), the server row wins and the flag drops.
      var initIds = {};
      tasks.forEach(function(t) { initIds[t.id] = true; });
      var carriedPhantoms = state.tasks.filter(function(t) {
        return t._addFailed && !initIds[t.id];
      });
      if (carriedPhantoms.length > 0) tasks = tasks.concat(carriedPhantoms);
      return {
        statuses: merged,
        tasks: tasks,
        _dirtyStatuses: dirty,
        _dirtyTaskIds: dirtyTaskIds
      };
    }
    case 'SET_STATUS': {
      var ns = Object.assign({}, state.statuses);
      if (!action.val || action.val === "") { delete ns[action.id]; } else { ns[action.id] = action.val; }
      var nt = state.tasks;
      if (action.taskFields) {
        nt = nt.map(function(t) {
          return t.id === action.id ? Object.assign({}, t, action.taskFields) : t;
        });
      }
      // Track dirty status so INIT won't overwrite it
      var ds = Object.assign({}, state._dirtyStatuses || {});
      ds[action.id] = action.val || '';
      // If taskFields were updated (e.g. recurring completion date advance), mark those fields dirty
      var dtIds = state._dirtyTaskIds;
      if (action.taskFields) {
        dtIds = markDirtyFields(dtIds, action.id, action.taskFields);
      }
      return { statuses: ns, tasks: nt, _dirtyStatuses: ds, _dirtyTaskIds: dtIds };
    }
    case 'UPDATE_TASK': {
      var dt3 = markDirtyFields(state._dirtyTaskIds, action.id, action.fields);
      // Find the target task to check if it's a recurring task instance
      var targetTask = state.tasks.find(function(t) { return t.id === action.id; });
      var sourceId = targetTask && targetTask.sourceId;
      // Template fields that propagate from source to all instances
      var TEMPLATE_PROPS = ['text', 'dur', 'pri', 'project', 'section', 'location', 'tools',
        'when', 'dayReq', 'recurring', 'timeFlex', 'split', 'splitMin',
        'travelBefore', 'travelAfter', 'dependsOn'];
      // Extract template-level changes from the update
      var templatePatch = null;
      if (sourceId && action.fields) {
        templatePatch = {};
        TEMPLATE_PROPS.forEach(function(f) {
          if (action.fields[f] !== undefined) templatePatch[f] = action.fields[f];
        });
        if (Object.keys(templatePatch).length === 0) templatePatch = null;
      }
      return {
        statuses: state.statuses,
        tasks: state.tasks.map(function(t) {
          if (t.id === action.id) return Object.assign({}, t, action.fields);
          // Propagate template fields to siblings (same sourceId) and the source itself
          if (templatePatch && (t.sourceId === sourceId || t.id === sourceId)) {
            return Object.assign({}, t, templatePatch);
          }
          return t;
        }),
        _dirtyStatuses: state._dirtyStatuses,
        _dirtyTaskIds: dt3
      };
    }
    case 'ADD_TASKS':
      return {
        statuses: state.statuses,
        tasks: state.tasks.concat(action.tasks),
        _dirtyStatuses: state._dirtyStatuses,
        _dirtyTaskIds: state._dirtyTaskIds
      };
    case 'SET_ADD_FAILED': {
      // 999.1571 — flags tasks from a rejected BULK addTasks() POST as
      // `_addFailed` instead of removing them (see useTaskState.js addTasks/
      // retryAddTasks). `failed: false` clears the flag on a successful
      // (re)send without touching any other task field.
      var addFailedSet = {};
      (action.ids || []).forEach(function(id) { addFailedSet[id] = true; });
      return Object.assign({}, state, {
        tasks: state.tasks.map(function(t) {
          if (!addFailedSet[t.id]) return t;
          return Object.assign({}, t, { _addFailed: !!action.failed });
        })
      });
    }
    case 'REMOVE_TASKS': {
      // Remove multiple tasks by ID (e.g., scheduler deleted recurring instances)
      var removeSet = {};
      action.ids.forEach(function(id) { removeSet[id] = true; });
      return {
        statuses: state.statuses,
        tasks: state.tasks.filter(function(t) { return !removeSet[t.id]; }),
        _dirtyStatuses: state._dirtyStatuses,
        _dirtyTaskIds: state._dirtyTaskIds
      };
    }
    case 'PATCH_TASKS': {
      // Apply server-authoritative partial updates (e.g. scheduler moved a task).
      // Does NOT mark tasks dirty — the backend already persisted these fields.
      var patchMap = {};
      action.patches.forEach(function(p) { if (p && p.id) patchMap[p.id] = p.patch || {}; });
      // Sync statuses map when a patch carries a status field, but skip tasks
      // whose status is currently dirty (local change not yet confirmed by server).
      var dirtyStatuses = state._dirtyStatuses || {};
      var newStatuses = state.statuses;
      action.patches.forEach(function(p) {
        if (!p || !p.id || !p.patch || !('status' in p.patch)) return;
        if (dirtyStatuses[p.id] !== undefined) return;
        if (newStatuses === state.statuses) newStatuses = Object.assign({}, state.statuses);
        if (p.patch.status) newStatuses[p.id] = p.patch.status;
        else delete newStatuses[p.id];
      });
      return {
        statuses: newStatuses,
        tasks: state.tasks.map(function(t) {
          var p = patchMap[t.id];
          return p ? Object.assign({}, t, p) : t;
        }),
        _dirtyStatuses: state._dirtyStatuses,
        _dirtyTaskIds: state._dirtyTaskIds
      };
    }
    case 'UPSERT_TASKS': {
      // Insert or update tasks with complete API data
      var upsertMap = {};
      action.tasks.forEach(function(t) { upsertMap[t.id] = t; });
      var updated6 = state.tasks.map(function(t) {
        return upsertMap[t.id] ? upsertMap[t.id] : t;
      });
      // Add any genuinely new tasks not already in state
      action.tasks.forEach(function(t) {
        if (!state.tasks.some(function(st) { return st.id === t.id; })) {
          updated6.push(t);
        }
      });
      return {
        statuses: state.statuses,
        tasks: updated6,
        _dirtyStatuses: state._dirtyStatuses,
        _dirtyTaskIds: state._dirtyTaskIds
      };
    }
    case 'DELETE_TASK': {
      // Mark tasks whose dependsOn changed as dirty
      var dt4 = Object.assign({}, state._dirtyTaskIds || {});
      state.tasks.forEach(function(t) {
        if (t.dependsOn && t.dependsOn.indexOf(action.id) >= 0) {
          dt4 = markDirtyFields(dt4, t.id, { dependsOn: true });
        }
      });
      return {
        statuses: state.statuses,
        tasks: state.tasks.filter(function(t) { return t.id !== action.id; }).map(function(t) {
          if (t.dependsOn && t.dependsOn.indexOf(action.id) >= 0) {
            return Object.assign({}, t, { dependsOn: t.dependsOn.filter(function(d) { return d !== action.id; }) });
          }
          return t;
        }),
        _dirtyStatuses: state._dirtyStatuses,
        _dirtyTaskIds: dt4
      };
    }
    case 'SET_ALL': {
      // Mark all fields on changed tasks as dirty
      var dt5 = Object.assign({}, state._dirtyTaskIds || {});
      if (action.tasks) {
        var oldMap = {};
        state.tasks.forEach(function(t) { oldMap[t.id] = t; });
        action.tasks.forEach(function(t) {
          var old = oldMap[t.id];
          if (!old) return;
          var changed = {};
          Object.keys(t).forEach(function(k) {
            if (k === 'id') return;
            if (JSON.stringify(t[k]) !== JSON.stringify(old[k])) changed[k] = true;
          });
          if (Object.keys(changed).length > 0) {
            dt5 = markDirtyFields(dt5, t.id, changed);
          }
        });
      }
      return {
        statuses: action.statuses != null ? action.statuses : state.statuses,
        tasks: action.tasks != null ? action.tasks : state.tasks,
        _dirtyStatuses: state._dirtyStatuses,
        _dirtyTaskIds: dt5
      };
    }
    case 'RESTORE':
      return {
        statuses: action.statuses,
        tasks: action.extraTasks,
        _dirtyStatuses: {},
        _dirtyTaskIds: {}
      };
    case 'CLEAR_DIRTY_STATUS': {
      var cd = Object.assign({}, state._dirtyStatuses || {});
      delete cd[action.id];
      // BUG1 (W1, leg sched-anchor-split-bugs) fix: SET_STATUS also dirties
      // _dirtyTaskIds[id] when opts.taskFields is present (e.g. a rolling
      // completion advancing a field alongside status). Clear that marker too
      // so a redundant debounced flushSave()/CLEAR_DIRTY_TASKS round-trip
      // doesn't re-fire for a pure status change already confirmed here.
      //
      // WARN ernie-w2-cleardirty-overbroad (2026-07-04): _dirtyTaskIds[id] is a
      // per-FIELD map ({field: true, ...}) shared with UPDATE_TASK/other edit
      // paths (see file header). Deleting the WHOLE entry silently drops any
      // OTHER co-pending field edit for the same task id (e.g. a pending `dur`
      // change queued via UPDATE_TASK before the status PUT resolved). Clear
      // only the field(s) THIS status update itself dirtied — action.taskFields
      // carries the exact same object SET_STATUS's markDirtyFields merged in
      // (useTaskState.js's setStatus passes its own opts.taskFields through to
      // both dispatches) — mirroring the savedFields per-field clearing
      // CLEAR_DIRTY_TASKS already does below. A caller that cannot supply
      // taskFields falls back to the pre-fix whole-entry clear.
      var cti = Object.assign({}, state._dirtyTaskIds || {});
      if (cti[action.id]) {
        if (action.taskFields) {
          var ctiEntry = Object.assign({}, cti[action.id]);
          Object.keys(action.taskFields).forEach(function(k) { delete ctiEntry[k]; });
          if (Object.keys(ctiEntry).length === 0) {
            delete cti[action.id];
          } else {
            cti[action.id] = ctiEntry;
          }
        } else {
          delete cti[action.id];
        }
      }
      return Object.assign({}, state, { _dirtyStatuses: cd, _dirtyTaskIds: cti });
    }
    case 'CLEAR_DIRTY_TASKS': {
      if (action.ids) {
        // Only clear the specified IDs — preserve any that were dirtied during in-flight save
        // Also handle field-level: if action.savedFields is provided, only clear those fields
        var remaining = Object.assign({}, state._dirtyTaskIds || {});
        if (action.savedFields) {
          action.ids.forEach(function(id) {
            if (!remaining[id]) return;
            var saved = action.savedFields[id];
            if (!saved) { delete remaining[id]; return; }
            var entry = Object.assign({}, remaining[id]);
            Object.keys(saved).forEach(function(f) { delete entry[f]; });
            if (Object.keys(entry).length === 0) { delete remaining[id]; }
            else { remaining[id] = entry; }
          });
        } else {
          action.ids.forEach(function(id) { delete remaining[id]; });
        }
        return Object.assign({}, state, { _dirtyTaskIds: remaining });
      }
      return Object.assign({}, state, { _dirtyTaskIds: {} });
    }
    default:
      return state;
  }
}
