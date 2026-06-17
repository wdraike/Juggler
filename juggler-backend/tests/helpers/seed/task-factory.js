/**
 * Task factory — writes task_masters + task_instances to the real test DB.
 *
 * Design: one master + one instance per call (the common case).
 * For recurring templates, pass recur config; instances are materialized separately.
 *
 * Usage:
 *   const tf = require('./seed/task-factory');
 *   const t  = await tf.createTask(db, userId, { text: 'Do thing', dur: 30 });
 *   const r  = await tf.createRecurring(db, userId, { text: 'Daily habit', recur: { type: 'daily' } });
 *   const ch = await tf.createChain(db, userId, [ { text: 'Step 1' }, { text: 'Step 2' } ]);
 */

var crypto = require('crypto');

function uid(prefix) {
  return (prefix || 'task') + '-' + crypto.randomBytes(6).toString('hex');
}

function now(db) { return db.fn.now(); }

// ─── Master defaults ────────────────────────────────────────────────────────

function masterDefaults(userId, props) {
  return {
    id:           props.id       || uid('tm'),
    user_id:      userId,
    text:         props.text     || 'Test task',
    project:      props.project  || null,
    section:      props.section  || null,
    notes:        props.notes    || null,
    dur:          props.dur      != null ? props.dur : 30,
    pri:          props.pri      || 'P3',
    desired_at:   props.desiredAt    || null,
    desired_date: props.desiredDate  || null,
    due_at:       props.dueAt        || null,
    earliest_start_at: props.earliestStart || null,
    when:         props.when     != null ? props.when : '',
    day_req:      props.dayReq   || null,
    time_flex:    props.timeFlex != null ? props.timeFlex : null,
    flex_when:    props.flexWhen  ? 1 : 0,
    rigid:        props.rigid     ? 1 : 0,
    marker:       props.marker    ? 1 : 0,
    preferred_time_mins: props.preferredTimeMins || null,
    tz:           props.tz       || null,
    recurring:    props.recurring ? 1 : 0,
    recur:        props.recur    ? JSON.stringify(props.recur) : null,
    recur_start:  props.recurStart  || null,
    recur_end:    props.recurEnd    || null,
    split:        props.split     ? 1 : 0,
    split_min:    props.splitMin || null,
    depends_on:   props.dependsOn ? JSON.stringify(props.dependsOn) : null,
    location:     props.location  ? JSON.stringify(props.location)  : null,
    tools:        props.tools     ? JSON.stringify(props.tools)     : null,
    travel_before: props.travelBefore || null,
    travel_after:  props.travelAfter  || null,
    disabled_at:   props.disabledAt   || null,
    disabled_reason: props.disabledReason || null
  };
}

// ─── Instance defaults ───────────────────────────────────────────────────────

function instanceDefaults(db, masterId, userId, props, masterRow) {
  var instanceId = props.instanceId || (masterId + '-1');
  return {
    id:               instanceId,
    master_id:        masterId,
    user_id:          userId,
    occurrence_ordinal: props.occurrenceOrdinal || 1,
    split_ordinal:    props.splitOrdinal  || 1,
    split_total:      props.splitTotal    || 1,
    split_group:      props.splitGroup    || null,
    scheduled_at:     props.scheduledAt   || null,
    dur:              props.dur != null ? props.dur : (masterRow.dur || 30),
    date:             props.date          || null,
    day:              props.day           || null,
    time:             props.time          || null,
    date_pinned:      props.datePinned    ? 1 : 0,
    original_date:    props.originalDate  || null,
    original_time:    props.originalTime  || null,
    original_scheduled_at: props.originalScheduledAt || null,
    status:           props.status        || '',
    completed_at:     props.completedAt   || null,
    time_remaining:   props.timeRemaining != null ? props.timeRemaining : null,
    gcal_event_id:    props.gcalEventId   || null,
    gcal_recurring_id: props.gcalRecurringId || null,
    msft_event_id:    props.msftEventId   || null,
    apple_uid:        props.appleUid      || null,
    placement_mode:   props.placementMode || null,
    source_id:        props.sourceId      || null,
    overdue:          props.overdue       ? 1 : 0
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Create one task (master + instance).
 * Returns { master, instance } with the inserted row data.
 */
async function createTask(db, userId, props) {
  props = props || {};
  var master = masterDefaults(userId, props);
  master.created_at = now(db);
  master.updated_at = now(db);

  await db('task_masters').insert(master);

  var inst = instanceDefaults(db, master.id, userId, props, master);
  inst.created_at = now(db);
  inst.updated_at = now(db);

  await db('task_instances').insert(inst);
  return { master, instance: inst };
}

/**
 * Create a recurring master (no instances — scheduler materializes them).
 */
async function createRecurring(db, userId, props) {
  props = Object.assign({ recurring: true }, props);
  if (!props.recur) props.recur = { type: 'daily', days: [], every: 1 };
  var master = masterDefaults(userId, props);
  master.created_at = now(db);
  master.updated_at = now(db);
  await db('task_masters').insert(master);
  return { master };
}

/**
 * Create a dependency chain: each task depends on the previous.
 * Returns array of { master, instance } in order.
 */
async function createChain(db, userId, steps) {
  var results = [];
  var prevId = null;
  for (var i = 0; i < steps.length; i++) {
    var props = Object.assign({}, steps[i]);
    if (prevId) props.dependsOn = [prevId];
    var result = await createTask(db, userId, props);
    prevId = result.master.id;
    results.push(result);
  }
  return results;
}

/**
 * Create N split chunks for a master task.
 * Pass { dur, splitMin } — chunks are ceil(dur/splitMin) pieces.
 */
async function createSplitTask(db, userId, props) {
  props = Object.assign({ split: true }, props);
  var dur = props.dur || 60;
  var splitMin = props.splitMin || 30;
  var n = Math.ceil(dur / splitMin);

  var master = masterDefaults(userId, props);
  master.created_at = now(db);
  master.updated_at = now(db);
  await db('task_masters').insert(master);

  var instances = [];
  var groupId = master.id;
  for (var i = 1; i <= n; i++) {
    var chunkDur = (i < n) ? splitMin : (dur - splitMin * (n - 1));
    var inst = instanceDefaults(db, master.id, userId, {
      instanceId:    i === 1 ? master.id + '-1' : master.id + '-1-' + i,
      splitOrdinal:  i,
      splitTotal:    n,
      splitGroup:    n > 1 ? groupId : null,
      dur:           chunkDur,
      scheduledAt:   props.scheduledAt || null,
      date:          props.date        || null,
      datePinned:    props.datePinned  || false,
      status:        props.status      || ''
    }, master);
    inst.created_at = now(db);
    inst.updated_at = now(db);
    await db('task_instances').insert(inst);
    instances.push(inst);
  }
  return { master, instances };
}

/**
 * Bulk-create tasks from an array of props objects.
 * Returns array of { master, instance }.
 */
async function createTasks(db, userId, propsArray) {
  var results = [];
  for (var p of propsArray) {
    results.push(await createTask(db, userId, p));
  }
  return results;
}

/**
 * Set the status of a task instance directly in the DB.
 * Useful for state-machine tests that need a specific starting state.
 */
async function setStatus(db, instanceId, status, extra) {
  var update = Object.assign({ status, updated_at: db.fn.now() }, extra || {});
  if (status === 'done' || status === 'skip' || status === 'cancel') {
    update.completed_at = update.completed_at || db.fn.now();
  }
  await db('task_instances').where('id', instanceId).update(update);
}

/**
 * Pin a task instance to a specific date/time.
 */
async function pinTask(db, instanceId, scheduledAt) {
  await db('task_instances').where('id', instanceId).update({
    date_pinned: 1,
    scheduled_at: scheduledAt,
    updated_at: db.fn.now()
  });
}

module.exports = {
  createTask,
  createRecurring,
  createChain,
  createSplitTask,
  createTasks,
  setStatus,
  pinTask,
  uid
};
