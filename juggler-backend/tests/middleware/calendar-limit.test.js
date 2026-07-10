'use strict';

/**
 * Unit tests — src/middleware/calendar-limit.js (999.1205 JUG-TEST-CALENDARLIMIT-FAILOPEN).
 *
 * Plan-gated REVENUE check: Free = 1 calendar provider, Pro+ = unlimited (-1).
 * Previously ZERO tests. Pure unit, NO DB — the knex singleton is mocked at the
 * module boundary (src/lib/db.getDefaultDb) before the middleware is required.
 *
 * NOTE ON FAIL-OPEN SEMANTICS (documented CURRENT behavior — intentionally pinned,
 * not endorsed): the middleware fails OPEN in five places —
 *   1. `!req.planFeatures`  → allow + logger.warn (999.1428) — if plan-features
 *      resolution breaks upstream, Free users can connect unlimited providers;
 *      the warn is the only observable signal of the bypass.
 *   2. `limit === undefined` → treated as unlimited (L31).
 *   3. missing req.user.id  → allow (L36-38).
 *   4. user row not found   → allow (L42).
 *   5. DB error             → allow + logger.error (L67-70).
 * These tests pin that behavior explicitly (and that paths 1 and 5 are logged)
 * so any change — tightening OR accidental widening — fails a test.
 *
 * Plan context: req.planFeatures is resolved upstream (plan-features.middleware)
 * from the JWT `plans` claim, which is keyed by product SLUG ('juggler'), not
 * UUID. This middleware consumes the already-resolved features object.
 */

// ── module-scope mocks (survive jest.mock hoisting) ─────────────────────────
var mockFirst = jest.fn();
var mockWhere = jest.fn(function () { return { first: mockFirst }; });
var mockDb = jest.fn(function (table) { return { where: mockWhere }; });

var mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };

jest.mock('../../src/lib/db', () => ({
  getDefaultDb: () => mockDb,
}));

jest.mock('@raike/lib-logger', () => ({
  createLogger: () => mockLogger,
}));

const { checkCalendarLimit } = require('../../src/middleware/calendar-limit');

// ── helpers ──────────────────────────────────────────────────────────────────
function makeReq({ planFeatures, planId, userId } = {}) {
  const req = {};
  if (planFeatures !== undefined) req.planFeatures = planFeatures;
  if (planId !== undefined) req.planId = planId;
  if (userId !== undefined) req.user = { id: userId };
  return req;
}

function makeRes() {
  const res = { statusCode: null, body: null };
  res.status = jest.fn(function (code) { res.statusCode = code; return res; });
  res.json = jest.fn(function (payload) { res.body = payload; return res; });
  return res;
}

function freeFeatures() {
  // Shape produced by plan-features.middleware for the Free plan.
  return { calendar: { max_providers: 1 } };
}

function setDbUser(userRow) {
  mockFirst.mockResolvedValue(userRow);
}

async function run(provider, req, res) {
  const next = jest.fn();
  await checkCalendarLimit(provider)(req, res, next);
  return next;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── enforcement (the revenue gate actually gates) ────────────────────────────
describe('calendar-limit — enforcement for limited (Free) plans', () => {
  test('Free (limit 1) with 1 provider connected → 403 CALENDAR_LIMIT_REACHED for a second provider', async () => {
    setDbUser({ id: 'u1', gcal_access_token: 'tok', msft_cal_access_token: null });
    const req = makeReq({ planFeatures: freeFeatures(), planId: 'free', userId: 'u1' });
    const res = makeRes();

    const next = await run('microsoft', req, res);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: 'Calendar provider limit reached',
      code: 'CALENDAR_LIMIT_REACHED',
      connected: 1,
      limit: 1,
      current_plan: 'free',
      upgrade_required: true,
      message: 'Your plan allows 1 calendar provider. Upgrade to connect additional providers.',
    });
  });

  test('Free (limit 1) with msft connected blocks google too (limit is provider-agnostic)', async () => {
    setDbUser({ id: 'u1', gcal_access_token: null, msft_cal_access_token: 'tok' });
    const req = makeReq({ planFeatures: freeFeatures(), planId: 'free', userId: 'u1' });
    const res = makeRes();

    const next = await run('google', req, res);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('CALENDAR_LIMIT_REACHED');
  });

  test('Free (limit 1) with 0 providers connected → allowed (counting query: both token columns checked)', async () => {
    setDbUser({ id: 'u1', gcal_access_token: null, msft_cal_access_token: null });
    const req = makeReq({ planFeatures: freeFeatures(), planId: 'free', userId: 'u1' });
    const res = makeRes();

    const next = await run('google', req, res);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    // counting query correctness: queried the users table by the requester's id
    expect(mockDb).toHaveBeenCalledWith('users');
    expect(mockWhere).toHaveBeenCalledWith('id', 'u1');
  });

  test('reconnect of an already-connected provider is allowed even at the limit (google)', async () => {
    setDbUser({ id: 'u1', gcal_access_token: 'tok', msft_cal_access_token: null });
    const req = makeReq({ planFeatures: freeFeatures(), planId: 'free', userId: 'u1' });
    const res = makeRes();

    const next = await run('google', req, res);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('reconnect of an already-connected provider is allowed even at the limit (microsoft)', async () => {
    setDbUser({ id: 'u1', gcal_access_token: null, msft_cal_access_token: 'tok' });
    const req = makeReq({ planFeatures: freeFeatures(), planId: 'free', userId: 'u1' });
    const res = makeRes();

    const next = await run('microsoft', req, res);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('limit 2 with 1 connected → second distinct provider allowed; message pluralizes at limit > 1', async () => {
    // allowed case
    setDbUser({ id: 'u1', gcal_access_token: 'tok', msft_cal_access_token: null });
    let req = makeReq({ planFeatures: { calendar: { max_providers: 2 } }, planId: 'duo', userId: 'u1' });
    let res = makeRes();
    let next = await run('microsoft', req, res);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();

    // blocked-at-2 case pins the plural message. Both providers connected and a
    // hypothetical third provider ('apple') is requested — neither reconnect
    // branch matches, so the count check runs.
    setDbUser({ id: 'u1', gcal_access_token: 'tok', msft_cal_access_token: 'tok' });
    req = makeReq({ planFeatures: { calendar: { max_providers: 2 } }, planId: 'duo', userId: 'u1' });
    res = makeRes();
    next = await run('apple', req, res);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.connected).toBe(2);
    expect(res.body.message).toBe('Your plan allows 2 calendar providers. Upgrade to connect additional providers.');
  });

  test('403 body defaults current_plan to "free" when req.planId is absent', async () => {
    setDbUser({ id: 'u1', gcal_access_token: 'tok', msft_cal_access_token: null });
    const req = makeReq({ planFeatures: freeFeatures(), userId: 'u1' }); // no planId
    const res = makeRes();

    await run('microsoft', req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body.current_plan).toBe('free');
  });
});

// ── unlimited plans ───────────────────────────────────────────────────────────
describe('calendar-limit — unlimited (Pro+) plans', () => {
  test('limit -1 → allowed without querying the DB', async () => {
    const req = makeReq({ planFeatures: { calendar: { max_providers: -1 } }, planId: 'pro', userId: 'u1' });
    const res = makeRes();

    const next = await run('microsoft', req, res);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(mockDb).not.toHaveBeenCalled();
  });

  test('calendar.max_providers missing from features → treated as unlimited (fail-open path 2), no DB query', async () => {
    // FAIL-OPEN: a plan-catalog edit that drops the key silently un-gates Free.
    const req = makeReq({ planFeatures: { calendar: {} }, planId: 'free', userId: 'u1' });
    const res = makeRes();

    const next = await run('microsoft', req, res);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(mockDb).not.toHaveBeenCalled();
  });
});

// ── fail-open paths (CURRENT behavior, pinned explicitly) ────────────────────
describe('calendar-limit — fail-open paths (pinned current behavior)', () => {
  test('FAIL-OPEN 1: no req.planFeatures → allowed with no DB query, but logged via logger.warn (999.1428)', async () => {
    // If plan-features resolution breaks upstream, the gate stops gating —
    // still allowed (fail open), but no longer silently (999.1428).
    setDbUser({ id: 'u1', gcal_access_token: 'tok', msft_cal_access_token: 'tok' });
    const req = makeReq({ userId: 'u1' }); // planFeatures undefined
    const res = makeRes();

    const next = await run('microsoft', req, res);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(mockDb).not.toHaveBeenCalled(); // short-circuits before counting
    // 999.1428: the revenue-gate bypass is observable.
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn.mock.calls[0][0]).toBe(
      '[calendar-limit] req.planFeatures missing — allowing connect without plan check (fail open)');
    expect(mockLogger.warn.mock.calls[0][1]).toEqual({ provider: 'microsoft', userId: 'u1' });
  });

  test('FAIL-OPEN 3: no req.user.id → allowed, no DB query', async () => {
    const req = makeReq({ planFeatures: freeFeatures(), planId: 'free' }); // no user
    const res = makeRes();

    const next = await run('google', req, res);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(mockDb).not.toHaveBeenCalled();
  });

  test('FAIL-OPEN 4: user row not found → allowed', async () => {
    setDbUser(undefined);
    const req = makeReq({ planFeatures: freeFeatures(), planId: 'free', userId: 'ghost' });
    const res = makeRes();

    const next = await run('google', req, res);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('FAIL-OPEN 5: DB error → allowed AND logged via logger.error', async () => {
    mockFirst.mockRejectedValue(new Error('pool exhausted'));
    const req = makeReq({ planFeatures: freeFeatures(), planId: 'free', userId: 'u1' });
    const res = makeRes();

    const next = await run('microsoft', req, res);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    // fail-open must be observable: the error is logged
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toBe('[calendar-limit] Check failed:');
    expect(mockLogger.error.mock.calls[0][1]).toBe('pool exhausted');
  });

  test('FAIL-OPEN 1 vs 5 distinction: missing planFeatures warns (999.1428), only the DB-error path uses logger.error', async () => {
    const req = makeReq({ userId: 'u1' });
    const res = makeRes();

    await run('google', req, res);

    // 999.1428: the planFeatures fail-open is a WARN (observable bypass),
    // never an ERROR — logger.error remains exclusive to the DB-error path
    // (FAIL-OPEN 5) so log-based alerting can tell the two apart.
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });
});
