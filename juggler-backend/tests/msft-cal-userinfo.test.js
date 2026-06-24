/**
 * 999.859 — capture the connected Microsoft account's identity so the Calendar
 * Sync modal shows the MS account, not the local Raike account email.
 * Unit-tests the Graph /me extraction (no DB, mocked fetch).
 */
process.env.NODE_ENV = 'test';

var msftCalApi = require('../src/lib/msft-cal-api');

function mockGraph(payload, ok) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: ok !== false,
    status: ok === false ? 500 : 200,
    json: function() { return Promise.resolve(payload); },
    text: function() { return Promise.resolve(JSON.stringify(payload)); }
  });
}

afterEach(function() { delete global.fetch; });

test('getUserInfo returns the account mail when present', async function() {
  mockGraph({ mail: 'wdraike@outlook.com', userPrincipalName: 'wdraike@contoso.onmicrosoft.com' });
  var info = await msftCalApi.getUserInfo('tok');
  expect(info.email).toBe('wdraike@outlook.com');
  // hit the Graph /me endpoint
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/me'), expect.any(Object));
});

test('getUserInfo falls back to userPrincipalName when mail is null', async function() {
  mockGraph({ mail: null, userPrincipalName: 'wdraike@contoso.onmicrosoft.com' });
  var info = await msftCalApi.getUserInfo('tok');
  expect(info.email).toBe('wdraike@contoso.onmicrosoft.com');
});

test('getUserInfo returns null email when Graph gives neither', async function() {
  mockGraph({ id: '123' });
  var info = await msftCalApi.getUserInfo('tok');
  expect(info.email).toBeNull();
});
