#!/usr/bin/env node
/**
 * generate-traceability.js — 999.1213: requirement -> test traceability matrix.
 *
 * Regenerates docs/TRACEABILITY-MATRIX.md from the two LIVE sources:
 *   1. docs/REQUIREMENTS.md      — the R-number precedence register (each row's
 *                                  Tests column is the per-requirement authority,
 *                                  per commit ad2b4abf).
 *   2. the filesystem            — juggler-backend/{tests,scripts} and
 *                                  juggler-frontend/src, so every test reference
 *                                  is verified to still EXIST.
 *
 * This is the service-wide extension of the SCHEDULER-TRACEABILITY-REPORT.md
 * pointer approach: no hand-maintained matrix snapshot that can rot
 * (999.1080-style) — the matrix is derived, and stale refs are surfaced.
 *
 * Usage (from juggler/):
 *   node scripts/generate-traceability.js            # rewrite docs/TRACEABILITY-MATRIX.md
 *   node scripts/generate-traceability.js --check    # no write; exit 1 on stale refs
 *
 * Output is deterministic for a given (REQUIREMENTS.md, filesystem) state —
 * no timestamps — so reruns are diff-clean and commit-friendly.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const JUGGLER_ROOT = path.resolve(__dirname, '..');
const REQUIREMENTS_MD = path.join(JUGGLER_ROOT, 'docs', 'REQUIREMENTS.md');
const OUTPUT_MD = path.join(JUGGLER_ROOT, 'docs', 'TRACEABILITY-MATRIX.md');

// ── filesystem index ─────────────────────────────────────────────────────────

/** Recursively list files under dir, as paths relative to JUGGLER_ROOT. */
function listFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(path.relative(JUGGLER_ROOT, full));
  }
  return out;
}

function buildFileIndex() {
  return [
    ...listFiles(path.join(JUGGLER_ROOT, 'juggler-backend', 'tests')),
    ...listFiles(path.join(JUGGLER_ROOT, 'juggler-backend', 'scripts')),
    ...listFiles(path.join(JUGGLER_ROOT, 'juggler-frontend', 'src')),
  ].sort();
}

// ── REQUIREMENTS.md parsing ──────────────────────────────────────────────────

const UNESCAPED_PIPE = /(?<!\\)\|/;

/**
 * Parse every requirement row (`| Rn.m | ... |`) from tables whose header has
 * a Tests column. Returns { rows, skipped } where each row is
 * { id, family, status, testsCell }.
 */
function parseRequirements(md) {
  const lines = md.split('\n');
  const rows = [];
  let skipped = 0;
  let family = null;
  let cols = null; // header column names for the current table

  for (const line of lines) {
    const h = line.match(/^###+\s+(R[\d–R.\- ]+—.*)$/);
    if (h) { family = h[1].trim(); cols = null; continue; }
    if (/^\|/.test(line)) {
      const cells = line.split(UNESCAPED_PIPE).map((c) => c.trim());
      if (cells[1] === 'ID') { cols = cells; continue; }
      if (/^-+:?$/.test((cells[1] || '').replace(/\s/g, ''))) continue; // separator row
      if (!/^R\d/.test(cells[1] || '')) continue;
      if (!cols || !cols.includes('Tests')) { skipped += 1; continue; }
      rows.push({
        id: cells[1],
        family,
        status: cells[cols.indexOf('Status')] || '',
        testsCell: cells[cols.indexOf('Tests')] || '',
      });
    }
  }
  return { rows, skipped };
}

// ── test-reference resolution ────────────────────────────────────────────────

/**
 * Split a Tests cell into entries ('·'-separated) and resolve each against the
 * file index. Returns [{ ref, kind, resolved }] where kind is
 * 'file'|'dir'|'glob'|'basename'|'none' and resolved is true|false|null (null
 * for 'none' entries — explicit no-test markers).
 */
function resolveTestsCell(cell, fileIndex) {
  const trimmed = cell.trim();
  if (!trimmed || trimmed === '—') return [{ ref: '—', kind: 'none', resolved: null }];

  return trimmed.split('·').map((raw) => {
    const entry = raw.trim();
    // Prose entries beginning with "No ..." are explicit no-test markers even
    // when they embed a code span (e.g. "No dedicated backend test; ... Flag:
    // no unit test for `handleGridDrop` logic.").
    if (/^no\s/i.test(entry)) {
      return { ref: entry, kind: 'none', resolved: null };
    }
    const code = entry.match(/`([^`]+)`/);
    if (!code) return { ref: entry, kind: 'none', resolved: null };
    const ref = code[1].trim();

    // Normalize to a juggler/-relative path.
    let rel;
    if (ref.startsWith('juggler-backend/') || ref.startsWith('juggler-frontend/')) {
      rel = ref;
    } else if (ref.startsWith('tests/') || ref.startsWith('scripts/')) {
      rel = 'juggler-backend/' + ref;
    } else if (!ref.includes('/')) {
      // Bare filename — resolve by basename anywhere in the index.
      const hit = fileIndex.some((f) => path.basename(f) === ref);
      return { ref, kind: 'basename', resolved: hit };
    } else {
      rel = ref; // unknown root — check verbatim
    }

    if (rel.endsWith('/')) {
      const prefix = rel;
      const hit = fileIndex.some((f) => f.startsWith(prefix));
      return { ref, kind: 'dir', resolved: hit };
    }
    if (rel.includes('*')) {
      const re = new RegExp('^' + rel.split('*').map(escapeRe).join('[^/]*') + '$');
      const hit = fileIndex.some((f) => re.test(f));
      return { ref, kind: 'glob', resolved: hit };
    }
    return { ref, kind: 'file', resolved: fileIndex.includes(rel) };
  });
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── report generation ────────────────────────────────────────────────────────

function generate() {
  const md = fs.readFileSync(REQUIREMENTS_MD, 'utf8');
  const fileIndex = buildFileIndex();
  const { rows, skipped } = parseRequirements(md);

  const results = rows.map((row) => ({ ...row, refs: resolveTestsCell(row.testsCell, fileIndex) }));

  const covered = results.filter((r) => r.refs.some((x) => x.resolved === true));
  const untested = results.filter((r) => r.refs.every((x) => x.kind === 'none'));
  const stale = results
    .map((r) => ({ id: r.id, staleRefs: r.refs.filter((x) => x.resolved === false) }))
    .filter((r) => r.staleRefs.length > 0);

  const byStatus = {};
  results.forEach((r) => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });

  const inputHash = crypto.createHash('sha256').update(md).digest('hex').slice(0, 12);

  const out = [];
  out.push('# Traceability Matrix — Juggler (requirement → test)');
  out.push('');
  out.push('> **GENERATED — do not hand-edit.** Regenerate with');
  out.push('> `node scripts/generate-traceability.js` (from `juggler/`).');
  out.push('> Derived from `docs/REQUIREMENTS.md` (the R-number precedence register —');
  out.push('> each row\'s **Tests** column is the per-requirement authority) verified');
  out.push('> against the live filesystem. Rot cannot accumulate here: a reference to a');
  out.push('> deleted/renamed test shows up as **STALE** on the next regeneration');
  out.push('> (`--check` exits 1 on any stale ref).');
  out.push('>');
  out.push(`> Source: \`docs/REQUIREMENTS.md\` @ sha256:${inputHash}`);
  out.push('');
  out.push('## Summary');
  out.push('');
  out.push('| Metric | Count |');
  out.push('|--------|-------|');
  out.push(`| Requirement rows parsed | ${results.length} |`);
  Object.keys(byStatus).sort().forEach((s) => {
    out.push(`| — status \`${s || '(blank)'}\` | ${byStatus[s]} |`);
  });
  out.push(`| Rows with ≥1 resolving test reference | ${covered.length} |`);
  out.push(`| Rows explicitly marked "No dedicated test" / — | ${untested.length} |`);
  out.push(`| Rows with STALE test references | ${stale.length} |`);
  out.push(`| Sub-table rows without a Tests column (skipped) | ${skipped} |`);
  out.push('');

  if (stale.length > 0) {
    out.push('## STALE references (fix REQUIREMENTS.md or restore the test)');
    out.push('');
    for (const s of stale) {
      for (const ref of s.staleRefs) {
        out.push(`- **${s.id}** → \`${ref.ref}\` (${ref.kind} — not found)`);
      }
    }
    out.push('');
  }

  out.push('## Untested requirements (explicit no-test markers)');
  out.push('');
  for (const r of untested) {
    out.push(`- **${r.id}** (\`${r.status}\`) — ${r.refs.map((x) => x.ref).join(' · ')}`);
  }
  out.push('');

  out.push('## Matrix');
  out.push('');
  let currentFamily = null;
  for (const r of results) {
    if (r.family !== currentFamily) {
      currentFamily = r.family;
      out.push(`### ${currentFamily}`);
      out.push('');
      out.push('| ID | Status | Tests | Resolution |');
      out.push('|----|--------|-------|------------|');
    }
    const refCol = r.refs.map((x) => (x.kind === 'none' ? x.ref : '`' + x.ref + '`')).join(' · ');
    const resCol = r.refs.map((x) => {
      if (x.resolved === true) return 'ok';
      if (x.resolved === false) return '**STALE**';
      return 'none';
    }).join(' · ');
    out.push(`| ${r.id} | ${r.status} | ${refCol.replace(/\|/g, '\\|')} | ${resCol} |`);
  }
  out.push('');

  return { report: out.join('\n'), stale, results };
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const { report, stale, results } = generate();

  if (!checkOnly) {
    fs.writeFileSync(OUTPUT_MD, report);
    console.log('[traceability] wrote %s (%d requirement rows)', path.relative(JUGGLER_ROOT, OUTPUT_MD), results.length);
  }
  if (stale.length > 0) {
    console.log('[traceability] %d requirement(s) carry STALE test references:', stale.length);
    for (const s of stale) {
      console.log('  %s → %s', s.id, s.staleRefs.map((r) => r.ref).join(' · '));
    }
    if (checkOnly) process.exit(1);
  } else {
    console.log('[traceability] no stale references');
  }
}

main();
