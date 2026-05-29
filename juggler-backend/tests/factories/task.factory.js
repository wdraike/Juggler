/**
 * Task factory for juggler test suite.
 * Creates task_masters + task_instances rows for different task types.
 *
 * Domain model:
 *   - task_masters: user intent (what the user wants scheduled)
 *   - task_instances: scheduler-placed occurrences (when/where it's scheduled)
 *
 * Task type terminology:
 *   - one-off: Single standalone task (master + 1 instance)
 *   - chain member: Task linked in a dependency chain (depends_on field)
 *   - recurring instance: One occurrence of a repeating task (master + N instances)
 *   - split chunk: A piece of a task split across time blocks (split_ordinal/split_total)
 */
const crypto = require('crypto');

/**
 * Generate a task ID in juggler format.
 * @returns {string} UUID-based ID
 */
function generateId() {
  return crypto.randomUUID();
}

/**
 * Create a one-off (standalone) task.
 * Creates both a task_master and single task_instance.
 *
 * @param {string} userId - User ID who owns this task
 * @param {Object} options - Task configuration
 * @param {string} [options.text] - Task title/text
 * @param {number} [options.dur=30] - Duration in minutes
 * @param {string} [options.pri='P3'] - Priority (P1, P2, P3, P4)
 * @param {string} [options.project] - Project name
 * @param {string} [options.section] - Section within project
 * @param {string} [options.notes] - Task notes/description
 * @param {string} [options.status=''] - Instance status (empty, done, wip, skip, cancel, unscheduled)
 * @param {Date} [options.scheduled_at] - When the task is scheduled
 * @param {string} [options.date] - Date string (M/D format)
 * @param {string} [options.time] - Time string (e.g., '9:00 AM')
 * @param {string} [options.day] - Day abbreviation (Mon, Tue, etc.)
 * @param {string} [options.deadline] - Deadline date
 * @param {Object} [options.location] - Location JSON
 * @param {Array} [options.tools] - Required tools JSON array
 * @param {string} [options.placement_mode='flexible'] - Placement mode (flexible, fixed, reminder)
 * @param {string} [options.when] - Time preference tags (morning,afternoon,evening,night)
 * @param {string} [options.day_req] - Day requirement (any, weekday, weekend)
 * @returns {{ master: Object, instance: Object }} Created task master and instance
 */
function createTask(userId, options = {}) {
  const masterId = generateId();
  const instanceId = generateId();
  const now = new Date();

  const master = {
    id: masterId,
    user_id: userId,
    text: options.text || 'Test task',
    dur: options.dur ?? 30,
    pri: options.pri || 'P3',
    project: options.project || null,
    section: options.section || null,
    notes: options.notes || null,
    location: options.location || null,
    tools: options.tools || null,
    when: options.when || 'morning,lunch,afternoon,evening,night',
    day_req: options.day_req || 'any',
    deadline: options.deadline || null,
    start_after_at: options.start_after_at || null,
    desired_at: options.desired_at || null,
    desired_date: options.desired_date || null,
    depends_on: options.depends_on || null,
    recurring: false,
    split: false,
    placement_mode: options.placement_mode || 'flexible',
    disabled_at: null,
    disabled_reason: null,
    created_at: now,
    updated_at: now
  };

  const instance = {
    id: instanceId,
    master_id: masterId,
    user_id: userId,
    occurrence_ordinal: 1,
    split_ordinal: 1,
    split_total: 1,
    split_group: null,
    dur: options.dur ?? 30,
    scheduled_at: options.scheduled_at || null,
    date: options.date || null,
    day: options.day || null,
    time: options.time || null,
    status: options.status || '',
    date_pinned: false,
    time_remaining: null,
    unscheduled: null,
    created_at: now,
    updated_at: now
  };

  return { master, instance };
}

/**
 * Create a chain of dependent tasks.
 * Each task depends on the previous one in the chain via depends_on field.
 *
 * @param {string} userId - User ID who owns these tasks
 * @param {Object} options - Chain configuration
 * @param {number} [options.count=3] - Number of tasks in chain
 * @param {string} [options.prefix='Chain task'] - Title prefix for each task
 * @param {number} [options.dur=30] - Duration for each task
 * @param {string} [options.pri='P3'] - Priority for each task
 * @param {string} [options.project] - Project for all tasks
 * @returns {Array<{ master: Object, instance: Object }>}} Array of tasks in chain order
 */
function createChain(userId, options = {}) {
  const count = options.count ?? 3;
  const prefix = options.prefix || 'Chain task';
  const dur = options.dur ?? 30;
  const pri = options.pri || 'P3';

  const tasks = [];
  let previousId = null;

  for (let i = 0; i < count; i++) {
    const task = createTask(userId, {
      text: `${prefix} ${i + 1}`,
      dur,
      pri,
      project: options.project || null,
      depends_on: previousId ? [previousId] : null
    });

    tasks.push(task);
    previousId = task.master.id;
  }

  return tasks;
}

/**
 * Create a recurring task with generated instances.
 * Creates a task_master flagged as recurring, plus N instances.
 *
 * @param {string} userId - User ID who owns this task
 * @param {Object} options - Recurring task configuration
 * @param {string} [options.text='Recurring task'] - Task title
 * @param {number} [options.dur=30] - Duration per instance
 * @param {string} [options.pri='P3'] - Priority
 * @param {Object} [options.recur] - Recurrence rule { type: 'daily'|'weekly'|'custom', days?: string[], every?: number }
 * @param {string} [options.recur_start] - Start date for recurrence
 * @param {string} [options.recur_end] - End date for recurrence
 * @param {number} [options.instanceCount=1] - Number of instances to create
 * @param {Array<Object>} [options.instances] - Override instance configs [{ date, time, scheduled_at, status }]
 * @returns {{ master: Object, instances: Array<Object> }} Master template and instance array
 */
function createRecurring(userId, options = {}) {
  const masterId = generateId();
  const now = new Date();
  const instanceCount = options.instanceCount ?? 1;

  // Default recurrence rule: daily
  const recur = options.recur || { type: 'daily', every: 1 };

  const master = {
    id: masterId,
    user_id: userId,
    text: options.text || 'Recurring task',
    dur: options.dur ?? 30,
    pri: options.pri || 'P3',
    project: options.project || null,
    section: options.section || null,
    notes: options.notes || null,
    location: options.location || null,
    tools: options.tools || null,
    when: options.when || 'morning,lunch,afternoon,evening,night',
    day_req: options.day_req || 'any',
    deadline: options.deadline || null,
    recurring: true,
    recur: recur,
    recur_start: options.recur_start || null,
    recur_end: options.recur_end || null,
    split: false,
    placement_mode: 'flexible',
    disabled_at: null,
    disabled_reason: null,
    created_at: now,
    updated_at: now
  };

  const instances = [];

  for (let i = 0; i < instanceCount; i++) {
    const instanceId = generateId();
    const instanceOverride = (options.instances && options.instances[i]) || {};

    instances.push({
      id: instanceId,
      master_id: masterId,
      user_id: userId,
      occurrence_ordinal: i + 1,
      split_ordinal: 1,
      split_total: 1,
      split_group: null,
      dur: instanceOverride.dur ?? options.dur ?? 30,
      scheduled_at: instanceOverride.scheduled_at || null,
      date: instanceOverride.date || null,
      day: instanceOverride.day || null,
      time: instanceOverride.time || null,
      status: instanceOverride.status || '',
      date_pinned: instanceOverride.date_pinned || false,
      time_remaining: null,
      unscheduled: null,
      created_at: now,
      updated_at: now
    });
  }

  return { master, instances };
}

/**
 * Create a split task (single task broken into time blocks).
 * Creates one task_master plus multiple task_instances with different split_ordinals.
 *
 * @param {string} userId - User ID who owns this task
 * @param {Object} options - Split task configuration
 * @param {string} [options.text='Split task'] - Task title
 * @param {number} [options.totalDur=90] - Total duration in minutes
 * @param {number} [options.chunkCount=3] - Number of split chunks
 * @param {Array<number>} [options.chunkDurations] - Override chunk durations (must sum to totalDur)
 * @param {string} [options.pri='P3'] - Priority
 * @param {string} [options.project] - Project name
 * @param {string} [options.split_min] - Minimum chunk duration
 * @returns {{ master: Object, instances: Array<Object> }} Master and all chunk instances
 */
function createSplit(userId, options = {}) {
  const masterId = generateId();
  const now = new Date();
  const totalDur = options.totalDur ?? 90;
  const chunkCount = options.chunkCount ?? 3;
  const chunkDurations = options.chunkDurations;
  const splitMin = options.split_min;

  // Calculate chunk durations if not provided
  let durations;
  if (chunkDurations) {
    durations = chunkDurations;
  } else {
    const baseChunkDur = Math.floor(totalDur / chunkCount);
    const remainder = totalDur % chunkCount;
    durations = Array(chunkCount).fill(baseChunkDur);
    // Distribute remainder across first chunks
    for (let i = 0; i < remainder; i++) {
      durations[i]++;
    }
  }

  const master = {
    id: masterId,
    user_id: userId,
    text: options.text || 'Split task',
    dur: totalDur,
    pri: options.pri || 'P3',
    project: options.project || null,
    section: options.section || null,
    notes: options.notes || null,
    location: options.location || null,
    tools: options.tools || null,
    when: options.when || 'morning,lunch,afternoon,evening,night',
    day_req: options.day_req || 'any',
    deadline: options.deadline || null,
    recurring: false,
    split: true,
    split_min: splitMin || null,
    placement_mode: 'flexible',
    disabled_at: null,
    disabled_reason: null,
    created_at: now,
    updated_at: now
  };

  const instances = [];
  const primaryChunkId = generateId();

  for (let i = 0; i < durations.length; i++) {
    const instanceId = (i === 0) ? primaryChunkId : generateId();

    instances.push({
      id: instanceId,
      master_id: masterId,
      user_id: userId,
      occurrence_ordinal: 1,
      split_ordinal: i + 1,
      split_total: durations.length,
      split_group: primaryChunkId, // All chunks reference the primary (first) chunk
      dur: durations[i],
      scheduled_at: null,
      date: null,
      day: null,
      time: null,
      status: '',
      date_pinned: false,
      time_remaining: null,
      unscheduled: null,
      created_at: now,
      updated_at: now
    });
  }

  return { master, instances };
}

/**
 * Helper to flatten task data for database insertion.
 * Converts factory output into separate master and instance arrays.
 *
 * @param {Array<{ master: Object, instance?: Object, instances?: Array<Object> }>} tasks - Factory output
 * @returns {{ masters: Array<Object>, instances: Array<Object> }} Flattened arrays
 */
function flattenForDb(tasks) {
  const masters = [];
  const instances = [];

  const taskList = Array.isArray(tasks) ? tasks : [tasks];

  for (const task of taskList) {
    masters.push(task.master);

    if (task.instance) {
      instances.push(task.instance);
    }
    if (task.instances) {
      instances.push(...task.instances);
    }
  }

  return { masters, instances };
}

/**
 * Helper to create a batch of one-off tasks.
 *
 * @param {string} userId - User ID
 * @param {number} count - Number of tasks to create
 * @param {Object} [options] - Shared options for all tasks
 * @returns {Array<{ master: Object, instance: Object }>} Array of tasks
 */
function createBatch(userId, count, options = {}) {
  const tasks = [];
  for (let i = 0; i < count; i++) {
    tasks.push(createTask(userId, {
      ...options,
      text: options.text ? `${options.text} ${i + 1}` : `Task ${i + 1}`
    }));
  }
  return tasks;
}

module.exports = {
  createTask,
  createChain,
  createRecurring,
  createSplit,
  createBatch,
  flattenForDb,
  generateId
};