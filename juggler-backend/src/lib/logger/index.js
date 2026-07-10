/**
 * lib-logger - Structured logging utilities for Juggler
 *
 * Factory-based logger utilities replacing console.* calls with structured logging.
 * Provides:
 * - createLogger(name, config): Factory function for named loggers
 * - Named loggers per slice/module
 * - Structured output with timestamps, level, module context
 * - Configurable log levels and output formats
 *
 * @module lib/logger
 */

// Named envConfig (not `config`) to avoid shadowing the Logger constructor's
// `config` parameter below (999.1473).
const envConfig = require('../config');

/**
 * Log levels in order of severity (most severe first)
 * @type {string[]}
 */
const LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'trace'];

/**
 * Default log level - can be overridden via LOG_LEVEL or NODE_ENV
 * @type {string}
 */
const DEFAULT_LOG_LEVEL = envConfig.getString('LOG_LEVEL') || // 999.1473
  (envConfig.getString('NODE_ENV') === 'production' ? 'info' : 'debug');

/**
 * ANSI color codes for terminal output (production uses plaintext)
 */
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m'
};

/**
 * Level color mapping for terminal output
 */
const LEVEL_COLORS = {
  error: COLORS.red,
  warn: COLORS.yellow,
  info: COLORS.green,
  debug: COLORS.blue,
  trace: COLORS.gray
};

/**
 * Check if the current environment supports colors
 * @returns {boolean}
 */
function supportsColors() {
  // No colors in production or when running in a non-TTY environment
  if (envConfig.getString('NODE_ENV') === 'production') return false;
  // Check for CI environments
  if (envConfig.getString('CI') || envConfig.getString('NO_COLOR') || envConfig.getString('TERM') === 'dumb') return false;
  // Check for TTY
  if (!process.stdout.isTTY) return false;
  return true;
}

/**
 * Format a log timestamp in ISO8601 format
 * @returns {string}
 */
function formatTimestamp() {
  return new Date().toISOString();
}

/**
 * Get the numeric level index (higher = more verbose)
 * @param {string} level
 * @returns {number}
 */
function getLevelIndex(level) {
  return LOG_LEVELS.indexOf(level.toLowerCase());
}

/**
 * Check if current log level allows the given level
 * @param {string} currentLevel
 * @param {string} messageLevel
 * @returns {boolean}
 */
function shouldLog(currentLevel, messageLevel) {
  return getLevelIndex(messageLevel) <= getLevelIndex(currentLevel);
}

/**
 * Safely serialize an error object to a loggable structure
 * @param {Error} err
 * @returns {Object}
 */
function serializeError(err) {
  if (!err || typeof err !== 'object') return err;
  return {
    name: err.name || 'Error',
    message: err.message || String(err),
    stack: err.stack || null,
    // Include additional error properties (e.g., from axios, http-errors)
    ...(err.code && { code: err.code }),
    ...(err.status && { status: err.status }),
    ...(err.statusCode && { statusCode: err.statusCode }),
    ...(err.config && { config: { url: err.config?.url, method: err.config?.method } })
  };
}

/**
 * Structured logger class for a specific module/scope
 */
class Logger {
  /**
   * Create a new Logger instance
   * @param {string} name - The module/scope name (e.g., 'scheduler', 'task.controller')
   * @param {Object} config - Configuration options
   * @param {string} config.level - Log level threshold (error, warn, info, debug, trace)
   * @param {boolean} config.json - Output as JSON (default: true in production)
   * @param {boolean} config.colors - Use ANSI colors (default: auto-detect)
   * @param {Function} config.output - Output function (default: console.log)
   * @param {Function} config.errorOutput - Error output function (default: console.error)
   */
  constructor(name, config = {}) {
    this.name = name;
    this.level = config.level || DEFAULT_LOG_LEVEL;
    this.json = config.json !== undefined ? config.json : envConfig.getString('NODE_ENV') === 'production';
    this.colors = config.colors !== undefined ? config.colors : supportsColors();
    this.output = config.output || console.log;
    this.errorOutput = config.errorOutput || console.error;
  }

  /**
   * Format and output a log message
   * @private
   * @param {string} level - Log level
   * @param {string} message - Message string
   * @param {Object} [meta] - Additional structured data
   */
  _log(level, message, meta = {}) {
    if (!shouldLog(this.level, level)) return;

    const timestamp = formatTimestamp();
    const record = {
      timestamp,
      level: level.toUpperCase(),
      module: this.name,
      message,
      ...meta
    };

    // Handle error objects specially - serialize them
    if (meta.error instanceof Error) {
      record.error = serializeError(meta.error);
    }

    // Handle Error objects passed as 'err' (common pattern)
    if (meta.err instanceof Error) {
      record.err = serializeError(meta.err);
    }

    if (this.json) {
      // JSON output for production / structured logs
      this.output(JSON.stringify(record));
    } else {
      // Human-readable output for development
      const color = this.colors ? LEVEL_COLORS[level] || '' : '';
      const reset = this.colors ? COLORS.reset : '';
      const gray = this.colors ? COLORS.gray : '';
      const cyan = this.colors ? COLORS.cyan : '';

      const levelStr = level.toUpperCase().padEnd(5);
      const prefix = `${gray}[${timestamp}]${reset} ${color}${levelStr}${reset} ${cyan}${this.name}:${reset}`;
      
      // Format additional metadata
      let metaStr = '';
      const metaEntries = Object.entries(meta)
        .filter(([_key, value]) => value !== undefined && !(value instanceof Error));
      
      if (metaEntries.length > 0) {
        metaStr = ' ' + JSON.stringify(Object.fromEntries(metaEntries));
      }

      // Print error stack below message if present
      const errorObj = meta.error || meta.err;
      if (errorObj && (errorObj.stack || errorObj.stack === null)) {
        // Serialized error from above
        this.output(`${prefix} ${message}${metaStr}`);
        if (errorObj.stack) {
          this.errorOutput(errorObj.stack);
        }
      } else {
        const useOutput = level === 'error' ? this.errorOutput : this.output;
        useOutput(`${prefix} ${message}${metaStr}`);
      }
    }
  }

  /**
   * Log a fatal error (always output)
   * @param {string} message - Error message
   * @param {Object} [meta] - Additional metadata
   */
  error(message, meta) {
    this._log('error', message, meta);
  }

  /**
   * Log a warning
   * @param {string} message - Warning message
   * @param {Object} [meta] - Additional metadata
   */
  warn(message, meta) {
    this._log('warn', message, meta);
  }

  /**
   * Log informational message
   * @param {string} message - Info message
   * @param {Object} [meta] - Additional metadata
   */
  info(message, meta) {
    this._log('info', message, meta);
  }

  /**
   * Log debug message (verbose)
   * @param {string} message - Debug message
   * @param {Object} [meta] - Additional metadata
   */
  debug(message, meta) {
    this._log('debug', message, meta);
  }

  /**
   * Log trace message (very verbose)
   * @param {string} message - Trace message
   * @param {Object} [meta] - Additional metadata
   */
  trace(message, meta) {
    this._log('trace', message, meta);
  }

  /**
   * Create a child logger with additional default metadata
   * Useful for sub-components within a module
   * @param {string} subName - Sub-component name
   * @param {Object} defaultMeta - Default metadata to include in all logs
   * @returns {Logger}
   */
  child(subName, defaultMeta = {}) {
    const childName = `${this.name}.${subName}`;
    const childLogger = new Logger(childName, {
      level: this.level,
      json: this.json,
      colors: this.colors,
      output: this.output,
      errorOutput: this.errorOutput
    });

    // Wrap _log to inject defaultMeta
    const originalLog = childLogger._log.bind(childLogger);
    childLogger._log = (level, message, meta = {}) => {
      originalLog(level, message, { ...defaultMeta, ...meta });
    };

    return childLogger;
  }
}

// Cache of loggers to avoid recreating them
const loggerCache = new Map();

/**
 * Create or retrieve a named logger instance
 *
 * Creates loggers cached by name. Use consistent names to get the same
 * logger instance across requires.
 *
 * @param {string} name - Logger name/scope (e.g., 'scheduler', 'task.controller')
 * @param {Object} [config] - Configuration options
 * @param {string} [config.level] - Log level (defaults to LOG_LEVEL env or 'debug')
 * @param {boolean} [config.json] - JSON output mode (auto-detected from NODE_ENV)
 * @param {boolean} [config.colors] - Use ANSI colors (auto-detected)
 * @param {Function} [config.output] - Output function (defaults to console.log)
 * @param {Function} [config.errorOutput] - Error output function (defaults to console.error)
 * @returns {Logger}
 *
 * @example
 * // In a controller
 * const logger = createLogger('task.controller');
 * logger.info('Task created', { taskId: 'abc123' });
 * logger.error('Task creation failed', { error: err });
 *
 * @example
 * // In scheduler
 * const logger = createLogger('scheduler.runSchedule');
 * logger.debug('Starting scheduler', { userId, taskCount: tasks.length });
 *
 * @example
 * // With custom config (useful for tests)
 * const mockLogger = createLogger('test', {
 *   level: 'error',
 *   output: jest.fn(),
 *   errorOutput: jest.fn()
 * });
 */
function createLogger(name, config) {
  // Create cache key from name + JSON-stringified config (for same config = same logger)
  const cacheKey = name + (config ? ':' + JSON.stringify(config) : '');
  
  if (!loggerCache.has(cacheKey)) {
    loggerCache.set(cacheKey, new Logger(name, config));
  }
  
  return loggerCache.get(cacheKey);
}

/**
 * Clear the logger cache (useful for tests)
 */
function clearLoggerCache() {
  loggerCache.clear();
}

/**
 * Per-slice named loggers for convenient importing
 *
 * These are pre-configured loggers for each domain slice.
 * Import the one appropriate for your module.
 */
const loggers = {
  /**
   * Scheduler domain loggers
   */
  scheduler: createLogger('scheduler'),
  schedulerRun: createLogger('scheduler.runSchedule'),
  schedulerUnified: createLogger('scheduler.unifiedSchedule'),
  schedulerQueue: createLogger('scheduler.queue'),
  schedulerScore: createLogger('scheduler.score'),
  schedulerReconcile: createLogger('scheduler.reconcile'),

  /**
   * Controller loggers
   */
  taskController: createLogger('task.controller'),
  calSyncController: createLogger('cal-sync.controller'),
  aiController: createLogger('ai.controller'),
  weatherController: createLogger('weather.controller'),
  configController: createLogger('config.controller'),
  dataController: createLogger('data.controller'),
  gcalController: createLogger('gcal.controller'),
  appleCalController: createLogger('apple-cal.controller'),
  msftCalController: createLogger('msft-cal.controller'),
  billingController: createLogger('billing.controller'),
  impersonationController: createLogger('impersonation.controller'),
  featureCatalogController: createLogger('feature-catalog.controller'),

  /**
   * Library loggers
   */
  libDb: createLogger('lib.db'),
  libRedis: createLogger('lib.redis'),
  libGcal: createLogger('lib.gcal'),
  libMsft: createLogger('lib.msft'),
  libApple: createLogger('lib.apple'),
  libTasksWrite: createLogger('lib.tasks-write'),
  libTaskWriteQueue: createLogger('lib.task-write-queue'),
  libCalAdapter: createLogger('lib.cal-adapter'),
  libSyncLock: createLogger('lib.sync-lock'),
  libUsageReporter: createLogger('lib.usage-reporter'),
  libRollingAnchor: createLogger('lib.rolling-anchor'),
  libReconcileSplits: createLogger('lib.reconcile-splits'),
  libSseEmitter: createLogger('lib.sse-emitter'),

  /**
   * Service loggers
   */
  aiUsageQueue: createLogger('service.ai-usage-queue'),
  aiUsageFlusher: createLogger('service.ai-usage-flusher'),

  /**
   * Infrastructure loggers
   */
  server: createLogger('server'),
  app: createLogger('app'),
  cronCalHistory: createLogger('cron.cal-history'),
  cron: createLogger('cron'),

  /**
   * Calendar adapter loggers
   */
  calAdapterGcal: createLogger('cal-adapter.gcal'),
  calAdapterApple: createLogger('cal-adapter.apple'),
  calAdapterMsft: createLogger('cal-adapter.msft'),
};

module.exports = {
  // Core exports
  createLogger,
  Logger,
  clearLoggerCache,
  LOG_LEVELS,
  DEFAULT_LOG_LEVEL,
  
  // Convenience exports - pre-configured loggers per slice
  loggers,

  // ── Individual loggers for direct destructuring ──────────────────────────
  //
  // CONVENTION (two-place rule — READ BEFORE ADDING A LOGGER):
  //   A logger is usable two ways, and the two are NOT linked automatically:
  //     1. via the `loggers` map:           const { loggers } = require('...'); loggers.fooBar
  //     2. via a top-level `*Logger` export: const { fooBarLogger } = require('...');
  //   Adding an entry to the `loggers` object above does NOT create the
  //   top-level `fooBarLogger` export. Each consumer-destructured `*Logger`
  //   MUST have a matching `fooBarLogger: loggers.fooBar` line in THIS block.
  //
  // FAILURE MODE if you forget:
  //   `const { fooBarLogger } = require('../lib/logger')` resolves to `undefined`,
  //   so the first `fooBarLogger.warn(...)` / `.error(...)` throws
  //   "Cannot read properties of undefined (reading 'warn')" — a runtime crash on
  //   the logging line, often on an error/retry path that is rarely exercised.
  //   This recurring crash class produced clusters W5/W7/W8 and 999.454
  //   (POST /api/schedule/run crash via usage-reporter.js → libUsageReporterLogger).
  //
  // CHECKLIST when adding `loggers.fooBar`:
  //   • if any module does `const { fooBarLogger } = require('.../logger')`,
  //     add `fooBarLogger: loggers.fooBar` below;
  //   • prefer the `loggers.fooBar` form in new code (no top-level export needed);
  //   • `tests/unit/lib/logger.test.js` asserts these exports — keep it in sync.
  // ─────────────────────────────────────────────────────────────────────────
  schedulerLogger: loggers.scheduler,
  schedulerRunLogger: loggers.schedulerRun,
  schedulerUnifiedLogger: loggers.schedulerUnified,
  taskControllerLogger: loggers.taskController,
  calSyncControllerLogger: loggers.calSyncController,
  aiControllerLogger: loggers.aiController,
  weatherControllerLogger: loggers.weatherController,
  serverLogger: loggers.server,
  libGcalLogger: loggers.libGcal,
  libMsftLogger: loggers.libMsft,
  libAppleLogger: loggers.libApple,
  libDbLogger: loggers.libDb,
  cronCalHistoryLogger: loggers.cronCalHistory,
  // Previously missing top-level exports — consumers destructured these and got
  // undefined → `X.warn/error is not a function` crashes (cal-sync retry path,
  // data export, ai-usage-queue). Surfaced by the test de-rot (clusters W5/W7/W8).
  libCalAdapterLogger: loggers.libCalAdapter,
  dataControllerLogger: loggers.dataController,
  aiUsageQueueLogger: loggers.aiUsageQueue,
  libUsageReporterLogger: loggers.libUsageReporter,
};
