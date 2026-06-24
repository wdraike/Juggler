/**
 * 999.861 — "Last synced" must read the most-recent CONNECTED provider, never a
 * disconnected provider's stale timestamp, and must include Apple.
 */
import { mostRecentSyncedAt } from '../CalSyncPanel';

test('ignores a disconnected provider even if its timestamp is newest', () => {
  // Google disconnected w/ a newer stale ts; Microsoft connected & older → MS wins.
  var r = mostRecentSyncedAt([
    { connected: false, ts: '2026-06-24 17:03:00' },  // disconnected (the old bug picked this)
    { connected: true, ts: '2026-06-09 22:11:00' }
  ]);
  expect(r).toBe('2026-06-09 22:11:00');
});

test('picks the max timestamp across connected providers', () => {
  var r = mostRecentSyncedAt([
    { connected: true, ts: '2026-06-09 22:11:00' },   // gcal (older)
    { connected: true, ts: '2026-06-24 17:03:00' },   // msft (newest)
    { connected: true, ts: '2026-06-20 08:00:00' }    // apple
  ]);
  expect(r).toBe('2026-06-24 17:03:00');
});

test('counts Apple as a real provider (regression: Apple was ignored entirely)', () => {
  var r = mostRecentSyncedAt([
    { connected: false, ts: null },                   // gcal disconnected
    { connected: false, ts: null },                   // msft disconnected
    { connected: true, ts: '2026-06-24 17:03:00' }    // apple connected
  ]);
  expect(r).toBe('2026-06-24 17:03:00');
});

test('returns null when nothing connected has a timestamp', () => {
  expect(mostRecentSyncedAt([
    { connected: false, ts: '2026-06-24 17:03:00' },
    { connected: true, ts: null }
  ])).toBeNull();
  expect(mostRecentSyncedAt([])).toBeNull();
});
