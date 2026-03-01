/**
 * Dependency helpers extracted from task_tracker_v7_28 lines 349-398
 */

export function getTaskDeps(task) {
  var deps = task.dependsOn;
  if (!deps) return [];
  if (typeof deps === "string") return [deps];
  if (!Array.isArray(deps)) return [];
  return deps;
}

export function getDepsStatus(task, allTasks, statuses) {
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

export function topoSortTasks(tasks) {
  var taskMap = {};
  tasks.forEach(function(t) { taskMap[t.id] = t; });
  var visited = {}, result = [], temp = {};
  function visit(t) {
    if (temp[t.id]) return;
    if (visited[t.id]) return;
    temp[t.id] = true;
    var deps = getTaskDeps(t);
    deps.forEach(function(depId) {
      if (taskMap[depId]) visit(taskMap[depId]);
    });
    temp[t.id] = false;
    visited[t.id] = true;
    result.push(t);
  }
  tasks.forEach(function(t) { visit(t); });
  return result;
}

export function getDependents(taskId, allTasks) {
  return allTasks.filter(function(t) {
    return getTaskDeps(t).indexOf(taskId) !== -1;
  });
}
