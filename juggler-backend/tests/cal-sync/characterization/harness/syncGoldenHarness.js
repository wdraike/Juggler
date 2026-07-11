/**
 * W4 sync() Golden-Master Harness (999.1025 Phase 1 — characterization BEFORE extraction)
 *
 * Mirrors the H6 scheduler golden-master discipline
 * (tests/characterization/scheduler/goldenMaster.h6.test.js): pin the COMPLETE
 * observable behavior of cal-sync.controller.js sync() against seeded fixtures
 * BEFORE any hexagonal extraction, so the extraction can prove bit-for-bit
 * behavior preservation.
 *
 * WHAT IS RECORDED per sync() run:
 *   - HTTP result   : statusCode + response body (stats/summary/errors)
 *   - Provider calls: every network-boundary adapter call (getValidAccessToken,
 *                     listEvents, create/update/delete, batch*), grouped per
 *                     provider (per-provider order is deterministic; cross-provider
 *                     interleaving during the parallel Phase-1 fetch is not, so
 *                     calls are never compared in a single global sequence).
 *   - SSE events    : every sseEmitter.emit (sync:progress / lock_conflict / error)
 *   - Queue enqueues: every enqueueScheduleRun (source + sorted affected ids)
 *   - DB row deltas : added/removed/changed rows in tasks_v, cal_sync_ledger,
 *                     sync_history, sync_locks, task_write_queue and the users
 *                     calendar columns — diffed before/after each run.
 *
 * DETERMINISM RULES:
 *   - Clock frozen at FIXED_NOW (2026-06-16T12:00:00Z, Monday) via jest modern
 *     fake timers faking ONLY Date (all timer fns stay real so DB I/O, the
 *     throttle() delays and the lock backoff still work).
 *   - All seeded datetimes are explicit 'YYYY-MM-DD HH:MM:SS' UTC strings
 *     (knex connection timezone is '+00:00' + dateStrings — host-TZ independent).
 *   - Seeded created_at/updated_at forced to FIXED_PAST so the write-phase
 *     watermark (max(updated_at)) is strictly below any row the run touches.
 *   - Volatile columns (server-clock timestamps) are normalized to '<TS>'.
 *   - Auto-increment ids are label-mapped (L1.. for pre-existing, N1.. for new).
 *   - UUIDs (sync_run_id, lock tokens) normalized to '<UUID>'.
 *   - Provider-generated ingest task ids (gcal_<hex>) mapped to '<NEW-TASK-n>'.
 *   - Real provider modules are NEVER allowed to hit the network: every network
 *     method of every adapter is replaced by a scripted simulator; unexpected
 *     methods throw loudly.
 *
 * GOLDEN FILES: tests/cal-sync/characterization/goldens/W4/<scenario>.golden.json
 *   Regenerate with UPDATE_GOLDEN=1 (only against a known-good tree!).
 */

'use strict';

var fs = require('fs');
var path = require('path');

var gcalAdapter = require('../../../../src/lib/cal-adapters/gcal.adapter');
var msftAdapter = require('../../../../src/lib/cal-adapters/msft.adapter');
var appleAdapter = require('../../../../src/lib/cal-adapters/apple.adapter');

var FIXED_NOW = new Date('2026-06-16T12:00:00.000Z'); // Monday, 08:00 EDT
var FIXED_NOW_ISO = '2026-06-16T12:00:00.000Z';
var FIXED_PAST = '2026-06-01 00:00:00';               // seeded created/updated watermark floor

var ADAPTERS = { gcal: gcalAdapter, msft: msftAdapter, apple: appleAdapter };

// Adapter methods that cross the network boundary. Everything here is scripted
// + recorded. Pure helpers (applyEventToTaskFields, eventHash, getEventIdColumn,
// taskHash inputs, …) stay REAL — they are part of the unit under test.
var NETWORK_METHODS = [
  'getValidAccessToken', 'listEvents', 'createEvent', 'updateEvent',
  'deleteEvent', 'batchCreateEvents', 'batchUpdateEvents', 'batchDeleteEvents',
  'hasChanges', 'getEvents', 'sync'
];

// Server-clock timestamp columns — normalized to '<TS>' (presence only).
var VOLATILE_COLS = new Set([
  'created_at', 'updated_at', 'synced_at', 'last_pushed_at',
  'gcal_last_synced_at', 'msft_cal_last_synced_at', 'apple_cal_last_synced_at',
  'acquired_at', 'expires_at', 'gcal_token_expiry', 'msft_cal_token_expiry',
  'completed_at', 'disabled_at'
]);

var USER_COLS = [
  'gcal_refresh_token', 'gcal_access_token', 'gcal_token_expiry', 'gcal_sync_token',
  'gcal_last_synced_at',
  'msft_cal_refresh_token', 'msft_cal_access_token', 'msft_cal_token_expiry',
  'msft_cal_last_synced_at',
  'apple_cal_username', 'apple_cal_password', 'apple_cal_last_synced_at'
];

var UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
var INGEST_ID_RE = /^(gcal|msft|apple)_[0-9a-f]{16}$/;

// ─────────────────────────────────────────────────────────────────────────────
// Provider simulator — scripted network boundary with an in-memory remote store
// ─────────────────────────────────────────────────────────────────────────────

function ProviderSim() {
  this.calls = {};    // pid -> [{ method, args }]
  this.stores = {};   // pid -> [event, ...]  (the simulated remote calendar)
  this.scripts = {};  // pid -> { tokenError, listError, createError, updateError, deleteError }
  this._spies = [];
}

ProviderSim.prototype.reset = function () {
  this.calls = { gcal: [], msft: [], apple: [] };
  this.stores = { gcal: [], msft: [], apple: [] };
  this.scripts = { gcal: {}, msft: {}, apple: {} };
};

ProviderSim.prototype.resetCalls = function () {
  this.calls = { gcal: [], msft: [], apple: [] };
};

ProviderSim.prototype.store = function (pid) { return this.stores[pid]; };
ProviderSim.prototype.script = function (pid) { return this.scripts[pid]; };

function taskLite(t) {
  if (!t) return null;
  return {
    id: t.id, text: t.text, date: t.date || null, time: t.time || null,
    dur: t.dur != null ? t.dur : null, status: t.status || ''
  };
}

/** Fabricate a normalized-shape remote event from a controller task object. */
ProviderSim.prototype.makeEventFromTask = function (pid, task) {
  var sa = task._scheduled_at instanceof Date
    ? task._scheduled_at.toISOString()
    : new Date(String(task._scheduled_at).replace(' ', 'T') + (String(task._scheduled_at).indexOf('Z') === -1 ? 'Z' : '')).toISOString();
  var durMin = Number(task.dur) || 30;
  var end = new Date(new Date(sa).getTime() + durMin * 60000).toISOString();
  var baseId = 'ev-' + pid + '-' + task.id;
  var id = baseId;
  var n = 1;
  var store = this.stores[pid];
  while (store.some(function (e) { return e.id === id; })) { n++; id = baseId + '-' + n; }
  return {
    id: id,
    title: task.text,
    description: '',
    startDateTime: sa,
    endDateTime: end,
    isAllDay: false,
    durationMinutes: durMin,
    isTransparent: false,
    lastModified: FIXED_NOW_ISO,
    _url: null,
    _etag: null,
    _raw: null
  };
};

/** Seed a remote-only event (not created via push) into the simulated store. */
ProviderSim.prototype.seedRemoteEvent = function (pid, ev) {
  var full = Object.assign({
    id: 'ev-' + pid + '-seed-' + (this.stores[pid].length + 1),
    title: 'Remote event',
    description: '',
    isAllDay: false,
    isTransparent: false,
    lastModified: '2026-06-16T11:00:00.000Z',
    _url: null, _etag: null, _raw: null
  }, ev);
  if (!full.durationMinutes && full.startDateTime && full.endDateTime) {
    full.durationMinutes = Math.round((new Date(full.endDateTime) - new Date(full.startDateTime)) / 60000);
  }
  this.stores[pid].push(full);
  return full;
};

ProviderSim.prototype._record = function (pid, method, normArgs) {
  this.calls[pid].push({ method: method, args: normArgs });
};

ProviderSim.prototype.install = function () {
  var sim = this;
  this.reset();
  Object.keys(ADAPTERS).forEach(function (pid) {
    var mod = ADAPTERS[pid];
    NETWORK_METHODS.forEach(function (method) {
      if (typeof mod[method] !== 'function') return;
      var spy = jest.spyOn(mod, method).mockImplementation(function () {
        return sim._dispatch(pid, method, Array.prototype.slice.call(arguments));
      });
      sim._spies.push(spy);
    });
    // normalizeEvent: our fabricated raws ARE normalized-shape already.
    if (typeof mod.normalizeEvent === 'function') {
      sim._spies.push(jest.spyOn(mod, 'normalizeEvent').mockImplementation(function (raw) { return raw; }));
    }
  });
};

ProviderSim.prototype.uninstall = function () {
  this._spies.forEach(function (s) { s.mockRestore(); });
  this._spies = [];
};

ProviderSim.prototype._removeFromStore = function (pid, eventIdOrUrl) {
  var store = this.stores[pid];
  for (var i = store.length - 1; i >= 0; i--) {
    if (store[i].id === eventIdOrUrl || store[i]._url === eventIdOrUrl) store.splice(i, 1);
  }
};

ProviderSim.prototype._applyPushToStore = function (pid, eventId, task) {
  var store = this.stores[pid];
  var ev = store.find(function (e) { return e.id === eventId || e._url === eventId; });
  if (!ev || !task) return;
  var sa = task._scheduled_at instanceof Date
    ? task._scheduled_at.toISOString()
    : task._scheduled_at ? new Date(String(task._scheduled_at).replace(' ', 'T') + 'Z').toISOString() : ev.startDateTime;
  ev.title = task.text;
  ev.startDateTime = sa;
  ev.endDateTime = new Date(new Date(sa).getTime() + (Number(task.dur) || 30) * 60000).toISOString();
  ev.durationMinutes = Number(task.dur) || ev.durationMinutes;
  // Echo suppression mirrors real providers: our own push bumps lastModified to
  // "now", which stays below the ledger's last_modified_at (= now + 30s guard).
  ev.lastModified = FIXED_NOW_ISO;
};

ProviderSim.prototype._dispatch = function (pid, method, args) {
  var script = this.scripts[pid];
  var sim = this;
  switch (method) {
    case 'getValidAccessToken':
      this._record(pid, method, { userId: args[0] && args[0].id });
      if (script.tokenError) return Promise.reject(new Error(script.tokenError));
      // Generic clock-advance hook (W4b, 999.1025): Date is fully faked by the
      // suite's jest.useFakeTimers, so jumping it here deterministically moves
      // sync() past a wall-clock-elapsed guard (e.g. the 5-minute sync_timeout
      // check) without any real wait — this is the FIRST network call in
      // Phase 1, so every later `Date.now()` read in sync() sees the advanced
      // time. Any scenario can opt in via script.advanceClockMs.
      if (script.advanceClockMs) jest.setSystemTime(new Date(FIXED_NOW.getTime() + script.advanceClockMs));
      return Promise.resolve('tok-' + pid);

    case 'listEvents':
      this._record(pid, method, { token: args[0], timeMin: args[1], timeMax: args[2] });
      if (script.listError) return Promise.reject(new Error(script.listError));
      return Promise.resolve(this.stores[pid].map(function (e) { return Object.assign({}, e); }));

    case 'createEvent': {
      var cTask = args[1];
      this._record(pid, method, { token: args[0], task: taskLite(cTask), year: args[2], tz: args[3] });
      if (script.createError) return Promise.reject(new Error(script.createError));
      var ev = this.makeEventFromTask(pid, cTask);
      this.stores[pid].push(ev);
      return Promise.resolve({ raw: ev, providerEventId: ev.id, taskId: cTask.id });
    }

    case 'batchCreateEvents': {
      var queue = args[1] || [];
      this._record(pid, method, {
        token: args[0], tasks: queue.map(function (q) { return taskLite(q.task); }), year: args[2], tz: args[3]
      });
      return Promise.resolve(queue.map(function (q) {
        if (script.createError) return { error: script.createError };
        var bev = sim.makeEventFromTask(pid, q.task);
        sim.stores[pid].push(bev);
        return { raw: bev, providerEventId: bev.id, taskId: q.task.id };
      }));
    }

    case 'updateEvent': {
      this._record(pid, method, { token: args[0], eventId: args[1], task: taskLite(args[2]) });
      if (script.updateError) return Promise.reject(new Error(script.updateError));
      this._applyPushToStore(pid, args[1], args[2]);
      return Promise.resolve({});
    }

    case 'batchUpdateEvents': {
      var updates = args[1] || [];
      this._record(pid, method, {
        token: args[0],
        updates: updates.map(function (u) { return { eventId: u.eventId, task: taskLite(u.task) }; })
      });
      return Promise.resolve(updates.map(function (u) {
        if (script.updateError) return { error: script.updateError };
        sim._applyPushToStore(pid, u.eventId, u.task);
        return {};
      }));
    }

    case 'deleteEvent':
      this._record(pid, method, { token: args[0], eventId: args[1] });
      if (script.deleteError) return Promise.reject(new Error(script.deleteError));
      this._removeFromStore(pid, args[1]);
      return Promise.resolve({});

    case 'batchDeleteEvents': {
      var ids = args[1] || [];
      this._record(pid, method, { token: args[0], eventIds: ids.slice() });
      ids.forEach(function (id) { sim._removeFromStore(pid, id); });
      return Promise.resolve(ids.map(function () { return {}; }));
    }

    default:
      this._record(pid, method, {});
      return Promise.reject(new Error('W4 harness: unexpected adapter call ' + pid + '.' + method));
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DB snapshot + delta
// ─────────────────────────────────────────────────────────────────────────────

async function snapshotState(db, userId) {
  var tasks = await db('tasks_v').where('user_id', userId).select('*');
  var ledger = await db('cal_sync_ledger').where('user_id', userId).select('*');
  var history = await db('sync_history').where('user_id', userId).select('*');
  var locks = await db('sync_locks').where('user_id', userId).select('*');
  var queue = await db('task_write_queue').where('user_id', userId).select('*');
  var users = await db('users').where('id', userId).select(USER_COLS);
  return { tasks_v: tasks, cal_sync_ledger: ledger, sync_history: history, sync_locks: locks, task_write_queue: queue, users: users };
}

function normalizeCell(col, v) {
  if (VOLATILE_COLS.has(col)) return v == null ? null : '<TS>';
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  return v;
}

function normalizeRow(row, dropCols) {
  var out = {};
  Object.keys(row).sort().forEach(function (col) {
    if (dropCols && dropCols.indexOf(col) !== -1) return;
    out[col] = normalizeCell(col, row[col]);
  });
  return out;
}

function keyBy(rows, pk) {
  var m = {};
  rows.forEach(function (r) { m[String(r[pk])] = r; });
  return m;
}

function diffTable(before, after, pk, dropCols) {
  var b = keyBy(before, pk);
  var a = keyBy(after, pk);
  var added = [], removed = [], changed = [];
  Object.keys(a).forEach(function (k) {
    if (!b[k]) { added.push(normalizeRow(a[k], dropCols)); return; }
    var nb = normalizeRow(b[k], dropCols);
    var na = normalizeRow(a[k], dropCols);
    var changes = {};
    var any = false;
    Object.keys(na).forEach(function (col) {
      if (JSON.stringify(na[col]) !== JSON.stringify(nb[col])) { changes[col] = [nb[col], na[col]]; any = true; }
    });
    if (any) changed.push({ key: k, changes: changes });
  });
  Object.keys(b).forEach(function (k) {
    if (!a[k]) removed.push(normalizeRow(b[k], dropCols));
  });
  var cmp = function (x, y) { return JSON.stringify(x) < JSON.stringify(y) ? -1 : 1; };
  added.sort(cmp); removed.sort(cmp); changed.sort(function (x, y) { return cmp(x.key, y.key); });
  var out = {};
  if (added.length) out.added = added;
  if (removed.length) out.removed = removed;
  if (changed.length) out.changed = changed;
  return out;
}

function diffState(before, after) {
  var delta = {};
  var d;
  d = diffTable(before.tasks_v, after.tasks_v, 'id'); if (Object.keys(d).length) delta.tasks_v = d;
  d = diffTable(before.cal_sync_ledger, after.cal_sync_ledger, 'id'); if (Object.keys(d).length) delta.cal_sync_ledger = d;
  d = diffTable(before.sync_history, after.sync_history, 'id', ['id']); if (Object.keys(d).length) delta.sync_history = d;
  d = diffTable(before.sync_locks, after.sync_locks, 'user_id'); if (Object.keys(d).length) delta.sync_locks = d;
  d = diffTable(before.task_write_queue, after.task_write_queue, 'id'); if (Object.keys(d).length) delta.task_write_queue = d;
  // users: single row keyed synthetically
  var ub = before.users.map(function (r) { return Object.assign({ id: 'user' }, r); });
  var ua = after.users.map(function (r) { return Object.assign({ id: 'user' }, r); });
  d = diffTable(ub, ua, 'id'); if (Object.keys(d).length) delta.users = d;
  return delta;
}

// ─────────────────────────────────────────────────────────────────────────────
// Output normalization (id maps, uuids)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the ledger-id label map: pre-existing ids (asc) -> L1.., new ids -> N1..
 */
function buildLedgerIdMap(beforeLedger, afterLedger) {
  var map = {};
  var beforeIds = beforeLedger.map(function (r) { return Number(r.id); }).sort(function (a, b) { return a - b; });
  beforeIds.forEach(function (id, i) { map[String(id)] = '<L' + (i + 1) + '>'; });
  var newIds = afterLedger.map(function (r) { return Number(r.id); })
    .filter(function (id) { return !map[String(id)]; })
    .sort(function (a, b) { return a - b; });
  newIds.forEach(function (id, i) { map[String(id)] = '<N' + (i + 1) + '>'; });
  return map;
}

/** Discover provider-generated ingest task ids and map to <NEW-TASK-n>. */
function buildIngestIdMap(afterTasks) {
  var ids = afterTasks
    .map(function (r) { return r.id; })
    .filter(function (id) { return INGEST_ID_RE.test(String(id)); })
    .sort();
  var map = {};
  ids.forEach(function (id, i) { map[id] = '<NEW-TASK-' + (i + 1) + '>'; });
  return map;
}

/**
 * Deep-walk any JSON-safe structure applying STRING normalizations only:
 * UUIDs -> '<UUID>' and provider-generated ingest task ids (gcal_<16hex>,
 * long unique tokens — substring-safe) -> '<NEW-TASK-n>'.
 *
 * Numeric auto-increment ledger ids are deliberately NOT handled here: any
 * value-based replacement of bare integers collides with ordinary numbers
 * (pct, dur, counts) or digit runs inside hashes/dates. They are relabeled
 * STRUCTURALLY (only in the ledger delta's id/key fields) by
 * relabelLedgerIds() below.
 */
function deepNormalize(value, substrMap) {
  if (typeof value === 'string') {
    var s = value.replace(UUID_RE, '<UUID>');
    Object.keys(substrMap).forEach(function (k) {
      if (s.indexOf(k) !== -1) s = s.split(k).join(substrMap[k]);
    });
    return s;
  }
  if (Array.isArray(value)) return value.map(function (v) { return deepNormalize(v, substrMap); });
  if (value && typeof value === 'object') {
    var out = {};
    Object.keys(value).forEach(function (k) {
      out[deepNormalize(k, substrMap)] = deepNormalize(value[k], substrMap);
    });
    return out;
  }
  return value;
}

/** Structurally relabel cal_sync_ledger auto-increment ids in a dbDelta.
 *  Re-sorts afterwards: the diff's original sort keyed on raw numeric ids,
 *  whose magnitudes (and hence lexical JSON order) vary run to run. */
function relabelLedgerIds(delta, idMap) {
  var t = delta && delta.cal_sync_ledger;
  if (!t) return;
  var cmp = function (x, y) { return JSON.stringify(x) < JSON.stringify(y) ? -1 : 1; };
  ['added', 'removed'].forEach(function (k) {
    (t[k] || []).forEach(function (row) {
      if (idMap[String(row.id)] !== undefined) row.id = idMap[String(row.id)];
    });
    if (t[k]) t[k].sort(cmp);
  });
  (t.changed || []).forEach(function (c) {
    if (idMap[String(c.key)] !== undefined) c.key = idMap[String(c.key)];
  });
  if (t.changed) t.changed.sort(function (x, y) { return cmp(x.key, y.key); });
}

// ─────────────────────────────────────────────────────────────────────────────
// Run wrapper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run sync() once with full recording.
 * deps: { db, sync, sim, sseEmitter, scheduleQueue, mockReq, mockRes, userId }
 * Returns the normalized run record for the golden file.
 */
async function recordedSyncRun(deps, label) {
  var before = await snapshotState(deps.db, deps.userId);
  deps.sim.resetCalls();
  deps.sseEmitter.emit.mockClear();
  deps.scheduleQueue.enqueueScheduleRun.mockClear();

  var user = await deps.db('users').where('id', deps.userId).first();
  var req = deps.mockReq(user);
  var res = deps.mockRes();
  await deps.sync(req, res);

  var after = await snapshotState(deps.db, deps.userId);

  var ledgerIdMap = buildLedgerIdMap(before.cal_sync_ledger, after.cal_sync_ledger);
  var ingestIdMap = buildIngestIdMap(after.tasks_v);

  var providerCalls = {};
  Object.keys(deps.sim.calls).forEach(function (pid) {
    if (deps.sim.calls[pid].length) providerCalls[pid] = deps.sim.calls[pid];
  });

  var sse = deps.sseEmitter.emit.mock.calls.map(function (c) {
    return { event: c[1], payload: c[2] };
  });

  var enqueues = deps.scheduleQueue.enqueueScheduleRun.mock.calls.map(function (c) {
    return { source: c[1], affectedIds: (c[2] || []).slice().sort() };
  });

  var dbDelta = diffState(before, after);
  relabelLedgerIds(dbDelta, ledgerIdMap);

  var raw = {
    label: label,
    statusCode: res.statusCode,
    body: res._json,
    providerCalls: providerCalls,
    sse: sse,
    enqueues: enqueues,
    dbDelta: dbDelta
  };
  // JSON round-trip first (strips undefined), then string-level normalization.
  return deepNormalize(JSON.parse(JSON.stringify(raw)), ingestIdMap);
}

// ─────────────────────────────────────────────────────────────────────────────
// Golden compare
// ─────────────────────────────────────────────────────────────────────────────

var GOLDEN_DIR = path.join(__dirname, '..', 'goldens', 'W4');

function checkGolden(name, actual) {
  var file = path.join(GOLDEN_DIR, name + '.golden.json');
  var actualJson = JSON.stringify(actual, null, 2) + '\n';
  if (process.env.UPDATE_GOLDEN === '1') {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(file, actualJson);
    // eslint-disable-next-line no-console
    console.log('[W4 golden] wrote ' + file);
    return;
  }
  if (!fs.existsSync(file)) {
    throw new Error('Golden file missing: ' + file +
      '\nGenerate it against a KNOWN-GOOD tree with: UPDATE_GOLDEN=1 <jest run>');
  }
  var golden = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(JSON.parse(actualJson)).toEqual(golden);
}

module.exports = {
  FIXED_NOW: FIXED_NOW,
  FIXED_NOW_ISO: FIXED_NOW_ISO,
  FIXED_PAST: FIXED_PAST,
  ProviderSim: ProviderSim,
  snapshotState: snapshotState,
  diffState: diffState,
  recordedSyncRun: recordedSyncRun,
  checkGolden: checkGolden,
  taskLite: taskLite
};
