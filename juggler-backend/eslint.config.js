const eslint = require('@eslint/js');

module.exports = [
  eslint.configs.recommended,
  {
    files: ['src/**/*.js', 'src/**/*.ts'],
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
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-unused-labels': 'warn',
      'no-empty': 'warn',
      'no-constant-condition': 'warn',
    },
  },
  {
    files: ['_*.js', 'check*.js', 'scripts/*.js'],
    rules: { 'no-unused-vars': 'off' },
  },
];
