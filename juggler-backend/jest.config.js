module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
  moduleNameMapper: {
    '^uuid$': '<rootDir>/tests/helpers/uuid-mock.js'
  }
};
