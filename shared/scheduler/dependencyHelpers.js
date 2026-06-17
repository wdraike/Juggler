/**
 * Dependency helpers — shared between frontend and backend
 */

function getTaskDeps(task) {
  var deps = task.dependsOn;
  if (!deps) return [];
  if (typeof deps === "string") return [deps];
  if (!Array.isArray(deps)) return [];
  return deps;
}

function getDepsStatus(task, allTasks, statuses) {
  var deps = getTaskDeps(task);
  if (deps.length === 0) return { satisfied: true, pending: [], done: [], missing: [] };
  var pending = [], done = [], missing = [];
  deps.forEach(function(depId) {
    var depTask = allTasks.find(function(t) { return t.id === depId; });
    if (!depTask) { missing.push(depId); return; }
    var st = statuses[depId] || "";
    if (st === "done") { done.push(depId); }
    else { pending.push(depId); }
  });
  return { satisfied: pending.length === 0 && missing.length === 0, pending: pending, done: done, missing: missing };
}

function topoSortTasks(tasks) {
  var taskMap = {};
  tasks.forEach(function(t) { taskMap[t.id] = t; });
  var visited = {}, result = [];
  var inCurrentPath = {}; // tracks nodes on the current DFS path
  var pathStack = [];     // ordered list of node IDs on the current path
  var cycleIds = [];      // accumulated cycle node IDs

  function visit(t) {
    if (visited[t.id]) return;
    // Cycle detected: t is already on the current DFS path
    if (inCurrentPath[t.id]) {
      // All nodes from t.id to the end of pathStack are in a cycle
      var recording = false;
      for (var pi = 0; pi < pathStack.length; pi++) {
        if (pathStack[pi] === t.id) recording = true;
        if (recording) {
          if (cycleIds.indexOf(pathStack[pi]) === -1) {
            cycleIds.push(pathStack[pi]);
          }
        }
      }
      return;
    }
    inCurrentPath[t.id] = true;
    pathStack.push(t.id);
    var deps = getTaskDeps(t);
    deps.forEach(function(depId) {
      if (taskMap[depId]) visit(taskMap[depId]);
    });
    pathStack.pop();
    delete inCurrentPath[t.id];
    visited[t.id] = true;
    result.push(t);
  }

  tasks.forEach(function(t) { visit(t); });

  var sorted = result;
  sorted.cycles = cycleIds;
  return sorted;
}

function getDependents(taskId, allTasks) {
  return allTasks.filter(function(t) {
    return getTaskDeps(t).indexOf(taskId) !== -1;
  });
}

module.exports = {
  getTaskDeps,
  getDepsStatus,
  topoSortTasks,
  getDependents
};
