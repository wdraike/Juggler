/**
 * Unit tests for lib/logger
 *
 * Tests the createLogger factory and structured logging behavior.
 * No database required — pure unit tests.
 */

const { createLogger, Logger, clearLoggerCache, LOG_LEVELS, DEFAULT_LOG_LEVEL, loggers } = require('../../../src/lib/logger');

describe('lib/logger', () => {
  let mockOutput;
  let mockErrorOutput;

  beforeEach(() => {
    // Clear the logger cache before each test
    clearLoggerCache();
    
    // Mock output functions
    mockOutput = jest.fn();
    mockErrorOutput = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
    clearLoggerCache();
  });

  describe('createLogger factory', () => {
    test('creates a Logger instance', () => {
      const logger = createLogger('test.module');
      expect(logger).toBeInstanceOf(Logger);
      expect(logger.name).toBe('test.module');
    });

    test('returns cached logger for same name', () => {
      const logger1 = createLogger('cached.module');
      const logger2 = createLogger('cached.module');
      expect(logger1).toBe(logger2);
    });

    test('creates different loggers for different names', () => {
      const logger1 = createLogger('module.a');
      const logger2 = createLogger('module.b');
      expect(logger1).not.toBe(logger2);
    });

    test('respects custom config', () => {
      const logger = createLogger('custom', {
        level: 'error',
        json: true,
        output: mockOutput
      });
      logger.info('should not log');
      logger.error('should log');
      
      expect(mockOutput).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(mockOutput.mock.calls[0][0]);
      expect(logged.level).toBe('ERROR');
      expect(logged.message).toBe('should log');
    });
  });

  describe('Logger levels', () => {
    test.each([
      ['error', ['error'], ['warn', 'info', 'debug', 'trace']],
      ['warn', ['error', 'warn'], ['info', 'debug', 'trace']],
      ['info', ['error', 'warn', 'info'], ['debug', 'trace']],
      ['debug', ['error', 'warn', 'info', 'debug'], ['trace']],
      ['trace', ['error', 'warn', 'info', 'debug', 'trace'], []]
    ])('level %s logs: %j, excludes: %j', (level, shouldLog, shouldNotLog) => {
      clearLoggerCache();
      const logger = createLogger('level-test', { 
        level,
        json: true,
        output: mockOutput 
      });

      mockOutput.mockClear();

      // Test that shouldLog levels are output
      for (const logLevel of shouldLog) {
        logger[logLevel]('test message');
        expect(mockOutput).toHaveBeenCalled();
        mockOutput.mockClear();
      }

      // Test that shouldNotLog levels are not output
      for (const logLevel of shouldNotLog) {
        logger[logLevel]('test message');
        expect(mockOutput).not.toHaveBeenCalled();
      }
    });
  });

  describe('Logger output format', () => {
    test('outputs JSON with expected structure', () => {
      const logger = createLogger('json-test', {
        json: true,
        output: mockOutput
      });

      logger.info('test message', { taskId: 'abc123', userId: 42 });

      expect(mockOutput).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(mockOutput.mock.calls[0][0]);
      
      expect(logged).toMatchObject({
        timestamp: expect.any(String),
        level: 'INFO',
        module: 'json-test',
        message: 'test message',
        taskId: 'abc123',
        userId: 42
      });
      
      // Timestamp should be ISO8601 format
      expect(new Date(logged.timestamp).toISOString()).toBe(logged.timestamp);
    });

    test('outputs plain text in non-JSON mode', () => {
      const logger = createLogger('plain-test', {
        json: false,
        colors: false,
        output: mockOutput
      });

      logger.info('plain message');

      expect(mockOutput).toHaveBeenCalledTimes(1);
      const output = mockOutput.mock.calls[0][0];
      
      // Should contain timestamp, level, module, and message
      expect(output).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
      expect(output).toContain('INFO');
      expect(output).toContain('plain-test:');
      expect(output).toContain('plain message');
    });
  });

  describe('Error handling', () => {
    test('serializes Error objects correctly', () => {
      const logger = createLogger('error-test', {
        json: true,
        output: mockOutput,
        errorOutput: mockErrorOutput
      });

      const error = new Error('Something went wrong');
      error.code = 'ERR_TEST';
      logger.error('Operation failed', { error });

      expect(mockOutput).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(mockOutput.mock.calls[0][0]);
      
      expect(logged.error).toMatchObject({
        name: 'Error',
        message: 'Something went wrong',
        code: 'ERR_TEST',
        stack: expect.any(String)
      });
    });

    test('serializes Error passed as err property', () => {
      const logger = createLogger('err-test', {
        json: true,
        output: mockOutput
      });

      const err = new Error('Test error');
      logger.warn('Warning with error', { err });

      const logged = JSON.parse(mockOutput.mock.calls[0][0]);
      expect(logged.err).toMatchObject({
        name: 'Error',
        message: 'Test error',
        stack: expect.any(String)
      });
    });

    test('uses errorOutput for error level logs', () => {
      const logger = createLogger('error-output-test', {
        json: false,
        colors: false,
        output: mockOutput,
        errorOutput: mockErrorOutput
      });

      logger.info('info message');
      logger.error('error message');

      expect(mockOutput).toHaveBeenCalledWith(expect.stringContaining('info message'));
      expect(mockErrorOutput).toHaveBeenCalledWith(expect.stringContaining('error message'));
    });
  });

  describe('Child loggers', () => {
    test('creates child logger with prefixed name', () => {
      const parent = createLogger('parent', { output: mockOutput });
      const child = parent.child('child');

      expect(child.name).toBe('parent.child');
    });

    test('child logger inherits parent config', () => {
      const parent = createLogger('parent2', { 
        level: 'warn',
        json: true,
        output: mockOutput 
      });
      const child = parent.child('child');

      child.info('should not log');
      child.warn('should log');

      expect(mockOutput).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(mockOutput.mock.calls[0][0]);
      expect(logged.module).toBe('parent2.child');
      expect(logged.level).toBe('WARN');
    });

    test('child logger includes default metadata', () => {
      const parent = createLogger('parent3', { 
        json: true,
        output: mockOutput 
      });
      const child = parent.child('child', { requestId: 'req-123' });

      child.info('test', { extra: 'data' });

      const logged = JSON.parse(mockOutput.mock.calls[0][0]);
      expect(logged.requestId).toBe('req-123');
      expect(logged.extra).toBe('data');
    });
  });

  describe('Constants', () => {
    test('LOG_LEVELS has expected values', () => {
      expect(LOG_LEVELS).toEqual(['error', 'warn', 'info', 'debug', 'trace']);
    });

    test('DEFAULT_LOG_LEVEL is defined', () => {
      expect(typeof DEFAULT_LOG_LEVEL).toBe('string');
      expect(LOG_LEVELS).toContain(DEFAULT_LOG_LEVEL);
    });
  });

  describe('Pre-configured loggers (loggers constant)', () => {
    test('has scheduler loggers', () => {
      expect(loggers.scheduler.name).toBe('scheduler');
      expect(loggers.schedulerRun.name).toBe('scheduler.runSchedule');
      expect(loggers.schedulerUnified.name).toBe('scheduler.unifiedSchedule');
      expect(loggers.schedulerQueue.name).toBe('scheduler.queue');
      expect(loggers.schedulerScore.name).toBe('scheduler.score');
      expect(loggers.schedulerReconcile.name).toBe('scheduler.reconcile');
    });

    test('has controller loggers', () => {
      expect(loggers.taskController.name).toBe('task.controller');
      expect(loggers.calSyncController.name).toBe('cal-sync.controller');
      expect(loggers.aiController.name).toBe('ai.controller');
      expect(loggers.weatherController.name).toBe('weather.controller');
      expect(loggers.configController.name).toBe('config.controller');
    });

    test('has library loggers', () => {
      expect(loggers.libDb.name).toBe('lib.db');
      expect(loggers.libRedis.name).toBe('lib.redis');
      expect(loggers.libGcal.name).toBe('lib.gcal');
      expect(loggers.libTasksWrite.name).toBe('lib.tasks-write');
      expect(loggers.libTaskWriteQueue.name).toBe('lib.task-write-queue');
    });

    test('has server logger', () => {
      expect(loggers.server.name).toBe('server');
    });
  });

  describe('Module exports', () => {
    test('exports createLogger', () => {
      const { createLogger: exported } = require('../../../src/lib/logger');
      expect(typeof exported).toBe('function');
    });

    test('exports Logger class', () => {
      const { Logger: exported } = require('../../../src/lib/logger');
      expect(typeof exported).toBe('function');
    });

    test('exports loggers constant', () => {
      const { loggers: exported } = require('../../../src/lib/logger');
      expect(typeof exported).toBe('object');
    });

    test('exports convenience loggers', () => {
      const { schedulerLogger, taskControllerLogger, serverLogger } = require('../../../src/lib/logger');
      expect(schedulerLogger.name).toBe('scheduler');
      expect(taskControllerLogger.name).toBe('task.controller');
      expect(serverLogger.name).toBe('server');
    });

    test('exports libUsageReporterLogger as a top-level named export (regression: BUG-1)', () => {
      // BUG-1: usage-reporter.js:9 destructures { libUsageReporterLogger } from './logger'.
      // If the export is missing the binding is undefined and .warn()/.error() at lines 22
      // and 71 throw "Cannot read properties of undefined (reading 'warn')".
      const { libUsageReporterLogger } = require('../../../src/lib/logger');
      expect(libUsageReporterLogger).toBeDefined();
      expect(libUsageReporterLogger).toBeInstanceOf(Logger);
      expect(libUsageReporterLogger.name).toBe('lib.usage-reporter');
    });
  });
});
