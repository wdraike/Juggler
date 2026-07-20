/**
 * H3-W6 FIX-4.2 — synced_at / next_start fn.now() PIN.
 *
 * The W3 RE-REVIEW (Oscar-gated) decided the P1/ADR-0003 timestamp-source
 * correction (new Date(), never db.fn.now()) is SCOPED to the task-table columns
 * the KnexTaskRepository write path stamps. The direct-`.update()` collaborator
 * sites in the facade on:
 *   - cal_sync_ledger.synced_at  (facade L377,427,495,521,564,810 — 6 sites)
 *   - task_masters next_start's updated_at (facade applyRollingAnchor — 1 site)
 * retain the LEGACY `fn.now()` / `trx.fn.now()` verbatim (ernie W6-1). FIX-3
 * reverted these 7 sites back to fn.now() after a drift.
 *
 * zoe proved that a WRONG value at these sites (e.g. drifting them to new Date())
 * left every existing test green → the legacy-fn.now() behavior at the 7 sites
 * was UNTESTED. This suite pins it BEHAVIORALLY: a TAGGED fn.now() sentinel is
 * threaded through lib/db; the suite drives the public facade and asserts the
 * tagged raw lands in the synced_at / updated_at update payloads. If a future
 * edit drifts any of these sites back to new Date(), the corresponding pin FAILS.
 *
 * NOTE: this is the COMPLEMENT of KnexTaskRepository.test.js's P1 proof — there,
 * a tagged fn.now() must NEVER appear (repo write path); here, it MUST appear
 * (out-of-P1-scope collaborator sites). Together they lock the scope boundary.
 *
 * RETARGETED (juggler-anchor-column-cleanup W5, 2020-01-11): `rolling_anchor` /
 * `next_occurrence_anchor` dropped from task_masters; applyRollingAnchor's
 * `.update()` call now writes `next_start` (the single unified anchor column)
 * instead of `rolling_anchor` — same call site, same fn.now()-on-updated_at
 * behavior, only the write-column key changed. The pin below is retargeted to
 * that key.
 */

process.env.NODE_ENV = 'test';

// A tagged sentinel — distinguishable from a JS Date. If any pinned site drifts
// to new Date(), the payload value will be a Date (not this tag) and the pin fails.
const FN_NOW_TAG = { __knexRawNow: true };

let resolveQueue = [];
let updateCalls = [];

function createChainMock() {
  const chain = jest.fn(() => chain);
  ['where', 'whereRaw', 'whereNotNull', 'whereNull', 'whereNot', 'whereNotIn',
   'whereIn', 'orWhere', 'orWhereNot', 'orderBy', 'orderByRaw', 'limit', 'offset',
   'join', 'leftJoin', 'count', 'max', 'clearSelect', 'clearOrder', 'clone',
   'groupBy', 'having'].forEach(m => { chain[m] = jest.fn(() => chain); });

  chain.select = jest.fn(() => Promise.resolve(resolveQueue.length ? resolveQueue.shift() : []));
  chain.first = jest.fn(() => Promise.resolve(resolveQueue.length ? resolveQueue.shift() : null));
  chain.insert = jest.fn(() => Promise.resolve());
  chain.update = jest.fn((fields) => { updateCalls.push(fields); return Promise.resolve(1); });
  chain.del = jest.fn(() => Promise.resolve(1));
  chain.then = jest.fn((resolve, reject) => Promise.resolve(resolveQueue.length ? resolveQueue.shift() : []).then(resolve, reject));
  chain.catch = jest.fn((fn) => Promise.resolve([]).catch(fn));
  // TAGGED fn.now() — the pin sentinel (NOT the 'MOCK_NOW' string the oracle
  // suites use; a distinct object so we can assert identity).
  chain.fn = { now: () => FN_NOW_TAG };
  chain.raw = (s) => s;
  chain.transaction = jest.fn(async (cb) => cb(chain));
  return chain;
}

const mockDb = createChainMock();
jest.mock('../../src/db', () => mockDb);

// ADR-0002 / H3-W6: point lib/db's default at the SAME mockDb so the facade's
// collaborator getDb() / trx handle resolve this tagged-fn.now chain.
jest.mock('../../src/lib/db', () => {
  const actual = jest.requireActual('../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

const TEST_USER = { id: 'user-pin', email: 'pin@test.com', name: 'Pin', timezone: 'America/New_York' };
jest.mock('../../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    req.user = { ...TEST_USER };
    req.auth = { plans: {}, apps: ['juggler'] };
    next();
  },
  verifyToken: jest.fn()
}));

jest.mock('../../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => {
    req.planId = 'enterprise';
    req.planFeatures = { limits: { active_tasks: -1 }, calendar: {}, scheduling: {}, tasks: {} };
    next();
  },
  PRODUCT_ID: 'juggler',
  refreshPlanFeatures: jest.fn(),
  invalidateUserPlanCache: jest.fn(),
  getCachedPlanFeatures: jest.fn()
}));

jest.mock('../../src/lib/redis', () => ({
  getClient: jest.fn().mockReturnValue(null),
  invalidateTasks: jest.fn(() => Promise.resolve()),
  invalidateConfig: jest.fn(() => Promise.resolve()),
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve()),
  del: jest.fn(() => Promise.resolve())
}));

jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
}));

jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn(),
  addClient: jest.fn()
}));

const VALID_TOKEN = 'valid-test-token';
let app, request;

beforeAll(async () => {
  // setSystemTime WITHOUT useFakeTimers — avoids hangs in async/retry code
  jest.setSystemTime(new Date('2026-01-15T12:00:00Z'));
  app = require('../../src/app');
  request = require('supertest');
});

beforeEach(() => {
  resolveQueue = [];
  updateCalls = [];
  jest.clearAllMocks();
});

describe('FIX-4.2 PIN — synced_at / next_start write fn.now() (legacy, out of P1 scope)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('reactivateDoneFrozen writes synced_at = fn.now() raw (NOT new Date()) on reopen', async () => {
    // done → '' (reopen) drives reactivateDoneFrozen (facade L424-428):
    //   cal_sync_ledger.update({ status:'active', synced_at: getDb().fn.now() })
    resolveQueue.push({ id: 'pin-1', user_id: TEST_USER.id, task_type: 'task', status: 'done', scheduled_at: '2026-05-01T12:00:00Z' });
    await request(app)
      .put('/api/tasks/pin-1/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: '' });

    const reactivate = updateCalls.find(u => u && u.status === 'active');
    expect(reactivate).toBeTruthy();
    // The pin: synced_at must be the TAGGED fn.now() raw — proving the legacy
    // fn.now() write was preserved (FIX-3 revert). A drift to new Date() makes
    // this a Date instance and the assertion fails.
    expect(reactivate.synced_at).toBe(FN_NOW_TAG);
    expect(reactivate.synced_at instanceof Date).toBe(false);
  });

  test('applyRollingAnchor writes updated_at = fn.now() raw (NOT new Date()) for a rolling master', async () => {
    // A rolling master + terminal status drives applyRollingAnchor (facade.js
    // applyRollingAnchor, isRollingMaster branch):
    //   task_masters.update({ next_start: GREATEST(...), updated_at: getDb().fn.now() })
    // Queue: fetchTaskWithEventIds(existing) → instance row with a master + date;
    // then loadMaster / applyRollingAnchor reads the rolling master.
    const instance = {
      id: 'pin-2', user_id: TEST_USER.id, task_type: 'task', status: '',
      scheduled_at: '2026-05-08T12:00:00Z', date: '2026-05-08',
      master_id: 'master-pin-2', source_id: 'master-pin-2'
    };
    const rollingMaster = {
      id: 'master-pin-2', user_id: TEST_USER.id, recurring: 1,
      rolling: 1, rolling_window: 7, next_start: '2026-05-01'
    };
    resolveQueue.push(instance);       // fetchTaskWithEventIds → existing
    resolveQueue.push(instance);       // possible re-fetch
    resolveQueue.push(rollingMaster);  // loadMaster / preloadedMaster
    resolveQueue.push(rollingMaster);  // applyRollingAnchor master read

    await request(app)
      .put('/api/tasks/pin-2/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'done' });

    // Find an update payload carrying next_start (the applyRollingAnchor site).
    const anchorWrite = updateCalls.find(u => u && Object.prototype.hasOwnProperty.call(u, 'next_start'));
    if (anchorWrite) {
      // The pin: when the anchor-write site fires, updated_at is the tagged
      // fn.now() raw — legacy behavior preserved (out of P1 scope, ernie W6-1).
      expect(anchorWrite.updated_at).toBe(FN_NOW_TAG);
      expect(anchorWrite.updated_at instanceof Date).toBe(false);
    } else {
      // If the rolling-anchor branch did not fire for this fixture shape, fall
      // back to the SOURCE proof so the pin is never a silent no-op (zoe guard).
      // RETARGETED (999.1516 stage 4, 14a799e0): the anchor-write .update({...})
      // moved from facade.js into adapters/KnexLedgerWrites.js and stamps
      // updated_at via the threaded handle (dbOrTrx.fn.now()) — same site,
      // same fn.now()-never-new-Date() intent.
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'slices', 'task', 'adapters', 'KnexLedgerWrites.js'), 'utf8');
      const codeOnly = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      // next_start update site stamps updated_at via fn.now() (NOT new Date()).
      expect(codeOnly).toMatch(/next_start:[^}]*updated_at:\s*dbOrTrx\.fn\.now\(\)/);
    }
  });

  // SOURCE PROOF backstop: all 7 reverted sites use fn.now() / trx.fn.now() for
  // synced_at|updated_at, NONE use new Date() at those columns. This guards every
  // site (incl. delete/template/takeOwnership paths not driven by HTTP above) so
  // a drift to new Date() anywhere in the 7 is caught even if a behavioral path
  // isn't exercised. Executable-code only (comments stripped).
  test('SOURCE PROOF: the 7 collaborator sites write synced_at/updated_at via fn.now(), never new Date()', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'slices', 'task', 'facade.js'), 'utf8');
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments (incl. JSDoc)
      .replace(/\/\/[^\n]*/g, '');         // line comments

    // Every executable synced_at: write uses fn.now() (getDb().fn.now() or trx.fn.now()).
    const syncedAtWrites = codeOnly.match(/synced_at:\s*[^,}\n]+/g) || [];
    expect(syncedAtWrites.length).toBeGreaterThanOrEqual(6); // the 6 synced_at sites
    syncedAtWrites.forEach((w) => {
      expect(w).toMatch(/fn\.now\(\)/);
      expect(w).not.toMatch(/new Date\(\)/);
    });

    // The next_start site stamps updated_at via fn.now() (legacy, out of P1 scope).
    // RETARGETED (juggler-anchor-column-cleanup W5): the .update({...}) object's
    // key was `rolling_anchor: GREATEST(...)` before this leg; the column was
    // dropped and the site now writes `next_start: GREATEST(...)` instead — same
    // call site, same fn.now()-on-updated_at behavior. The assertion's INTENT
    // (fn.now(), never new Date(), on this site) is unchanged.
    // RETARGETED again (999.1516 stage 4, 14a799e0): the write site moved from
    // facade.js into adapters/KnexLedgerWrites.js with a threaded dbOrTrx
    // handle — assert against the adapter source now.
    const ledgerSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'slices', 'task', 'adapters', 'KnexLedgerWrites.js'), 'utf8');
    const ledgerCodeOnly = ledgerSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(ledgerCodeOnly).toMatch(/next_start:[^}]*updated_at:\s*dbOrTrx\.fn\.now\(\)/);
    expect(ledgerCodeOnly).not.toMatch(/new Date\(\)/);
  });
});
