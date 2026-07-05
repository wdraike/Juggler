/**
 * Unit tests for juggler-backend/src/mcp/api-key-auth.js — WI-4 (devmcp leg).
 *
 * Covers the apiKeyValidator contract in isolation: introspection via
 * auth-service (WI-2's endpoint), entitlement via payment-service's existing
 * `/internal/users/:userId/entitlement` endpoint, and every failure mode
 * collapsing to `return null` (fail closed).
 *
 * The service-to-service HTTP boundary (`vendor/service-auth`'s
 * initServiceAuth/serviceRequest) is mocked — this test exercises only
 * api-key-auth.js's own decision logic.
 */

'use strict';

var mockInitServiceAuth = jest.fn();
var mockServiceRequest = jest.fn();

jest.mock('../../vendor/service-auth', function () {
  return {
    initServiceAuth: mockInitServiceAuth,
    serviceRequest: mockServiceRequest
  };
});

var apiKeyAuth; // required fresh per test via jest.resetModules to reset module-level init cache

function loadFresh() {
  jest.resetModules();
  mockInitServiceAuth.mockReset();
  mockServiceRequest.mockReset();
  mockInitServiceAuth.mockResolvedValue(undefined);
  // Re-require the module-under-test AND its mocked dependency (jest.resetModules
  // clears the require cache, so the mock factory above is re-invoked automatically
  // for `../../vendor/service-auth` — the fn references above stay the same jest.fn()
  // instances because jest hoists jest.mock factories once per file, but resetModules
  // still needs the mock re-registered for the fresh module registry).
  jest.mock('../../vendor/service-auth', function () {
    return {
      initServiceAuth: mockInitServiceAuth,
      serviceRequest: mockServiceRequest
    };
  });
  apiKeyAuth = require('../../src/mcp/api-key-auth');
}

beforeEach(function () {
  loadFresh();
});

describe('apiKeyValidator', function () {
  test('no token → null', async function () {
    var result = await apiKeyAuth.apiKeyValidator(null);
    expect(result).toBeNull();
    expect(mockServiceRequest).not.toHaveBeenCalled();
  });

  test('valid key + entitled user → authResult-shaped object with plans[APP_ID] truthy', async function () {
    mockServiceRequest.mockImplementation(function (target, path) {
      if (target === 'auth-service') {
        expect(path).toBe('/internal/api-keys/introspect');
        return Promise.resolve({ valid: true, user_id: 'user-123', key_type: 'mcp' });
      }
      if (target === 'payment-service') {
        expect(path).toBe('/internal/users/user-123/entitlement?product=juggler');
        return Promise.resolve({ success: true, entitlement: { entitled: true, productSlug: 'juggler', statuses: ['active'] } });
      }
      throw new Error('unexpected target: ' + target);
    });

    var result = await apiKeyAuth.apiKeyValidator('mcp_live_abc123');

    expect(result).toMatchObject({
      userId: 'user-123',
      authServiceId: 'user-123',
      keyId: 'apikey:user-123'
    });
    expect(result.plans.juggler).toBeTruthy();
    expect(mockServiceRequest).toHaveBeenCalledTimes(2);
  });

  test('valid key + NOT entitled → null (no double entitlement call, fails closed)', async function () {
    mockServiceRequest.mockImplementation(function (target) {
      if (target === 'auth-service') {
        return Promise.resolve({ valid: true, user_id: 'user-456', key_type: 'mcp' });
      }
      if (target === 'payment-service') {
        return Promise.resolve({ success: true, entitlement: { entitled: false, productSlug: 'juggler', statuses: [] } });
      }
      throw new Error('unexpected target');
    });

    var result = await apiKeyAuth.apiKeyValidator('mcp_live_notentitled');

    expect(result).toBeNull();
  });

  test('invalid key (introspection valid:false) → null, no entitlement call made', async function () {
    mockServiceRequest.mockImplementation(function (target) {
      if (target === 'auth-service') {
        return Promise.resolve({ valid: false });
      }
      throw new Error('payment-service should not be called for an invalid key');
    });

    var result = await apiKeyAuth.apiKeyValidator('not-a-real-key');

    expect(result).toBeNull();
    expect(mockServiceRequest).toHaveBeenCalledTimes(1);
  });

  test('wrong key_type (e.g. a non-MCP key) → null', async function () {
    mockServiceRequest.mockImplementation(function (target) {
      if (target === 'auth-service') {
        return Promise.resolve({ valid: true, user_id: 'user-789', key_type: 'other' });
      }
      throw new Error('payment-service should not be called for a wrong key_type');
    });

    var result = await apiKeyAuth.apiKeyValidator('some-other-key');

    expect(result).toBeNull();
    expect(mockServiceRequest).toHaveBeenCalledTimes(1);
  });

  test('auth-service introspection call throws (e.g. network error) → null (fail closed)', async function () {
    mockServiceRequest.mockImplementation(function (target) {
      if (target === 'auth-service') return Promise.reject(new Error('ECONNREFUSED'));
      throw new Error('should not reach payment-service');
    });

    var result = await apiKeyAuth.apiKeyValidator('mcp_live_whenauthdown');

    expect(result).toBeNull();
  });

  test('payment-service entitlement call throws → null (fail closed, not a crash)', async function () {
    mockServiceRequest.mockImplementation(function (target) {
      if (target === 'auth-service') {
        return Promise.resolve({ valid: true, user_id: 'user-999', key_type: 'mcp' });
      }
      if (target === 'payment-service') return Promise.reject(new Error('ECONNREFUSED'));
      throw new Error('unexpected target');
    });

    var result = await apiKeyAuth.apiKeyValidator('mcp_live_whenpaymentdown');

    expect(result).toBeNull();
  });

  test('service auth fails to initialize → null (fail closed, never calls serviceRequest)', async function () {
    mockInitServiceAuth.mockRejectedValue(new Error('no SERVICE_RSA_PRIVATE_KEY'));

    var result = await apiKeyAuth.apiKeyValidator('mcp_live_whateverkey');

    expect(result).toBeNull();
    expect(mockServiceRequest).not.toHaveBeenCalled();
  });

  test('service auth init fails once (transient) then succeeds → retried on next call, not permanently failed (ernie WARN-1)', async function () {
    // First call: initServiceAuth rejects (e.g. transient network issue at boot).
    mockInitServiceAuth.mockRejectedValueOnce(new Error('transient ECONNREFUSED'));

    var first = await apiKeyAuth.apiKeyValidator('mcp_live_retrykey');
    expect(first).toBeNull(); // fail-closed, as today
    expect(mockServiceRequest).not.toHaveBeenCalled();

    // Second call: initServiceAuth now succeeds (dependency recovered).
    mockInitServiceAuth.mockResolvedValue(undefined);
    mockServiceRequest.mockImplementation(function (target) {
      if (target === 'auth-service') {
        return Promise.resolve({ valid: true, user_id: 'user-retry', key_type: 'mcp' });
      }
      if (target === 'payment-service') {
        return Promise.resolve({ success: true, entitlement: { entitled: true, productSlug: 'juggler', statuses: ['active'] } });
      }
      throw new Error('unexpected target: ' + target);
    });

    var second = await apiKeyAuth.apiKeyValidator('mcp_live_retrykey');

    // The permanent-memoization bug would return null here forever;
    // the fix must retry initServiceAuth and succeed once it recovers.
    expect(second).not.toBeNull();
    expect(second.userId).toBe('user-retry');
    expect(mockInitServiceAuth).toHaveBeenCalledTimes(2);
  });
});
