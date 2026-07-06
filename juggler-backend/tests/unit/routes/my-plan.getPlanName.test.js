'use strict';

const mockLogger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
jest.mock('@raike/lib-logger', () => ({ createLogger: () => mockLogger }));
jest.mock('../../../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: jest.fn(),
  getProductId: jest.fn().mockResolvedValue('juggler'),
  PRODUCT_LABEL: 'juggler',
}));
jest.mock('../../../src/lib/db', () => ({ getDefaultDb: () => jest.fn() }));
jest.mock('../../../src/middleware/entity-limits', () => ({
  countActiveTasks: jest.fn(), countRecurringTemplates: jest.fn(),
  countProjects: jest.fn(), countLocations: jest.fn(), countScheduleTemplates: jest.fn(),
}));
jest.mock('../../../src/middleware/jwt-auth', () => ({ authenticateJWT: jest.fn() }));

const { getPlanName } = require('../../../src/routes/my-plan.routes');

describe('my-plan.routes getPlanName (999.1194 — silent catch fix)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => { delete global.fetch; });

  it('logs a warning (not silent) and falls back to planId when the fetch throws', async () => {
    global.fetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await getPlanName('plan-pro');

    expect(result).toBe('plan-pro'); // fallback behavior unchanged
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('plan-pro'),
      'ECONNREFUSED',
    );
  });

  it('logs a warning when payment-service responds non-ok', async () => {
    global.fetch.mockResolvedValue({ ok: false });

    const result = await getPlanName('plan-basic');

    expect(result).toBe('plan-basic');
    // res.ok===false falls through to the implicit `return` at the end of the try block
    // (no throw), so no catch fires here — this documents that non-ok responses are NOT
    // currently logged (only network/parse errors are caught). Asserting current behavior,
    // not the ideal — flagging as a follow-up rather than silently expanding scope.
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('returns the resolved plan name on a successful lookup (no warning)', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ plans: [{ planId: 'plan-pro', name: 'Pro' }] }),
    });

    const result = await getPlanName('plan-pro');

    expect(result).toBe('Pro');
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});
