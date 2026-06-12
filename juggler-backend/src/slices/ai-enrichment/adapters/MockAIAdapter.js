/**
 * MockAIAdapter — in-memory test double for `AIPort` (Phase H5). No `@google/genai`,
 * no network. Lets tests drive `generate` deterministically: a canned result, a
 * scripted sequence, a thrown error, or a hang (for the W3 timeout test).
 *
 * Usage:
 *   new MockAIAdapter({ result: { text: '🎯' } })           // always returns it
 *   new MockAIAdapter({ results: [r1, r2] })                 // one per call, then last
 *   new MockAIAdapter({ error: new Error('boom') })          // always throws
 *   new MockAIAdapter({ hangMs: 99999 })                     // never resolves (timeout test)
 */

'use strict';

function MockAIAdapter(opts) {
  const o = opts || {};
  this._result = o.result || { text: '' };
  this._results = o.results || null;
  this._error = o.error || null;
  this._hangMs = o.hangMs || 0;
  this.calls = []; // recorded { contents, config, meta }
  this._i = 0;
}

MockAIAdapter.prototype.generate = async function generate(contents, config, meta) {
  this.calls.push({ contents, config, meta });
  if (this._hangMs) {
    return new Promise((resolve) => { setTimeout(() => resolve(this._result), this._hangMs); });
  }
  if (this._error) throw this._error;
  if (this._results) {
    const r = this._results[Math.min(this._i, this._results.length - 1)];
    this._i += 1;
    return r;
  }
  return this._result;
};

module.exports = MockAIAdapter;
