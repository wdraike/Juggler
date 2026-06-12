/**
 * GeminiAIAdapter — the ONLY place the `@google/genai` SDK is instantiated
 * (Phase H5). Implements `AIPort`. Consolidates the Vertex-AI / API-key client
 * factory that was DUPLICATED in `ai.controller.getGenAIClient` and the
 * `task.routes /suggest-icon` handler, and routes the usage-telemetry enqueue
 * through `lib/db` (ADR-0002) instead of the `src/db.js` singleton.
 *
 * ── CONNECTION (ADR-0002 — lib/db, NOT src/db.js) ────────────────────────────
 * The `db` handed to `trackedGeminiCall` (for the ai_usage_outbox enqueue) is
 * `lib/db`'s shared pool via `getDefaultDb()` — the SAME pool src/db.js re-exports,
 * so behavior is identical; the slice simply no longer imports `src/db.js`.
 * Injectable for tests.
 *
 * ── BEHAVIOR-IDENTICAL (H5 refactor — W1) ────────────────────────────────────
 * Client instantiation reproduces `getGenAIClient` step-for-step: Vertex branch
 * (`USE_VERTEX_AI=true`, requires GOOGLE_CLOUD_PROJECT — else throws the same
 * 'GOOGLE_CLOUD_PROJECT required for Vertex AI') vs API-key branch (requires
 * GEMINI_API_KEY — else throws 'GEMINI_API_KEY not configured'); the client is
 * lazily built once and cached. `generate` returns the raw provider result exactly
 * as `trackedGeminiCall` did. **No timeout here — W1 is behavior-identical; the 8s
 * AbortController timeout is added in W3 (isolated).**
 */

'use strict';

const { trackedGeminiCall } = require('../../../services/gemini-tracked-call');
const { createLogger } = require('@raike/lib-logger');

// Default AI call budget. Read process.env at construction time (not module load)
// so tests that set process.env.AI_CALL_TIMEOUT_MS before instantiation via
// jest.isolateModules() get the right budget without needing --resetModules.
// trackedGeminiCall owns the AbortController + Promise.race timeout (W1a fix).
const DEFAULT_AI_CALL_TIMEOUT_MS = 45000; // 45s; override via AI_CALL_TIMEOUT_MS env

/**
 * @param {object} [deps]
 * @param {object}   [deps.client]   pre-built `@google/genai` client (tests inject a fake)
 * @param {Function} [deps.db]       knex handle (default: lib/db getDefaultDb())
 * @param {string}   [deps.model]    model name (default: env GEMINI_MODEL)
 * @param {object}   [deps.env]      env override (default: process.env)
 * @param {object}   [deps.logger]   logger (default: createLogger('ai-enrichment'))
 */
function GeminiAIAdapter(deps) {
  const d = deps || {};
  const env = d.env || process.env;
  this._client = d.client || null; // lazily built if not injected
  this._cachedApiKey = null;       // B8: snapshot of the key used to build the current client
  this.model = d.model || env.GEMINI_MODEL || 'gemini-2.5-flash';
  this._env = env;
  // Read AI_CALL_TIMEOUT_MS from env at construction time so an injected env object
  // (tests) or process.env override takes effect without reloading the module.
  const envBudget = env.AI_CALL_TIMEOUT_MS ? parseInt(env.AI_CALL_TIMEOUT_MS, 10) : DEFAULT_AI_CALL_TIMEOUT_MS;
  this.timeoutMs = typeof d.timeoutMs === 'number' ? d.timeoutMs : envBudget;
  this.logger = d.logger || createLogger('ai-enrichment');
  // DB handle: injected (tests/DI) or eagerly resolved from lib/db.
  // Real validation of DB config now lives in facade.init() (B9 boot hook) —
  // the constructor no longer validates NODE_ENV via a string allowlist (that was
  // the wrong check: it tested a string, not actual db-config resolution).
  if (d.db) {
    this._db = d.db;
  } else {
    this._db = require('../../../lib/db').getDefaultDb();
  }
}

GeminiAIAdapter.prototype._getDb = function _getDb() {
  if (!this._db) this._db = require('../../../lib/db').getDefaultDb();
  return this._db;
};

// Consolidated from getGenAIClient (ai.controller) + the /suggest-icon route —
// identical branch + identical thrown errors.
//
// B8 (live-invalidation): stores this._cachedApiKey at the time the client is built.
// On each call, if GEMINI_API_KEY has changed since the last build, the cached client
// is discarded and rebuilt with the new key. Vertex AI branch is key-less (project-keyed)
// and does not apply the live-invalidation logic.
GeminiAIAdapter.prototype._getClient = function _getClient() {
  const { GoogleGenAI } = require('@google/genai');
  const env = this._env;

  if (env.USE_VERTEX_AI === 'true') {
    // Vertex AI path: keyed by project, not an API key. Cache for the lifetime
    // of the adapter (project changes require a restart, same as the original code).
    if (this._client) return this._client;
    const project = env.GOOGLE_CLOUD_PROJECT;
    const location = env.VERTEX_AI_LOCATION || 'us-central1';
    if (!project) throw new Error('GOOGLE_CLOUD_PROJECT required for Vertex AI');
    this._client = new GoogleGenAI({ vertexai: true, project, location });
    this.logger.info('🤖 Juggler AI: Using Vertex AI (project:', project + ')');
  } else {
    // API-key path: live-invalidation — if the key changed, discard the cached client.
    const currentKey = env.GEMINI_API_KEY || '';
    if (this._client && this._cachedApiKey === currentKey) return this._client;
    if (!currentKey) throw new Error('GEMINI_API_KEY not configured');
    this._client = null; // discard stale client before rebuild
    this._client = new GoogleGenAI({ apiKey: currentKey });
    this._cachedApiKey = currentKey;
    this.logger.info('🤖 Juggler AI: Using Gemini API with API key');
  }

  return this._client;
};

/**
 * isConfigured() — returns true when the adapter has enough env config to make a call.
 *
 * B6 (not-configured no-log): callers that want a silent no-op on an AI-disabled deploy
 * should check this before calling generate(). generate() itself also checks this and
 * returns {} (no throw, no error log) when not configured.
 */
GeminiAIAdapter.prototype.isConfigured = function isConfigured() {
  const env = this._env;
  if (this._client) return true; // injected or already built
  if (env.USE_VERTEX_AI === 'true') return !!(env.GOOGLE_CLOUD_PROJECT);
  return !!(env.GEMINI_API_KEY);
};

/**
 * @implements AIPort.generate
 * Returns the raw provider result (`{text?, candidates?, usageMetadata?}`).
 *
 * B6 (not-configured no-log): when the adapter is not configured (no API key / no
 * Vertex project), generate() returns {} instead of throwing. This allows callers like
 * /suggest-icon to map the empty result to {icon:null} without logging an error — an
 * AI-disabled deploy is a CLEAN, expected state, not an error condition.
 *
 * W1a: timeout + AbortController now live in trackedGeminiCall (not here).
 * The adapter passes its timeoutMs via meta so tests injecting `timeoutMs: 40`
 * still get the right deadline. trackedGeminiCall handles the AbortController,
 * Promise.race, signal injection into the SDK call, and telemetry separation.
 */
GeminiAIAdapter.prototype.generate = async function generate(contents, config, meta) {
  // B6: not-configured is a clean expected state — return empty result, no throw.
  // Only suppress the specific "not configured" signals; real errors propagate normally.
  if (!this.isConfigured()) {
    return {};
  }
  const metaWithTimeout = Object.assign({}, meta || {}, { timeoutMs: this.timeoutMs });
  return trackedGeminiCall(
    this._getDb(), this._getClient(), this.model, contents, config, metaWithTimeout
  );
};

module.exports = GeminiAIAdapter;
