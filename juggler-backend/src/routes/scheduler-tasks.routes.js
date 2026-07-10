/**
 * scheduler-tasks.routes.js — Cloud Tasks push-handler for scheduler runs (999.627).
 *
 * Mount path: `/tasks/:queueName` (worker/backend Cloud Run service only — see
 * app.js wiring; gated behind JUGGLER_QUEUE_DRIVER=cloud-tasks).
 *
 * Cloud Tasks POSTs the task body here. We authenticate the request, decode the
 * payload, and run the SAME scheduler job logic the DB poll loop runs
 * (scheduleQueue.runScheduleForPush → claimAndRun → atomic DB claim).
 *
 * Auth — two accepted mechanisms (matching the patterns already in this repo):
 *   1. OIDC bearer token (production; same as resume-optimizer's worker-tasks):
 *      Cloud Tasks attaches a Google-signed OIDC token. We verify signature,
 *      audience = JUGGLER_WORKER_BASE_URL, and (if configured) the issuing
 *      service account = CLOUD_TASKS_INVOKER_SA.
 *   2. Shared-secret header `X-Scheduler-Task-Key` compared (timing-safe)
 *      against JUGGLER_TASK_SECRET || INTERNAL_SERVICE_KEY. Useful for the
 *      Cloud Tasks emulator (which does not mint OIDC tokens) and for
 *      same-project internal calls. Mirrors the billing-webhook shared-secret
 *      approach (juggler/CLAUDE.md §Approved Fallbacks, 999.368).
 *
 * If NEITHER an OIDC token nor a configured shared secret is presentable, the
 * request hard-fails — there is no unauthenticated path. Local dev may set
 * SKIP_SCHEDULER_TASK_AUTH=true to bypass (NEVER in prod).
 *
 * Response contract (drives Cloud Tasks retry/dead-letter):
 *   200 — job ran or was a benign no-op (claim lost to another runner).
 *   401/403 — auth failure (Cloud Tasks will retry; misconfig surfaces in logs).
 *   500 — retryable job failure (Cloud Tasks retries per the queue retry policy;
 *         after maxAttempts the task goes to the configured dead-letter queue).
 */

const express = require('express');
const crypto = require('crypto');
const { createLogger } = require('@raike/lib-logger');
const { validate } = require('../middleware/validate');
const { pushTaskSchema } = require('../schemas/scheduler-task.schema');
const config = require('../lib/config');
const logger = createLogger('scheduler-tasks.routes');

const router = express.Router();

// Lazy OAuth client — avoids a hard dep on google-auth-library construction
// during tests/dev that never hit this router.
let _authClient = null;
function authClient() {
  if (_authClient) { return _authClient; }
  const { OAuth2Client } = require('google-auth-library');
  _authClient = new OAuth2Client();
  return _authClient;
}

function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

async function authenticate(req, res, next) {
  // Dev/test-only bypass — NEVER honored in production (elmo W1, 999.627), so a
  // single prod env-var misconfig cannot open this internal scheduler endpoint.
  if (config.getString('SKIP_SCHEDULER_TASK_AUTH') === 'true' && config.getString('NODE_ENV') !== 'production') { // 999.1473
    return next();
  }

  // 1. Shared-secret header (emulator / internal). Only valid if a secret is
  //    actually configured — an unset secret never authenticates.
  // 999.1473: JUGGLER_TASK_SECRET routed through lib/config. INTERNAL_SERVICE_KEY
  // deliberately stays a raw process.env read HERE: `authenticate` is an ASYNC
  // Express middleware with no express-async-errors/asyncHandler wrapper in this
  // app, so a schema-read throw (INTERNAL_SERVICE_KEY is requiredInProduction:true)
  // would become an unhandled promise rejection instead of the controlled
  // 401/403/500 responses this function already returns — a strictly worse
  // failure mode (a hung request) than today's fallback-to-undefined behavior.
  const sharedSecret = config.getString('JUGGLER_TASK_SECRET') || process.env.INTERNAL_SERVICE_KEY;
  const presented = req.headers['x-scheduler-task-key'];
  if (presented && sharedSecret) {
    try {
      if (timingSafeEqualStr(presented, sharedSecret)) {
        req.taskAuth = 'shared-secret';
        return next();
      }
    } catch (_e) { /* fall through to 401 */ }
    return res.status(403).json({ error: 'invalid scheduler task key' });
  }

  // 2. OIDC bearer token (production).
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length);
    const audience = config.getString('JUGGLER_WORKER_BASE_URL'); // 999.1473
    if (!audience) {
      return res.status(500).json({ error: 'JUGGLER_WORKER_BASE_URL not configured on this worker' });
    }
    try {
      const ticket = await authClient().verifyIdToken({ idToken: token, audience });
      const payload = ticket.getPayload();
      const expectedSa = config.getString('CLOUD_TASKS_INVOKER_SA'); // 999.1473
      if (expectedSa && payload.email !== expectedSa) {
        return res.status(403).json({ error: 'token not issued for expected service account' });
      }
      req.taskAuth = 'oidc';
      req.oidcPayload = payload;
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'OIDC verification failed', detail: err.message });
    }
  }

  return res.status(401).json({ error: 'missing scheduler task credentials' });
}

/**
 * POST /tasks/:queueName — run a scheduler job pushed by Cloud Tasks.
 * Body: { userId, source, enqueuedAt }.
 */
router.post('/:queueName', express.json({ limit: '256kb' }), authenticate, validate(pushTaskSchema), async (req, res) => {
  const { queueName } = req.params;
  const payload = req.body || {};
  const userId = payload.userId;

  const ctx = {
    queueName,
    taskName: req.headers['x-cloudtasks-taskname'] || null,
    retryCount: Number(req.headers['x-cloudtasks-taskretrycount'] || 0),
  };

  try {
    const scheduleQueue = require('../scheduler/scheduleQueue');
    const result = await scheduleQueue.runScheduleForPush(userId);

    if (result && result.claimed && result.success === false) {
      // The scheduler ran but failed — retryable. 500 → Cloud Tasks retries /
      // eventually dead-letters per the queue policy.
      logger.error('[scheduler-tasks] scheduler run failed for ' + userId, { error: result.error });
      return res.status(500).json({ ok: false, error: result.error || 'scheduler run failed' });
    }

    // claimed:true/success:true OR claimed:false (another runner handled it) —
    // both are success from Cloud Tasks' perspective. Ack so it isn't retried.
    return res.status(200).json({ ok: true, queueName, userId, result, retryCount: ctx.retryCount });
  } catch (err) {
    logger.error('[scheduler-tasks] handler threw for ' + userId, { error: err && err.stack });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/** GET /tasks/_health — liveness probe for the push-handler. */
router.get('/_health', (req, res) => {
  res.json({ ok: true, worker: 'scheduler-tasks' });
});

module.exports = router;
