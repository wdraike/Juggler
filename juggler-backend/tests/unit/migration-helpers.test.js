'use strict';

/**
 * migration-helpers.test.js — unit characterization for
 * src/db/migration-helpers.js (999.1096 + 999.1189). No DB required.
 *
 * 999.1096: the legacy portableViewSql copies (inlined byte-identically in
 * the five applied view migrations) collapsed the whole
 * 'CREATE ALGORITHM=... DEFINER=... SQL SECURITY <type> VIEW' preamble to a
 * bare 'CREATE VIEW', silently normalizing every recreated view to MySQL's
 * default SQL SECURITY DEFINER. The shared helper now preserves the
 * original clause. This file characterizes BOTH behaviors so the before/
 * after difference is pinned: identical view body, only the SQL SECURITY
 * clause is now retained.
 */

var {
  portableViewSql,
  replaceAll,
  countOccurrences
} = require('../../src/db/migration-helpers');

// Byte-identical legacy behavior from the applied migrations (20260624120000,
// 20260703190000, 20260703210000, 20260703220000, 20260709120000). Kept here
// as the characterization baseline — those files are immutable once applied
// (juggler CLAUDE.md 999.733) and never run again in environments that
// already recorded them.
function legacyPortableViewSql(createViewStmt) {
  return String(createViewStmt)
    .replace(/^CREATE\s+ALGORITHM=\S+\s+DEFINER=`[^`]+`@`[^`]+`\s+SQL SECURITY \w+\s+VIEW/i, 'CREATE VIEW');
}

var BODY = '`tasks_v` AS select `m`.`id` AS `id`,`m`.`next_start` AS `next_start` ' +
  'from `task_masters` `m`';
var DEFINER_STMT = 'CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW ' + BODY;
var INVOKER_STMT = 'CREATE ALGORITHM=UNDEFINED DEFINER=`resumeapp`@`10.1.0.7` SQL SECURITY INVOKER VIEW ' + BODY;

describe('portableViewSql — SQL SECURITY preservation (999.1096)', function () {
  test('preserves SQL SECURITY DEFINER', function () {
    expect(portableViewSql(DEFINER_STMT)).toBe('CREATE SQL SECURITY DEFINER VIEW ' + BODY);
  });

  test('preserves SQL SECURITY INVOKER (the 999.1096 bug case)', function () {
    expect(portableViewSql(INVOKER_STMT)).toBe('CREATE SQL SECURITY INVOKER VIEW ' + BODY);
  });

  test('still strips environment-specific ALGORITHM and DEFINER', function () {
    var out = portableViewSql(INVOKER_STMT);
    expect(out).not.toMatch(/ALGORITHM=/);
    expect(out).not.toMatch(/DEFINER=/);
  });

  test('leaves an already-portable statement unchanged', function () {
    var portable = 'CREATE VIEW ' + BODY;
    expect(portableViewSql(portable)).toBe(portable);
  });

  describe('characterization vs the legacy inlined helper', function () {
    test('view body is byte-identical to legacy output for DEFINER and INVOKER inputs', function () {
      [DEFINER_STMT, INVOKER_STMT].forEach(function (stmt) {
        var current = portableViewSql(stmt);
        var legacy = legacyPortableViewSql(stmt);
        // Compare everything from 'VIEW `' onward — the definition body.
        expect(current.slice(current.indexOf('VIEW `'))).toBe(legacy.slice(legacy.indexOf('VIEW `')));
      });
    });

    test('legacy helper dropped the SQL SECURITY clause (documents the old bug)', function () {
      expect(legacyPortableViewSql(INVOKER_STMT)).toBe('CREATE VIEW ' + BODY);
      expect(legacyPortableViewSql(INVOKER_STMT)).not.toMatch(/SQL SECURITY/);
    });

    test('only difference from legacy output is the preserved SQL SECURITY clause', function () {
      expect(portableViewSql(DEFINER_STMT)).toBe(
        legacyPortableViewSql(DEFINER_STMT).replace(/^CREATE VIEW/, 'CREATE SQL SECURITY DEFINER VIEW')
      );
    });
  });
});

describe('replaceAll / countOccurrences (literal, no regex)', function () {
  test('replaceAll replaces every literal occurrence', function () {
    expect(replaceAll('a.b a.b a.b', 'a.b', 'x')).toBe('x x x');
  });

  test('replaceAll treats needle literally (regex metachars inert)', function () {
    expect(replaceAll('cast(NULL as date) AS `x`,cast(NULL as date) AS `y`', 'cast(NULL as date)', 'Z'))
      .toBe('Z AS `x`,Z AS `y`');
  });

  test('countOccurrences counts literal occurrences', function () {
    expect(countOccurrences('`i`.`c` AS `c` union `i`.`c` AS `c`', '`i`.`c` AS `c`')).toBe(2);
    expect(countOccurrences('nothing here', 'absent')).toBe(0);
  });
});
