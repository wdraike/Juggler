/**
 * 999.15605 — a save split across two endpoints emits two echoes.
 *
 * The suppression used to store ONE expiry per id and delete it on the first
 * echo, so the second echo passed the filter, triggered a re-fetch and could
 * overwrite an edit the user made in between — silently, with the dirty flag
 * already cleared, so nothing re-sent it.
 */
import { createSelfWriteTokens } from '../selfWriteTokens';

var T0 = 1000000;

describe('999.15605: self-write tokens count outstanding writes', () => {
  test('two writes for one id suppress TWO echoes', () => {
    var tok = createSelfWriteTokens(3000);
    tok.mark('t1', T0);
    tok.mark('t1', T0);

    expect(tok.filter(['t1'], T0 + 10)).toEqual([]);   // batch echo
    expect(tok.filter(['t1'], T0 + 20)).toEqual([]);   // anchor echo
    // Third echo is somebody else's write and must get through.
    expect(tok.filter(['t1'], T0 + 30)).toEqual(['t1']);
  });

  test('one write still suppresses exactly one echo', () => {
    var tok = createSelfWriteTokens(3000);
    tok.mark('t1', T0);
    expect(tok.filter(['t1'], T0 + 10)).toEqual([]);
    expect(tok.filter(['t1'], T0 + 20)).toEqual(['t1']);
  });

  test('an id never written passes straight through', () => {
    var tok = createSelfWriteTokens(3000);
    expect(tok.filter(['other'], T0)).toEqual(['other']);
  });

  test('an expired token is dropped, not carried forward', () => {
    var tok = createSelfWriteTokens(3000);
    tok.mark('t1', T0);
    tok.mark('t1', T0);
    expect(tok.filter(['t1'], T0 + 5000)).toEqual(['t1']); // past TTL → remote
    expect(tok._size()).toBe(0);
  });

  test('marking after expiry starts a fresh count rather than stacking', () => {
    var tok = createSelfWriteTokens(3000);
    tok.mark('t1', T0);
    tok.mark('t1', T0 + 5000); // previous token already dead
    expect(tok.filter(['t1'], T0 + 5010)).toEqual([]);
    expect(tok.filter(['t1'], T0 + 5020)).toEqual(['t1']);
  });

  test('ids are independent', () => {
    var tok = createSelfWriteTokens(3000);
    tok.mark(['a', 'b'], T0);
    tok.mark('a', T0);
    expect(tok.filter(['a', 'b'], T0 + 10)).toEqual([]);
    expect(tok.filter(['a', 'b'], T0 + 20)).toEqual(['b']); // a still has one left
  });

  test('empty and falsy inputs are no-ops', () => {
    var tok = createSelfWriteTokens(3000);
    tok.mark(null, T0);
    tok.mark([null, ''], T0);
    expect(tok._size()).toBe(0);
    expect(tok.filter([], T0)).toEqual([]);
  });
});
