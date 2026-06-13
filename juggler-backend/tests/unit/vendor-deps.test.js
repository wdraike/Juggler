'use strict';
/**
 * vendor-deps.test.js - regression guard for BUG-407 + 999.443
 *
 * Asserts that @raike/lib-logger, @raike/lib-db, and mysql2 all resolve
 * within the juggler-backend module tree - specifically within juggler-backend/
 * itself (vendor/ or node_modules/ local to this service), NOT from any hoisted
 * ancestor node_modules.
 *
 * The Docker build failure class this guards:
 *   The Docker COPY context only includes juggler-backend/. Any dependency
 *   resolved from outside that directory (e.g. DEV/packages/X or a hoisted
 *   DEV/node_modules/X) is missing inside the image and causes a
 *   "Cannot find module" crash at startup.
 *
 * Why plain require() / require.resolve() WITHOUT paths: would NOT catch this:
 *   - @raike/lib-logger and @raike/lib-db: the pre-fix declaration was
 *     file:../../packages/lib-X, which resolves fine on the dev host (packages/
 *     exists at DEV/packages/). A bare require() on the dev host walks up and
 *     finds DEV/packages/lib-X/src/index.js - the test stays GREEN even though
 *     the Docker image will crash.
 *   - mysql2: the pre-fix tree removed it from juggler-backend/package.json, but
 *     DEV/node_modules/mysql2 exists (hoisted). A bare require('mysql2') stays
 *     GREEN on the dev host while the Docker image has no mysql2 at all.
 *
 * Fix: use require.resolve(module, { paths: [backendDir] }) and assert the
 * resolved path starts with backendDir. If the module resolves from a hoisted
 * ancestor the assertion fails - mirroring exactly what happens in Docker.
 *
 * RED on pre-fix tree (6 tests RED):
 *   Tests 1-3 (path-scoped resolution assertions):
 *     - @raike/lib-logger: file:../../packages/lib-logger -> resolved to DEV/packages/,
 *       which is outside backendDir -> test 1 RED
 *     - @raike/lib-db: same -> test 2 RED
 *     - mysql2: removed from package.json -> resolved to hoisted DEV/node_modules/
 *       (outside backendDir) -> test 3 RED
 *   Tests 4-6 (package.json pin assertions):
 *     - @raike/lib-logger declared as file:../../packages/lib-logger ->
 *       fails /^file:\.\/vendor\// -> test 4 RED
 *     - @raike/lib-db: same -> test 5 RED
 *     - mysql2 absent from package.json -> test 6 RED
 *
 * GREEN on post-fix tree:
 *   - @raike/lib-logger: file:./vendor/lib-logger -> symlink in local node_modules
 *     pointing to juggler-backend/vendor/lib-logger (within backendDir) -> PASS
 *   - @raike/lib-db: file:./vendor/lib-db -> same pattern -> PASS
 *   - mysql2: ^3.9.2 restored -> juggler-backend/node_modules/mysql2 (within backendDir) -> PASS
 *   - package.json pins: all three match expected patterns -> PASS
 *
 * No DB, no Docker, no test-bed required.
 * Traceability: BUG-407 (juggler-deploy-libvendor leg); 999.443 (vendor-guard-gittrack leg)
 */

const path = require('path');
const { execFileSync } = require('child_process');

// juggler-backend/ - the Docker COPY root. Resolution must land inside here.
const BACKEND_DIR = path.resolve(__dirname, '../..');

// Checked once at module load so the (gitAvailable ? it : it.skip) selector
// below produces a visible Jest SKIP (○) rather than a vacuous green pass.
var gitAvailable = true;
try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch (_) { gitAvailable = false; }

describe('BUG-407 regression guard - vendor dependency resolution', () => {
  /**
   * Tests 1-3: path-scoped resolution.
   *
   * require.resolve(m, { paths: [BACKEND_DIR] }) starts the search at
   * BACKEND_DIR/node_modules (walking upward from there if not found in BACKEND_DIR).
   * We then assert the resolved absolute path starts with BACKEND_DIR -
   * so if the module falls through to a hoisted ancestor the assertion fails,
   * mirroring the missing-module crash inside Docker.
   */
  it('resolves @raike/lib-logger from within juggler-backend (not hoisted ancestor)', function () {
    var resolved;
    expect(function () {
      resolved = require.resolve('@raike/lib-logger', { paths: [BACKEND_DIR] });
    }).not.toThrow();
    // Must land inside juggler-backend/ (vendor/ symlink or local node_modules).
    // Pre-fix: resolves to DEV/packages/lib-logger - outside BACKEND_DIR -> FAIL.
    expect(resolved.indexOf(BACKEND_DIR)).toBe(0);
  });

  it('resolves @raike/lib-db from within juggler-backend (not hoisted ancestor)', function () {
    var resolved;
    expect(function () {
      resolved = require.resolve('@raike/lib-db', { paths: [BACKEND_DIR] });
    }).not.toThrow();
    // Pre-fix: resolves to DEV/packages/lib-db - outside BACKEND_DIR -> FAIL.
    expect(resolved.indexOf(BACKEND_DIR)).toBe(0);
  });

  it('resolves mysql2 from within juggler-backend (not hoisted ancestor)', function () {
    var resolved;
    expect(function () {
      resolved = require.resolve('mysql2', { paths: [BACKEND_DIR] });
    }).not.toThrow();
    // Pre-fix: mysql2 removed from package.json -> resolves to hoisted DEV/node_modules/mysql2
    // (outside BACKEND_DIR) -> FAIL.
    expect(resolved.indexOf(BACKEND_DIR)).toBe(0);
  });

  /**
   * Tests 4-6: package.json declaration pins.
   *
   * These guard against the declaration being changed back to the wrong form:
   *   - file:../../packages/X -> outside Docker context -> FAIL
   *   - missing mysql2 entry -> automated "unused dependency" removal -> FAIL
   */
  it('package.json declares @raike/lib-logger as file:./vendor/lib-logger', function () {
    // Pins the vendor path - catches re-pointing back to file:../../packages/lib-logger
    var pkg = require('../../package.json');
    expect(pkg.dependencies['@raike/lib-logger']).toMatch(/^file:\.\/vendor\//);
  });

  it('package.json declares @raike/lib-db as file:./vendor/lib-db', function () {
    // Pins the vendor path - catches re-pointing back to file:../../packages/lib-db
    var pkg = require('../../package.json');
    expect(pkg.dependencies['@raike/lib-db']).toMatch(/^file:\.\/vendor\//);
  });

  it('package.json declares mysql2 at ^3.x (knex driver - must not be removed as "unused")', function () {
    // Catches re-removal of mysql2 by automated "unused dependency" tools.
    // Also pins the ^3.x range restored in BUG-407.
    var pkg = require('../../package.json');
    expect(pkg.dependencies['mysql2']).toBeDefined();
    expect(pkg.dependencies['mysql2']).toMatch(/^\^3\./);
  });

  /**
   * Tests 7-8 (999.443): git-tracking assertions.
   *
   * Path-scoped resolution (tests 1-2) confirms the files are PRESENT on disk and
   * resolve within BACKEND_DIR, but does NOT catch a future accidental re-gitignore
   * of vendor/. On the dev host the files remain on disk and tests 1-2 stay GREEN;
   * a fresh CI checkout lacks them and the image crashes.
   *
   * `git ls-files vendor/<pkg>` lists only files that git KNOWS about (committed or
   * staged). If vendor/<pkg>/ were gitignored or removed from the index the output is
   * empty and the assertion fails — even if the files exist on disk.
   *
   * When git is not available (e.g. a stripped container CI image without a git
   * binary) the test is registered as `it.skip` so Jest reports it as a visible
   * SKIP (○) rather than a vacuous green pass. The `gitAvailable` flag is evaluated
   * once at module load (see top of file) so the selector is resolved before any
   * test runs — no runtime branch inside the test body.
   *
   * RED-meaningfulness: `git ls-files` reads the git index; it cannot return non-empty
   * output for a path that is gitignored or untracked. An assertion on its stdout is
   * NOT a constant — it changes when the index changes.
   */
  // (gitAvailable ? it : it.skip): git present → runs assertion; git absent → visible SKIP (○), not a green pass.
  (gitAvailable ? it : it.skip)('vendor/lib-db source is git-tracked (999.443: guard against re-gitignore of vendor/)', function () {
    var output = execFileSync('git', ['ls-files', 'vendor/lib-db'], { cwd: BACKEND_DIR }).toString().trim();
    // Non-empty output means vendor/lib-db files are committed to the index.
    // Empty output means gitignored or untracked — RED.
    expect(output.length).toBeGreaterThan(0);
  });

  // (gitAvailable ? it : it.skip): git present → runs assertion; git absent → visible SKIP (○), not a green pass.
  (gitAvailable ? it : it.skip)('vendor/lib-logger source is git-tracked (999.443: guard against re-gitignore of vendor/)', function () {
    var output = execFileSync('git', ['ls-files', 'vendor/lib-logger'], { cwd: BACKEND_DIR }).toString().trim();
    expect(output.length).toBeGreaterThan(0);
  });

  /**
   * Tests 9-11 (999.454): @raike/lib-error-ingest — same deploy-trap guard.
   *
   * juggler consumes the shared browser-error ingest router via file:./vendor/lib-error-ingest
   * (app.js mounts createClientErrorsRouter). Identical 999.407/999.443 risk: a bare require
   * resolves on the dev host even if the declaration re-points to packages/ or vendor/ is
   * re-gitignored, while a clean CI checkout crashes "Cannot find module @raike/lib-error-ingest"
   * at startup. Path-scoped resolution + package.json pin + git-tracking close all three holes.
   */
  it('resolves @raike/lib-error-ingest from within juggler-backend (not hoisted ancestor)', function () {
    var resolved;
    expect(function () {
      resolved = require.resolve('@raike/lib-error-ingest', { paths: [BACKEND_DIR] });
    }).not.toThrow();
    // Pre-fix: would resolve to DEV/packages/lib-error-ingest - outside BACKEND_DIR -> FAIL.
    expect(resolved.indexOf(BACKEND_DIR)).toBe(0);
  });

  it('package.json declares @raike/lib-error-ingest as file:./vendor/lib-error-ingest', function () {
    // Pins the vendor path - catches re-pointing back to file:../../packages/lib-error-ingest.
    var pkg = require('../../package.json');
    expect(pkg.dependencies['@raike/lib-error-ingest']).toMatch(/^file:\.\/vendor\//);
  });

  // (gitAvailable ? it : it.skip): git present → runs assertion; git absent → visible SKIP (○), not a green pass.
  (gitAvailable ? it : it.skip)('vendor/lib-error-ingest source is git-tracked (999.454: guard against re-gitignore of vendor/)', function () {
    var output = execFileSync('git', ['ls-files', 'vendor/lib-error-ingest'], { cwd: BACKEND_DIR }).toString().trim();
    // Non-empty output means vendor/lib-error-ingest files are committed to the index. Empty = RED.
    expect(output.length).toBeGreaterThan(0);
  });
});
