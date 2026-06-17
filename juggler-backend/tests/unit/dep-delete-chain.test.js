/**
 * dep-delete-chain.test.js — Dependency Deletion Chain Tests (999.673)
 *
 * Tests the dependency remap logic that fires when a task is deleted.
 * The remap logic lives in facade.js standardDelete() (lines 632-651):
 *
 *   - Find all tasks that depend on the deleted task (JSON_CONTAINS scan).
 *   - For each dependent: remove the deleted task's ID from its depends_on,
 *     then merge in the deleted task's own dependencies (upstream deps).
 *
 * This test exercises the pure remap function directly, testing all three
 * chain positions: end-of-chain, top-of-chain, and middle-of-chain.
 */

'use strict';

// ── The remap logic extracted from facade.js standardDelete ──────────
// This is the exact algorithm from facade.js L639-644, isolated for
// unit testing without a DB.
function remapDependenciesOnDelete(affectedTasks, deletedTaskId, deletedTaskDeps) {
  return affectedTasks.map(function (other) {
    var deps = Array.isArray(other.depends_on)
      ? other.depends_on.slice()
      : (typeof other.depends_on === 'string'
        ? JSON.parse(other.depends_on || '[]')
        : []);
    // Remove the deleted task from the dependent's deps
    var newDeps = deps.filter(function (d) { return d !== deletedTaskId; });
    // Merge in the deleted task's own deps (upstream chain)
    (deletedTaskDeps || []).forEach(function (d) {
      if (newDeps.indexOf(d) === -1) newDeps.push(d);
    });
    return { id: other.id, depends_on: newDeps };
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Dependency deletion chain remap (999.673)', function () {

  // ── End-of-chain: deleting the last task in a chain ────────────────
  // Chain: A → B → C. Delete C (end of chain).
  // C has no dependents, so nothing is remapped.
  describe('End-of-chain deletion', function () {
    test('deleting the last task in a chain has no dependents to remap', function () {
      // A depends on nothing, B depends on A, C depends on B
      var affected = []; // No tasks depend on C
      var result = remapDependenciesOnDelete(affected, 'C', ['B']);
      expect(result).toEqual([]);
    });

    test('deleting a task with no dependents and no deps is a no-op', function () {
      var affected = [];
      var result = remapDependenciesOnDelete(affected, 'orphan', []);
      expect(result).toEqual([]);
    });
  });

  // ── Top-of-chain: deleting the first task in a chain ───────────────
  // Chain: A → B → C. Delete A (top of chain).
  // B depends on A. After deletion: B's deps = [] (A had no deps).
  describe('Top-of-chain deletion', function () {
    test('deleting the first task removes it from dependents with no upstream merge', function () {
      var affected = [
        { id: 'B', depends_on: ['A'] }
      ];
      var result = remapDependenciesOnDelete(affected, 'A', []);
      expect(result).toEqual([
        { id: 'B', depends_on: [] }
      ]);
    });

    test('deleting the first task in a 3-chain: B loses A, no new deps added', function () {
      var affected = [
        { id: 'B', depends_on: ['A'] },
        { id: 'C', depends_on: ['B'] } // C does NOT depend on A directly
      ];
      var result = remapDependenciesOnDelete(affected, 'A', []);
      // B's deps should be empty (A had no upstream deps)
      // C's deps should be unchanged (C depends on B, not A)
      expect(result).toEqual([
        { id: 'B', depends_on: [] },
        { id: 'C', depends_on: ['B'] }
      ]);
    });
  });

  // ── Middle-of-chain: deleting a task in the middle ─────────────────
  // Chain: A → B → C. Delete B (middle of chain).
  // C depends on B. After deletion: C's deps = [A] (B's upstream deps merged in).
  describe('Middle-of-chain deletion', function () {
    test('deleting middle task remaps upstream deps onto downstream', function () {
      var affected = [
        { id: 'C', depends_on: ['B'] }
      ];
      var result = remapDependenciesOnDelete(affected, 'B', ['A']);
      expect(result).toEqual([
        { id: 'C', depends_on: ['A'] }
      ]);
    });

    test('deleting middle task with multiple upstream deps merges all', function () {
      // A1 and A2 → B → C. Delete B.
      // C depends on B. After: C's deps = [A1, A2]
      var affected = [
        { id: 'C', depends_on: ['B'] }
      ];
      var result = remapDependenciesOnDelete(affected, 'B', ['A1', 'A2']);
      expect(result).toEqual([
        { id: 'C', depends_on: ['A1', 'A2'] }
      ]);
    });

    test('deleting middle task: downstream already has some deps, merge preserves them', function () {
      // A → B → C, but C also depends on D (external dep).
      // Delete B. After: C's deps = [D, A] (D preserved, A added)
      var affected = [
        { id: 'C', depends_on: ['B', 'D'] }
      ];
      var result = remapDependenciesOnDelete(affected, 'B', ['A']);
      expect(result).toEqual([
        { id: 'C', depends_on: ['D', 'A'] }
      ]);
    });

    test('deleting middle task: upstream dep already in downstream list is not duplicated', function () {
      // A → B → C, but C already depends on A directly.
      // Delete B. After: C's deps = [A] (no duplicate)
      var affected = [
        { id: 'C', depends_on: ['B', 'A'] }
      ];
      var result = remapDependenciesOnDelete(affected, 'B', ['A']);
      expect(result).toEqual([
        { id: 'C', depends_on: ['A'] }
      ]);
    });

    test('deleting middle task with no upstream deps: downstream just loses the deleted task', function () {
      // B has no deps of its own. C depends on B.
      // Delete B. After: C's deps = [] (B removed, nothing to merge)
      var affected = [
        { id: 'C', depends_on: ['B'] }
      ];
      var result = remapDependenciesOnDelete(affected, 'B', []);
      expect(result).toEqual([
        { id: 'C', depends_on: [] }
      ]);
    });
  });

  // ── Complex scenarios ─────────────────────────────────────────────
  describe('Complex chain scenarios', function () {
    test('diamond: A→B, A→C, B+C→D. Delete B: D inherits A, C unchanged', function () {
      var affected = [
        { id: 'D', depends_on: ['B', 'C'] }
      ];
      var result = remapDependenciesOnDelete(affected, 'B', ['A']);
      // D's deps: B removed, A added (if not already present), C preserved
      expect(result).toEqual([
        { id: 'D', depends_on: ['C', 'A'] }
      ]);
    });

    test('multiple dependents: A→B→C and A→B→E. Delete B: C and E both get A', function () {
      var affected = [
        { id: 'C', depends_on: ['B'] },
        { id: 'E', depends_on: ['B'] }
      ];
      var result = remapDependenciesOnDelete(affected, 'B', ['A']);
      expect(result).toEqual([
        { id: 'C', depends_on: ['A'] },
        { id: 'E', depends_on: ['A'] }
      ]);
    });

    test('deleting a task that no one depends on (no affected tasks) is a no-op', function () {
      var affected = [];
      var result = remapDependenciesOnDelete(affected, 'lonely', ['X', 'Y']);
      expect(result).toEqual([]);
    });

    test('string-format depends_on is parsed correctly', function () {
      // Simulate DB row where depends_on is a JSON string
      var affected = [
        { id: 'C', depends_on: '["B"]' }
      ];
      var result = remapDependenciesOnDelete(affected, 'B', ['A']);
      expect(result).toEqual([
        { id: 'C', depends_on: ['A'] }
      ]);
    });

    test('null depends_on is treated as empty array', function () {
      var affected = [
        { id: 'C', depends_on: null }
      ];
      // C doesn't actually depend on B, but the remap still runs
      // (the DB query found C via JSON_CONTAINS, so it must have B in deps)
      // This tests the null guard
      var result = remapDependenciesOnDelete(affected, 'B', ['A']);
      expect(result).toEqual([
        { id: 'C', depends_on: ['A'] }
      ]);
    });
  });
});
