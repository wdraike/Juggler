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
      // --- CALENDAR SLICE BOUNDARIES (JUG-HEX-P7) ---
      //
      // External code must access calendar functionality only via the facade.
      // Direct imports of slice-internal paths are forbidden.
      'no-restricted-syntax': [
        'error',
        // Adapters are internal — go through facade.js
        {
          selector: "CallExpression[callee.name='require'] > Literal[value=/slices\\/calendar\\/adapters\\//]",
          message:
            "Direct import of calendar adapter is forbidden. " +
            "Use the facade: require('./slices/calendar/facade'). See JUG-HEX-P7."
        },
        // Domain ports are internal — go through facade.js
        {
          selector: "CallExpression[callee.name='require'] > Literal[value=/slices\\/calendar\\/domain\\/ports\\//]",
          message:
            "Direct import of calendar port is forbidden. " +
            "Use the facade: require('./slices/calendar/facade'). Ports are consumed only by adapters and the facade. See JUG-HEX-P7."
        },
        // Domain entities are internal — go through facade.js
        {
          selector: "CallExpression[callee.name='require'] > Literal[value=/slices\\/calendar\\/domain\\/entities\\//]",
          message:
            "Direct import of calendar entity is forbidden. " +
            "Use the facade: require('./slices/calendar/facade'). See JUG-HEX-P7."
        }
      ]
    }
  },
  {
    // The facade itself may import its own slice internals.
    files: ['**/slices/calendar/facade.js'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  },
  {
    // Adapter files may import domain ports/entities (they implement the port).
    files: ['**/slices/calendar/adapters/**/*.js'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  },
  {
    // Tests are exempt — they import internals to test them directly.
    files: ['**/slices/calendar/**/*.test.js', '**/slices/calendar/test-doubles/**/*.js'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  }
];
