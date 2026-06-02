// Shared helpers for computing missed status

function isTaskMissed(task, currentTime) {
  if (!task.scheduled_at) return false;
  if (task.status === 'done' || task.status === 'cancel' || task.status === 'skip') return false;
  
  // Task is considered missed if it's past the scheduled time and not completed
  const scheduledTime = new Date(task.scheduled_at);
  const missedThreshold = new Date(scheduledTime.getTime() + (2 * 60 * 60 * 1000)); // 2 hours after scheduled time
  
  return currentTime > missedThreshold;
}

function shouldAutoMarkMissed(task, currentTime) {
  if (!task.scheduled_at) return false;
  if (task.status === 'missed') return false; // Already marked
  if (task.status === 'done' || task.status === 'cancel' || task.status === 'skip') return false;
  
  // Auto-mark as missed if past the resolution window
  const scheduledTime = new Date(task.scheduled_at);
  const resolutionWindow = new Date(scheduledTime.getTime() + (24 * 60 * 60 * 1000)); // 24 hours after scheduled time
  
  return currentTime > resolutionWindow;
}

function getMissedResolutionWindow(task) {
  if (!task.scheduled_at) return null;
  
  const scheduledTime = new Date(task.scheduled_at);
  return new Date(scheduledTime.getTime() + (24 * 60 * 60 * 1000)); // 24 hours after scheduled time
}

module.exports = {
  isTaskMissed,
  shouldAutoMarkMissed,
  getMissedResolutionWindow
};
