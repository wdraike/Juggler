/**
 * ai-enrichment slice facade — the ONLY public entry point (Phase H5).
 *
 * Wires adapters → ports: a single lazily-built GeminiAIAdapter (the consolidated
 * `@google/genai` provider seam, over lib/db) + a KnexAIUsageRepository (the daily
 * AI-command quota, over lib/db). Exposes ONE method per operation the two legacy
 * SDK-leak call-sites need:
 *   - `generate(contents, config, meta)` → AIPort: the raw provider result. Used by
 *     `ai.controller.handleCommand` (TASK_AI) and `task.routes /suggest-icon`
 *     (EMOJI_SUGGEST). The call-sites keep their own result extraction/validation.
 *   - `checkAndLogDailyQuota(userId)` → AIUsagePort: the 50/day quota gate, used by
 *     `handleCommand`.
 *
 * Mirrors the user-config / task slice facade wiring idiom (the per-slice facade).
 *
 * ── REFACTOR MODE — NO BEHAVIOR CHANGE (W1/W2) ───────────────────────────────
 * Every method reproduces the legacy behavior step-for-step; the provider client
 * is built once + cached exactly as `getGenAIClient`. (The 8s AbortController
 * timeout is added in W3, isolated.) The slice imports no `src/db.js`.
 *
 * ── SCOPE (human-approved LIGHT H5) ──────────────────────────────────────────
 * No `Enrichment`/`UserOverride` entities or repository — that persistence does
 * not exist in the codebase; building it would be a separate `new` feature.
 */

'use strict';

const GeminiAIAdapter = require('./adapters/GeminiAIAdapter');
const KnexAIUsageRepository = require('./adapters/KnexAIUsageRepository');

// Lazy singletons — built on first use so requiring the facade never touches the
// SDK or the DB pool at import time (mirrors getGenAIClient's lazy instantiation).
let _ai = null;
let _usage = null;

function ai() {
  if (!_ai) _ai = new GeminiAIAdapter();
  return _ai;
}
function usage() {
  if (!_usage) _usage = new KnexAIUsageRepository();
  return _usage;
}

module.exports = {
  /** @see AIPort.generate */
  generate(contents, config, meta) {
    return ai().generate(contents, config, meta);
  },
  /** @see AIUsagePort.checkAndLogDailyQuota */
  checkAndLogDailyQuota(userId) {
    return usage().checkAndLogDailyQuota(userId);
  },
  AI_DAILY_LIMIT: KnexAIUsageRepository.AI_DAILY_LIMIT,
  // exposed for tests / explicit DI
  GeminiAIAdapter,
  KnexAIUsageRepository,
  MockAIAdapter: require('./adapters/MockAIAdapter'),
  _setAdapters({ aiAdapter, usageRepo } = {}) {
    // Explicit undefined means "do not touch"; explicit null means "reset to lazy-build".
    if (aiAdapter !== undefined) _ai = aiAdapter;
    if (usageRepo !== undefined) _usage = usageRepo;
  },
  /** Full reset — sets both singletons back to null (lazy-rebuild on next call). */
  _reset() { _ai = null; _usage = null; },
};
