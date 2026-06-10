/**
 * W6 — Calendar slice boundary enforcement regression test.
 *
 * WHAT this proves:
 *   The `no-restricted-syntax` rules in eslint.boundaries.config.js are a
 *   REAL guard, not a silent no-op.  It does this via two complementary
 *   approaches:
 *
 *   1. Positive guard — runs `npm run lint:boundaries` via execSync and asserts
 *      exit 0 (no violations in the live src/ tree).  Uses the CLI so the test
 *      works without --experimental-vm-modules.
 *
 *   2. Negative guard — uses the ESLint v9 synchronous Linter API
 *      (Linter.verify, flat-config mode) to lint synthetic in-memory source
 *      strings.  No files are written to disk anywhere in the project tree.
 *      The virtual filePath argument tells ESLint which config block to apply;
 *      the file does not need to exist on disk.
 *
 * WHY the assertions are specific enough to catch a weakened rule:
 *   Each assertion targets the exact `ruleId` ("no-restricted-syntax") AND a
 *   substring of the human-readable message unique to the rule (e.g.
 *   "JUG-HEX-P7").  Removing or loosening the rule makes Linter.verify return
 *   0 messages, which fails the `expect(messages.length).toBe(1)` assertion.
 *   Changing only the message wording fails the `.toContain()` assertion.
 *
 * JUG-HEX-W6 — boundary guard regression.
 */

'use strict';

const path = require('path');
const { execSync } = require('child_process');
const { Linter } = require('eslint');

// Absolute paths so tests are location-independent.
const BACKEND_ROOT = path.resolve(__dirname, '../..');
const CONFIG_FILE = path.resolve(BACKEND_ROOT, 'eslint.boundaries.config.js');

// A virtual non-exempt consumer path — same pattern controllers use.
const CONSUMER_VIRTUAL_FILE = 'src/controllers/fake-controller-for-boundary-test.js';

// The flat config array loaded once for all Linter.verify calls.
const FLAT_CONFIG = require(CONFIG_FILE);

/** Returns a fresh Linter instance (synchronous, no dynamic-import required). */
function makeLinter() {
  return new Linter({ configType: 'flat' });
}

// ---------------------------------------------------------------------------
// Positive guard: the boundary lint must still pass for the real src/ tree.
// Runs `npm run lint:boundaries` via execSync — uses the CLI so no
// --experimental-vm-modules flag is required.
// ---------------------------------------------------------------------------
describe('W6 positive guard — lint:boundaries passes on src/', () => {
  test('npm run lint:boundaries exits 0 (no violations in src/)', () => {
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    try {
      stdout = execSync('npm run lint:boundaries', {
        cwd: BACKEND_ROOT,
        encoding: 'utf8',
        timeout: 30000,
      });
    } catch (err) {
      stdout = err.stdout || '';
      stderr = err.stderr || '';
      exitCode = err.status || 1;
    }

    if (exitCode !== 0) {
      throw new Error(
        `lint:boundaries exited ${exitCode} — boundary violations detected in src/.\n` +
        `stdout:\n${stdout}\nstderr:\n${stderr}\n` +
        '(Run `npm run lint:boundaries` directly for full output.)'
      );
    }

    expect(exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Negative guard: violations ARE caught — the rule is not a silent no-op.
// Uses Linter.verify (sync, flat-config) to lint in-memory strings.
// ---------------------------------------------------------------------------
describe('W6 negative guard — boundary violations are caught', () => {
  // --- adapters ---------------------------------------------------------------
  test('direct require of calendar adapter is reported as no-restricted-syntax', () => {
    const linter = makeLinter();
    const src = "const x = require('../../slices/calendar/adapters/GoogleCalendarAdapter');";
    const messages = linter.verify(src, FLAT_CONFIG, {
      filename: CONSUMER_VIRTUAL_FILE,
    });

    expect(messages.length).toBe(1);
    expect(messages[0].ruleId).toBe('no-restricted-syntax');
    expect(messages[0].message).toContain('JUG-HEX-P7');
    expect(messages[0].message).toContain('calendar adapter');
  });

  // --- domain/ports -----------------------------------------------------------
  test('direct require of calendar port is reported as no-restricted-syntax', () => {
    const linter = makeLinter();
    const src = "const x = require('../../slices/calendar/domain/ports/CalendarPort');";
    const messages = linter.verify(src, FLAT_CONFIG, {
      filename: CONSUMER_VIRTUAL_FILE,
    });

    expect(messages.length).toBe(1);
    expect(messages[0].ruleId).toBe('no-restricted-syntax');
    expect(messages[0].message).toContain('JUG-HEX-P7');
    expect(messages[0].message).toContain('calendar port');
  });

  // --- domain/entities --------------------------------------------------------
  test('direct require of calendar entity is reported as no-restricted-syntax', () => {
    const linter = makeLinter();
    const src = "const x = require('../../slices/calendar/domain/entities/CalendarEvent');";
    const messages = linter.verify(src, FLAT_CONFIG, {
      filename: CONSUMER_VIRTUAL_FILE,
    });

    expect(messages.length).toBe(1);
    expect(messages[0].ruleId).toBe('no-restricted-syntax');
    expect(messages[0].message).toContain('JUG-HEX-P7');
    expect(messages[0].message).toContain('calendar entity');
  });

  // --- severity ---------------------------------------------------------------
  test('violations are reported at error severity (2), not just warnings', () => {
    const linter = makeLinter();
    const src = "const x = require('../../slices/calendar/adapters/SomeAdapter');";
    const messages = linter.verify(src, FLAT_CONFIG, {
      filename: CONSUMER_VIRTUAL_FILE,
    });

    expect(messages[0].severity).toBe(2); // 1 = warn, 2 = error
  });
});

// ---------------------------------------------------------------------------
// Control: approved imports produce NO violations.
// ---------------------------------------------------------------------------
describe('W6 control — approved imports are not flagged', () => {
  test('require of the facade produces zero messages', () => {
    const linter = makeLinter();
    const src = "const cal = require('../../slices/calendar/facade');";
    const messages = linter.verify(src, FLAT_CONFIG, {
      filename: CONSUMER_VIRTUAL_FILE,
    });

    expect(messages.length).toBe(0);
  });

  test('require of an unrelated module produces zero messages', () => {
    const linter = makeLinter();
    const src = "const x = require('../../lib/utils');";
    const messages = linter.verify(src, FLAT_CONFIG, {
      filename: CONSUMER_VIRTUAL_FILE,
    });

    expect(messages.length).toBe(0);
  });

  // The facade itself is exempt — it may require its own slice internals.
  test('facade file is exempt: direct adapter import from facade.js produces zero messages', () => {
    const linter = makeLinter();
    const src = "const x = require('./adapters/GoogleCalendarAdapter');";
    const messages = linter.verify(src, FLAT_CONFIG, {
      filename: 'src/slices/calendar/facade.js',
    });

    expect(messages.length).toBe(0);
  });

  // Adapter files themselves are also exempt.
  test('adapter files are exempt: internal import from adapter produces zero messages', () => {
    const linter = makeLinter();
    const src = "const x = require('../domain/ports/CalendarPort');";
    const messages = linter.verify(src, FLAT_CONFIG, {
      filename: 'src/slices/calendar/adapters/SomeAdapter.js',
    });

    expect(messages.length).toBe(0);
  });
});
