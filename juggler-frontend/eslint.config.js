// ESLint configuration using plugin from package.json
const js = require('@eslint/js');
const unusedImports = require('eslint-plugin-unused-imports');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');
const importPlugin = require('eslint-plugin-import');

module.exports = [
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: {
      'unused-imports': unusedImports,
      'react': react,
      'react-hooks': reactHooks,
      'import': importPlugin,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        process: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        Blob: 'readonly',
        Buffer: 'readonly',
        FormData: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        XMLHttpRequest: 'readonly',
        AbortController: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        ReadableStream: 'readonly',
        WorkerGlobalScope: 'readonly',
        self: 'readonly',
        caches: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        queueMicrotask: 'readonly',
        TextEncoder: 'readonly',
        FileReader: 'readonly',
        File: 'readonly',
        ResizeObserver: 'readonly',
        Notification: 'readonly',
        Intl: 'readonly',
        EventTarget: 'readonly',
        EventSource: 'readonly',
        MessageEvent: 'readonly',
        // Testing globals (Jest)
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
        global: 'readonly',
        // CommonJS / Node globals
        module: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-unused-labels': 'warn',
      'no-empty': 'warn',
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    ignores: [
      'node_modules/**',
      'build/**',
      'dist/**',
      'coverage/**',
      'test-results/**',
      // The config itself is a CommonJS node file — js.configs.recommended
      // (no `files` restriction) would otherwise flag its require/module as
      // no-undef when linted directly (e.g. by the vinatieri staged-file hook).
      'eslint.config.js',
    ],
  },
];
