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
    files: ['_*.js', 'check*.js', 'scripts/*.js'],
    rules: { 'no-unused-vars': 'off' },
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
];
