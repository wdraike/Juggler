# Juggler Deep Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Juggler across security, DoS protection, performance, DB schema, and multi-server readiness — audit every layer, fix every issue found.

**Architecture:** Six review areas each produce one or more Knex migrations and/or code changes with tests: (1) security/webhook signing, (2) rate-limiting, (3) input validation, (4) performance/N+1, (5) DB schema, (6) multi-server SSE. Each task is independently deployable.

**Tech Stack:** Node.js/Express, MySQL/Knex.js, ioredis (ioredis already in use), Zod (already a dep — used in MCP but not REST), express-rate-limit (already in use), Jest (existing test runner at `juggler-backend/`).

---

## Known Audit Findings (pre-identified)

| ID | Area | Severity | Finding |
|----|------|----------|---------|
| JF-R1 | Rate limiting | Med | OAuth callbacks, health endpoint, billing webhooks have no dedicated limiter |
| JF-R2 | Security | High | Billing webhook signs `JSON.stringify(req.body)` — ordering/whitespace fragile; must sign raw body buffer |
| JF-R3 | Validation | Med | Zod only used in MCP tools; REST write routes have ad-hoc manual checks |
| JF-R4 | Testing | Med | No live security probe suite (OAuth state spoofing, MCP userId injection, webhook replay) |
| P-1 | Performance | Med | Global API limiter keyed by IP only — single user can consume quota from many IPs |
| P-2 | Performance | Low | `cal-sync.controller.js` (2,287 LOC) has nested loops — audit for N+1 DB calls inside per-event loops |
| P-3 | Performance | Low | `task.controller.js` (2,190 LOC) — audit create/update paths for redundant re-fetches |
| DB-1 | DB schema | Low | Older VARCHAR fields lack explicit length limits |
| DB-2 | DB schema | Low | No CHECK constraints on enum-like columns (pri, status, placement_mode) |
| DB-3 | DB schema | Low | Missing index on `cal_sync_ledger.user_id`; `weather_cache` lookup pattern unindexed |
| MS-1 | Multi-server | High | SSE emitter uses in-memory Map — events on instance B won't reach clients on instance A |
| MS-2 | Multi-server | Low | Scheduler stepper sessions in-memory Map — session lost if request hits different instance |

---

## File Map

| Action | File |
|--------|------|
| Modify | `juggler-backend/src/app.js` |
| Modify | `juggler-backend/src/routes/billing-webhooks.routes.js` |
| Modify | `juggler-backend/src/lib/sse-emitter.js` |
| Modify | `juggler-backend/src/scheduler/schedulerSession.js` |
| Modify | `juggler-backend/src/controllers/cal-sync.controller.js` |
| Modify | `juggler-backend/src/controllers/task.controller.js` |
| Create | `juggler-backend/src/schemas/task.schema.js` |
| Create | `juggler-backend/src/schemas/project.schema.js` |
| Create | `juggler-backend/src/schemas/config.schema.js` |
| Create | `juggler-backend/src/middleware/validate.js` |
| Create | `juggler-backend/src/db/migrations/20260506000100_add_missing_indexes.js` |
| Create | `juggler-backend/src/db/migrations/20260506000200_add_schema_check_constraints.js` |
| Create | `juggler-backend/src/db/migrations/20260506000300_add_varchar_limits.js` |
| Create | `juggler-backend/src/db/migrations/20260506000400_scheduler_sessions_table.js` |
| Create | `juggler-backend/tests/security/webhook.test.js` |
| Create | `juggler-backend/tests/security/rate-limits.test.js` |

---

## Task 1: Fix Billing Webhook Raw-Body HMAC (JF-R2)

**Files:**
- Modify: `juggler-backend/src/app.js`
- Modify: `juggler-backend/src/routes/billing-webhooks.routes.js`
- Create: `juggler-backend/tests/security/webhook.test.js`

**Problem:** `verifySignature` currently signs `JSON.stringify(req.body)` — this is the re-serialized parsed body, not the original bytes the payment service signed. JSON key ordering and whitespace differ across implementations, making this fragile and potentially bypassable.

**Fix:** Mount billing route before `bodyParser.json()` with `express.raw({ type: 'application/json' })`. Attach raw buffer to `req.rawBody`. Sign that.

- [ ] **Step 1: Write the failing tests**

Create `juggler-backend/tests/security/webhook.test.js`:
```js
const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/app');

const SECRET = 'test-webhook-secret';
process.env.BILLING_WEBHOOK_SECRET = SECRET;

function sign(bodyBuffer) {
  return 'sha256=' + crypto.createHmac('sha256', SECRET).update(bodyBuffer).digest('hex');
}

describe('Billing webhook signature', () => {
  it('accepts a valid raw-body signature', async () => {
    const body = JSON.stringify({ event: 'subscription.created', user_id: 'u1', timestamp: new Date().toISOString() });
    const buf = Buffer.from(body);
    const sig = sign(buf);
    const res = await request(app)
      .post('/api/billing-webhooks')
      .set('Content-Type', 'application/json')
      .set('X-Billing-Signature', sig)
      .send(buf);
    expect(res.status).not.toBe(401);
  });

  it('rejects a request signed against re-serialized body', async () => {
    // Simulate old behaviour: sign the re-serialized (possibly reordered) JSON
    const body = { b: 2, a: 1, event: 'subscription.created', user_id: 'u1', timestamp: new Date().toISOString() };
    const badSig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(JSON.stringify(body)).digest('hex');
    // Send with different key order than what we signed
    const sentBody = JSON.stringify({ a: 1, b: 2, event: body.event, user_id: body.user_id, timestamp: body.timestamp });
    const res = await request(app)
      .post('/api/billing-webhooks')
      .set('Content-Type', 'application/json')
      .set('X-Billing-Signature', badSig)
      .send(sentBody);
    expect(res.status).toBe(401);
  });

  it('rejects a stale timestamp', async () => {
    const staleTs = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const body = JSON.stringify({ event: 'subscription.created', user_id: 'u1', timestamp: staleTs });
    const buf = Buffer.from(body);
    const sig = sign(buf);
    const res = await request(app)
      .post('/api/billing-webhooks')
      .set('Content-Type', 'application/json')
      .set('X-Billing-Signature', sig)
      .send(buf);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**
```bash
cd juggler-backend && npx jest tests/security/webhook.test.js --no-coverage
```
Expected: tests 1 and 3 pass, test 2 fails (current code signs re-serialized body so ordering attack works).

- [ ] **Step 3: Fix `app.js` — mount raw body capture before json middleware**

In `src/app.js`, find where `/api/billing-webhooks` routes are mounted. Add `express.raw()` specifically for that path, BEFORE the global `bodyParser.json()`:

```js
// Raw body capture for billing webhook signature verification — MUST be before bodyParser.json
app.use('/api/billing-webhooks', express.raw({ type: 'application/json' }), function(req, res, next) {
  if (Buffer.isBuffer(req.body)) {
    req.rawBody = req.body;
    try { req.body = JSON.parse(req.body.toString('utf8')); } catch (e) { req.body = {}; }
  }
  next();
});
```

Place this block immediately before the `app.use(bodyParser.json(...))` line.

- [ ] **Step 4: Fix `billing-webhooks.routes.js` — sign raw buffer**

Replace the `expectedSig` line in `verifySignature`:
```js
// OLD:
var expectedSig = 'sha256=' + crypto
  .createHmac('sha256', secret)
  .update(JSON.stringify(req.body))
  .digest('hex');

// NEW:
var rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
var expectedSig = 'sha256=' + crypto
  .createHmac('sha256', secret)
  .update(rawBody)
  .digest('hex');
```

- [ ] **Step 5: Run tests — expect PASS**
```bash
cd juggler-backend && npx jest tests/security/webhook.test.js --no-coverage
```
Expected: all 3 tests pass.

- [ ] **Step 6: Commit**
```bash
git add src/app.js src/routes/billing-webhooks.routes.js tests/security/webhook.test.js
git commit -m "fix(security): sign billing webhook against raw body buffer, not re-serialized JSON (JF-R2)"
```

---

## Task 2: Add Rate Limits to Unprotected Public Endpoints (JF-R1)

**Files:**
- Modify: `juggler-backend/src/app.js`
- Create: `juggler-backend/tests/security/rate-limits.test.js`

**Problem:** OAuth callbacks (`/api/gcal/callback`, `/api/msft-cal/callback`, `/api/apple-cal/callback`) and billing webhooks fall under the global 1,000/min IP limiter but have no dedicated tighter limit. A flood of OAuth callback requests can consume quota meant for real API traffic.

- [ ] **Step 1: Write failing tests**

Create `juggler-backend/tests/security/rate-limits.test.js`:
```js
const request = require('supertest');
const app = require('../../src/app');

describe('OAuth callback rate limits', () => {
  it('returns 429 after 20 requests/min to gcal callback', async () => {
    const reqs = Array.from({ length: 21 }, () =>
      request(app).get('/api/gcal/callback?code=x&state=y')
    );
    const results = await Promise.all(reqs);
    const has429 = results.some(r => r.status === 429);
    expect(has429).toBe(true);
  });

  it('returns 429 after 20 requests/min to msft callback', async () => {
    const reqs = Array.from({ length: 21 }, () =>
      request(app).get('/api/msft-cal/callback?code=x&state=y')
    );
    const results = await Promise.all(reqs);
    expect(results.some(r => r.status === 429)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**
```bash
cd juggler-backend && npx jest tests/security/rate-limits.test.js --no-coverage
```
Expected: FAIL — no 429 returned for OAuth callbacks at 21 requests.

- [ ] **Step 3: Add dedicated limiters in `app.js`**

Add after the existing `mcpLimiter` definition (around line 90):
```js
const oauthCallbackLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many OAuth requests, please wait.' }
});
const billingWebhookLimiter = rateLimit({
  windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many webhook calls.' }
});
const healthLimiter = rateLimit({
  windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false
});
```

Mount them before the global `apiLimiter`:
```js
app.use('/health', healthLimiter);
app.use('/api/billing-webhooks', billingWebhookLimiter);
app.use('/api/gcal/callback', oauthCallbackLimiter);
app.use('/api/msft-cal/callback', oauthCallbackLimiter);
app.use('/api/apple-cal/callback', oauthCallbackLimiter);
```

- [ ] **Step 4: Run tests — expect PASS**
```bash
cd juggler-backend && npx jest tests/security/rate-limits.test.js --no-coverage
```

- [ ] **Step 5: Commit**
```bash
git add src/app.js tests/security/rate-limits.test.js
git commit -m "fix(security): add dedicated rate limits to OAuth callbacks, billing webhooks, health (JF-R1)"
```

---

## Task 3: Add User-Keyed Rate Limiting to Write Routes (P-1)

**Files:**
- Modify: `juggler-backend/src/app.js`

**Problem:** The global `apiLimiter` uses IP as the key. A single authenticated user behind a rotating proxy can exhaust quota. Task write routes (create, update, delete) should be rate-limited per `user_id`, not per IP.

- [ ] **Step 1: Add user-keyed write limiter in `app.js`**

Add after the `oauthCallbackLimiter` definitions:
```js
const writeRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: function(req) { return req.user ? req.user.id : req.ip; },
  skip: function(req) { return req.method === 'GET' || req.method === 'HEAD'; },
  message: { error: 'Too many writes, please slow down.' }
});
```

Mount it on the `/api` namespace (after auth middleware has run, so `req.user` is populated). Add it to the authenticated route group. In `app.js` find the line `app.use('/api', apiLimiter)` and add user write limiter first for mutation routes:
```js
app.use('/api/tasks', writeRateLimiter);
app.use('/api/projects', writeRateLimiter);
app.use('/api/config', writeRateLimiter);
app.use('/api/locations', writeRateLimiter);
app.use('/api/tools', writeRateLimiter);
```

These must be placed AFTER the OAuth/billing limiters but BEFORE the general `apiLimiter` mount.

- [ ] **Step 2: Verify no existing tests break**
```bash
cd juggler-backend && npx jest --no-coverage 2>&1 | tail -20
```
Expected: same pass/fail count as before this change.

- [ ] **Step 3: Commit**
```bash
git add src/app.js
git commit -m "fix(security): add user-keyed rate limiter to task/project/config write routes (P-1)"
```

---

## Task 4: Add Zod Input Validation to REST Write Routes (JF-R3)

**Files:**
- Create: `juggler-backend/src/schemas/task.schema.js`
- Create: `juggler-backend/src/schemas/project.schema.js`
- Create: `juggler-backend/src/schemas/config.schema.js`
- Create: `juggler-backend/src/middleware/validate.js`
- Modify: `juggler-backend/src/routes/task.routes.js`
- Modify: `juggler-backend/src/routes/project.routes.js`
- Modify: `juggler-backend/src/routes/config.routes.js`

**Problem:** REST write routes do ad-hoc validation inside controllers. A malformed payload can reach deep into controller logic or DB calls before failing with an unhelpful 500.

- [ ] **Step 1: Create the validate middleware**

Create `src/middleware/validate.js`:
```js
const { ZodError } = require('zod');

function validate(schema) {
  return function(req, res, next) {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.errors.map(function(e) {
        return e.path.join('.') + ': ' + e.message;
      });
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validate };
```

- [ ] **Step 2: Create task schema**

Create `src/schemas/task.schema.js`:
```js
const { z } = require('zod');

const VALID_PRI = ['P1', 'P2', 'P3', 'P4'];
const VALID_STATUS = ['', 'wip', 'done', 'cancel', 'skip', 'pause'];
const VALID_PRECIP = ['any', 'wet_ok', 'light_ok', 'dry_only'];
const VALID_CLOUD = ['any', 'overcast_ok', 'partly_ok', 'clear'];
const VALID_TEMP_UNIT = ['F', 'C'];

const taskCreateSchema = z.object({
  text: z.string().min(1).max(500),
  pri: z.enum(VALID_PRI).optional().default('P3'),
  dur: z.number().int().min(5).max(480).optional(),
  project: z.string().max(100).optional(),
  location: z.string().max(100).optional(),
  tools: z.string().max(500).optional(),
  desired_at: z.string().datetime({ offset: true }).optional().nullable(),
  recur: z.string().max(200).optional().nullable(),
  split: z.boolean().optional(),
  depends_on: z.string().uuid().optional().nullable(),
  url: z.string().url().max(2048).optional().nullable(),
  when: z.string().max(200).optional(),
  travel_before: z.number().int().min(0).max(120).optional(),
  travel_after: z.number().int().min(0).max(120).optional(),
  weather_precip: z.enum(VALID_PRECIP).optional(),
  weather_cloud: z.enum(VALID_CLOUD).optional(),
  weather_temp_min: z.number().min(-60).max(150).optional().nullable(),
  weather_temp_max: z.number().min(-60).max(150).optional().nullable(),
  weather_temp_unit: z.enum(VALID_TEMP_UNIT).optional(),
  weather_humidity_min: z.number().int().min(0).max(100).optional().nullable(),
  weather_humidity_max: z.number().int().min(0).max(100).optional().nullable(),
});

const taskUpdateSchema = taskCreateSchema.partial().extend({
  status: z.enum(VALID_STATUS).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional().nullable(),
});

module.exports = { taskCreateSchema, taskUpdateSchema };
```

- [ ] **Step 3: Create project schema**

Create `src/schemas/project.schema.js`:
```js
const { z } = require('zod');

const projectSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  icon: z.string().max(10).optional(),
});

const projectUpdateSchema = projectSchema.partial();

module.exports = { projectSchema, projectUpdateSchema };
```

- [ ] **Step 4: Create config schema**

Create `src/schemas/config.schema.js`:
```js
const { z } = require('zod');

const preferencesSchema = z.object({
  temperatureUnit: z.enum(['F', 'C']).optional(),
  weekStartsOn: z.number().int().min(0).max(6).optional(),
  defaultDuration: z.number().int().min(5).max(480).optional(),
  timezone: z.string().max(50).optional(),
}).passthrough(); // allow other prefs without breaking

module.exports = { preferencesSchema };
```

- [ ] **Step 5: Wire validation into task routes**

In `src/routes/task.routes.js`, add at the top:
```js
const { validate } = require('../middleware/validate');
const { taskCreateSchema, taskUpdateSchema } = require('../schemas/task.schema');
```

Find the POST (create) route and add the middleware:
```js
router.post('/', validate(taskCreateSchema), taskController.createTask);
```

Find the PUT/PATCH (update) route:
```js
router.put('/:id', validate(taskUpdateSchema), taskController.updateTask);
```

- [ ] **Step 6: Wire validation into project routes**

In `src/routes/project.routes.js`:
```js
const { validate } = require('../middleware/validate');
const { projectSchema, projectUpdateSchema } = require('../schemas/project.schema');
// Add to POST route:
router.post('/', validate(projectSchema), projectController.createProject);
// Add to PUT route:
router.put('/:id', validate(projectUpdateSchema), projectController.updateProject);
```

- [ ] **Step 7: Write validation tests**

Add to `juggler-backend/tests/security/webhook.test.js` a new describe block, OR create `tests/unit/validate.middleware.test.js`:
```js
const { validate } = require('../../src/middleware/validate');
const { taskCreateSchema } = require('../../src/schemas/task.schema');

function makeRes() {
  const res = { status: null, json: null };
  res.status = (code) => { res._code = code; return { json: (body) => { res._body = body; } }; };
  return res;
}

describe('validate middleware', () => {
  it('passes a valid task body', () => {
    const req = { body: { text: 'Write tests', dur: 30, pri: 'P2' } };
    const res = makeRes();
    let called = false;
    validate(taskCreateSchema)(req, res, () => { called = true; });
    expect(called).toBe(true);
  });

  it('rejects an empty text field', () => {
    const req = { body: { text: '' } };
    const res = makeRes();
    validate(taskCreateSchema)(req, res, () => {});
    expect(res._code).toBe(400);
    expect(res._body.error).toBe('Validation failed');
  });

  it('rejects invalid pri value', () => {
    const req = { body: { text: 'Task', pri: 'P9' } };
    const res = makeRes();
    validate(taskCreateSchema)(req, res, () => {});
    expect(res._code).toBe(400);
  });

  it('rejects text over 500 chars', () => {
    const req = { body: { text: 'x'.repeat(501) } };
    const res = makeRes();
    validate(taskCreateSchema)(req, res, () => {});
    expect(res._code).toBe(400);
  });
});
```

- [ ] **Step 8: Run tests — expect PASS**
```bash
cd juggler-backend && npx jest tests/unit/validate.middleware.test.js --no-coverage
```

- [ ] **Step 9: Run full suite — no regressions**
```bash
cd juggler-backend && npx jest --no-coverage 2>&1 | tail -5
```

- [ ] **Step 10: Commit**
```bash
git add src/schemas/ src/middleware/validate.js src/routes/task.routes.js src/routes/project.routes.js src/routes/config.routes.js tests/unit/validate.middleware.test.js
git commit -m "feat(security): add Zod input validation to task/project/config write routes (JF-R3)"
```

---

## Task 5: Audit and Fix N+1 Queries in `cal-sync.controller.js` (P-2)

**Files:**
- Modify: `juggler-backend/src/controllers/cal-sync.controller.js`

**What to look for:** The controller has nested `for` loops (lines 269, 356, 438, 460, 548, 586, 600, 622) that iterate over events or tasks. Any `await db(...)` call INSIDE one of these loops that could instead be batched with a single query using `.whereIn()` is an N+1.

- [ ] **Step 1: Read and audit the inner loop sections**

Read the following ranges from `cal-sync.controller.js`:
- Lines 260–300 (event loop, inner await calls)
- Lines 350–470 (task sync loop, per-task DB calls)
- Lines 580–640 (ledger loop, per-provider calls)

For each `await db(...)` or `await trx(...)` inside a for-loop, check whether the query takes a single ID (N+1) or an array of IDs (already batched).

- [ ] **Step 2: Fix each N+1 found — batch pattern**

For any pattern like:
```js
for (var i = 0; i < events.length; i++) {
  var ledger = await db('cal_sync_ledger').where({ event_id: events[i].id, provider: pid }).first();
  // use ledger...
}
```

Replace with:
```js
var eventIds = events.map(function(e) { return e.id; });
var ledgerRows = await db('cal_sync_ledger')
  .whereIn('event_id', eventIds)
  .where('provider', pid);
var ledgerByEventId = {};
ledgerRows.forEach(function(r) { ledgerByEventId[r.event_id] = r; });

for (var i = 0; i < events.length; i++) {
  var ledger = ledgerByEventId[events[i].id];
  // use ledger...
}
```

Apply this pattern to every N+1 found.

- [ ] **Step 3: Run existing cal-sync tests**
```bash
cd juggler-backend && npx jest --testPathPattern="cal-sync" --no-coverage 2>&1 | tail -10
```
Expected: same results as before.

- [ ] **Step 4: Commit each logical batch of fixes**
```bash
git add src/controllers/cal-sync.controller.js
git commit -m "perf(cal-sync): batch N+1 DB queries in event sync loop (P-2)"
```

---

## Task 6: Audit and Fix N+1 Queries in `task.controller.js` (P-3)

**Files:**
- Modify: `juggler-backend/src/controllers/task.controller.js`

**What to look for:** The update path includes re-fetches after write (line 1165: `await trx('tasks_v').where({ id, user_id }).first()` inside a transaction). Check lines 1103–1220 for any per-task queries inside loops.

- [ ] **Step 1: Read and audit update transaction section (lines 1103–1220)**

Look for:
- Any `.first()` call inside a loop that could be pulled out
- Any re-fetch of data that was just written (if the data is known from the write payload, avoid re-fetching)
- Any per-project lookup inside a per-task loop

- [ ] **Step 2: Fix re-fetch after write if payload is already known**

If the controller does `const updated = await trx('tasks_v').where({ id }).first()` immediately after an update and only uses fields that were just written, eliminate the re-fetch and construct the response from the input payload + known defaults.

- [ ] **Step 3: Run full test suite**
```bash
cd juggler-backend && npx jest --no-coverage 2>&1 | tail -5
```

- [ ] **Step 4: Commit**
```bash
git add src/controllers/task.controller.js
git commit -m "perf(tasks): eliminate redundant re-fetch in update path (P-3)"
```

---

## Task 7: DB Index Audit and Additions (DB-3)

**Files:**
- Create: `juggler-backend/src/db/migrations/20260506000100_add_missing_indexes.js`

- [ ] **Step 1: Audit missing indexes**

Run this against the local DB to find FK columns without indexes:
```bash
cd juggler-backend && DB_PORT=3307 node -e "
const db = require('./src/db');
db.raw(\`
  SELECT TABLE_NAME, COLUMN_NAME
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE REFERENCED_TABLE_NAME IS NOT NULL
    AND TABLE_SCHEMA = 'juggler'
\`).then(([rows]) => {
  rows.forEach(r => console.log(r.TABLE_NAME, r.COLUMN_NAME));
  process.exit(0);
});
"
```

Also check these specific hot-path queries that are likely missing indexes:
- `cal_sync_ledger` — `user_id` column (frequent filter in sync status queries)
- `weather_integration` — `(location_id, fetched_at)` (cache lookup: most recent entry per location)
- `feature_events` — `(user_id, created_at)` (usage reporting queries)
- `ai_command_log` — `(user_id, created_at)` (admin audit queries)
- `task_write_queue` — `(user_id, created_at)` (queue drain)
- `sync_history` — `(user_id, provider, created_at)` (sync log queries)

- [ ] **Step 2: Create the migration**

Create `src/db/migrations/20260506000100_add_missing_indexes.js`:
```js
exports.up = async function(knex) {
  // Add any indexes confirmed missing in Step 1 audit
  // Template — fill in after Step 1 findings:
  await knex.schema.table('cal_sync_ledger', function(t) {
    t.index(['user_id'], 'idx_cal_sync_ledger_user_id');
  });
  await knex.schema.table('weather_integration', function(t) {
    t.index(['location_id', 'fetched_at'], 'idx_weather_location_fetched');
  });
  await knex.schema.table('feature_events', function(t) {
    t.index(['user_id', 'created_at'], 'idx_feature_events_user_created');
  });
  await knex.schema.table('ai_command_log', function(t) {
    t.index(['user_id', 'created_at'], 'idx_ai_command_log_user_created');
  });
  await knex.schema.table('sync_history', function(t) {
    t.index(['user_id', 'provider', 'created_at'], 'idx_sync_history_user_provider_created');
  });
};

exports.down = async function(knex) {
  await knex.schema.table('cal_sync_ledger', t => t.dropIndex([], 'idx_cal_sync_ledger_user_id'));
  await knex.schema.table('weather_integration', t => t.dropIndex([], 'idx_weather_location_fetched'));
  await knex.schema.table('feature_events', t => t.dropIndex([], 'idx_feature_events_user_created'));
  await knex.schema.table('ai_command_log', t => t.dropIndex([], 'idx_ai_command_log_user_created'));
  await knex.schema.table('sync_history', t => t.dropIndex([], 'idx_sync_history_user_provider_created'));
};
```

**Important:** Before running, verify each index doesn't already exist (the Step 1 query will show existing ones). Remove any that already exist.

- [ ] **Step 3: Run the migration locally**
```bash
cd juggler-backend && npx knex migrate:up 20260506000100_add_missing_indexes.js --knexfile knexfile.js
```
Expected: `Batch NNN ran the following migrations: 20260506000100_add_missing_indexes.js`

- [ ] **Step 4: Commit**
```bash
git add src/db/migrations/20260506000100_add_missing_indexes.js
git commit -m "perf(db): add missing indexes on cal_sync_ledger, weather, feature_events, sync_history (DB-3)"
```

---

## Task 8: DB Schema Hardening — VARCHAR Limits and CHECK Constraints (DB-1, DB-2)

**Files:**
- Create: `juggler-backend/src/db/migrations/20260506000200_add_schema_check_constraints.js`
- Create: `juggler-backend/src/db/migrations/20260506000300_add_varchar_limits.js`

**Problem:** Older migrations created VARCHAR columns without explicit length limits (defaults to 255 in MySQL but undocumented). Enum-like columns (pri, status) lack CHECK constraints — invalid values can be inserted if bypassing the app layer.

- [ ] **Step 1: Audit VARCHAR and enum columns**

Run to find unbounded text columns in the core tables:
```bash
cd juggler-backend && DB_PORT=3307 node -e "
const db = require('./src/db');
db.raw(\`
  SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'juggler'
    AND DATA_TYPE IN ('varchar', 'text')
  ORDER BY TABLE_NAME, COLUMN_NAME
\`).then(([rows]) => { rows.forEach(r => console.log(JSON.stringify(r))); process.exit(0); });
"
```

Look specifically for `CHARACTER_MAXIMUM_LENGTH = 255` on columns that should have tighter limits (e.g. `project` name on `task_masters` should be ≤100, not 255).

- [ ] **Step 2: Create CHECK constraint migration**

Create `src/db/migrations/20260506000200_add_schema_check_constraints.js`:
```js
exports.up = async function(knex) {
  // Add CHECK constraints for enum-like columns on task_masters
  // MySQL 8.0.16+ enforces CHECK constraints
  await knex.raw(`
    ALTER TABLE task_masters
      ADD CONSTRAINT chk_task_masters_pri
        CHECK (pri IN ('P1','P2','P3','P4')),
      ADD CONSTRAINT chk_task_masters_weather_precip
        CHECK (weather_precip IN ('any','wet_ok','light_ok','dry_only') OR weather_precip IS NULL),
      ADD CONSTRAINT chk_task_masters_weather_cloud
        CHECK (weather_cloud IN ('any','overcast_ok','partly_ok','clear') OR weather_cloud IS NULL)
  `);

  await knex.raw(`
    ALTER TABLE task_instances
      ADD CONSTRAINT chk_task_instances_status
        CHECK (status IN ('','wip','done','cancel','skip','pause','disabled'))
  `);
};

exports.down = async function(knex) {
  await knex.raw('ALTER TABLE task_masters DROP CHECK chk_task_masters_pri');
  await knex.raw('ALTER TABLE task_masters DROP CHECK chk_task_masters_weather_precip');
  await knex.raw('ALTER TABLE task_masters DROP CHECK chk_task_masters_weather_cloud');
  await knex.raw('ALTER TABLE task_instances DROP CHECK chk_task_instances_status');
};
```

- [ ] **Step 3: Run CHECK constraint migration locally**
```bash
cd juggler-backend && npx knex migrate:up 20260506000200_add_schema_check_constraints.js --knexfile knexfile.js
```

- [ ] **Step 4: Create VARCHAR limits migration**

Based on Step 1 audit findings, create `src/db/migrations/20260506000300_add_varchar_limits.js`. Standard limits:
- Task text: 500 chars
- Project/location/tool names: 100 chars
- URL field: 2048 chars
- Email fields: 255 chars

```js
exports.up = async function(knex) {
  await knex.schema.alterTable('task_masters', function(t) {
    t.string('text', 500).alter();
    t.string('project', 100).alter();
    t.string('location', 100).alter();
    t.string('tools', 500).alter();
    t.string('url', 2048).alter();
  });
  await knex.schema.alterTable('projects', function(t) {
    t.string('name', 100).alter();
    t.string('color', 20).alter();
    t.string('icon', 50).alter();
  });
  await knex.schema.alterTable('locations', function(t) {
    t.string('name', 100).alter();
    t.string('icon', 10).alter();
    t.string('display_name', 300).alter();
  });
};

exports.down = async function(knex) {
  // Restore to 255 (MySQL default) — no data loss unless data exceeds 255 chars
  await knex.schema.alterTable('task_masters', function(t) {
    t.string('text', 255).alter();
    t.string('project', 255).alter();
    t.string('location', 255).alter();
    t.string('tools', 255).alter();
    t.string('url', 255).alter();
  });
};
```

**Before running:** Check that no existing rows exceed the new limits:
```bash
cd juggler-backend && DB_PORT=3307 node -e "
const db = require('./src/db');
Promise.all([
  db('task_masters').whereRaw('LENGTH(text) > 500').count('* as n').first(),
  db('task_masters').whereRaw('LENGTH(project) > 100').count('* as n').first(),
]).then(([a,b]) => { console.log('text violations:', a.n, 'project violations:', b.n); process.exit(0); });
"
```

- [ ] **Step 5: Run VARCHAR migration**
```bash
cd juggler-backend && npx knex migrate:up 20260506000300_add_varchar_limits.js --knexfile knexfile.js
```

- [ ] **Step 6: Commit**
```bash
git add src/db/migrations/20260506000200_add_schema_check_constraints.js src/db/migrations/20260506000300_add_varchar_limits.js
git commit -m "fix(db): add CHECK constraints on enum columns and VARCHAR length limits (DB-1, DB-2)"
```

---

## Task 9: Multi-Server SSE — Redis Pub/Sub (MS-1)

**Files:**
- Modify: `juggler-backend/src/lib/sse-emitter.js`

**Problem:** `clients` Map is per-process. On Cloud Run with >1 instance, mutations on instance B won't reach SSE clients connected to instance A. Redis is already wired (`src/lib/redis.js` — ioredis, fails-open).

**Architecture:** Each `emit(userId, event, data)` call publishes to a Redis channel `sse:userId`. Each instance subscribes to channels for its connected users. When a user disconnects, unsubscribe if no other local clients exist.

- [ ] **Step 1: Rewrite `sse-emitter.js`**

Replace the entire file:
```js
/**
 * SSE Event Emitter — multi-instance safe via Redis pub/sub.
 *
 * Each instance holds its own in-memory client map (for response writing).
 * Events are published to Redis channel `sse:{userId}` so all instances
 * receive them regardless of which instance handled the mutation.
 *
 * Falls back to direct local-only emit if Redis is unavailable (single-instance OK).
 */

const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const CHANNEL_PREFIX = 'sse:';

// Local SSE response objects — own-instance only
var clients = {};

// Lazy subscriber client — separate connection required for Redis pub/sub
var subscriber = null;

function getSubscriber() {
  if (subscriber) return subscriber;
  subscriber = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: function(times) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    }
  });
  subscriber.on('message', function(channel, message) {
    var userId = channel.slice(CHANNEL_PREFIX.length);
    var subs = clients[userId];
    if (!subs || subs.size === 0) return;
    subs.forEach(function(res) {
      try { res.write(message); }
      catch (e) { subs.delete(res); }
    });
  });
  subscriber.on('error', function(err) {
    console.warn('[sse-emitter] Redis subscriber error (falling back to local-only):', err.message);
  });
  return subscriber;
}

// Publisher client — reuse the same connection pattern as redis.js but separate client
var publisher = null;
function getPublisher() {
  if (publisher) return publisher;
  publisher = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: function(times) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    }
  });
  publisher.on('error', function(err) {
    console.warn('[sse-emitter] Redis publisher error (falling back to local-only):', err.message);
  });
  return publisher;
}

function addClient(userId, res) {
  if (!clients[userId]) clients[userId] = new Set();
  clients[userId].add(res);

  // Subscribe to this user's channel if this is the first local client
  if (clients[userId].size === 1) {
    try { getSubscriber().subscribe(CHANNEL_PREFIX + userId); }
    catch (e) { /* Redis unavailable — local-only mode */ }
  }

  res.on('close', function() {
    if (clients[userId]) {
      clients[userId].delete(res);
      if (clients[userId].size === 0) {
        delete clients[userId];
        try { getSubscriber().unsubscribe(CHANNEL_PREFIX + userId); }
        catch (e) { /* ignore */ }
      }
    }
  });
}

function emit(userId, event, data) {
  var payload = 'event: ' + event + '\n';
  payload += 'data: ' + JSON.stringify(data || {}) + '\n\n';

  // Publish to Redis — all instances receive it (including this one via subscriber)
  var pub = getPublisher();
  if (pub && pub.status === 'ready') {
    pub.publish(CHANNEL_PREFIX + userId, payload).catch(function(err) {
      console.warn('[sse-emitter] publish failed, falling back to local:', err.message);
      _emitLocal(userId, payload);
    });
  } else {
    // Redis unavailable — direct local emit
    _emitLocal(userId, payload);
  }
}

function _emitLocal(userId, payload) {
  var subs = clients[userId];
  if (!subs || subs.size === 0) return;
  subs.forEach(function(res) {
    try { res.write(payload); }
    catch (e) { subs.delete(res); }
  });
}

function clientCount(userId) {
  return clients[userId] ? clients[userId].size : 0;
}

module.exports = { addClient, emit, clientCount };
```

- [ ] **Step 2: Verify existing SSE behaviour in integration tests**
```bash
cd juggler-backend && npx jest --testPathPattern="sse|events" --no-coverage 2>&1 | tail -10
```
If no SSE-specific tests exist, manually test:
```bash
# Terminal 1 — listen for events (requires a valid JWT):
TOKEN=$(node scripts/claude/core/auth.js token --quiet 2>/dev/null)
curl -N -H "Authorization: Bearer $TOKEN" http://localhost:5002/api/events

# Terminal 2 — trigger a mutation:
curl -s -X POST http://localhost:5002/api/tasks -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"text":"SSE test","dur":15}'
```
Expected: Terminal 1 receives `event: tasks:changed` within 1 second.

- [ ] **Step 3: Commit**
```bash
git add src/lib/sse-emitter.js
git commit -m "feat(infra): SSE via Redis pub/sub for multi-instance safety (MS-1)"
```

---

## Task 10: Persist Scheduler Sessions to DB (MS-2)

**Files:**
- Create: `juggler-backend/src/db/migrations/20260506000400_scheduler_sessions_table.js`
- Modify: `juggler-backend/src/scheduler/schedulerSession.js`

**Problem:** Admin stepper sessions are stored in an in-memory Map with 1h TTL. If the admin's subsequent requests hit a different Cloud Run instance, the session is gone.

- [ ] **Step 1: Create the sessions table migration**

Create `src/db/migrations/20260506000400_scheduler_sessions_table.js`:
```js
exports.up = async function(knex) {
  await knex.schema.createTable('scheduler_sessions', function(t) {
    t.string('session_id', 36).primary();
    t.string('user_id', 36).notNullable().index();
    t.json('snapshot').notNullable();
    t.json('steps').notNullable().defaultTo('[]');
    t.integer('current_step').notNullable().defaultTo(0);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at').notNullable();
    t.index(['expires_at'], 'idx_scheduler_sessions_expires');
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('scheduler_sessions');
};
```

- [ ] **Step 2: Run the migration**
```bash
cd juggler-backend && npx knex migrate:up 20260506000400_scheduler_sessions_table.js --knexfile knexfile.js
```

- [ ] **Step 3: Rewrite `schedulerSession.js` to use DB**

Open `src/scheduler/schedulerSession.js`. Replace the in-memory `sessions` Map with DB reads/writes. The interface must remain identical: `createSession(userId, snapshot, steps)`, `getSession(sessionId)`, `updateSession(sessionId, updates)`, `deleteSession(sessionId)`.

Replacement pattern:
```js
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

async function createSession(userId, snapshot, steps) {
  const sessionId = uuidv4();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db('scheduler_sessions').insert({
    session_id: sessionId,
    user_id: userId,
    snapshot: JSON.stringify(snapshot),
    steps: JSON.stringify(steps),
    current_step: 0,
    expires_at: expiresAt
  });
  return sessionId;
}

async function getSession(sessionId) {
  const row = await db('scheduler_sessions')
    .where('session_id', sessionId)
    .where('expires_at', '>', new Date())
    .first();
  if (!row) return null;
  return {
    userId: row.user_id,
    snapshot: JSON.parse(row.snapshot),
    steps: JSON.parse(row.steps),
    currentStep: row.current_step
  };
}

async function updateSession(sessionId, updates) {
  const patch = {};
  if (updates.currentStep !== undefined) patch.current_step = updates.currentStep;
  if (updates.steps !== undefined) patch.steps = JSON.stringify(updates.steps);
  if (updates.snapshot !== undefined) patch.snapshot = JSON.stringify(updates.snapshot);
  await db('scheduler_sessions').where('session_id', sessionId).update(patch);
}

async function deleteSession(sessionId) {
  await db('scheduler_sessions').where('session_id', sessionId).delete();
}

// Sweep expired sessions (call on a slow interval — e.g., every 5 minutes)
async function sweepExpired() {
  await db('scheduler_sessions').where('expires_at', '<', new Date()).delete();
}

module.exports = { createSession, getSession, updateSession, deleteSession, sweepExpired };
```

- [ ] **Step 4: Update the sweep interval in wherever it's called**

Search for the existing sweep interval in `src/app.js` or `scheduleQueue.js`:
```bash
grep -rn "sweep\|Session" juggler-backend/src/ | grep -v node_modules | grep -v ".test."
```
Update the interval call to use the async version: `schedulerSession.sweepExpired()` (no args needed).

- [ ] **Step 5: Run full test suite**
```bash
cd juggler-backend && npx jest --no-coverage 2>&1 | tail -5
```

- [ ] **Step 6: Commit**
```bash
git add src/db/migrations/20260506000400_scheduler_sessions_table.js src/scheduler/schedulerSession.js
git commit -m "feat(infra): persist scheduler sessions to DB for multi-instance safety (MS-2)"
```

---

## Task 11: Security Probe Test Suite (JF-R4)

**Files:**
- Create: `juggler-backend/tests/security/probes.test.js`

- [ ] **Step 1: Create the probe suite**

Create `juggler-backend/tests/security/probes.test.js`:
```js
const request = require('supertest');
const crypto = require('crypto');
const app = require('../../src/app');

describe('Security probes', () => {
  describe('Webhook replay protection', () => {
    it('rejects a replayed webhook outside freshness window', async () => {
      const secret = process.env.BILLING_WEBHOOK_SECRET || 'test-secret';
      const staleTs = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const body = JSON.stringify({ event: 'subscription.created', user_id: 'u1', timestamp: staleTs });
      const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');
      const res = await request(app)
        .post('/api/billing-webhooks')
        .set('Content-Type', 'application/json')
        .set('X-Billing-Signature', sig)
        .send(body);
      expect(res.status).toBe(401);
    });

    it('rejects a webhook with no signature', async () => {
      const res = await request(app)
        .post('/api/billing-webhooks')
        .send({ event: 'subscription.created' });
      expect([401, 400]).toContain(res.status);
    });
  });

  describe('MCP userId injection', () => {
    it('rejects MCP requests with no Bearer token', async () => {
      const res = await request(app)
        .post('/mcp')
        .send({ jsonrpc: '2.0', method: 'list_tasks', params: {}, id: 1 });
      expect([401, 403]).toContain(res.status);
    });
  });

  describe('Auth endpoint protection', () => {
    it('POST /api/tasks returns 401 without token', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .send({ text: 'Unauthenticated task' });
      expect(res.status).toBe(401);
    });

    it('GET /api/schedule/run returns 401 without token', async () => {
      const res = await request(app).post('/api/schedule/run');
      expect(res.status).toBe(401);
    });

    it('GET /health returns 200 without token', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    });
  });

  describe('Input size limits', () => {
    it('rejects task text over 500 chars', async () => {
      // Requires a valid token — skip if not in integration test environment
      if (!process.env.TEST_JWT) return;
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', 'Bearer ' + process.env.TEST_JWT)
        .send({ text: 'x'.repeat(501) });
      expect(res.status).toBe(400);
    });
  });
});
```

- [ ] **Step 2: Run the probe suite**
```bash
cd juggler-backend && npx jest tests/security/probes.test.js --no-coverage
```
Expected: all tests pass (the fixes from Tasks 1–4 should already handle these).

- [ ] **Step 3: Commit**
```bash
git add tests/security/probes.test.js
git commit -m "test(security): add live security probe suite — replay, MCP auth, input size (JF-R4)"
```

---

## Final: Deploy Migrations to Live DB

After all tasks are committed and local tests pass:

- [ ] **Step 1: Verify migration batch order**
```bash
cd juggler-backend && npx knex migrate:status --knexfile knexfile.js | grep "20260506"
```

- [ ] **Step 2: Connect Cloud SQL Proxy (port 3307)**

User runs in their terminal:
```bash
cloud_sql_proxy -instances=<INSTANCE>=tcp:3307 &
```

- [ ] **Step 3: Run all pending migrations against live DB**
```bash
cd juggler-backend && npx knex migrate:latest --knexfile knexfile.js
```

- [ ] **Step 4: Deploy to Cloud Run**
```bash
cd /path/to/monorepo && ./deploy.sh
```

- [ ] **Step 5: Smoke test**
```bash
curl https://juggler.appspot.com/health
```
Expected: `{"status":"ok"}`

- [ ] **Step 6: Final commit — bump submodule in monorepo**
```bash
cd .. && git add juggler && git commit -m "chore(submodule): bump juggler — deep hardening complete"
```
