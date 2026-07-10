/**
 * 999.1444 — STEP 0 (RED pre-fix)
 *
 * Bug: GeminiAIAdapter's constructor stores an injected `deps.client` but leaves
 * `_cachedApiKey = null` (GeminiAIAdapter.js lines 46-47). `_getClient()`'s API-key
 * branch (lines 92-99) compares `this._cachedApiKey === currentKey`; when the client
 * was injected, `_cachedApiKey` is `null`, so `null !== env.GEMINI_API_KEY` reads as
 * "key rotated" — the injected fake client is DISCARDED and a real `GoogleGenAI` is
 * built from the env key. This means unit tests that inject a fake client but run in a
 * jest process whose environment carries a real GEMINI_API_KEY silently make real LLM
 * calls.
 *
 * ── Fix contract (from Intake Brief, root_cause + spec_draft) ──────────────────────
 *   Track injection at construction time (`this._isInjectedClient = !!d.client`) and
 *   short-circuit `_getClient()`'s live-invalidation check for injected clients: an
 *   injected client must NEVER be discarded due to env.GEMINI_API_KEY changing —
 *   only env-BUILT clients (B8 contract, adapterLifecycle.test.js) rebuild on key
 *   rotation.
 *
 * ── What must FAIL against current code ─────────────────────────────────────────────
 *   999.1444-red: constructing the adapter with an injected fake client AND a
 *   real-looking env.GEMINI_API_KEY, then calling generate() — the fake client must
 *   be the one passed to trackedGeminiCall, and the real `@google/genai` SDK
 *   constructor (mocked here as MockGoogleGenAI) must NEVER be instantiated. On
 *   current code, `_getClient()`'s null-vs-real-key comparison discards the fake and
 *   builds a real client → MockGoogleGenAI IS instantiated → assertion fails → RED.
 *
 * ── What must stay GREEN (guard) ────────────────────────────────────────────────────
 *   999.1444-guard: env-BUILT clients (no injection) still rebuild on key rotation —
 *   this is the B8 contract (adapterLifecycle.test.js B8-red/B8-guard, lines 528-623),
 *   re-pinned minimally here so this fix does not regress it. The full contract is
 *   NOT duplicated — see adapterLifecycle.test.js for the exhaustive B8 suite.
 *
 * ── DETERMINISM ──────────────────────────────────────────────────────────────────────
 *   `@google/genai` is mocked at module level (jest.mock, hoisted) with a constructor-
 *   counting MockGoogleGenAI — identical pattern to adapterLifecycle.test.js B8 — so no
 *   real network call can occur even while this test is RED. `gemini-tracked-call` is
 *   also mocked so `generate()` never reaches a real SDK call surface. Fresh adapter
 *   module per test via jest.isolateModules (same pattern as B8) so `MockGoogleGenAI`
 *   call counts are not polluted by other test files sharing the module registry.
 *
 * ── TRACEABILITY ─────────────────────────────────────────────────────────────────────
 *   .planning/kermit/999-1444-fake-ai-client/TRACEABILITY.md — BUG-1444a
 */

'use strict';

process.env.NODE_ENV = 'test';

// ─────────────────────────────────────────────────────────────────────────────
// @google/genai mock (module-level so Jest can hoist it) — same pattern as
// adapterLifecycle.test.js B8. Captures instantiation calls so we can assert
// the real SDK constructor was never invoked when a client is injected.
// ─────────────────────────────────────────────────────────────────────────────
const mockGoogleGenAIInstances = [];
const MockGoogleGenAI = jest.fn().mockImplementation(function (opts) {
  this._opts = opts;
  mockGoogleGenAIInstances.push(this);
});

jest.mock('@google/genai', () => ({
  GoogleGenAI: MockGoogleGenAI,
}));

// gemini-tracked-call mocked so generate() never reaches the real SDK call
// surface, and so we can inspect which client instance was actually passed
// through to it (the injected fake vs a rebuilt real one).
const mockTrackedGeminiCall = jest.fn();
jest.mock('../../../src/slices/ai-enrichment/adapters/gemini-tracked-call', () => ({
  trackedGeminiCall: mockTrackedGeminiCall,
}));

const noopDb = () => ({ insert: async () => {} });

describe('999.1444 — injected client must be immutable across live-invalidation', () => {
  beforeEach(() => {
    MockGoogleGenAI.mockClear();
    mockGoogleGenAIInstances.length = 0;
    mockTrackedGeminiCall.mockReset();
    mockTrackedGeminiCall.mockResolvedValue({ text: 'ok' });
  });

  test(
    '999.1444-red [EXPECT-RED]: injected fake client is used by generate() even when env carries ' +
      'a real-looking GEMINI_API_KEY — the real GoogleGenAI SDK must NEVER be instantiated ' +
      '(currently: injected client is discarded and a real GoogleGenAI is built from the env key)',
    async () => {
      const GeminiAIAdapter = await new Promise((resolve) => {
        jest.isolateModules(() => {
          const A = require('../../../src/slices/ai-enrichment/adapters/GeminiAIAdapter');
          resolve(A);
        });
      });

      const fakeClient = {
        __fake: true,
        models: { generateContent: async () => ({ text: 'fake-result' }) },
      };
      const env = {
        GEMINI_API_KEY: 'real-looking-key-abc123',
        USE_VERTEX_AI: 'false',
        GOOGLE_CLOUD_PROJECT: '',
      };

      const adapter = new GeminiAIAdapter({ client: fakeClient, env, db: noopDb });

      await adapter.generate('hello', {}, {});

      // Assert 1: trackedGeminiCall must have received the INJECTED fake client —
      // not a rebuilt real GoogleGenAI instance.
      expect(mockTrackedGeminiCall).toHaveBeenCalledTimes(1);
      const clientArgPassed = mockTrackedGeminiCall.mock.calls[0][1];
      expect(clientArgPassed).toBe(fakeClient);

      // Assert 2: the real @google/genai SDK constructor must NEVER be called when a
      // client was injected — a real network-capable client must not be built.
      //
      // On current code: constructor stores fakeClient but _cachedApiKey stays null;
      // _getClient()'s API-key branch compares `this._cachedApiKey === currentKey`
      // → null !== 'real-looking-key-abc123' → reads as "key rotated" → discards
      // fakeClient → builds a REAL GoogleGenAI from env.GEMINI_API_KEY →
      // MockGoogleGenAI IS instantiated → this assertion FAILS → RED.
      expect(MockGoogleGenAI).not.toHaveBeenCalled();
    }
  );

  test(
    '999.1444-guard [GUARD-GREEN]: env-BUILT client (no injection) still rebuilds on key rotation ' +
      '(B8 contract minimal re-pin — full exhaustive contract lives in adapterLifecycle.test.js B8)',
    () => {
      const env = { GEMINI_API_KEY: 'key-v1', USE_VERTEX_AI: 'false', GOOGLE_CLOUD_PROJECT: '' };
      const RequireFreshAdapter = () => {
        let A;
        jest.isolateModules(() => {
          A = require('../../../src/slices/ai-enrichment/adapters/GeminiAIAdapter');
        });
        return A;
      };
      const GeminiAIAdapter = RequireFreshAdapter();
      const adapter = new GeminiAIAdapter({ env, db: noopDb }); // no client injected

      const c1 = adapter._getClient();
      expect(MockGoogleGenAI).toHaveBeenCalledTimes(1);

      env.GEMINI_API_KEY = 'key-v2'; // simulate key rotation
      const c2 = adapter._getClient();

      expect(MockGoogleGenAI).toHaveBeenCalledTimes(2); // rebuilt — env-BUILT clients still rotate
      expect(c2).not.toBe(c1);
    }
  );
});
