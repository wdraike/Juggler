'use strict';

/**
 * cal-sync-loop-lag-repro.js — REPRODUCTION/MEASUREMENT harness for 999.5269.
 *
 * David: "make sure there are sufficient pauses in the process to not impact
 * the ui and api calls from the ui" (successor to the CANCELLED Cloud Tasks
 * migration 999.4678 — sync stays on the request path; this measures whether
 * its EXISTING throttle()/delay() pacing (cal-sync.controller.js) is enough).
 *
 * Method, mirroring the RO precedent (resume-optimizer-backend/scripts/dev/
 * dupscan-loop-lag-repro.js — main-loop lag max 1686ms before / 47ms after a
 * worker-thread fix): a tight setInterval "heartbeat" (every 20ms) measures
 * how late each tick fires vs schedule = main-event-loop lag. In PARALLEL, a
 * second loop repeatedly issues the same kind of DB read a real UI/API
 * request would make (GET-tasks-shaped `tasks_v` select) and times each
 * round trip — this is the number that actually matters to David: "the
 * latency of a concurrent UI/API request DURING a sync".
 *
 * NOTE (documented in RO's CLAUDE.md, confirmed here): jest's timer/event-loop
 * interaction hides main-loop blocking that raw node exposes — this is
 * deliberately a standalone node script, not a jest test.
 *
 * Scenarios:
 *   A) STEADY-STATE sync — N tasks already pushed, provider returns matching
 *      events (a real sync where nothing changed). This is the common case
 *      AND the one most likely to run a long synchronous decision loop with
 *      no `await`s in it (every ledger row is a pure in-memory decision —
 *      no provider call, so no cooperative yield from throttle()/delay()).
 *   B) FRESH-PUSH sync — N brand-new tasks, all pushed this run. Exercises
 *      the throttle()-paced provider-call path.
 *
 * Provider calls are MOCKED with a realistic simulated network delay (no
 * live credentials needed, matches the credential-gated pattern the jest
 * suites already use) — this isolates event-loop behavior from real network
 * variance, which is the property under test.
 *
 * Run:  DB_PORT=3407 node scripts/dev/cal-sync-loop-lag-repro.js [taskCount]
 */

var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env.test') });

var TASK_COUNT = parseInt(process.argv[2] || '300', 10);
var SIMULATED_PROVIDER_LATENCY_MS = 90; // realistic GCal round-trip order of magnitude

var {
  db, TEST_USER_ID, seedTestUser, destroyTestUser, mockReq, mockRes
} = require('../../tests/cal-sync/helpers/test-setup');
var { makeTask } = require('../../tests/cal-sync/helpers/test-fixtures');
var { sync } = require('../../src/controllers/cal-sync.controller');
var gcalAdapter = require('../../src/lib/cal-adapters/gcal.adapter');
var { runWithActor } = require('../../src/lib/audit-context');

// scheduleQueue/sse-emitter fire side effects (redis, SSE) we don't want in a
// standalone script — no-op them the same way the jest suites mock them.
var scheduleQueue = require('../../src/scheduler/scheduleQueue');
scheduleQueue.enqueueScheduleRun = function() {};
var sseEmitter = require('../../src/lib/sse-emitter');
sseEmitter.emit = function() {};

function delay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

function startHeartbeat(intervalMs) {
  intervalMs = intervalMs || 20;
  var lags = [];
  var last = Date.now();
  var timer = setInterval(function() {
    var now = Date.now();
    var lag = now - last - intervalMs;
    if (lag > 0) lags.push(lag);
    last = now;
  }, intervalMs);
  timer.unref();
  return {
    stop: function() {
      clearInterval(timer);
      lags.sort(function(a, b) { return a - b; });
      var max = lags.length ? lags[lags.length - 1] : 0;
      var p99 = lags.length ? lags[Math.min(lags.length - 1, Math.floor(lags.length * 0.99))] : 0;
      return { max: max, p99: p99, samples: lags.length };
    }
  };
}

/**
 * Simulates a concurrent UI/API request: the same shape of read the task
 * list endpoint runs. Fires every `intervalMs` for the duration of the sync
 * and records each round-trip latency.
 */
function startConcurrentApiProbe(intervalMs) {
  intervalMs = intervalMs || 100;
  var latencies = [];
  var stopped = false;
  var loopPromise = (async function loop() {
    while (!stopped) {
      var t0 = Date.now();
      await db('tasks_v').where('user_id', TEST_USER_ID).select('id', 'text', 'status', 'scheduled_at').limit(50);
      latencies.push(Date.now() - t0);
      await delay(intervalMs);
    }
  })();
  return {
    stop: async function() {
      stopped = true;
      await loopPromise;
      latencies.sort(function(a, b) { return a - b; });
      var max = latencies.length ? latencies[latencies.length - 1] : 0;
      var p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : 0;
      var avg = latencies.length ? Math.round(latencies.reduce(function(a, b) { return a + b; }, 0) / latencies.length) : 0;
      return { max: max, p95: p95, avg: avg, samples: latencies.length };
    }
  };
}

function tomorrowPlus(hoursOffset, minuteJitter) {
  var d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8 + (hoursOffset % 12), minuteJitter % 60, 0, 0);
  return d;
}

async function seedTasks(n, labelPrefix) {
  var tasks = [];
  for (var i = 0; i < n; i++) {
    tasks.push(await makeTask({
      text: labelPrefix + ' ' + i,
      dur: 30,
      scheduled_at: tomorrowPlus(i, i * 7)
    }));
  }
  return tasks;
}

async function runSyncMeasured(user, label) {
  var apiProbe = startConcurrentApiProbe(100);
  var hb = startHeartbeat(20);
  var callTimestamps = [];
  var origBatchCreate = gcalAdapter.batchCreateEvents;
  var origListEvents = gcalAdapter.listEvents;
  // Wrap whatever the scenario already mocked so we can also count provider
  // calls / measure call rate without changing scenario-specific behavior.
  gcalAdapter.batchCreateEvents = function() {
    callTimestamps.push(Date.now());
    return origBatchCreate.apply(gcalAdapter, arguments);
  };

  var t0 = Date.now();
  var req = mockReq(user);
  var res = mockRes();
  await sync(req, res);
  var elapsed = Date.now() - t0;

  gcalAdapter.batchCreateEvents = origBatchCreate;
  gcalAdapter.listEvents = origListEvents;

  var lag = hb.stop();
  var api = await apiProbe.stop();

  console.log('\n--- ' + label + ' ---');
  console.log('sync elapsed: ' + elapsed + 'ms | statusCode: ' + res.statusCode);
  console.log('provider batchCreateEvents calls: ' + callTimestamps.length);
  console.log('MAIN-LOOP LAG during sync:   max=' + lag.max + 'ms  p99=' + lag.p99 + 'ms  (samples=' + lag.samples + ')');
  console.log('CONCURRENT UI/API latency:   max=' + api.max + 'ms  p95=' + api.p95 + 'ms  avg=' + api.avg + 'ms  (samples=' + api.samples + ')');
  return { elapsed: elapsed, lag: lag, api: api, providerCalls: callTimestamps.length };
}

async function main() {
  // Every stamped write (task/ledger inserts+updates) requires an ambient
  // actor outside a request context (999.1576 strict who-attribution) — a
  // raw node script has no Express middleware to establish one, so wrap the
  // whole run the same way a request's expressAuditContext would.
  return runWithActor('cal-sync-loop-lag-repro', runScenarios);
}

async function runScenarios() {
  console.log('=== cal-sync loop-lag / concurrent-request-latency reproduction — ' + TASK_COUNT + ' tasks ===');
  await destroyTestUser();
  var user = await seedTestUser({
    gcal_refresh_token: 'mock-gcal-token',
    msft_cal_refresh_token: null, apple_cal_username: null,
    apple_cal_password: null, apple_cal_server_url: null, apple_cal_calendar_url: null
  });

  gcalAdapter.getValidAccessToken = function() { return Promise.resolve('mock-token'); };

  // ---- Scenario A: FRESH-PUSH — N new tasks, all pushed this run. ----
  var pushedTasks = await seedTasks(TASK_COUNT, 'FreshPush');
  gcalAdapter.listEvents = function() { return delay(SIMULATED_PROVIDER_LATENCY_MS).then(function() { return []; }); };
  gcalAdapter.batchCreateEvents = async function(_token, pairs) {
    await delay(SIMULATED_PROVIDER_LATENCY_MS);
    return pairs.map(function(p) {
      return {
        taskId: p.task.id,
        providerEventId: 'evt-' + p.task.id,
        raw: {
          id: 'evt-' + p.task.id, summary: p.task.text,
          start: { dateTime: new Date(p.task._scheduled_at || Date.now()).toISOString() },
          end: { dateTime: new Date(Date.now() + 3600000).toISOString() }
        },
        error: null
      };
    });
  };
  var resultB = await runSyncMeasured(user, 'B) FRESH-PUSH sync (' + TASK_COUNT + ' new tasks, provider latency ' + SIMULATED_PROVIDER_LATENCY_MS + 'ms/call)');

  // ---- Scenario A: STEADY-STATE — re-sync with nothing changed. ----
  // Provider now returns exactly the events we just created (matching hash),
  // so Phase 2's per-ledger-row loop runs its decision logic with NO
  // provider call and therefore NO throttle()/delay() yield point at all —
  // the scenario most likely to expose a long uninterrupted synchronous run.
  var createdById = {};
  pushedTasks.forEach(function(t) { createdById[t.id] = true; });
  var ledgerRows = await db('cal_sync_ledger').where({ user_id: TEST_USER_ID, provider: 'gcal', status: 'active' }).select();
  gcalAdapter.listEvents = function() {
    return delay(SIMULATED_PROVIDER_LATENCY_MS).then(function() {
      return ledgerRows.map(function(l) {
        return {
          id: l.provider_event_id,
          summary: l.event_summary,
          start: { dateTime: l.event_start },
          end: { dateTime: l.event_end }
        };
      });
    });
  };
  gcalAdapter.batchCreateEvents = function() { return Promise.resolve([]); };
  var user2 = await db('users').where('id', TEST_USER_ID).first();
  var resultA = await runSyncMeasured(user2, 'A) STEADY-STATE sync (' + TASK_COUNT + ' unchanged tasks, no provider calls in the decision loop)');

  await destroyTestUser();
  await db.destroy();

  console.log('\n=== VERDICT ===');
  console.log('Fresh-push:   loop lag max=' + resultB.lag.max + 'ms   concurrent-request max=' + resultB.api.max + 'ms');
  console.log('Steady-state: loop lag max=' + resultA.lag.max + 'ms   concurrent-request max=' + resultA.api.max + 'ms');
  var ACCEPTABLE_MS = 250;
  var worstLag = Math.max(resultA.lag.max, resultB.lag.max);
  var worstApi = Math.max(resultA.api.max, resultB.api.max);
  if (worstLag < ACCEPTABLE_MS && worstApi < ACCEPTABLE_MS) {
    console.log('RESULT: PASS — main loop lag and concurrent UI/API latency both stay under ' + ACCEPTABLE_MS + 'ms throughout both scenarios at ' + TASK_COUNT + ' tasks.');
  } else {
    console.log('RESULT: CHECK — worst loop lag ' + worstLag + 'ms / worst concurrent-request latency ' + worstApi + 'ms; ' + ACCEPTABLE_MS + 'ms threshold exceeded.');
  }
}

main().catch(function(err) {
  console.error('repro failed:', err);
  process.exit(2);
});
