'use strict';

/**
 * 999.1576 inc.4 — the armed, sandbox-scoped test-default actor and the
 * strict stamping flip.
 *
 * Mechanism (the APPROVED test-only fallback, David sign-off 2026-07-19 —
 * documented in juggler/CLAUDE.md "Approved Fallbacks"): setupFilesAfterEnv
 * (test-helpers/armAuditTestActor.js) arms a module-level default actor
 * ('jest') inside each test file's sandbox. getActor() resolves the real ALS
 * store first and falls back to the armed default — synchronously, with NO
 * AsyncLocalStorage propagation involved, which is why this design survives
 * jest's sequencer where the three disproven mechanisms (enterWith-in-
 * beforeEach, global test-fn wrapping, testEnvironment event hooks) did not.
 * Production never arms it: arming outside a jest sandbox throws.
 */

const {
  runWithActor,
  getActor,
  peekActor,
  stampInsert,
  stampUpdate,
  _runWithoutActor,
  _armTestDefaultActor,
  _disarmTestDefaultActor,
} = require('../../src/lib/audit-context');

afterEach(() => {
  // Every test in this file may disarm; restore the suite-wide invariant.
  _armTestDefaultActor('jest');
});

describe('armed test-default actor (inc.4 approved test-only fallback)', () => {
  test('setupFilesAfterEnv armed the default: getActor() resolves outside any context', () => {
    // No runWithActor, no express context — the arming file already ran.
    expect(getActor()).toBe('jest');
  });

  test('a real ALS context always wins over the armed default', async () => {
    await runWithActor('user-42', async () => {
      expect(getActor()).toBe('user-42');
    });
    expect(getActor()).toBe('jest');
  });

  test('peekActor never surfaces the armed default (pure ALS probe)', () => {
    expect(peekActor()).toBeNull();
  });

  test('_runWithoutActor suppresses the armed default — no-context assertions still throw', async () => {
    await _runWithoutActor(() => {
      expect(() => getActor()).toThrow(/no actor established/);
    });
  });

  test('disarmed: getActor() throws outside any context (production behavior)', () => {
    _disarmTestDefaultActor();
    expect(() => getActor()).toThrow(/no actor established/);
  });

  test('arming is jest-sandbox-gated: throws when JEST_WORKER_ID is absent', () => {
    const saved = process.env.JEST_WORKER_ID;
    delete process.env.JEST_WORKER_ID;
    try {
      expect(() => _armTestDefaultActor('jest')).toThrow(/jest sandbox/);
    } finally {
      process.env.JEST_WORKER_ID = saved;
    }
  });

  test('arming rejects empty/non-string actors', () => {
    expect(() => _armTestDefaultActor('')).toThrow(/non-empty string/);
    expect(() => _armTestDefaultActor(null)).toThrow(/non-empty string/);
  });
});

describe('strict stampInsert/stampUpdate (inc.4 flip)', () => {
  test('stampInsert stamps the ambient actor', async () => {
    await runWithActor('user-7', async () => {
      const row = stampInsert({ text: 'hi' });
      expect(row.created_by).toBe('user-7');
      expect(row.updated_by).toBe('user-7');
    });
  });

  test('stampInsert falls back to the armed test default outside any context', () => {
    const row = stampInsert({ text: 'hi' });
    expect(row.created_by).toBe('jest');
    expect(row.updated_by).toBe('jest');
  });

  test('stampInsert THROWS with no context and no armed default — zero silent NULLs', async () => {
    await _runWithoutActor(() => {
      expect(() => stampInsert({ text: 'hi' })).toThrow(/no actor established/);
    });
  });

  test('stampUpdate THROWS with no context and no armed default', async () => {
    await _runWithoutActor(() => {
      expect(() => stampUpdate({ text: 'hi' })).toThrow(/no actor established/);
    });
  });

  test('caller-provided attribution always wins (import/backfill paths)', async () => {
    await runWithActor('user-7', async () => {
      const row = stampInsert({ text: 'hi', created_by: 'migration-backfill', updated_by: 'migration-backfill' });
      expect(row.created_by).toBe('migration-backfill');
      expect(row.updated_by).toBe('migration-backfill');
      const upd = stampUpdate({ text: 'x', updated_by: 'import' });
      expect(upd.updated_by).toBe('import');
    });
  });

  test('stampUpdate stamps only updated_by', () => {
    const changes = stampUpdate({ status: 'done' });
    expect(changes.updated_by).toBe('jest');
    expect(changes.created_by).toBeUndefined();
  });

  test('stampInsert is array-aware (bulk fixture/import inserts)', () => {
    const rows = stampInsert([{ a: 1 }, { a: 2, created_by: 'import', updated_by: 'import' }]);
    expect(rows[0].created_by).toBe('jest');
    expect(rows[0].updated_by).toBe('jest');
    expect(rows[1].created_by).toBe('import');
    expect(rows[1].updated_by).toBe('import');
  });
});
