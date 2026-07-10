/**
 * cloud-tasks-driver.js — thin wrapper over @google-cloud/tasks for the
 * juggler scheduler-run queue.
 *
 * This is the Cloud Tasks BACKEND for the swappable queue abstraction in
 * queue-backend.js. It is only required (and `@google-cloud/tasks` is only
 * loaded) when JUGGLER_QUEUE_DRIVER=cloud-tasks. The DB-backed scheduleQueue
 * remains the default; nothing here runs unless the flag is set.
 *
 * Pattern + config style lifted from resume-optimizer's
 * src/services/queue-driver/cloud-tasks-driver.js so the two services share one
 * mental model (emulator support, OIDC token attachment, dedup-by-task-name).
 *
 * Required env when selected:
 *   JUGGLER_QUEUE_DRIVER=cloud-tasks
 *   GCP_PROJECT (or GOOGLE_CLOUD_PROJECT)
 *   GCP_REGION                         (defaults to us-central1)
 *   JUGGLER_WORKER_BASE_URL            (internal URL of the juggler worker /
 *                                       backend Cloud Run service that mounts
 *                                       scheduler-tasks.routes.js)
 *   JUGGLER_SCHEDULER_QUEUE            (Cloud Tasks queue id; defaults to
 *                                       'juggler-scheduler-runs')
 *   CLOUD_TASKS_INVOKER_SA             (service account whose OIDC token the
 *                                       push-handler trusts; optional in dev)
 *
 * Local dev / test: set CLOUD_TASKS_EMULATOR_HOST=localhost:8123 (dev-bed) or
 * localhost:8223 (test-bed) to point the client at the emulator with insecure
 * gRPC creds.
 *
 * Retry / dead-letter / rate-limit live in the QUEUE definition (Terraform /
 * gcloud), NOT here — that is the whole point of moving off the DB poll loop.
 */

const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('scheduler-cloud-tasks-driver');

// Injectable clock (999.1195): wall-clock reads derive from a ClockPort
// (MysqlClockAdapter in production — same as RunScheduleCommand); swappable
// via the _setClock test seam below.
const MysqlClockAdapter = require('../slices/scheduler/adapters/MysqlClockAdapter');
let _clock = new MysqlClockAdapter();

let _client = null;
function client() {
  if (_client) { return _client; }
  // Lazy require so installing @google-cloud/tasks is only needed when the
  // cloud-tasks backend is actually selected (mirrors RO).
  const { CloudTasksClient } = require('@google-cloud/tasks');

  const emulator = process.env.CLOUD_TASKS_EMULATOR_HOST;
  if (emulator) {
    const grpc = require('@grpc/grpc-js');
    const [host, portRaw] = emulator.split(':');
    _client = new CloudTasksClient({
      apiEndpoint: host,
      port: Number(portRaw) || 8123,
      sslCreds: grpc.credentials.createInsecure(),
    });
    logger.info('[scheduler-cloud-tasks] using emulator at ' + emulator);
  } else {
    _client = new CloudTasksClient();
  }
  return _client;
}

function project() {
  return process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
}
function location() {
  return process.env.GCP_REGION || 'us-central1';
}
function workerBaseUrl() {
  return process.env.JUGGLER_WORKER_BASE_URL;
}
function invokerSa() {
  return process.env.CLOUD_TASKS_INVOKER_SA;
}

/**
 * Build the Cloud Tasks `createTask` request for a scheduler run. Extracted
 * (and exported) so unit tests can assert the request shape WITHOUT a live
 * client or emulator.
 *
 * @param {string} queueName
 * @param {object} payload   — JSON-serializable; e.g. { userId, source }.
 * @param {object} [options] — { delaySeconds, dedupKey }
 * @returns {{ parent: string, task: object }}
 */
function buildCreateTaskRequest(queueName, payload, options = {}) {
  const proj = project();
  const url = workerBaseUrl();
  if (!proj) {
    throw new Error('[scheduler-cloud-tasks] GCP_PROJECT is required');
  }
  if (!url) {
    throw new Error('[scheduler-cloud-tasks] JUGGLER_WORKER_BASE_URL is required');
  }

  const parent = client().queuePath(proj, location(), queueName);
  const body = Buffer.from(JSON.stringify(payload || {})).toString('base64');

  const httpRequest = {
    httpMethod: 'POST',
    url: url.replace(/\/+$/, '') + '/tasks/' + queueName,
    headers: { 'Content-Type': 'application/json' },
    body,
  };

  const sa = invokerSa();
  if (sa) {
    httpRequest.oidcToken = { serviceAccountEmail: sa, audience: url };
  }

  const task = { httpRequest };

  if (options.delaySeconds) {
    task.scheduleTime = {
      seconds: Math.floor(_clock.now().getTime() / 1000) + Number(options.delaySeconds),
    };
  }

  if (options.dedupKey) {
    // Cloud Tasks enforces idempotency on task.name: a second create with the
    // same name within ~1h is rejected ALREADY_EXISTS (swallowed below). This
    // is the Cloud-Tasks-native replacement for the DB row's per-user
    // onConflict('user_id').merge() coalescing.
    task.name = parent + '/tasks/' + safeDedupKey(options.dedupKey);
  }

  return { parent, task };
}

/**
 * Create one scheduler-run task in Cloud Tasks.
 * @returns {Promise<{name: string, deduped?: boolean}>}
 */
async function createTask(queueName, payload, options = {}) {
  const { parent, task } = buildCreateTaskRequest(queueName, payload, options);
  try {
    const [response] = await client().createTask({ parent, task });
    return { name: response.name };
  } catch (err) {
    if (err && (err.code === 6 || /ALREADY_EXISTS/i.test(err.message || ''))) {
      // Dedup hit — a run for this user is already queued. Treat as success;
      // the queued task will run the LATEST state when it fires.
      return { name: task.name, deduped: true };
    }
    throw err;
  }
}

function safeDedupKey(key) {
  // Cloud Tasks task names must match ^[A-Za-z0-9_-]{1,500}$.
  return String(key).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 500);
}

/** Reset the memoized client — test seam only. */
function _resetClient() { _client = null; }

module.exports = {
  createTask,
  buildCreateTaskRequest,
  safeDedupKey,
  _resetClient,
  // Test-only clock seam (999.1195). Returns the previous clock for restore.
  _setClock: process.env.NODE_ENV === 'test' ? function _setClock(clock) {
    const prev = _clock;
    _clock = clock || new MysqlClockAdapter();
    return prev;
  } : undefined,
};
