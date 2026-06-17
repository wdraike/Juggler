/**
 * In-memory task repository test double.
 *
 * Implements the task repository port for unit testing without a real database.
 * Uses a Map for O(1) lookups by ID, with secondary indexes for user_id queries.
 *
 * Method signatures match the production Knex-based repository:
 *   - findById(id, userId) → task or null
 *   - findByUserId(userId) → array of tasks
 *   - create(task) → created task with generated id
 *   - update(id, task, userId) → updated task or null
 *   - delete(id, userId) → deleted task or null
 *   - findAll(userId) → array of all tasks for user
 */

/**
 * Default monotonic clock: returns a strictly-increasing ISO-8601 timestamp on
 * every call, even when wall-clock milliseconds have not advanced.  Tracks the
 * last-issued ms; if Date.now() <= lastMs, it emits lastMs + 1.
 *
 * This prevents the sub-millisecond create→update collision that caused
 * task.adapter.test.js:132 to flake ~80% of the time (999.312).
 */
function makeMonotonicClock() {
  var lastMs = 0;
  return function monotonicNow() {
    var now = Date.now();
    if (now <= lastMs) {
      lastMs = lastMs + 1;
    } else {
      lastMs = now;
    }
    return new Date(lastMs).toISOString();
  };
}

class InMemoryTaskRepository {
  /**
   * @param {object} [opts]
   * @param {function} [opts.clock] - Zero-arg function returning an ISO-8601
   *   timestamp string.  Defaults to a monotonic wall-clock wrapper that
   *   guarantees strictly-increasing values even within the same millisecond.
   *   Inject a controlled clock in tests that need deterministic timestamps.
   */
  constructor(opts) {
    // Primary storage: id → task
    this._store = new Map();
    // Secondary index: userId → Set of task ids
    this._byUser = new Map();
    // Auto-increment counter for ID generation
    this._idCounter = 0;
    // Injected or default monotonic clock
    this._clock = (opts && opts.clock) ? opts.clock : makeMonotonicClock();
  }

  /**
   * Generate a unique task ID.
   * @returns {string}
   * @private
   */
  _generateId() {
    this._idCounter++;
    return `task-${this._idCounter}`;
  }

  /**
   * Deep clone a task to prevent external mutation.
   * @param {object} task
   * @returns {object}
   * @private
   */
  _clone(task) {
    if (!task) return null;
    return JSON.parse(JSON.stringify(task));
  }

  /**
   * Find a task by ID for a specific user.
   *
   * @param {string} id - Task ID
   * @param {string} userId - User ID (ensures user-scoped access)
   * @returns {object|null} Task object or null if not found
   */
  findById(id, userId) {
    const task = this._store.get(id);
    if (!task || task.user_id !== userId) {
      return null;
    }
    return this._clone(task);
  }

  /**
   * Find all tasks for a specific user.
   *
   * @param {string} userId - User ID
   * @returns {object[]} Array of tasks (may be empty)
   */
  findByUserId(userId) {
    const taskIds = this._byUser.get(userId);
    if (!taskIds || taskIds.size === 0) {
      return [];
    }
    const tasks = [];
    for (const id of taskIds) {
      const task = this._store.get(id);
      if (task) {
        tasks.push(this._clone(task));
      }
    }
    return tasks;
  }

  /**
   * Create a new task.
   *
   * @param {object} task - Task data (user_id required)
   * @returns {object} Created task with generated id
   */
  create(task) {
    const id = task.id || this._generateId();
    const now = this._clock();
    
    const newTask = {
      id,
      user_id: task.user_id,
      task_type: task.task_type || 'task',
      text: task.text || '',
      scheduled_at: task.scheduled_at || null,
      desired_at: task.desired_at || null,
      tz: task.tz || null,
      deadline: task.deadline || null,
      dur: task.dur || 30,
      time_remaining: task.time_remaining || null,
      pri: task.pri || 'P3',
      project: task.project || null,
      status: task.status || '',
      section: task.section || null,
      notes: task.notes || null,
      url: task.url || null,
      earliest_start_at: task.earliest_start_at || null,
      location: task.location || '[]',
      tools: task.tools || '[]',
      when: task.when || null,
      day_req: task.day_req || null,
      recurring: task.recurring || 0,
      time_flex: task.time_flex || null,
      split: task.split || null,
      split_min: task.split_min || null,
      recur: task.recur || null,
      source_id: task.source_id || null,
      generated: task.generated || 0,
      gcal_event_id: task.gcal_event_id || null,
      msft_event_id: task.msft_event_id || null,
      apple_event_id: task.apple_event_id || null,
      cal_sync_origin: task.cal_sync_origin || null,
      cal_event_url: task.cal_event_url || null,
      apple_calendar_name: task.apple_calendar_name || null,
      depends_on: task.depends_on || '[]',
      marker: task.marker || 0,
      placement_mode: task.placement_mode || null,
      flex_when: task.flex_when || 0,
      travel_before: task.travel_before || null,
      travel_after: task.travel_after || null,
      weather_precip: task.weather_precip || 'any',
      weather_cloud: task.weather_cloud || 'any',
      weather_temp_min: task.weather_temp_min || null,
      weather_temp_max: task.weather_temp_max || null,
      weather_temp_unit: task.weather_temp_unit || null,
      weather_humidity_min: task.weather_humidity_min || null,
      weather_humidity_max: task.weather_humidity_max || null,
      preferred_time_mins: task.preferred_time_mins || null,
      unscheduled: task.unscheduled || null,
      overdue: task.overdue || null,
      slack_mins: task.slack_mins || null,
      recur_start: task.recur_start || null,
      recur_end: task.recur_end || null,
      rolling_anchor: task.rolling_anchor || null,
      disabled_at: task.disabled_at || null,
      disabled_reason: task.disabled_reason || null,
      occurrence_ordinal: task.occurrence_ordinal || null,
      split_ordinal: task.split_ordinal || null,
      split_total: task.split_total || null,
      split_group: task.split_group || null,
      created_at: task.created_at || now,
      updated_at: now,
    };

    // Store the task
    this._store.set(id, newTask);

    // Update secondary index
    const userId = newTask.user_id;
    if (!this._byUser.has(userId)) {
      this._byUser.set(userId, new Set());
    }
    this._byUser.get(userId).add(id);

    return this._clone(newTask);
  }

  /**
   * Update an existing task.
   *
   * @param {string} id - Task ID
   * @param {object} updates - Partial task data to merge
   * @param {string} userId - User ID (ensures user-scoped access)
   * @returns {object|null} Updated task or null if not found
   */
  update(id, updates, userId) {
    const existing = this._store.get(id);
    if (!existing || existing.user_id !== userId) {
      return null;
    }

    const updated = {
      ...existing,
      ...updates,
      id, // preserve original id
      user_id: existing.user_id, // preserve original user_id
      updated_at: this._clock(),
    };

    // Handle user_id change (rare, but update secondary index)
    if (updates.user_id && updates.user_id !== existing.user_id) {
      // Remove from old user index
      const oldUserTasks = this._byUser.get(existing.user_id);
      if (oldUserTasks) {
        oldUserTasks.delete(id);
      }
      // Add to new user index
      if (!this._byUser.has(updates.user_id)) {
        this._byUser.set(updates.user_id, new Set());
      }
      this._byUser.get(updates.user_id).add(id);
    }

    this._store.set(id, updated);
    return this._clone(updated);
  }

  /**
   * Delete a task.
   *
   * @param {string} id - Task ID
   * @param {string} userId - User ID (ensures user-scoped access)
   * @returns {object|null} Deleted task or null if not found
   */
  delete(id, userId) {
    const task = this._store.get(id);
    if (!task || task.user_id !== userId) {
      return null;
    }

    // Remove from store
    this._store.delete(id);

    // Remove from secondary index
    const userTasks = this._byUser.get(userId);
    if (userTasks) {
      userTasks.delete(id);
      // Clean up empty sets
      if (userTasks.size === 0) {
        this._byUser.delete(userId);
      }
    }

    return this._clone(task);
  }

  /**
   * Find all tasks for a user (alias for findByUserId).
   *
   * @param {string} userId - User ID
   * @returns {object[]} Array of tasks
   */
  findAll(userId) {
    return this.findByUserId(userId);
  }

  /**
   * Clear all stored data (useful between tests).
   */
  clear() {
    this._store.clear();
    this._byUser.clear();
    this._idCounter = 0;
  }

  /**
   * Get total count of stored tasks.
   * @returns {number}
   */
  get size() {
    return this._store.size;
  }
}

module.exports = InMemoryTaskRepository;