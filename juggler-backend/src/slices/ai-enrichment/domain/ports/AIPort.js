/**
 * AIPort — driven-port contract for the LLM provider (Phase H5).
 *
 * Formalizes the Gemini provider seam currently `new`'d inline in TWO places
 * (`controllers/ai.controller.js` getGenAIClient + `routes/task.routes.js`
 * /suggest-icon). The adapter (`GeminiAIAdapter`) ABSORBS the `@google/genai`
 * SDK + the Vertex/API-key instantiation branch; this port is the contract the
 * call-sites program against. Test-doubled by `MockAIAdapter`.
 *
 * ── BINDING INVARIANT (CLAUDE.md §AI Enrichment, KG juggler_ai_enrichment) ────
 * The provider SDK is wrapped behind THIS port — never instantiated in a
 * controller/route. (Exit gate: `grep GoogleGenAI src/controllers src/routes` → 0.)
 *
 * ── BEHAVIOR-IDENTICAL (H5 refactor contract) ────────────────────────────────
 * `generate` returns the RAW provider result object (the `@google/genai`
 * `generateContent` response: `{ text?, candidates?, usageMetadata? }`) exactly as
 * the legacy `trackedGeminiCall` returned it — the call-sites keep their own
 * result extraction (controller joins parts + throws-on-neither; route validates
 * emoji + null-on-error). Usage tracking (ai_usage_outbox enqueue) stays inside the
 * call, identical to legacy. Model is the adapter's configured `GEMINI_MODEL`.
 *
 * Contract only — JSDoc `@typedef` + throw-not-implemented base.
 *
 * @typedef {Object} AIPort
 * @property {(contents: string, config: object, meta: { useCase: string, userId?: string|null, correlationId?: string|null }) => Promise<{text?: string, candidates?: any[], usageMetadata?: object}>} generate
 */

'use strict';

const AI_PORT_METHODS = ['generate'];

/**
 * Base AIPort — every method throws until an adapter overrides it.
 * @returns {AIPort}
 */
function AIPort() {}
AIPort.prototype.generate = async function generate() {
  throw new Error('AIPort.generate not implemented');
};

module.exports = { AIPort, AI_PORT_METHODS };
