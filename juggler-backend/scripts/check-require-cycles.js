#!/usr/bin/env node
/**
 * check-require-cycles.js — require-cycle gate (999.1198 JUG-REQUIRE-CYCLES-X11).
 *
 * Builds the relative-require graph over src/**\/*.js (top-level AND
 * mid-function lazy requires — a lazy require is still a graph edge; laziness
 * only papers over init order), finds strongly-connected components (Tarjan),
 * and enumerates elementary cycles (Johnson, capped). FAILS (exit 1) when the
 * cycle count exceeds MAX_CYCLES.
 *
 * MAX_CYCLES is the post-999.1198 residual baseline, NOT an allowance for new
 * cycles: the residual SCC is the sanctioned facade↔facade / middleware seam
 * set (task ↔ user-config counts + plan-features/usage-reporter, and the
 * lib-internal task-write-queue↔sync-lock pair) tracked for later legs. When
 * you REMOVE cycles, lower MAX_CYCLES in the same commit. Never raise it
 * without a backlog item.
 *
 * Usage: node scripts/check-require-cycles.js [--print]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MAX_CYCLES = 7; // measured residual post-999.1192/999.1198 (was 60 before those legs)

const ROOT = path.join(__dirname, '..', 'src');

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(ROOT, []);
const fileSet = new Set(files);

function resolveReq(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // external / package requires: not graph edges
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [base, base + '.js', path.join(base, 'index.js')]) {
    if (fileSet.has(cand)) return cand;
  }
  return null;
}

const graph = new Map();
const RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/^\s*\/\/.*$/gm, '');      // line comments
  const deps = new Set();
  let m;
  while ((m = RE.exec(src))) {
    const r = resolveReq(f, m[1]);
    if (r && r !== f) deps.add(r);
  }
  graph.set(f, deps);
}

// ── Tarjan SCC ────────────────────────────────────────────────────────────────
let idx = 0;
const index = new Map(), low = new Map(), onStack = new Map(), stack = [];
const sccs = [];
function strongconnect(v) {
  index.set(v, idx); low.set(v, idx); idx++;
  stack.push(v); onStack.set(v, true);
  for (const w of graph.get(v) || []) {
    if (!index.has(w)) { strongconnect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
    else if (onStack.get(w)) low.set(v, Math.min(low.get(v), index.get(w)));
  }
  if (low.get(v) === index.get(v)) {
    const comp = [];
    let w;
    do { w = stack.pop(); onStack.set(w, false); comp.push(w); } while (w !== v);
    if (comp.length > 1) sccs.push(comp);
  }
}
for (const f of files) if (!index.has(f)) strongconnect(f);

// ── Johnson elementary-cycle enumeration within each SCC (capped) ─────────────
const CAP = 500;
const cycles = [];
function findCycles(comp) {
  const compSet = new Set(comp);
  const adj = new Map(comp.map(v => [v, [...(graph.get(v) || [])].filter(w => compSet.has(w))]));
  const nodes = comp.slice().sort();
  for (let i = 0; i < nodes.length && cycles.length < CAP; i++) {
    const start = nodes[i];
    const blocked = new Set(), B = new Map(), st = [];
    const allowed = new Set(nodes.slice(i));
    function unblock(u) {
      blocked.delete(u);
      for (const w of B.get(u) || []) if (blocked.has(w)) unblock(w);
      B.set(u, new Set());
    }
    function circuit(v) {
      if (cycles.length >= CAP) return false;
      let found = false;
      st.push(v); blocked.add(v);
      for (const w of adj.get(v) || []) {
        if (!allowed.has(w)) continue;
        if (w === start) { cycles.push(st.slice()); found = true; if (cycles.length >= CAP) break; }
        else if (!blocked.has(w)) { if (circuit(w)) found = true; }
      }
      if (found) unblock(v);
      else for (const w of adj.get(v) || []) {
        if (!allowed.has(w)) continue;
        if (!B.has(w)) B.set(w, new Set());
        B.get(w).add(v);
      }
      st.pop();
      return found;
    }
    circuit(start);
  }
}
for (const comp of sccs) findCycles(comp);

const rel = f => path.relative(ROOT, f);
console.log('[cycles] files scanned: ' + files.length);
console.log('[cycles] SCCs (>1 node): ' + sccs.length
  + sccs.map(c => ' [' + c.length + ']').join(''));
console.log('[cycles] elementary require cycles: ' + cycles.length
  + (cycles.length >= CAP ? ' (CAPPED)' : '') + ' (max allowed: ' + MAX_CYCLES + ')');
if (process.argv.includes('--print')) {
  for (const c of cycles) console.log('  ' + c.map(rel).join(' -> ') + ' -> ' + rel(c[0]));
}
if (cycles.length > MAX_CYCLES) {
  console.error('[cycles] FAIL: cycle count ' + cycles.length + ' exceeds baseline ' + MAX_CYCLES
    + '. A new require cycle was introduced — break it (see scheduleTrigger/cal-sync-trigger'
    + ' seams for the inversion pattern) instead of lazy-requiring around it.');
  process.exit(1);
}
console.log('[cycles] OK');
