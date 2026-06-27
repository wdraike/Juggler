// @covers none (MCP backend integration, not a UI surface)
const { test, expect } = require('@playwright/test');

test.describe('999.190 — MCP endpoint smoke', () => {
  test('MCP endpoint returns 405 (no auth)', async ({ request }) => {
    const resp = await request.get('http://localhost:5002/mcp');
    expect(resp.status()).toBe(405);
  });
});
