/**
 * ai-usage-flusher-first-tick-actor.test.js — 999.1576 inc.4a (strict-flip
 * precondition: timer-spawned writers carry an audit actor).
 *
 * AiUsageFlusher.start() schedules TWO timers: the recurring interval (already
 * wrapped in runWithActor('ai-usage-flusher') — inc.3b) and an immediate
 * first-tick setTimeout(5s) which was left UNwrapped. start() is called from
 * server boot — outside any ALS context. _tick's current writes are raw knex
 * (delete/increment — they never call the stampers), so this wrap is
 * consistency/defense: it guarantees the flusher identity for any stamped
 * write reachable from _tick now or later, matching the interval's inc.3b
 * wrap. Pin: BOTH timers run _tick under the 'ai-usage-flusher' actor.
 */

const { AiUsageFlusher } = require('../../src/slices/ai-enrichment/adapters/ai-usage-flusher.service');
const { peekActor } = require('../../src/lib/audit-context');

const makeFlusher = () => new AiUsageFlusher({
  db: () => ({}),
  billingUrl: 'http://billing:5020',
  serviceKey: 'test-key',
  sourceApp: 'juggler',
});

describe('AiUsageFlusher.start() timer actor attribution (999.1576 inc.4a)', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('immediate first tick (5s setTimeout) runs under ai-usage-flusher actor', async () => {
    const flusher = makeFlusher();
    const seen = [];
    flusher._tick = async () => { seen.push(peekActor()); };

    flusher.start();
    jest.advanceTimersByTime(5000);
    await Promise.resolve(); // drain the tick's microtasks
    flusher.stop();

    expect(seen).toEqual(['ai-usage-flusher']);
  });

  test('recurring interval tick runs under ai-usage-flusher actor (inc.3b pin)', async () => {
    const flusher = makeFlusher();
    const seen = [];
    flusher._tick = async () => { seen.push(peekActor()); };

    flusher.start();
    jest.advanceTimersByTime(60_000); // ≥ INTERVAL_MS fires the interval at least once
    await Promise.resolve();
    flusher.stop();

    expect(seen.length).toBeGreaterThanOrEqual(1);
    seen.forEach((actor) => expect(actor).toBe('ai-usage-flusher'));
  });
});
