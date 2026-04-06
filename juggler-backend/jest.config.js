process.env.NODE_ENV = 'test';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
  moduleNameMapper: {
    '^uuid$': '<rootDir>/tests/helpers/uuid-mock.js'
  },
  forceExit: true,
  // Run sequentially — integration tests share a DB connection that
  // conflicts with jest.mock('../src/db') in parallel workers.
  maxWorkers: 1
};
