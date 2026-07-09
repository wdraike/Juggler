/**
 * juggler-mcp jest harness (999.1210).
 *
 * Pure unit harness — no DB, no network: tests mock the MCP SDK subpaths and
 * global.fetch, so `npm test` runs standalone inside this package (the CI
 * entry point the deep-review flagged as missing).
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js']
};
