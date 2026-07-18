/**
 * sync-orchestrator-shape.arch.test.js — mechanical orchestrator-shape gate for
 * cal-sync.controller.js `sync()` (999.1025 increment 11, CLOSING).
 *
 * The H7 leg (999.1025) extracted sync()'s branching decisions into pure
 * decide-, predicate-, and planner-use-cases under src/slices/calendar/domain/. This
 * arch test locks in the RESULT and RATCHETS it shrink-only, so future edits
 * cannot silently re-grow inline business logic inside the ~1,480-line sync():
 *
 *   1. DELEGATION — every carved decision module is imported by the controller
 *      AND invoked inside sync(). Catches an accidental un-wiring (a decider
 *      left imported-but-unused, or replaced by re-inlined logic).
 *   2. CARVED-PREDICATES-GONE — the two guards carved THIS increment
 *      (recurring-template skip + unscheduled-task delete) no longer appear
 *      inline in sync(); they live only in both-exist-disposition.js.
 *   3. RESIDUAL RATCHET — a FROZEN allowlist of the business-decision predicates
 *      that remain inline. Each MUST still be present; carving one deletes its
 *      code, which fails the "present" assertion and FORCES its removal from the
 *      allowlist (and a decrement of EXPECTED_RESIDUAL_COUNT). The allowlist may
 *      only SHRINK. It is the precise tracker of remaining work.
 *   4. DOMAIN-PREDICATE CEILING — a coarse AST backstop: the count of
 *      IfStatements in sync() whose test reads a raw domain object
 *      (task/ledger/event/newEvent/…) — excluding dispatch on a decision result
 *      — must never exceed a frozen ceiling. Catches a NEW inline branch that
 *      the anchor list does not name. Shrink-only: lower it as residuals/gates
 *      are carved, NEVER raise it. (AST via espree — a hoisted eslint dep; the
 *      test self-skips this one backstop if no parser is resolvable, so a
 *      missing devDep never reds CI. The parser-free gates 1-3 always run.)
 *
 * DB-FREE: pure source-text + AST analysis. No DB, no app boot.
 */

'use strict';

var fs = require('fs');
var path = require('path');

var CONTROLLER = path.join(__dirname, '../../../src/controllers/cal-sync.controller.js');
var SRC = fs.readFileSync(CONTROLLER, 'utf8');

// --- Extract sync()'s source by its stable top-level function boundaries ------
var SYNC_START = 'async function sync(req, res) {';
var SYNC_END = 'async function hasChanges(req, res) {';
var startIdx = SRC.indexOf(SYNC_START);
var endIdx = SRC.indexOf(SYNC_END);
var SYNC_SRC = (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx)
  ? SRC.slice(startIdx, endIdx)
  : '';

// The carved decision/predicate/planner use-cases and their import module paths.
var CARVED_MODULES = [
  { fn: 'decideMissingEventSync', mod: 'missing-event-decision' },
  { fn: 'decideTerminalTaskSync', mod: 'terminal-task-decision' },
  { fn: 'decidePastCleanupSync', mod: 'past-cleanup-decision' },
  { fn: 'decideExternalEditSync', mod: 'external-edit-decision' },
  { fn: 'decideProviderOriginPull', mod: 'provider-origin-pull-decision' },
  { fn: 'decideIngestEvent', mod: 'ingest-event-decision' },
  { fn: 'decideHashPushSync', mod: 'hash-push-decision' },
  { fn: 'isTaskPushEligible', mod: 'push-eligibility' },
  { fn: 'planMergedFollowerCleanup', mod: 'merged-follower-cleanup' },
  { fn: 'decideBothExistDisposition', mod: 'both-exist-disposition' }
];

// The two predicates carved THIS increment — must NOT reappear inline in sync().
var CARVED_THIS_INCREMENT = [
  "task.taskType === 'recurring_template'",  // recurring-template skip
  "task.unscheduled && ledger.origin"        // unscheduled-task calendar-delete
];

// FROZEN allowlist: business-decision predicates that REMAIN inline in sync().
// Each entry is a unique code anchor that must still be present. SHRINK-ONLY:
// when a follow-up increment carves one, delete its entry here and decrement
// EXPECTED_RESIDUAL_COUNT. NEVER add a new entry — new inline decisions belong
// in a decide* use-case.
var RESIDUAL_DECISION_ANCHORS = [
  // Self-heal stale recurring-instance ledger task_ids (reconcile re-numbering).
  { id: 'self-heal-stale-instance', anchor: 'var masterMatch = ledger.task_id.match(/^(.+)-\\d+$/);' },
  // done_frozen rows skip the push (already frozen after a prior successful push).
  { id: 'done-frozen-skip', anchor: "if (ledger.status === 'done_frozen') {" },
  // Backward-dependency warning: task pulled to before a task it depends on.
  { id: 'backward-dep-warning', anchor: "backwardDepWarning = 'Task promoted to before dependency '" },
  // Freeze done tasks after their first successful push (done_frozen).
  { id: 'done-frozen-freeze', anchor: "pushedTask.status === 'done' && calCompletedBehavior === 'update'" }
];
var EXPECTED_RESIDUAL_COUNT = 4;

// Coarse AST backstop ceiling (see analyzer): number of IfStatements in sync()
// whose test reads a raw domain object, excluding dispatch on a decision result.
// Frozen at the post-increment-11 value. SHRINK-ONLY — lower as residual
// decisions / dispatch gates are carved; NEVER raise.
var DOMAIN_PREDICATE_IF_CEILING = 21;

describe('sync() orchestrator shape — boundaries', function () {
  it('locates the sync() function body by its stable top-level boundaries', function () {
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    expect(SYNC_SRC.length).toBeGreaterThan(1000);
  });
});

describe('sync() orchestrator shape — DELEGATION to pure use-cases', function () {
  CARVED_MODULES.forEach(function (m) {
    it('imports and invokes ' + m.fn + ' (' + m.mod + ')', function () {
      // imported at controller scope
      expect(SRC.indexOf('/slices/calendar/domain/' + m.mod)).toBeGreaterThan(-1);
      // invoked inside sync()
      expect(SYNC_SRC.indexOf(m.fn + '(')).toBeGreaterThan(-1);
    });
  });
});

describe('sync() orchestrator shape — this-increment carves are no longer inline', function () {
  CARVED_THIS_INCREMENT.forEach(function (pred) {
    it('predicate removed from inline sync(): ' + pred, function () {
      expect(SYNC_SRC.indexOf(pred)).toBe(-1);
    });
  });
});

describe('sync() orchestrator shape — RESIDUAL ratchet (shrink-only)', function () {
  it('the allowlist length matches EXPECTED_RESIDUAL_COUNT (self-consistency)', function () {
    expect(RESIDUAL_DECISION_ANCHORS.length).toBe(EXPECTED_RESIDUAL_COUNT);
  });

  RESIDUAL_DECISION_ANCHORS.forEach(function (r) {
    it('residual [' + r.id + '] is still present (carving it forces removal from the allowlist)', function () {
      expect(SYNC_SRC.indexOf(r.anchor)).toBeGreaterThan(-1);
    });
  });
});

describe('sync() orchestrator shape — domain-predicate IfStatement ceiling (AST backstop)', function () {
  var espree = null;
  try { espree = require('espree'); } catch (e) { espree = null; }
  var runner = espree ? it : it.skip;

  runner('domain-predicate If count in sync() does not exceed the frozen ceiling', function () {
    var ast = espree.parse(SRC, { ecmaVersion: 2022, sourceType: 'script', range: true, loc: true });
    var syncNode = null;
    ast.body.forEach(function (n) {
      if (n.type === 'FunctionDeclaration' && n.id && n.id.name === 'sync') syncNode = n;
    });
    expect(syncNode).not.toBe(null);

    var DOMAIN_OBJS = { task: 1, ledger: 1, event: 1, newEvent: 1, bTask: 1, rTask: 1,
      fTask: 1, pushedTask: 1, newTask: 1, existingTask: 1, orphanMatch: 1 };
    var DISPATCH_RE = /Decision\.action|disposition\.action|missDecision\.|editDecision\.|pushDecision\.|pullDecision\.|ingestDecision\./;

    function walk(node, cb) {
      if (!node || typeof node.type !== 'string') return;
      cb(node);
      Object.keys(node).forEach(function (k) {
        if (k === 'range' || k === 'loc') return;
        var v = node[k];
        if (Array.isArray(v)) {
          v.forEach(function (c) { if (c && typeof c.type === 'string') walk(c, cb); });
        } else if (v && typeof v.type === 'string') {
          walk(v, cb);
        }
      });
    }

    var count = 0;
    walk(syncNode, function (n) {
      if (n.type !== 'IfStatement') return;
      var testStr = SRC.slice(n.test.range[0], n.test.range[1]);
      if (DISPATCH_RE.test(testStr)) return; // dispatch on a decision result — allowed
      var refsDomain = false;
      walk(n.test, function (m) {
        if (m.type === 'MemberExpression' && m.object &&
            m.object.type === 'Identifier' && DOMAIN_OBJS[m.object.name]) {
          refsDomain = true;
        }
      });
      if (refsDomain) count += 1;
    });

    expect(count).toBeLessThanOrEqual(DOMAIN_PREDICATE_IF_CEILING);
  });
});
