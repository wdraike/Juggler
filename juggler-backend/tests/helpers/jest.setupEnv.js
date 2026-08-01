/**
 * jest `setupFiles` entry — loads .env.test into process.env BEFORE any test
 * file's own top-level `require`s run.
 *
 * 999.1037 root cause: a test file that requires a production DB-backed
 * module (e.g. a controller) ABOVE its own `require('./helpers/test-setup')`
 * triggers src/lib/db/index.js's eager, process-wide getDefaultDb() singleton
 * BEFORE test-setup.js's require('dotenv').config({path: '.env.test'}) call
 * ever runs. The singleton then permanently caches DB_PASSWORD='' (unset) —
 * this jest process's mysql2 connections silently authenticate with NO
 * password for the rest of the run, producing MySQL's own access-denied
 * error ("user 'root'@'<client-ip-as-seen-by-the-docker-mysql-server>',
 * using password: NO") — which reads like a wrong host, but is actually a
 * dropped password. `setupFiles` runs before the test framework/test file is
 * even required, so this guarantees .env.test wins the race regardless of
 * what a given test file requires in what order. dotenv.config() never
 * overrides an already-set process.env var, so an explicit shell export
 * (e.g. `DB_PORT=3407 jest`) still takes precedence.
 */
'use strict';
var path = require('path');

// Pin the clock zone BEFORE anything constructs a Date (999.5065).
//
// The cal-sync golden masters were recorded on a dev machine in
// America/New_York and encode that offset literally: W4's golden holds
// date "2026-06-02" / time "12:00 AM", while the SAME instant renders as
// "2026-06-01" / "8:00 PM" under UTC. CI runs UTC, so those suites could
// never match the golden there — they failed only in CI Nightly (the one gate
// that runs tests/cal-sync at all; run-suite.sh's IGNORE list keeps them out
// of the pool and pre-push) and passed on every developer's machine.
// Reproduced exactly by running the suite locally with TZ=UTC.
//
// Pinning makes the dependency EXPLICIT and the suites deterministic on any
// host. It does not paper over a product bug: the sync layer formatting event
// times in the SERVER's zone rather than the task owner's is a real question,
// but characterization tests exist to freeze current behaviour, not to change
// it — that belongs in its own ticket, not in a CI-recovery fix.
// An explicit shell TZ still wins, so a deliberate `TZ=UTC jest` run can still
// probe the other zone.
if (!process.env.TZ) {
  process.env.TZ = 'America/New_York';
}

require('dotenv').config({ path: path.join(__dirname, '../../.env.test') });

// 999.1444: scrub AI-call env after the .env.test load so NO jest process can
// lazily build a real GoogleGenAI client regardless of what .env.test or the
// shell carries. Tests that need a key/Vertex flag set their own fake env
// (e.g. goldenMaster.h5.test.js sets 'test-api-key-init' when absent;
// adapterLifecycle.test.js injects its own env objects via deps.env).
delete process.env.GEMINI_API_KEY;
delete process.env.USE_VERTEX_AI;
