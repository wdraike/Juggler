'use strict';

/**
 * 999.1576 inc.4 — arm the sandbox-scoped audit test-default actor.
 *
 * Registered via jest `setupFilesAfterEnv`, so it runs once inside EVERY test
 * file's sandbox (fresh module registry per file) before the file's own
 * top-level code. audit-context.getActor() then resolves: real ALS store →
 * this armed 'jest' default → throw. Purely synchronous module state — no
 * AsyncLocalStorage propagation, which is what makes it deterministic under
 * jest's sequencer where the three disproven ALS mechanisms were not
 * (inc.4b findings, 999.1576).
 *
 * This is the APPROVED test-only fallback (David sign-off 2026-07-19),
 * documented in juggler/CLAUDE.md "Approved Fallbacks". Production never
 * arms it — _armTestDefaultActor throws outside a jest sandbox.
 *
 * Tests that assert production no-actor behavior (throws) use
 * _runWithoutActor (default-suppressing zone) or _disarmTestDefaultActor.
 */

// NOTE: test-helpers/ is a SYMLINK to tests/helpers/ — jest realpaths this
// file, so relative requires resolve from tests/helpers/ (two levels deep).
require('../../src/lib/audit-context')._armTestDefaultActor('jest');
