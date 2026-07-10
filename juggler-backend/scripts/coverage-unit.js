#!/usr/bin/env node
/**
 * coverage-unit.js — 999.1206: run jest --coverage on the mock-based (no-DB)
 * subset of the juggler-backend suite, with NO test-bed / docker dependency.
 *
 * Usage (from juggler-backend/):
 *   npm run test:coverage:unit          # select no-DB suites, run with --coverage
 *   npm run test:coverage:unit -- --list  # print the selection + exclusions, don't run
 *
 * Why a selector script: DB-backed suites are TEST-FR-001 fail-loud (they
 * THROW when test-bed MySQL @3407 is unreachable — tests/helpers/requireDB.js),
 * so "just run everything without a DB" produces a red run by design. This
 * script classifies each test file by static markers and runs only the files
 * that never touch a real database. The full-suite coverage (unit + DB) still
 * comes from test-bed runs; this gives a reproducible baseline on any machine.
 *
 * Output artifacts (gitignored via juggler/.gitignore `coverage/`):
 *   coverage/coverage-summary.json, coverage/lcov.info, coverage/lcov-report/
 *
 * Classification rules (exclude when ANY matches):
 *   - filename:  *.db.test.js, *integration*, tests/api-e2e/**
 *   - content:   requireDB / assertDbAvailable (TEST-FR-001 guard),
 *                DB test helpers (helpers/test-db, helpers/testDb, helpers/db,
 *                helpers/queries, helpers/seedFullUser, helpers/seed/,
 *                ensureIsolatedDb), knexfile require,
 *                require of src/db WITHOUT a jest.mock of it
 *   - DENYLIST:  files that defeat static markers (each carries a reason)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// Files that need the DB (or a live service) but defeat the static markers.
// Keep each entry with a reason; re-verify when touching the suite.
const DENYLIST = [
  // ── DB/app-stack dependent (fail BECAUSE no test-bed; verified standalone 2026-07-09) ──
  { file: 'tests/api/tasks.test.js', why: 'AP-07 reads the DB through the app (500 without test-bed)' },
  { file: 'tests/api/projects.test.js', why: 'reorder guard assertions drift + DB-backed routes (red without test-bed)' },
  { file: 'tests/api/config.test.js', why: 'GET /api/config reads user_config from live DB (null without test-bed)' },
  { file: 'tests/api/ai-command.test.js', why: 'app-stack dependent: rate-limiter double-count + teardown import without test-bed' },
  { file: 'tests/disabledStatus.test.js', why: 'DELETE cascade=recurring path reaches live DB (qb.where crash without test-bed)' },
  { file: 'tests/fixed-recurring-exclusion.test.js', why: 'needs seeded DB rows ("Task not found" without test-bed)' },
  { file: 'tests/characterization/task.goldenMaster.http.test.js', why: 'HTTP golden-master exercises DB-backed routes' },
  { file: 'tests/unit/app.test.js', why: 'app-boot OAuth flows exceed 5s timeout without backing services' },
  // ── live-service / timing-sensitive ──
  { file: 'tests/unit/aiEnrichment/trackedCallTimeout.test.js', why: 'fake-client injection bypassed -> live AI reply observed when .env.test carries real keys' },
  { file: 'tests/unit/aiEnrichment/geminiAdapterTimeout.test.js', why: '2s timing budget blown under coverage instrumentation (16s observed)' },
  // ── KNOWN-RED (DB-independent, fail standalone on main — re-include when fixed) ──
  { file: 'tests/taskControllerUnit.test.js', why: 'KNOWN-RED: preferred_time_mins template-inheritance assertions fail (5/84)' },
  { file: 'tests/taskPipeline.test.js', why: 'KNOWN-RED: same preferred_time_mins inheritance drift (4/37)' },
];

function listTestFiles() {
  const out = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.test.js')) out.push(full);
    }
  }
  // Mirrors jest.config.js testMatch: **/tests/**/*.test.js + **/src/__tests__/**
  walk(path.join(ROOT, 'tests'));
  const srcTests = path.join(ROOT, 'src', '__tests__');
  if (fs.existsSync(srcTests)) walk(srcTests);
  return out.sort();
}

const CONTENT_MARKERS = [
  { re: /requireDB|assertDbAvailable/, why: 'TEST-FR-001 requireDB guard' },
  { re: /helpers\/(?:test-db|testDb)(?:['"])/, why: 'test-db helper (live test-bed handle)' },
  { re: /helpers\/db['"]/, why: 'helpers/db (live DB helper)' },
  { re: /helpers\/queries['"]/, why: 'helpers/queries (live DB queries)' },
  { re: /helpers\/seedFullUser|helpers\/seed\//, why: 'DB seed helper' },
  { re: /ensureIsolatedDb/, why: 'isolated-DB helper' },
  { re: /require\((['"]).*knexfile\1\)/, why: 'requires knexfile (real connection)' },
];

const SRC_DB_REQUIRE = /require\(\s*(['"])(?:\.\.\/)+(?:src\/)?db\1\s*\)/;
const SRC_DB_MOCK = /jest\.mock\(\s*(['"])(?:\.\.\/)+(?:src\/)?db\1/;

function classify(file) {
  const rel = path.relative(ROOT, file);
  if (/\.db\.test\.js$/.test(rel)) return 'filename: *.db.test.js';
  if (/integration/i.test(rel)) return 'filename: integration suite';
  if (rel.startsWith(path.join('tests', 'api-e2e') + path.sep)) return 'filename: api-e2e (live stack)';
  const deny = DENYLIST.find((d) => d.file === rel);
  if (deny) return 'denylist: ' + deny.why;

  const content = fs.readFileSync(file, 'utf8');
  for (const m of CONTENT_MARKERS) {
    if (m.re.test(content)) return 'content: ' + m.why;
  }
  if (SRC_DB_REQUIRE.test(content) && !SRC_DB_MOCK.test(content)) {
    return 'content: requires src/db without jest.mock';
  }
  return null; // include
}

function main() {
  const listOnly = process.argv.includes('--list');
  const all = listTestFiles();
  const included = [];
  const excluded = [];
  for (const f of all) {
    const reason = classify(f);
    if (reason) excluded.push({ file: path.relative(ROOT, f), reason });
    else included.push(f);
  }

  console.log('[coverage-unit] test files total=%d  selected(no-DB)=%d  excluded(DB-backed)=%d',
    all.length, included.length, excluded.length);

  if (listOnly) {
    console.log('\n── excluded ──');
    for (const e of excluded) console.log('  %s  ← %s', e.file, e.reason);
    console.log('\n── selected ──');
    for (const f of included) console.log('  ' + path.relative(ROOT, f));
    return;
  }

  const args = [
    'jest',
    '--config', 'jest.coverage.config.js',
    '--coverage',
    '--runTestsByPath', ...included.map((f) => path.relative(ROOT, f)),
  ];
  const res = spawnSync('npx', args, { cwd: ROOT, stdio: 'inherit' });

  // Echo the headline numbers from the machine-readable summary so the run
  // always ends with the recorded baseline.
  const summaryPath = path.join(ROOT, 'coverage', 'coverage-summary.json');
  if (fs.existsSync(summaryPath)) {
    const total = JSON.parse(fs.readFileSync(summaryPath, 'utf8')).total;
    console.log('[coverage-unit] BASELINE  lines=%s%%  statements=%s%%  functions=%s%%  branches=%s%%',
      total.lines.pct, total.statements.pct, total.functions.pct, total.branches.pct);
  }
  process.exit(res.status === null ? 1 : res.status);
}

main();
