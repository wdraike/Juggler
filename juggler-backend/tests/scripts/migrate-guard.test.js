/**
 * Regression tests for scripts/migrate-guard.js
 *
 * Bug: `npm run migrate` (knex migrate:latest) has no production-safety guard.
 *   DB_PORT=3307 (GCP Cloud SQL Proxy) or CLOUD_SQL_CONNECTION_NAME set means
 *   running `npm run migrate` in dev silently migrates PRODUCTION.
 *
 * Fix contract: migrate-guard.js must export:
 *   module.exports.assertSafeMigrateTarget = function(env) { ... }
 *   - env: { DB_PORT, CLOUD_SQL_CONNECTION_NAME, ALLOW_PROD_MIGRATE }
 *   - THROW when (DB_PORT==='3307' OR CLOUD_SQL_CONNECTION_NAME set) AND
 *     ALLOW_PROD_MIGRATE !== '1'
 *   - Return normally otherwise (no throw).
 *
 * These tests are authored RED-first (bugfix mode): the module does not yet
 * exist. They will FAIL until bert implements scripts/migrate-guard.js.
 *
 * Traceability: jug-migrate-prod-guard AC1, AC2, AC2b, AC3, AC4, AC4b
 * ROADMAP: 999.302
 */

'use strict';

// The module does not exist yet — this require() itself will throw MODULE_NOT_FOUND,
// causing all tests in this suite to error out (RED). That is the intended pre-fix state.
const { assertSafeMigrateTarget } = require('../../scripts/migrate-guard');

describe('migrate-guard › assertSafeMigrateTarget', () => {

  // ── AC1: DB_PORT=3307 without opt-in → REFUSE ───────────────────────────────
  it('AC1: throws when DB_PORT is 3307 (production Cloud SQL Proxy port)', () => {
    expect(() => assertSafeMigrateTarget({ DB_PORT: '3307' }))
      .toThrow(/prod|3307|Cloud SQL/i);
  });

  // ── AC2: DB_PORT=3407 (test-bed) → ALLOW ────────────────────────────────────
  it('AC2: does not throw when DB_PORT is 3407 (test-bed)', () => {
    expect(() => assertSafeMigrateTarget({ DB_PORT: '3407' }))
      .not.toThrow();
  });

  // ── AC2b: DB_PORT=3308 (dev-bed) → ALLOW ────────────────────────────────────
  it('AC2b: does not throw when DB_PORT is 3308 (dev-bed)', () => {
    expect(() => assertSafeMigrateTarget({ DB_PORT: '3308' }))
      .not.toThrow();
  });

  // ── AC3: DB_PORT=3307 with explicit opt-in → ALLOW ──────────────────────────
  it('AC3: does not throw when DB_PORT is 3307 but ALLOW_PROD_MIGRATE=1 is set', () => {
    expect(() =>
      assertSafeMigrateTarget({ DB_PORT: '3307', ALLOW_PROD_MIGRATE: '1' })
    ).not.toThrow();
  });

  // ── AC4: CLOUD_SQL_CONNECTION_NAME set (no DB_PORT) → REFUSE ─────────────────
  it('AC4: throws when CLOUD_SQL_CONNECTION_NAME is set (Cloud SQL = production)', () => {
    expect(() =>
      assertSafeMigrateTarget({ CLOUD_SQL_CONNECTION_NAME: 'proj:region:inst' })
    ).toThrow(/prod|Cloud SQL/i);
  });

  // ── AC4b: CLOUD_SQL_CONNECTION_NAME set + opt-in → ALLOW ─────────────────────
  it('AC4b: does not throw when CLOUD_SQL_CONNECTION_NAME set but ALLOW_PROD_MIGRATE=1', () => {
    expect(() =>
      assertSafeMigrateTarget({
        CLOUD_SQL_CONNECTION_NAME: 'proj:region:inst',
        ALLOW_PROD_MIGRATE: '1',
      })
    ).not.toThrow();
  });

  // ── Edge: empty / missing env → ALLOW (no prod signals present) ──────────────
  it('does not throw when env is empty (no prod signals)', () => {
    expect(() => assertSafeMigrateTarget({})).not.toThrow();
  });

  // ── Edge: DB_PORT as number (coercion safety) → REFUSE ───────────────────────
  it('throws when DB_PORT is the number 3307 (not just string)', () => {
    expect(() => assertSafeMigrateTarget({ DB_PORT: 3307 }))
      .toThrow(/prod|3307|Cloud SQL/i);
  });

  // ── Edge: DB_PORT=3307 + ALLOW_PROD_MIGRATE='0' → REFUSE (non-'1' opt-in) ────
  it('throws when DB_PORT=3307 and ALLOW_PROD_MIGRATE is "0" (not a valid opt-in)', () => {
    expect(() =>
      assertSafeMigrateTarget({ DB_PORT: '3307', ALLOW_PROD_MIGRATE: '0' })
    ).toThrow(/prod|3307|Cloud SQL/i);
  });

  // ── Edge: both DB_PORT=3307 AND CLOUD_SQL_CONNECTION_NAME set + opt-in → ALLOW
  it('does not throw when both prod signals are set but ALLOW_PROD_MIGRATE=1', () => {
    expect(() =>
      assertSafeMigrateTarget({
        DB_PORT: '3307',
        CLOUD_SQL_CONNECTION_NAME: 'proj:region:inst',
        ALLOW_PROD_MIGRATE: '1',
      })
    ).not.toThrow();
  });
});
