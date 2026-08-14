/**
 * Self-write tokens — "this client just wrote task X, ignore the echo".
 *
 * The server echoes our own writes back over `tasks:changed`. Re-fetching on
 * that echo races any still-queued write and flashes the UI back to pre-write
 * state, so each write leaves a token and the echo consumes it.
 *
 * 999.15605: one user save can now be TWO writes for the same id — ordinary
 * fields on PUT /tasks/batch, the recurrence-anchor group on PUT /tasks/:id —
 * and each emits its own echo. A single expiry per id suppressed only the
 * first; the second re-fetched and could overwrite an edit made in between,
 * silently, with the dirty flag already cleared. Tokens therefore COUNT
 * outstanding writes, and each echo consumes exactly one.
 *
 * Extracted from useTaskState so the counting is testable on its own — the
 * behaviour is invisible from the hook's public surface.
 */
export function createSelfWriteTokens(ttlMs) {
  var TTL = ttlMs || 3000;
  var map = new Map();

  function mark(ids, now) {
    if (!ids) return;
    var t = now === undefined ? Date.now() : now;
    var arr = Array.isArray(ids) ? ids : [ids];
    arr.forEach(function(id) {
      if (!id) return;
      var prev = map.get(id);
      // An expired token is not carried forward — its write is long done.
      var n = (prev && prev.expiry >= t ? prev.n : 0) + 1;
      map.set(id, { expiry: t + TTL, n: n });
    });
  }

  /**
   * @returns {Array<string>} the ids that were NOT self-written (i.e. genuinely
   *   remote changes the caller should re-fetch).
   */
  function filter(ids, now) {
    if (!ids || ids.length === 0) return ids;
    var t = now === undefined ? Date.now() : now;
    var kept = [];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var tok = map.get(id);
      if (tok == null) { kept.push(id); continue; }
      if (tok.expiry < t) { map.delete(id); kept.push(id); continue; }
      if (tok.n > 1) { map.set(id, { expiry: tok.expiry, n: tok.n - 1 }); }
      else { map.delete(id); }
    }
    return kept;
  }

  return { mark: mark, filter: filter, _size: function() { return map.size; } };
}
