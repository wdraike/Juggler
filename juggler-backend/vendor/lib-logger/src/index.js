/**
 * @raike/lib-logger
 *
 * Hexagonal logging library using Winston for structured logging
 * Supports multiple transports and per-slice named loggers
 */

const { createLogger: createWinstonLogger, format, transports } = require('winston');
const { combine, timestamp, json, printf, colorize, errors } = format;

// Create Winston logger instance
const logger = createWinstonLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp(),
    json()
  ),
  transports: [
    new transports.Console(),
  ],
});

/**
 * Create a named logger instance.
 *
 * Supports two calling styles for backward compatibility:
 *   createLogger('my-service')                         → child logger with { slice: 'my-service' }
 *   createLogger({ serviceName: 'my-service', ... })   → child logger with { slice: 'my-service' }
 *
 * @param {string|Object} nameOrOptions - Logger name string, or options object with serviceName
 * @returns {Object} Winston child logger instance
 */
function createLogger(nameOrOptions) {
  if (nameOrOptions && typeof nameOrOptions === 'object') {
    const { serviceName = 'unknown' } = nameOrOptions;
    return logger.child({ slice: serviceName });
  }
  return logger.child({ slice: nameOrOptions });
}

/**
 * Export the logger factory and instance
 */
module.exports = {
  // Winston logger instance
  logger,
  
  // Logger factory for named loggers
  createLogger,
  
  // Winston components for advanced usage
  transports,
  format,
};