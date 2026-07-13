// Scoped ESLint config for architecture boundary enforcement only.
// Loaded by `npm run lint:boundaries`. Does NOT include general lint rules
// so the gate passes without being blocked by pre-existing unrelated errors.
//
// Uses no-restricted-syntax (not no-restricted-imports) because the codebase is CommonJS —
// no-restricted-imports only catches ES module `import` syntax, not `require()` calls.
//
// --no-inline-config: source files may contain eslint-disable comments for rules not
// loaded by this config; without --no-inline-config those disable comments would cause
// "rule not found" errors.
//
// JUG-HEX-P7: Initial boundary config — calendar slice only.
// Further slices (Task, Scheduler, Weather, User, AI) will be added as JUG-HEX-P2–P6 land.
//
// Boundary rule: ALL code outside the calendar slice must access calendar functionality
// only via the public facade (slices/calendar/facade.js). Direct imports of adapters,
// ports, or domain entities from outside the slice are forbidden.

// --- Per-slice boundary helpers (single-source the copy-paste blocks) ---
//
// Each slice declares: name, ref tag, the list of restricted internal subpaths
// (each carrying its own message text), the facade files that may import internals,
// the adapters exemption glob, and the optional domain/application exemption globs.
// `restriction()` builds one no-restricted-syntax selector object; `sliceRules()`
// maps a slice's restrictions to selector objects; `sliceExemptions()` builds the
// per-slice "off" override blocks in the canonical order
// (facade(+index), adapters, [domain/application], tests).

// Build a single no-restricted-syntax selector object for a slice subpath.
// `subpath` is a slash-separated path under slices/<name>/ (e.g. 'adapters',
// 'domain/ports'). `label` is the human noun in the message (e.g. 'adapter').
// `tail` is the exact text following "...require('./slices/<name>/facade')" —
// normally "." (period only), but some slices append extra prose (e.g. weather
// value-object: " (it re-exports GeoPoint + roundCoord/gridValue).") or a port
// sentence. It always ends just before the " See <ref>." suffix.
function restriction(name, subpath, label, ref, tail) {
  const escaped = subpath.split('/').join('\\/');
  return {
    selector:
      "CallExpression[callee.name='require'] > Literal[value=/slices\\/" +
      name + '\\/' + escaped + "\\//]",
    message:
      'Direct import of ' + name + ' ' + label + ' is forbidden. ' +
      "Use the facade: require('./slices/" + name + "/facade')" +
      tail + ' See ' + ref + '.'
  };
}

// Standard message tails.
const TAIL_PLAIN = '.';
const TAIL_PORT = '. Ports are consumed only by adapters and the facade.';

// Non-slice boundary: lib/tasks-write.js (999.1199). The master/instance
// write module is internal to the task slice's Knex adapter — external
// writers use the task slice facade's exported KnexTaskRepository class
// (`require('./slices/task/facade').KnexTaskRepository`), constructed over
// their own db/trx handle as a lightweight "transaction token", instead of
// requiring the raw module directly. Not slice-shaped (lib/, not
// slices/<name>/<subpath>/), so it is a standalone selector rather than a
// SLICES() entry. Enforced everywhere EXCEPT slices/task/adapters/** (which
// already gets no-restricted-syntax turned off by the task slice's own
// adapters exemption below) and every other slice's adapters/** directories
// (pre-existing broad exemptions, not widened by this rule).
const TASKS_WRITE_RESTRICTION = {
  selector:
    "CallExpression[callee.name='require'] > Literal[value=/(^|\\/)tasks-write$/]",
  message:
    'Direct import of lib/tasks-write is forbidden outside slices/task/adapters. ' +
    "Use the task slice facade's KnexTaskRepository instead: " +
    "require('./slices/task/facade').KnexTaskRepository (construct with " +
    '{ db: trxOrDb } as a transaction token). See 999.1199.'
};

// Direct-db import ban (JUG-NO-SLICE-BOUNDARY-ENFORCEMENT). DB access belongs
// in slice adapters behind repository ports. Two selectors because the module
// is reachable two ways: the legacy root module (src/db.js, any `../`-relative
// depth, incl. `../../src/db`) and the lib module (src/lib/db + the vendored
// @raike/lib-db it wraps). AST selectors — comments that merely mention
// require('../../db') (e.g. taskMappers.js:25 header) never match.
// Grandfathered legacy call sites are listed EXPLICITLY in
// DB_GRANDFATHERED_FILES below — a ratchet: the list only shrinks, never grows.
const DB_DIRECT_SELECTORS = [
  {
    selector:
      "CallExpression[callee.name='require'] > Literal[value=/^(\\.\\.?\\/)+(src\\/)?db$/]",
    message:
      'Direct import of the db module is forbidden — DB access goes through the owning ' +
      "slice's facade/repository port (adapters are the only DB layer). Legacy sites are " +
      'grandfathered in eslint.boundaries.config.js DB_GRANDFATHERED_FILES; do not add new ones. ' +
      'See JUG-NO-SLICE-BOUNDARY-ENFORCEMENT.'
  },
  {
    selector:
      "CallExpression[callee.name='require'] > Literal[value=/(^|\\/)lib[-\\/]db$/]",
    message:
      'Direct import of lib/db (or @raike/lib-db) is forbidden — DB access goes through the ' +
      "owning slice's facade/repository port (adapters are the only DB layer). Legacy sites are " +
      'grandfathered in eslint.boundaries.config.js DB_GRANDFATHERED_FILES; do not add new ones. ' +
      'See JUG-NO-SLICE-BOUNDARY-ENFORCEMENT.'
  }
];

// Domain-purity selectors (JUG-NO-SLICE-BOUNDARY-ENFORCEMENT): slice domain
// code must have zero infrastructure dependencies — no DB, no HTTP/express,
// no Redis, no SDKs, no Node IO, and no adapter imports (not even its own
// slice's). Currently ZERO violations (verified 2026-07-13, incl. transitive
// requires of taskMappers' helpers) — this block locks that in so the
// 2026-07-11 hex-audit class of claim is machine-checkable instead of
// grep-guessable.
const DOMAIN_PURITY_SELECTORS = [
  {
    selector:
      "CallExpression[callee.name='require'] > Literal[value=/^(node:)?(knex|mysql2|express|axios|node-fetch|ioredis|redis|googleapis|bcrypt|bcryptjs|argon2|jsonwebtoken|nodemailer|fs|child_process|net|http|https)(\\/|$)/]",
    message:
      'Infrastructure package import inside slice domain code — domain must stay pure ' +
      '(no DB/HTTP/Redis/SDK/Node-IO). Depend on a port and let an adapter own the ' +
      'infrastructure. See JUG-NO-SLICE-BOUNDARY-ENFORCEMENT.'
  },
  {
    selector:
      "CallExpression[callee.name='require'] > Literal[value=/(^|\\/)adapters(\\/|$)/]",
    message:
      'Adapter import inside slice domain code — domain depends on ports only; wiring ' +
      'adapters to ports happens in the facade/application layer. ' +
      'See JUG-NO-SLICE-BOUNDARY-ENFORCEMENT.'
  }
];

// Ratchet list: production files that ALREADY require the db module directly.
// Each entry is an exact path. REMOVE entries as their refactors land
// (JUG-FACADE-DB-VIOLATIONS, JUG-SCHEDULER-LEGACY-DB-BYPASS, MCP/middleware
// slice work); NEVER add one — new code uses slice facades/ports.
// (Facades + slices/*/adapters/** + src/scheduler/*.js are NOT listed: their
// own exemption blocks below already turn no-restricted-syntax off / replace
// it. src/app.js, src/server.js, src/db.js, src/db/**, src/lib/db/** are the
// composition roots + the db modules themselves — permanently allowed via
// DB_ALLOWED_FILES, not this ratchet.)
const DB_GRANDFATHERED_FILES = [
  '**/src/controllers/cal-sync.controller.js',
  '**/src/cron/cal-history-cron.js',
  '**/src/jobs/morning-schedule-cron.js',
  '**/src/lib/push-subscriptions.js',
  '**/src/lib/sync-lock.js',
  '**/src/lib/task-write-queue.js',
  '**/src/mcp/getUserTimezone.js',
  '**/src/mcp/tools/config.js',
  '**/src/mcp/tools/data.js',
  '**/src/mcp/tools/tasks.js',
  '**/src/mcp/transport.js',
  '**/src/middleware/calendar-limit.js',
  '**/src/middleware/feature-gate.js',
  '**/src/middleware/jwt-auth.js',
  '**/src/routes/health.diagnostics.js',
  '**/src/routes/health.routes.js',
  '**/src/routes/my-plan.routes.js'
];

// Composition roots + the db modules themselves — allowed to touch the db
// module forever (they ARE the wiring/DB layer). Kept separate from the
// ratchet list so "shrink to zero" stays a meaningful goal for the latter.
const DB_ALLOWED_FILES = [
  '**/src/app.js',
  '**/src/server.js',
  '**/src/db.js',
  '**/src/db/**/*.js',
  '**/src/lib/db/**/*.js'
];

// Map a slice descriptor to its array of selector objects.
function sliceRules(slice) {
  return slice.restrictions.map((r) =>
    restriction(slice.name, r.subpath, r.label, slice.ref, r.tail || TAIL_PLAIN)
  );
}

// Build the per-slice exemption override blocks. `facadeFiles` is the glob list
// for the facade (+ index when re-exported). `extraExempt` is an optional glob
// list for the domain/application self-import exemption (omitted when absent).
function sliceExemptions(slice) {
  const blocks = [
    // JUG-FACADE-DB-VIOLATIONS ratchet: a slice that declares facadeDbClean
    // keeps its facade exempt from the SLICE-INTERNAL selectors (facades wire
    // their own internals by design) but gains the DB-direct ban — facades
    // delegate DB access to adapters. Flip per slice as its facade is purged;
    // never flip one back.
    {
      files: slice.facadeFiles,
      rules: {
        'no-restricted-syntax': slice.facadeDbClean
          ? ['error', ...DB_DIRECT_SELECTORS, TASKS_WRITE_RESTRICTION]
          : 'off'
      }
    },
    { files: ['**/slices/' + slice.name + '/adapters/**/*.js'], rules: { 'no-restricted-syntax': 'off' } }
  ];
  if (slice.extraExempt) {
    blocks.push({ files: slice.extraExempt, rules: { 'no-restricted-syntax': 'off' } });
  }
  blocks.push({
    files: [
      '**/slices/' + slice.name + '/**/*.test.js',
      '**/slices/' + slice.name + '/test-doubles/**/*.js'
    ],
    rules: { 'no-restricted-syntax': 'off' }
  });
  return blocks;
}

// Slice descriptors — single source of truth for rules AND exemptions.
const SLICES = [
  {
    name: 'calendar',
    ref: 'JUG-HEX-P7',
    facadeFiles: ['**/slices/calendar/facade.js'],
    restrictions: [
      { subpath: 'adapters', label: 'adapter' },
      { subpath: 'domain/ports', label: 'port', tail: TAIL_PORT },
      { subpath: 'domain/entities', label: 'entity' }
    ]
  },
  {
    name: 'weather',
    facadeDbClean: true, // verified db-free 2026-07-13 (JUG-FACADE-DB-VIOLATIONS stage 0)
    ref: 'JUG-HEX-H1 (W3)',
    facadeFiles: ['**/slices/weather/facade.js', '**/slices/weather/index.js'],
    restrictions: [
      { subpath: 'adapters', label: 'adapter' },
      { subpath: 'domain/ports', label: 'port', tail: TAIL_PORT },
      { subpath: 'domain/entities', label: 'entity' },
      { subpath: 'domain/value-objects', label: 'value-object', tail: ' (it re-exports GeoPoint + roundCoord/gridValue).' }
    ]
  },
  {
    name: 'task',
    ref: 'JUG-HEX-H3 (W6)',
    facadeFiles: ['**/slices/task/facade.js', '**/slices/task/index.js'],
    extraExempt: ['**/slices/task/application/**/*.js', '**/slices/task/domain/**/*.js'],
    restrictions: [
      { subpath: 'adapters', label: 'adapter' },
      { subpath: 'domain/ports', label: 'port', tail: TAIL_PORT },
      { subpath: 'domain/entities', label: 'entity' },
      { subpath: 'domain/value-objects', label: 'value-object' },
      { subpath: 'application', label: 'application use-case' }
    ]
  },
  {
    name: 'ai-enrichment',
    ref: 'JUG-HEX-H5 (W4)',
    facadeFiles: ['**/slices/ai-enrichment/facade.js'],
    extraExempt: ['**/slices/ai-enrichment/domain/**/*.js'],
    restrictions: [
      { subpath: 'adapters', label: 'adapter' },
      { subpath: 'domain/ports', label: 'port', tail: TAIL_PORT }
    ]
  },
  {
    name: 'user-config',
    ref: 'JUG-HEX-H4 (W6)',
    facadeFiles: ['**/slices/user-config/facade.js', '**/slices/user-config/index.js'],
    extraExempt: ['**/slices/user-config/application/**/*.js', '**/slices/user-config/domain/**/*.js'],
    restrictions: [
      { subpath: 'adapters', label: 'adapter' },
      { subpath: 'domain/ports', label: 'port', tail: TAIL_PORT },
      { subpath: 'domain/entities', label: 'entity' },
      { subpath: 'domain/value-objects', label: 'value-object' },
      { subpath: 'domain/logic', label: 'domain logic' },
      { subpath: 'application', label: 'application use-case' }
    ]
  },
  {
    name: 'scheduler',
    facadeDbClean: true, // purged 2026-07-13 (JUG-FACADE-DB-VIOLATIONS stage 1 — adapters/KnexDebugReads.js)
    ref: 'JUG-HEX-H6 / 999.435',
    facadeFiles: ['**/slices/scheduler/facade.js', '**/slices/scheduler/index.js'],
    extraExempt: ['**/slices/scheduler/application/**/*.js', '**/slices/scheduler/domain/**/*.js'],
    restrictions: [
      { subpath: 'adapters', label: 'adapter' },
      { subpath: 'domain/ports', label: 'port', tail: TAIL_PORT },
      { subpath: 'domain/entities', label: 'entity' },
      { subpath: 'domain/value-objects', label: 'value-object' },
      { subpath: 'domain/logic', label: 'domain logic' },
      { subpath: 'application', label: 'application use-case' }
    ]
  }
];

module.exports = [
  {
    // Scope: all .js files under the backend root.
    //
    // Excluded from boundary enforcement:
    //   - node_modules/**    — third-party deps
    //   - tests/**           — test specs (slice internals intentionally imported there)
    //   - **/*.test.js       — any test file pattern outside tests/
    //   - coverage/**        — Istanbul-generated output
    //   - dist/**            — compiled output
    //   - migrations/**      — Knex migration files (no slice access expected)
    //   - _*.js              — debug/scratch scripts
    //   - check*.js          — ad-hoc check scripts at repo root
    ignores: [
      'node_modules/**',
      'tests/**',
      '**/*.test.js',
      '**/*.spec.js',
      'coverage/**',
      'dist/**',
      'build/**',
      '**/migrations/**',
      '**/fixtures/**',
      '**/*.min.js',
      // Config files — not subject to boundary enforcement
      'jest.config.js',
      'knexfile.js',
      'eslint.config.js',
      'eslint.boundaries.config.js',
      // Debug/scratch scripts
      '_*.js',
      'check*.js',
      'debug*.js',
      'test-*.js',
    ]
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        global: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
      }
    },
    rules: {
      // Per-slice boundary selectors — single-sourced from SLICES (see helpers
      // above). Order is preserved: calendar, weather, task, ai-enrichment,
      // user-config; within each slice the restrictions array order is kept.
      'no-restricted-syntax': [
        'error',
        ...SLICES.flatMap(sliceRules),
        TASKS_WRITE_RESTRICTION,
        ...DB_DIRECT_SELECTORS
      ]
    }
  },
  // DB ratchet grandfather + composition-root allowance: REPLACE the base rule
  // with everything EXCEPT the db selectors for these exact files (a plain
  // 'off' would also disable the slice-facade selectors, regressing 999.1401's
  // un-exemption of cal-sync.controller.js). Placed BEFORE the slice exemption
  // blocks so facades/adapters still end up fully off as before.
  {
    files: [...DB_GRANDFATHERED_FILES, ...DB_ALLOWED_FILES],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...SLICES.flatMap(sliceRules),
        TASKS_WRITE_RESTRICTION
      ]
    }
  },
  // Per-slice exemption override blocks — single-sourced from SLICES (see
  // sliceExemptions above). Order is preserved: for each slice, facade(+index),
  // adapters, [domain/application self-imports], tests; slices in declaration
  // order (calendar, weather, task, ai-enrichment, user-config, scheduler).
  ...SLICES.flatMap(sliceExemptions),
  // Grandfather exemption (999.435): the legacy scheduler ENTRY files directly
  // under src/scheduler/ predate the H6 slice extraction and still import scheduler
  // slice internals directly (ScoreEngine/ConstraintSolver/ConflictResolver from
  // domain/logic, SchedulerTaskProvider from adapters, RunScheduleCommand from
  // application, PRI_RANK from domain/constants). Routing them through the facade is
  // a separate scheduler-hot-path refactor (risky — "scheduler bugs cascade", see
  // juggler CLAUDE.md), tracked as the H7B follow-up. They are exempted here so the
  // scheduler boundary rule still enforces the facade for ALL OTHER (new/external)
  // code today. The glob matches only the top-level legacy entry files
  // (src/scheduler/*.js), NOT slices/scheduler/{adapters,domain,application}/** —
  // those keep their inward slice enforcement. Remove this block when the H7B
  // refactor lands and `npm run lint:boundaries` is clean without it.
  // Glob narrowed **/scheduler/*.js → **/src/scheduler/*.js (harrison BLOCK,
  // JUG-FACADE-DB-VIOLATIONS stage 0): the broad form ALSO matched
  // slices/scheduler/facade.js + index.js, silently clobbering the
  // facadeDbClean replacement block back to 'off' (flat config later-wins) —
  // the block's own comment always claimed src/scheduler/*.js-only intent,
  // and the wall-clock block below already uses the narrow form.
  { files: ['**/src/scheduler/*.js'], rules: { 'no-restricted-syntax': 'off' } },
  // (999.1401) The former grandfather exemption for controllers/cal-sync.controller.js
  // is gone: the controller now imports KnexScheduleRepository via the scheduler
  // facade's named export, so the boundary rule enforces the facade there too.
  //
  // Wall-clock boundary for the legacy scheduler path (999.1195). Placed AFTER
  // the grandfather block so, for src/scheduler/*.js, it REPLACES the 'off'
  // with ONLY the Date selectors — the slice-boundary selectors stay
  // grandfathered-off there (999.435 intent preserved), while bare wall-clock
  // reads become errors: all time in the legacy entry files must derive from
  // the injected ClockPort (MysqlClockAdapter in production — the same adapter
  // RunScheduleCommand wires — FakeClockAdapter in tests), so queue
  // claim/TTL/debounce and overdue boundary math are deterministic under test.
  //
  // Exception: unifiedScheduleV2.js — its single Date.now() is the debug-only
  // captureSnapshot timestamp (cfg._debug step-recorder metadata for the admin
  // stepper UI; never scheduling math) and the pure core has no clock in scope.
  // Threading one through the hot scheduler signature for a diagnostic label is
  // not worth the risk ("scheduler bugs cascade"). Remove the ignore if a clock
  // is ever threaded into the V2 core.
  {
    files: ['**/src/scheduler/*.js'],
    ignores: ['**/src/scheduler/unifiedScheduleV2.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Bare new Date() in the legacy scheduler — derive time from the injected ClockPort (clock.now()). See 999.1195.'
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Bare Date.now() in the legacy scheduler — derive time from the injected ClockPort (clock.now().getTime()). See 999.1195.'
        }
      ]
    }
  },
  // Domain purity (JUG-NO-SLICE-BOUNDARY-ENFORCEMENT). LAST on purpose: it
  // REPLACES the per-slice domain 'off' exemptions (extraExempt) for
  // slices/*/domain/** files with the full boundary set PLUS the purity
  // selectors — so domain files keep the cross-slice facade rules AND gain
  // the no-infrastructure guarantee their headers promise. Relative
  // intra-slice requires (value-objects, ../logic, shared pure helpers) match
  // none of these selectors and stay legal. Zero violations at introduction.
  {
    files: ['**/slices/*/domain/**/*.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...SLICES.flatMap(sliceRules),
        TASKS_WRITE_RESTRICTION,
        ...DB_DIRECT_SELECTORS,
        ...DOMAIN_PURITY_SELECTORS
      ]
    }
  }
];
