// Jest setup — close open connections after all tests in each worker
afterAll(async function() {
  try { require('../../src/lib/redis').quit(); } catch (e) {}
  try { await require('../../src/db').destroy(); } catch (e) {}
});
