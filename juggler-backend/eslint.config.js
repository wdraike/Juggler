// ESLint flat config (ESLint 9.x)
// Minimal config installed by juggler-code-review Plan A — adds the
// unused-imports plugin so Plan G can sweep dead imports/vars.
// Source-formatting/style rules intentionally NOT enabled here; this is
// detection scaffolding only, not a full lint baseline.
const unusedImports = require('eslint-plugin-unused-imports');

module.exports = [
  {
    files: ['src/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // Node + Jest globals so the unused-imports plugin doesn't false-flag
        // common runtime references when run standalone.
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        console: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'writable',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
        jest: 'readonly',
      },
    },
    plugins: {
      'unused-imports': unusedImports,
    },
    rules: {
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    ignores: [
      'src/db/migrations/**',
      'src/db/seeds/**',
      'vendor/**',
      'coverage/**',
      'node_modules/**',
      'logs/**',
      'uploads/**',
      'test-results/**',
    ],
  },
];
