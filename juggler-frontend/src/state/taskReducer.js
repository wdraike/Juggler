/**
 * Task state reducer — single source of truth for statuses + directions + tasks
 * Extracted from task_tracker_v7_28 lines 1424-1445
 */

export const TASK_STATE_INIT = { statuses: {}, directions: {}, tasks: [] };

export default function taskReducer(state, action) {
  switch (action.type) {
    case 'INIT':
      return {
        statuses: action.statuses || {},
        directions: action.directions || {},
        tasks: action.tasks || []
      };
    case 'SET_STATUS': {
      var ns = Object.assign({}, state.statuses);
      if (!action.val || action.val === "") { delete ns[action.id]; } else { ns[action.id] = action.val; }
      var nd = state.directions;
      if (action.deleteDirection) { nd = Object.assign({}, nd); delete nd[action.id]; }
      var nt = state.tasks;
      if (action.taskFields) {
        nt = nt.map(function(t) {
          return t.id === action.id ? Object.assign({}, t, action.taskFields) : t;
        });
      }
      return { statuses: ns, directions: nd, tasks: nt };
    }
    case 'SET_DIRECTION': {
      var nd2 = Object.assign({}, state.directions);
      nd2[action.id] = action.val;
      return { statuses: state.statuses, directions: nd2, tasks: state.tasks };
    }
    case 'UPDATE_TASK':
      return {
        statuses: state.statuses,
        directions: state.directions,
        tasks: state.tasks.map(function(t) {
          return t.id === action.id ? Object.assign({}, t, action.fields) : t;
        })
      };
    case 'ADD_TASKS':
      return {
        statuses: state.statuses,
        directions: state.directions,
        tasks: state.tasks.concat(action.tasks)
      };
    case 'DELETE_TASK':
      return {
        statuses: state.statuses,
        directions: state.directions,
        tasks: state.tasks.filter(function(t) { return t.id !== action.id; })
      };
    case 'SET_ALL':
      return {
        statuses: action.statuses != null ? action.statuses : state.statuses,
        directions: action.directions != null ? action.directions : state.directions,
        tasks: action.tasks != null ? action.tasks : state.tasks
      };
    case 'RESTORE':
      return {
        statuses: action.statuses,
        directions: action.directions,
        tasks: action.extraTasks
      };
    default:
      return state;
  }
}
