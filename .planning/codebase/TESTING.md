# Testing Patterns

**Analysis Date:** 2026-05-14

## Test Framework

**Backend Runner:**
- Jest 30.x
- Config: `juggler-backend/jest.config.js`
- Single-worker mode enforced (`maxWorkers: 1`) — integration tests share a DB connection that conflicts when run in parallel
- `forceExit: true` — required to close DB and Redis connections after tests
- `NODE_ENV` set to `'test'` at top of `jest.config.js`

**Frontend Runner:**
- `react-scripts test` (CRA's Jest wrapper)
- `@testing-library/react` 16.x + `@testing-library/jest-dom` 6.x
- No separate jest config file — configured via CRA defaults

**E2E:**
- Playwright via `@playwright/test`
- Config: `juggler/playwright.config.js`
- Only Chromium project configured; headless, viewport 1280x800
- Base URL: `https://juggler.test.raike.local:8443` (env vars `PLAYWRIGHT_BASE_URL` / `FRONTEND_URL` override — see `playwright.config.js:15`; nothing serves on localhost:3001 — the juggler frontend dev port is 3002)

**Assertion Library:**
- Jest built-in `expect` throughout backend
- `@testing-library/jest-dom` matchers (`.toBeInTheDocument()`, `.toBeVisible()`) in frontend JSX tests

**Run Commands:**
```bash
# Backend
cd juggler-backend && npm test              # Run all backend tests
cd juggler-backend && npm test -- --watch  # Watch mode
cd juggler-backend && npm test -- --coverage  # Coverage

# Frontend
cd juggler-frontend && npm test            # Run all frontend tests (interactive)
cd juggler-frontend && npm test -- --watchAll=false  # CI mode

# E2E (from juggler root)
npx playwright test                        # Run all E2E tests
```

## Test File Organization

**Backend — two locations:**

1. `juggler-backend/tests/` — primary test directory (most tests live here)
   - Flat files for core domain: `schedulerRules.test.js`, `unifiedSchedule.test.js`, `taskControllerUnit.test.js`
   - Subdirectories for feature areas:
     - `tests/cal-sync/` — calendar sync integration tests (numbered `01-` through `99-`)
     - `tests/api/` — API route tests (`reactivation-reset.test.js`, `status-guard.test.js`)
     - `tests/security/` — security probe tests (`probes.test.js`, `rate-limits.test.js`, `webhook.test.js`, `write-rate-limit.test.js`)
     - `tests/scheduler/` — scheduler edge case tests
     - `tests/unit/` — pure unit tests (`ai-usage-flusher.test.js`, `ai-usage-queue.test.js`, `validate.middleware.test.js`)
     - `tests/db/` — migration/schema tests
     - `tests/migrations/` — migration-specific tests
     - `tests/lib/` — lib module tests
     - `tests/shared/` — shared utility tests
     - `tests/cron/` — cron job tests
     - `tests/helpers/` — shared test infrastructure (NOT test files)

2. `juggler-backend/src/__tests__/` — for tests co-located near their implementation
   - Currently: `impersonation.controller.test.js`

**Frontend — co-located `__tests__` directories:**
- `src/components/admin/__tests__/` — `ImpersonationBanner.test.jsx`, `ImpersonationPage.test.jsx`
- `src/services/__tests__/` — `impersonationService.test.js`
- `src/state/__tests__/` — `constants.test.js`
- `src/utils/__tests__/` — `taskIcon.test.js`, `weatherMatch.test.js`

**E2E:**
- `juggler/tests/e2e.spec.js` — full app E2E flows
- `juggler/tests/responsive.spec.js` — responsive layout tests

**Naming:**
- Backend: `<module>.test.js` or `<feature>.integration.test.js` or `<feature>Integration.test.js`
- Frontend: `<Component>.test.jsx` or `<module>.test.js`
- E2E: `<area>.spec.js` (Playwright convention)

## Test Structure

**Backend unit test pattern (scheduler domain):**
```js
/**
 * Scheduler Rules Test Suite
 *
 * Comprehensive tests for every scheduling rule...
 */

const unifiedSchedule = require('../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');

// Factory function — standard pattern across all scheduler tests
function makeTask(overrides) {
  return {
    id: 't_' + Math.random().toString(36).slice(2, 8),
    text: 'Test task',
    date: TODAY,
    dur: 30,
    pri: 'P3',
    when: '',
    ...overrides
  };
}

function makeCfg(overrides) {
  return { timeBlocks: DEFAULT_TIME_BLOCKS, splitMinDefault: 15, ...overrides };
}

describe('Deadline tasks', () => {
  test('hard deadline task placed before deadline', () => {
    var task = makeTask({ deadline: '2026-03-22', pri: 'P1' });
    var result = run([task]);
    // assertions
  });
});
```

**Backend integration test pattern (DB required):**
```js
var db = require('../src/db');

var available = false;

beforeAll(async () => {
  try {
    await db.raw('SELECT 1');
    available = true;
  } catch (e) {
    console.warn('Test DB not available:', e.message);
    return;
  }
  // Seed test user + clean state
  await db('users').insert({ id: USER_ID, ... });
}, 15000);

afterAll(async () => {
  if (available) {
    // Clean up in dependency order
    await db('task_instances').where('user_id', USER_ID).del();
    await db('task_masters').where('user_id', USER_ID).del();
    await db('users').where('id', USER_ID).del();
  }
  await db.destroy();
});

beforeEach(async () => {
  if (!available) return;
  await db('task_instances').where('user_id', USER_ID).del();
  // Reset mocks
  someMock.mockClear();
});
```

**Frontend component test pattern:**
```jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImpersonationBanner from '../ImpersonationBanner';
import * as impersonationService from '../../../services/impersonationService';

jest.mock('../../../services/impersonationService');

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

it('renders nothing when juggler-impersonation is not set', () => {
  const { container } = render(<ImpersonationBanner darkMode={true} />);
  expect(container.firstChild).toBeNull();
});
```

## Mocking

**Backend — DB mock (unit tests):**

Full chainable Knex mock used in `api.integration.test.js`:
```js
function createChainMock() {
  const chain = jest.fn(() => chain);
  ['where', 'whereRaw', 'leftJoin', 'orderBy', ...].forEach(m => {
    chain[m] = jest.fn(() => chain);
  });
  chain.select = jest.fn(() => Promise.resolve(resolveQueue.shift() || []));
  chain.first = jest.fn(() => Promise.resolve(resolveQueue.shift() || null));
  chain.insert = jest.fn(() => Promise.resolve());
  chain.update = jest.fn(() => Promise.resolve(1));
  chain.transaction = jest.fn(async (cb) => cb(chain));
  return chain;
}
const mockDb = createChainMock();
jest.mock('../src/db', () => mockDb);
```

Simple mock (for unit tests that just need `db.fn.now()`):
```js
jest.mock('../src/db', () => {
  const fn = { now: () => 'MOCK_NOW' };
  const mock = () => mock;
  mock.fn = fn;
  return mock;
});
```

**Backend — JWT middleware mock:**
```js
jest.mock('../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.user = { ...TEST_USER };
    req.auth = { plans: {} };
    next();
  },
  verifyToken: jest.fn()
}));
```

**Backend — plan features middleware mock:**
```js
jest.mock('../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => {
    req.planId = 'enterprise';
    req.planFeatures = {
      limits: { active_tasks: -1, ... },
      ai: { natural_language_commands: true },
      calendar: { max_providers: -1, auto_sync: true },
    };
    next();
  },
  PRODUCT_ID: 'juggler',
  refreshPlanFeatures: jest.fn(),
  getCachedPlanFeatures: jest.fn()
}));
```

**Backend — scheduler mock (for CRUD tests):**
```js
jest.mock('../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn()
}));
```

**Frontend — service mock:**
```js
jest.mock('../../../services/impersonationService');
// Then per-test:
impersonationService.getStoredImpersonation.mockReturnValue({ ... });
impersonationService.stopImpersonation.mockResolvedValueOnce({ message: 'stopped' });
```

**Frontend — global fetch mock:**
```js
beforeEach(() => {
  global.fetch = jest.fn();
});
// Per-test:
global.fetch.mockResolvedValueOnce({ ok: true, json: async () => mockData });
```

**UUID mock (`moduleNameMapper` in jest.config.js):**
```js
// tests/helpers/uuid-mock.js
const crypto = require('crypto');
module.exports = {
  v7: () => crypto.randomUUID(),
  v4: () => crypto.randomUUID(),
};
```
This is required because `uuid` v13 uses ESM-only exports that break Jest's CommonJS environment.

**What to mock:**
- `../src/db` — always mock in unit tests and route integration tests that don't need real data
- JWT middleware — always mock in API route tests
- `../src/scheduler/scheduleQueue` — mock in CRUD tests to prevent scheduler side effects
- `../src/lib/sync-lock` — mock in queue tests
- External API clients (GCal, MSFT, Apple) — mock in unit tests; use real credentials in cal-sync integration tests

**What NOT to mock:**
- The scheduler logic itself (`unifiedScheduleV2.js`) — it is the primary subject of most backend tests
- `tasksWrite` module in CRUD integration tests — let it write to the real test DB
- Calendar adapters in `tests/cal-sync/` — these require real API credentials; tests self-skip when credentials are absent

## Fixtures and Factories

**Test DB helper (`tests/helpers/testDb.js`):**
```js
async function seedUser(overrides) {
  var d = getDb();
  var user = Object.assign({
    id: 'test-user-001',
    email: 'test@test.com',
    timezone: 'America/New_York',
    created_at: d.fn.now(),
    updated_at: d.fn.now()
  }, overrides);
  await d('users').insert(user);
  return user;
}

async function seedTask(overrides) {
  // Routes through tasksWrite.insertTask() to create both master + instance rows
  await tasksWrite.insertTask(d, task);
}
```

**Calendar sync test setup (`tests/cal-sync/helpers/test-setup.js`):**
- `buildTestUser(overrides)` — constructs user row with real OAuth credentials from env
- `seedTestUser(overrides)` — inserts test user into DB
- `cleanupTestData()` — deletes in FK dependency order (ledger → instances → masters → user)
- `mockReq(user, overrides)` / `mockRes()` — builds Express req/res objects for calling controllers directly

**Calendar sync fixtures (`tests/cal-sync/helpers/test-fixtures.js`):**
- `makeTask(overrides)` — creates a real DB task row via `tasksWrite.insertTask`
- `makeLedgerRow(overrides)` — creates a `cal_sync_ledger` row

**Scheduler factory pattern (tests/schedulerRules.test.js and others):**
```js
function makeTask(overrides) {
  return {
    id: 't_' + Math.random().toString(36).slice(2, 8),
    text: 'Test task', date: TODAY, dur: 30, pri: 'P3',
    when: '', dayReq: 'any', status: '',
    dependsOn: [], location: [], tools: [],
    recurring: false, split: false, datePinned: false,
    ...overrides
  };
}
```

**Time control helper (`tests/helpers/time-control.js`):**
```js
const tc = timeControl('4/3/2026', 'America/New_York');
tc.setTime('8:00 AM');     // nowMins = 480
tc.advanceDay();            // move to next day
tc.simulateWeek(tasks, statuses, cfg, unifiedSchedule);
```
Used in `schedulerTimeSimulation.test.js` for multi-day/week simulation.

**Location:** All shared infrastructure in `juggler-backend/tests/helpers/` (never test files themselves)
- `testDb.js` — Knex DB handle + seed/cleanup helpers
- `time-control.js` — time simulation for scheduler tests
- `uuid-mock.js` — Jest moduleNameMapper target
- `teardown.js` — global Jest teardown
- `real-config-fixtures.js` — real user config fixtures for integration tests

## Coverage

**Requirements:** No enforced coverage threshold
**Collect from:** `src/**/*.js` (excluding `src/server.js`)
**View coverage:**
```bash
cd juggler-backend && npm test -- --coverage
```

## Test Types

**Unit Tests (pure logic, no DB):**
- Scheduler algorithm: `tests/unifiedSchedule.test.js`, `tests/schedulerRules.test.js`, `tests/schedulerScenarios.test.js`, `tests/schedulerDeepCoverage.test.js`
- Helper functions: `tests/dateHelpers.test.js`, `tests/timeBlockHelpers.test.js`, `tests/taskMapping.test.js`, `tests/dependencyHelpers.test.js`
- Middleware: `tests/unit/validate.middleware.test.js`
- Services: `tests/unit/ai-usage-queue.test.js`, `tests/unit/ai-usage-flusher.test.js`
- Frontend utilities: `src/utils/__tests__/taskIcon.test.js`, `src/state/__tests__/constants.test.js`

**Integration Tests (real test DB — require Docker):**
- Task CRUD: `tests/taskCrudIntegration.test.js`, `tests/taskCrudIntegration2.test.js`
- Scheduler persistence: `tests/schedulerPersistIntegration.test.js`, `tests/runScheduleIntegration.test.js`, `tests/schedulerIntegration.test.js`
- API routes: `tests/api.integration.test.js` (DB mock), `tests/viewShape.integration.test.js` (real DB)
- Schedule queue: `tests/scheduleQueue.test.js`
- Migrations: `tests/migrations/20260509000100.test.js`, `tests/db/missed-status-migration.test.js`

**Calendar Sync Integration Tests (real API credentials required):**
- Location: `tests/cal-sync/01-99-*.test.js`
- Numbered by concern: `01` adapter (GCal), `02` adapter (MSFT), `03` adapter (Apple), `10` push, `11` pull, `12` deletion/history, `13` conflict, `14` promotion, `15` ingest, `16` all-day, `17` split, `18` recurring, `19` multi-provider, `20` lock, `30` performance, `99` E2E
- Tests self-skip via `isDbAvailable()` / `hasGCalCredentials()` etc. guards:
  ```js
  var dbOk = await isDbAvailable();
  if (!dbOk) { test.skip('...'); return; }
  ```

**Security Tests:**
- `tests/security/probes.test.js` — auth protection, MCP injection, OAuth validation
- `tests/security/rate-limits.test.js`, `write-rate-limit.test.js`, `webhook.test.js`
- Uses `supertest` against the real Express `app`:
  ```js
  const request = require('supertest');
  const app = require('../../src/app');
  const res = await request(app).post('/api/tasks').set('Content-Type', 'application/json').send({...});
  ```

**Frontend Component Tests:**
- React Testing Library for render + interaction (`src/components/admin/__tests__/`)
- Pure JS function tests for services and utilities

**E2E Tests (Playwright, requires running services):**
- `tests/e2e.spec.js` — full browser flows (app load, view switching, task creation)
- Auth bypassed by intercepting `/api/auth/refresh` and `/api/auth/me` in `setupAuth(page)`

## Common Patterns

**DB availability guard (integration tests):**
```js
var available = false;

beforeAll(async () => {
  try {
    await db.raw('SELECT 1');
    available = true;
  } catch (e) {
    console.warn('Test DB not available:', e.message);
    return;
  }
  // ... seed
}, 15000);  // Extended timeout for DB setup

// In each test:
if (!available) return;
```

**Mock req/res (controller unit/integration tests):**
```js
function mockReq(overrides) {
  return Object.assign({
    user: { id: USER_ID },
    headers: { 'x-timezone': 'America/New_York' },
    params: {}, query: {}, body: {},
    planFeatures: null, planId: 'free'
  }, overrides);
}

function mockRes() {
  var res = {
    statusCode: 200,
    _json: null,
    status: function(code) { res.statusCode = code; return res; },
    json: function(data) { res._json = data; return res; }
  };
  return res;
}
```

**Async testing (backend):**
```js
test('does NOT throw when DB insert fails', async () => {
  mockInsert.mockRejectedValueOnce(new Error('DB down'));
  await expect(enqueue(mockDb, validEvent)).resolves.not.toThrow();
});
```

**Conditional skip based on env vars:**
```js
const describeIfJwt = process.env.TEST_JWT ? describe : describe.skip;
describeIfJwt('Input size limits', () => { ... });
```

**Supertest HTTP assertions (security tests):**
```js
it('rejects MCP requests with no Bearer token', async () => {
  const res = await request(app)
    .post('/mcp')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ jsonrpc: '2.0', method: 'list_tasks', id: 1 }));
  expect(res.status).toBe(401);
});
```

**Playwright auth bypass pattern (E2E):**
```js
async function setupAuth(page) {
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ accessToken: TEST_TOKEN }) })
  );
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ user: TEST_USER }) })
  );
}

test.beforeEach(async ({ page }) => {
  await setupAuth(page);
  await page.goto('/');
  await page.waitForSelector('text=Juggler', { timeout: 15000 });
});
```

---

*Testing analysis: 2026-05-14*
