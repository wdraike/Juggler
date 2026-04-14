/**
 * Backfill task_masters and task_instances from the existing `tasks` table.
 *
 * ID preservation strategy (keeps sync tables valid without a mapping table):
 *   - recurring_template rows -> task_masters (SAME id)
 *   - recurring_instance rows -> task_instances (SAME id); master_id = source_id
 *   - one-shot / generated / NULL task_type rows -> create NEW task_masters row (new UUIDv7)
 *                                                 + task_instances row keeping OLD id
 *
 * After this migration every existing sync reference (cal_sync_ledger.task_id,
 * sync_history.task_id, task_write_queue.task_id) still points at a valid
 * task_instances.id. Only master IDs for one-shots are newly generated.
 *
 * depends_on arrays on masters are rewritten through the old_id -> master_id map,
 * because dependencies are a master-level concept in the new schema.
 */
var { v7: uuidv7 } = require('uuid');

exports.up = async function(knex) {
  var allTasks = await knex('tasks').select('*');
  if (allTasks.length === 0) {
    console.log('[BACKFILL] No tasks to migrate');
    return;
  }

  console.log('[BACKFILL] Migrating ' + allTasks.length + ' tasks');

  // Partition — mirrors buildSourceMap() in task.controller.js so legacy
  // recurring sources (task_type='task' with recurring=1) are treated as templates.
  function isTemplate(t) {
    if (t.task_type === 'recurring_template') return true;
    if (t.recurring && t.task_type !== 'recurring_instance') return true;
    return false;
  }
  var templates = allTasks.filter(isTemplate);
  var instances = allTasks.filter(function(t) { return t.task_type === 'recurring_instance'; });
  var oneshots = allTasks.filter(function(t) {
    return !isTemplate(t) && t.task_type !== 'recurring_instance';
  });

  console.log('[BACKFILL] ' + templates.length + ' templates, ' + instances.length + ' recurring instances, ' + oneshots.length + ' one-shots');

  // old_task_id -> master_id (for depends_on rewriting).
  // For templates: master_id = task.id (preserved).
  // For one-shots: master_id = task.id (shared with instance) — keeps trigger logic simple:
  //   any write to `tasks` can compute master_id directly from task.id without a lookup.
  //   For non-recurring, master and instance share the same id value; they live in
  //   different tables so there's no collision.
  var oldToMaster = {};
  templates.forEach(function(t) { oldToMaster[t.id] = t.id; });
  oneshots.forEach(function(t) { oldToMaster[t.id] = t.id; });

  function parseJson(v) {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch (e) { return null; }
  }

  function rewriteDeps(deps) {
    if (!Array.isArray(deps) || deps.length === 0) return deps;
    var out = deps.map(function(id) { return oldToMaster[id] || id; });
    return out;
  }

  function masterFromTask(t, masterId) {
    var deps = rewriteDeps(parseJson(t.depends_on));
    return {
      id: masterId,
      user_id: t.user_id,
      text: t.text,
      project: t.project,
      section: t.section,
      notes: t.notes,
      dur: t.dur != null ? t.dur : 30,
      pri: t.pri || 'P3',
      desired_at: t.desired_at || null,
      desired_date: t.desired_date || null,
      due_at: t.due_at || null,
      start_after_at: t.start_after_at || null,
      when: t.when || null,
      day_req: t.day_req || null,
      time_flex: t.time_flex != null ? t.time_flex : null,
      flex_when: !!t.flex_when,
      rigid: !!t.rigid,
      marker: !!t.marker,
      preferred_time_mins: t.preferred_time_mins != null ? t.preferred_time_mins : null,
      tz: t.tz || null,
      prev_when: t.prev_when || null,
      recurring: !!t.recurring,
      recur: t.recur != null ? (typeof t.recur === 'string' ? t.recur : JSON.stringify(t.recur)) : null,
      recur_start: t.recur_start || null,
      recur_end: t.recur_end || null,
      split: t.split != null ? !!t.split : null,
      split_min: t.split_min != null ? t.split_min : null,
      depends_on: deps ? JSON.stringify(deps) : null,
      location: t.location != null ? (typeof t.location === 'string' ? t.location : JSON.stringify(t.location)) : null,
      tools: t.tools != null ? (typeof t.tools === 'string' ? t.tools : JSON.stringify(t.tools)) : null,
      travel_before: t.travel_before != null ? t.travel_before : null,
      travel_after: t.travel_after != null ? t.travel_after : null,
      disabled_at: t.disabled_at || null,
      disabled_reason: t.disabled_reason || null,
      created_at: t.created_at,
      updated_at: t.updated_at
    };
  }

  function instanceFromTask(t, masterId, occOrdinal) {
    return {
      id: t.id,
      master_id: masterId,
      user_id: t.user_id,
      occurrence_ordinal: occOrdinal,
      split_ordinal: 1,
      split_total: 1,
      scheduled_at: t.scheduled_at || null,
      dur: t.dur != null ? t.dur : 30,
      date: t.date || null,
      day: t.day || null,
      time: t.time || null,
      date_pinned: !!t.date_pinned,
      original_date: t.original_date || null,
      original_time: t.original_time || null,
      original_day: t.original_day || null,
      status: t.status || '',
      time_remaining: t.time_remaining != null ? t.time_remaining : null,
      unscheduled: t.unscheduled != null ? !!t.unscheduled : null,
      created_at: t.created_at,
      updated_at: t.updated_at
    };
  }

  // Batch insert helper
  async function batchInsert(tableName, rows) {
    if (rows.length === 0) return;
    var CHUNK = 200;
    for (var i = 0; i < rows.length; i += CHUNK) {
      await knex(tableName).insert(rows.slice(i, i + CHUNK));
    }
  }

  // 1. Insert masters for templates (preserve id)
  var templateMasters = templates.map(function(t) { return masterFromTask(t, t.id); });

  // 2. Insert masters for one-shots (master_id = task.id — shared with instance)
  var oneshotMasters = oneshots.map(function(t) { return masterFromTask(t, t.id); });

  await batchInsert('task_masters', templateMasters.concat(oneshotMasters));
  console.log('[BACKFILL] Inserted ' + (templateMasters.length + oneshotMasters.length) + ' masters');

  // 3. Insert instances for one-shots (1:1, ordinal=1, keep old id; master_id = task.id)
  var oneshotInstances = oneshots.map(function(t) {
    return instanceFromTask(t, t.id, 1);
  });

  // 4. Insert instances for recurring instances (master_id = source_id, ordinal by scheduled_at)
  //    Group by source_id, sort by scheduled_at ASC, number 1..N.
  // Build set of valid master IDs (any template id — they kept their ids as masters)
  var masterIdSet = {};
  templates.forEach(function(t) { masterIdSet[t.id] = true; });

  var bySource = {};
  var orphanCount = 0;
  instances.forEach(function(t) {
    var sid = t.source_id;
    if (!sid || !masterIdSet[sid]) {
      orphanCount++;
      return;
    }
    if (!bySource[sid]) bySource[sid] = [];
    bySource[sid].push(t);
  });
  if (orphanCount > 0) {
    console.warn('[BACKFILL] Skipped ' + orphanCount + ' orphaned recurring_instance rows (no matching template)');
  }

  var recurringInstances = [];
  Object.keys(bySource).forEach(function(sid) {
    var grp = bySource[sid].slice().sort(function(a, b) {
      var as = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
      var bs = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
      if (as !== bs) return as - bs;
      return (a.id < b.id ? -1 : 1);
    });
    grp.forEach(function(t, idx) {
      recurringInstances.push(instanceFromTask(t, sid, idx + 1));
    });
  });

  await batchInsert('task_instances', oneshotInstances.concat(recurringInstances));
  console.log('[BACKFILL] Inserted ' + (oneshotInstances.length + recurringInstances.length) + ' instances');
};

exports.down = async function(knex) {
  // Non-reversible — tasks rows are the source of truth until the drop migration runs.
  // To undo: truncate task_instances and task_masters; the original tasks table is untouched by this migration.
  await knex('task_instances').del();
  await knex('task_masters').del();
};
