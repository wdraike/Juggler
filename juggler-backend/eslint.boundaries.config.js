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
    { files: slice.facadeFiles, rules: { 'no-restricted-syntax': 'off' } },
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
        ...SLICES.flatMap(sliceRules)
      ]
    }
  },
  // Per-slice exemption override blocks — single-sourced from SLICES (see
  // sliceExemptions above). Order is preserved: for each slice, facade(+index),
  // adapters, [domain/application self-imports], tests; slices in declaration
  // order (calendar, weather, task, ai-enrichment, user-config).
  ...SLICES.flatMap(sliceExemptions)
];
