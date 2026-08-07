const eslint = require('@eslint/js');
const unusedImports = require('eslint-plugin-unused-imports');

module.exports = [
  eslint.configs.recommended,
  {
    files: ['src/**/*.js', 'src/**/*.ts'],
    plugins: {
      'unused-imports': unusedImports,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        jest: 'readonly',
        describe: 'readonly',
        test: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-unused-labels': 'warn',
      'no-empty': 'warn',
      'no-constant-condition': 'warn',
    },
  },
  {
    // 999.5269: was 'scripts/*.js' (one level only) with no `languageOptions`
    // at all — every script no-undef'd on require/console/setTimeout/etc.
    // the moment it was staged and hit vinatieri's per-staged-file eslint
    // (npx eslint on the literal path never picked up node globals from
    // anywhere else). Pre-existing top-level scripts were never caught
    // because `npm run lint` scopes to 'src/**/*.js' only and none of them
    // had been staged+linted since this config file's globals block was
    // added — confirmed by running eslint directly against
    // scripts/coverage-unit.js, which fails identically. Widened to
    // scripts/**/*.js (covers scripts/dev/, scripts/patriots/, etc.) with
    // the same node globals `src/**/*.js` gets above.
    files: ['_*.js', 'check*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly', process: 'readonly', Buffer: 'readonly',
        __dirname: 'readonly', __filename: 'readonly', require: 'readonly',
        module: 'readonly', exports: 'readonly',
        setTimeout: 'readonly', setInterval: 'readonly',
        clearTimeout: 'readonly', clearInterval: 'readonly',
        setImmediate: 'readonly', clearImmediate: 'readonly',
        fetch: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
      },
    },
    // no-unused-vars off, but NOT unlinted: the `unused-imports/*` rules are
    // scoped to src/** only, so turning the base rule off here would leave
    // scripts/** with no dead-code check at all — this block widened from
    // `_*.js`/`check*.js` to scripts/**/*.js, so that would be a silent
    // reduction in coverage for files that previously had it.
    rules: { 'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }] },
  },
  // 999.1202: env-var config hardening. Direct `process.env.X` reads are
  // restricted outside lib/config (the declared-schema front door) and the
  // two bootstrap entry points (server.js/app.js — the existing idiom here is
  // plain top-level env reads at boot, not constructor injection; forcing DI
  // onto them would fight the codebase's own pattern). 'warn' not 'error':
  // ~90 process.env sites across 40+ files predate this rule and are only
  // partially migrated so far (see 999.1202 follow-up items) — 'error' would
  // fail lint on unmigrated code that hasn't regressed. Bump to 'error' once
  // the remaining sites are migrated or explicitly exempted.
  {
    files: ['src/**/*.js'],
    ignores: [
      'src/lib/config/**',
      'src/server.js',
      'src/app.js',
      '**/*.test.js',
    ],
    rules: {
      'no-restricted-syntax': ['warn', {
        selector: "MemberExpression[object.object.name='process'][object.property.name='env']",
        message:
          'Direct process.env reads are restricted outside lib/config + server bootstrap ' +
          '(server.js/app.js). Declare the key in src/lib/config/index.js SCHEMA and read it ' +
          'via config.getString/getInt/getBool. See 999.1202.',
      }],
    },
  },
  // 999.2164: tests were previously never linted directly (root-only hook
  // detection); the vinatieri nearest-config hook (999.2168) now lints staged
  // test files against THIS config — give them node + jest globals so
  // legitimate test code doesn't no-undef.
  {
    files: ['tests/**/*.js', 'test-helpers/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly', process: 'readonly', Buffer: 'readonly',
        __dirname: 'readonly', require: 'readonly', module: 'readonly',
        exports: 'readonly', setTimeout: 'readonly', setInterval: 'readonly',
        clearTimeout: 'readonly', clearInterval: 'readonly',
        setImmediate: 'readonly', clearImmediate: 'readonly',
        fetch: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
        global: 'readonly',
        describe: 'readonly', it: 'readonly', test: 'readonly',
        expect: 'readonly', beforeEach: 'readonly', afterEach: 'readonly',
        beforeAll: 'readonly', afterAll: 'readonly', jest: 'readonly',
      },
    },
  },
  // CommonJS node config files — recommended rules (no `files` restriction)
  // would no-undef their require/module when the vinatieri staged-file hook
  // lints them directly (same self-ignore as juggler-frontend, 999.2168).
  {
    ignores: ['eslint.config.js', 'eslint.boundaries.config.js'],
  },
];
