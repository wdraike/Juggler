'use strict';

/**
 * 999.1576 inc.2a — audit-context contract. The actor must survive async
 * hops (awaits, promise chains, setImmediate — the shapes knex queries take),
 * resolve lazily for express (auth sets req.user AFTER the middleware ran),
 * throw when absent (no silent NULL attribution), and let the innermost
 * context win for system-writers-within-requests.
 */

const { runWithActor, getActor, peekActor, expressAuditContext } = require('../../src/lib/audit-context');

describe('audit-context', () => {
  test('getActor throws outside any context (no silent NULL)', () => {
    expect(() => getActor()).toThrow(/no actor established/);
    expect(peekActor()).toBeNull();
  });

  test('runWithActor establishes the actor across await boundaries', async () => {
    await runWithActor('scheduler', async () => {
      expect(getActor()).toBe('scheduler');
      await new Promise((r) => setImmediate(r));
      expect(getActor()).toBe('scheduler'); // survives the macrotask hop
      await Promise.resolve().then(() => {
        expect(getActor()).toBe('scheduler'); // survives microtask chains
      });
    });
  });

  test('rejects empty/non-string actors', () => {
    expect(() => runWithActor('', () => {})).toThrow(/non-empty string/);
    expect(() => runWithActor(null, () => {})).toThrow(/non-empty string/);
    expect(() => runWithActor(42, () => {})).toThrow(/non-empty string/);
  });

  test('nested contexts: innermost wins, outer restored after', async () => {
    await runWithActor('user-123', async () => {
      expect(getActor()).toBe('user-123');
      await runWithActor('cal-sync', async () => {
        expect(getActor()).toBe('cal-sync');
      });
      expect(getActor()).toBe('user-123');
    });
  });

  test('parallel contexts do not bleed into each other', async () => {
    const seen = [];
    await Promise.all([
      runWithActor('a', async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(getActor());
      }),
      runWithActor('b', async () => {
        seen.push(getActor());
        await new Promise((r) => setTimeout(r, 10));
        seen.push(getActor());
      }),
    ]);
    expect(seen.sort()).toEqual(['a', 'b', 'b']);
  });

  describe('expressAuditContext (lazy req.user)', () => {
    test('actor resolves from req.user set AFTER the middleware ran (route-level auth)', (done) => {
      const req = {};
      expressAuditContext(req, {}, () => {
        // auth middleware has not run yet
        expect(peekActor()).toBeNull();
        expect(() => getActor()).toThrow(/no actor established/);

        // route-level JWT auth populates req.user later on the same chain
        req.user = { sub: 'user-777' };
        expect(getActor()).toBe('user-777');
        done();
      });
    });

    test('falls through sub -> id -> userId claim shapes', (done) => {
      const req = { user: { id: 'via-id' } };
      expressAuditContext(req, {}, () => {
        expect(getActor()).toBe('via-id');
        done();
      });
    });
  });
});
