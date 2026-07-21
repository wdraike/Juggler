/**
 * 999.2159 — scheduleQueue._drainForTests: awaitable in-flight run barrier.
 *
 * Root cause pinned by this suite: _resetForTests() clears the _running map
 * WITHOUT awaiting the promises inside it, so an in-flight claimAndRun kept
 * mutating task_instances/users into the NEXT test/describe/file. Observed as
 * three flake faces in tests/scheduler/rollingRecurrence.test.js: FK violation
 * (users row deleted under a live run), 404 on markInstanceStatus (instance
 * re-fabricated under the test), and 5s beforeAll hook timeouts under host
 * load (clearAll DELETE waiting on locks held by a leaked run).
 *
 * _drainForTests(timeoutMs) must:
 *   1. resolve only after every tracked in-flight run settles,
 *   2. resolve { timedOut: true } after the cap when a run never settles
 *      (teardown must never hang forever on a wedged run),
 *   3. resolve immediately with { drained: 0 } when nothing is in flight.
 */

const scheduleQueue = require('../../../src/scheduler/scheduleQueue');

afterEach(() => {
  scheduleQueue._resetForTests();
});

test('drain waits for an in-flight run to settle before resolving', async () => {
  let settled = false;
  let release;
  const run = new Promise((resolve) => { release = resolve; });
  run.then(() => { settled = true; });
  scheduleQueue._running.set('drain-user-1', run);

  const drainP = scheduleQueue._drainForTests(5000);
  setTimeout(() => release({ ran: true }), 50);
  const result = await drainP;

  expect(settled).toBe(true);
  expect(result.drained).toBe(1);
  expect(result.timedOut).toBe(false);
});

test('drain resolves timedOut after the cap when a run never settles', async () => {
  scheduleQueue._running.set('drain-user-wedged', new Promise(() => {}));

  const result = await scheduleQueue._drainForTests(100);

  expect(result.timedOut).toBe(true);
});

test('drain resolves immediately when nothing is in flight', async () => {
  const result = await scheduleQueue._drainForTests(5000);
  expect(result).toEqual({ drained: 0, timedOut: false });
});

test('a rejected in-flight run still settles the drain (allSettled semantics)', async () => {
  const run = Promise.reject(new Error('scheduler blew up'));
  run.catch(() => {}); // parked rejection — drain must still count it
  scheduleQueue._running.set('drain-user-reject', run);

  const result = await scheduleQueue._drainForTests(5000);

  expect(result.drained).toBe(1);
  expect(result.timedOut).toBe(false);
});
