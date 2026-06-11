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
        },

        // --- WEATHER SLICE BOUNDARIES (JUG-HEX-H1 / W3) ---
        //
        // External code must access weather functionality only via the facade
        // (slices/weather/facade.js) or its index re-export. Direct imports of
        // slice-internal paths (adapters / domain ports / domain entities +
        // value-objects) are forbidden.
        //
        // Adapters are internal — go through facade.js
        {
          selector: "CallExpression[callee.name='require'] > Literal[value=/slices\\/weather\\/adapters\\//]",
          message:
            "Direct import of weather adapter is forbidden. " +
            "Use the facade: require('./slices/weather/facade'). See JUG-HEX-H1 (W3)."
        },
        // Domain ports are internal — go through facade.js
        {
          selector: "CallExpression[callee.name='require'] > Literal[value=/slices\\/weather\\/domain\\/ports\\//]",
          message:
            "Direct import of weather port is forbidden. " +
            "Use the facade: require('./slices/weather/facade'). Ports are consumed only by adapters and the facade. See JUG-HEX-H1 (W3)."
        },
        // Domain entities are internal — go through facade.js
        {
          selector: "CallExpression[callee.name='require'] > Literal[value=/slices\\/weather\\/domain\\/entities\\//]",
          message:
            "Direct import of weather entity is forbidden. " +
            "Use the facade: require('./slices/weather/facade'). See JUG-HEX-H1 (W3)."
        },
        // Domain value-objects (e.g. GeoPoint) are internal — go through facade.js
        // (the facade re-exports GeoPoint + roundCoord/gridValue for consumers).
        {
          selector: "CallExpression[callee.name='require'] > Literal[value=/slices\\/weather\\/domain\\/value-objects\\//]",
          message:
            "Direct import of weather value-object is forbidden. " +
            "Use the facade: require('./slices/weather/facade') (it re-exports GeoPoint + roundCoord/gridValue). See JUG-HEX-H1 (W3)."
        },

        // --- TASK SLICE BOUNDARIES (JUG-HEX-H3 / W6) ---
        //
        // External code must access task functionality only via the facade
        // (slices/task/facade.js) or its index re-export. Direct imports of
        // slice-internal paths (adapters / domain ports / entities / value-objects /
        // application use-cases) are forbidden — they go through the facade.
        //
        // Adapters are internal — go through facade.js
        {
          selector: "CallExpression[callee.name='require'] > Literal[value=/slices\\/task\\/adapters\\//]",
          message:
            "Direct import of task adapter is forbidden. " +
            "Use the facade: require('./slices/task/facade'). See JUG-HEX-H3 (W6)."
        },
        // Domain ports are internal — go through facade.js
        {
          selector: "CallExpression[callee.name='require'] > Literal[value=/slices\\/task\\/domain\\/ports\\//]",
          message:
            "Direct import of task port is forbidden. " +
            "Use the facade: require('./slices/task/facade'). Ports are consumed only by adapters and the facade. See JUG-HEX-H3 (W6)."
        },
        // Domain entities are internal — go through facade.js
        {
          selector: "CallExpression[callee.name='require'] > Literal[value=/slices\\/task\\/domain\\/entities\\//]",
          message:
            "Direct import of task entity is forbidden. " +
            "Use the facade: require('./slices/task/facade'). See JUG-HEX-H3 (W6)."
        },
        // Domain value-objects (closed-enum VOs) are internal — go through facade.js
        {
          selector: "CallExpression[callee.name='require'] > Literal[value=/slices\\/task\\/domain\\/value-objects\\//]",
          message:
            "Direct import of task value-object is forbidden. " +
            "Use the facade: require('./slices/task/facade'). See JUG-HEX-H3 (W6)."
        },
        // Application use-cases are internal — go through facade.js
        {
          selector: "CallExpression[callee.name='require'] > Literal[value=/slices\\/task\\/application\\//]",
          message:
            "Direct import of task application use-case is forbidden. " +
            "Use the facade: require('./slices/task/facade'). See JUG-HEX-H3 (W6)."
        },

        // --- USER-CONFIG SLICE BOUNDARIES (JUG-HEX-H4 / W6) ---
        //
        // External code must access user-config functionality only via the facade
        // (slices/user-config/facade.js) or its index re-export. Direct imports of
        // slice-internal paths (adapters / domain ports / entities / value-objects /
        // domain logic / application use-cases) are forbidden — they go through the
        // facade.
        //
        // Adapters are internal — go through facade.js
        {
          selector: "CallExpression[callee.name='require'] > Literal[value=/slices\\/user-config\\/adapters\\//]",
          message:
            "Direct import of user-config adapter is forbidden. " +
            "Use the facade: require('./slices/user-config/facade'). See JUG-HEX-H4 (W6)."
        },
        // Domain ports are internal — go through facade.js
        {
          selector: "CallExpression[callee.name='require'] > Literal[value=/slices\\/user-config\\/domain\\/ports\\//]",
          message:
            "Direct import of user-config port is forbidden. " +
            "Use the facade: require('./slices/user-config/facade'). Ports are consumed only by adapters and the facade. See JUG-HEX-H4 (W6)."
        },
        // Domain entities are internal — go through facade.js
        {
          selector: "CallExpression[callee.name='require'] > Literal[value=/slices\\/user-config\\/domain\\/entities\\//]",
          message:
            "Direct import of user-config entity is forbidden. " +
            "Use the facade: require('./slices/user-config/facade'). See JUG-HEX-H4 (W6)."
        },
        // Domain value-objects (closed-enum VOs: PlanSlug/FeatureKey/EntityLimit) are
        // internal — go through facade.js
        {
          selector: "CallExpression[callee.name='require'] > Literal[value=/slices\\/user-config\\/domain\\/value-objects\\//]",
          message:
            "Direct import of user-config value-object is forbidden. " +
            "Use the facade: require('./slices/user-config/facade'). See JUG-HEX-H4 (W6)."
        },
        // Domain logic (pure decision functions) is internal — go through facade.js
        {
          selector: "CallExpression[callee.name='require'] > Literal[value=/slices\\/user-config\\/domain\\/logic\\//]",
          message:
            "Direct import of user-config domain logic is forbidden. " +
            "Use the facade: require('./slices/user-config/facade'). See JUG-HEX-H4 (W6)."
        },
        // Application use-cases are internal — go through facade.js
        {
          selector: "CallExpression[callee.name='require'] > Literal[value=/slices\\/user-config\\/application\\//]",
          message:
            "Direct import of user-config application use-case is forbidden. " +
            "Use the facade: require('./slices/user-config/facade'). See JUG-HEX-H4 (W6)."
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
  },

  // --- WEATHER SLICE per-slice exemptions (JUG-HEX-H1 / W3) ---
  {
    // The weather facade + its index re-export may import their own slice
    // internals (adapters / domain ports / entities / value-objects).
    files: ['**/slices/weather/facade.js', '**/slices/weather/index.js'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  },
  {
    // Weather adapter files may import domain ports/entities/value-objects
    // (they implement the port / use the VO).
    files: ['**/slices/weather/adapters/**/*.js'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  },
  {
    // Weather tests are exempt — they import internals to test them directly.
    files: ['**/slices/weather/**/*.test.js', '**/slices/weather/test-doubles/**/*.js'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  },

  // --- TASK SLICE per-slice exemptions (JUG-HEX-H3 / W6) ---
  {
    // The task facade + its index re-export may import their own slice internals
    // (adapters / domain ports / entities / value-objects / application use-cases).
    files: ['**/slices/task/facade.js', '**/slices/task/index.js'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  },
  {
    // Task adapter files may import domain ports/entities/value-objects
    // (they implement the port / map the entities).
    files: ['**/slices/task/adapters/**/*.js'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  },
  {
    // Task application use-cases consume the ports/domain through injection; the
    // application barrel + use-case files reach into their own slice's application
    // and domain (NOT external code) — exempt the slice's own internals.
    files: ['**/slices/task/application/**/*.js', '**/slices/task/domain/**/*.js'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  },
  {
    // Task tests are exempt — they import internals to test them directly.
    files: ['**/slices/task/**/*.test.js', '**/slices/task/test-doubles/**/*.js'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  },

  // --- USER-CONFIG SLICE per-slice exemptions (JUG-HEX-H4 / W6) ---
  {
    // The user-config facade + its index re-export may import their own slice
    // internals (adapters / domain ports / entities / value-objects / logic /
    // application use-cases).
    files: ['**/slices/user-config/facade.js', '**/slices/user-config/index.js'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  },
  {
    // User-config adapter files may import domain ports/entities/value-objects/logic
    // (they implement the port / map the entities).
    files: ['**/slices/user-config/adapters/**/*.js'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  },
  {
    // User-config application use-cases + domain reach into their OWN slice's
    // application/domain (NOT external code) — exempt the slice's own internals.
    files: ['**/slices/user-config/application/**/*.js', '**/slices/user-config/domain/**/*.js'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  },
  {
    // User-config tests are exempt — they import internals to test them directly.
    files: ['**/slices/user-config/**/*.test.js', '**/slices/user-config/test-doubles/**/*.js'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  }
];
