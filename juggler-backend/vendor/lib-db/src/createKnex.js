/**
 * createKnex - Factory function to create a knex database instance
 *
 * Creates a knex instance with environment-aware configuration.
 * Includes built-in slow query logging and connection safeguards.
 */
function createKnex(options = {}) {
  const {
    knexConfig,
    environment = process.env.NODE_ENV || 'development',
    logger = console,
    slowQueryThresholdMs = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || '100', 10),
    enableQueryLogging = process.env.ENABLE_QUERY_LOGGING === 'true',
    safeguards = { enabled: true }
  } = options;

  if (!knexConfig) {
    throw new Error('knexConfig is required');
  }

  const knex = require('knex');
  const config = knexConfig[environment];

  if (!config) {
    throw new Error(`No knex configuration found for environment: ${environment}`);
  }

  // Apply test environment safeguards
  if (safeguards.enabled && environment === 'test') {
    const expectedDb = safeguards.expectedDatabase || 'resume_optimizer_test';
    const actualDb = config.connection?.database;
    const actualPort = parseInt(config.connection?.port, 10);
    const actualHost = config.connection?.host;

    const isDocker = safeguards.expectedHosts 
      ? safeguards.expectedHosts.includes(actualHost)
      : (actualHost === 'mysql-test' || actualHost === 'ra-mysql-test');
    
    const expectedPorts = safeguards.expectedPorts || (isDocker ? [3306] : [8306, 3407]);

    if (!expectedPorts.includes(actualPort)) {
      throw new Error(
        `[TEST SAFEGUARD] Test environment MUST use port ${expectedPorts.join(' or ')}, got ${actualPort}. `
      );
    }

    if (actualDb !== expectedDb) {
      throw new Error(
        `[TEST SAFEGUARD] Test environment MUST use database '${expectedDb}', got '${actualDb}'.`
      );
    }

    logger.log(`Test safeguard: Verified connection to ${actualDb} on port ${actualPort} (${actualHost})`);
  }

  const db = knex(config);

  // Track query start times
  const queryStartTimes = new Map();

  db.on('query', (query) => {
    const queryId = query.__knexQueryUid;
    queryStartTimes.set(queryId, Date.now());
  });

  db.on('query-response', (response, query) => {
    const queryId = query.__knexQueryUid;
    const startTime = queryStartTimes.get(queryId);

    if (startTime) {
      const duration = Date.now() - startTime;
      queryStartTimes.delete(queryId);

      if (duration > slowQueryThresholdMs) {
        logger.warn(`[SLOW QUERY] ${duration}ms: ${query.sql.substring(0, 200)}${query.sql.length > 200 ? '...' : ''}`);
        if (query.bindings && query.bindings.length > 0) {
          logger.warn(`[SLOW QUERY] Bindings: ${JSON.stringify(query.bindings).substring(0, 100)}`);
        }
      }

      if (enableQueryLogging) {
        logger.log(`[QUERY] ${duration}ms: ${query.sql.substring(0, 100)}${query.sql.length > 100 ? '...' : ''}`);
      }
    }
  });

  db.on('query-error', (error, query) => {
    const queryId = query.__knexQueryUid;
    queryStartTimes.delete(queryId);
    logger.error(`[QUERY ERROR] ${error.message}: ${query.sql.substring(0, 200)}`);
  });

  return db;
}

module.exports = { createKnex };