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

    // expectedHosts is a HOST ALLOWLIST, not the docker discriminator. Overloading
    // it as both meant a caller allowlisting the CI host ('127.0.0.1') silently
    // collapsed the port list to [3306] and rejected every local pool slot, while
    // the allowlist itself was never actually enforced against actualHost.
    if (safeguards.expectedHosts && !safeguards.expectedHosts.includes(actualHost)) {
      throw new Error(
        `[TEST SAFEGUARD] Test environment MUST use host ${safeguards.expectedHosts.join(' or ')}, got ${actualHost}.`
      );
    }

    const isDocker = actualHost === 'mysql-test' || actualHost === 'ra-mysql-test' || /^ra-mysql-t\d+$/.test(actualHost);

    // Loopback is NOT a docker-network host, and it is ambiguous: GitHub Actions
    // publishes its MySQL service container on 127.0.0.1:3306, while local runs
    // use the same host for test-bed (3407/8306) and the ephemeral pool band.
    // 3306 is also knexfile.js's DB_PORT default, so accepting it on loopback
    // everywhere would wave through an unset DB_PORT pointed at a native MySQL.
    // It is therefore accepted ONLY under a CI runner, where 3306 is the service
    // container and no developer database is reachable.
    const isLoopback = actualHost === '127.0.0.1' || actualHost === 'localhost';
    const isCi = process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true';

    // Pool band 3410-3417: ephemeral test-bed slots (test-bed/scripts/instance.sh POOL_SIZE=8)
    const localPorts = [8306, 3407, 3410, 3411, 3412, 3413, 3414, 3415, 3416, 3417];
    const expectedPorts = safeguards.expectedPorts
      || (isDocker ? [3306] : isLoopback && isCi ? [3306, ...localPorts] : localPorts);

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
    // 999.5123: ER_DUP_ENTRY (errno 1062) is a benign, application-handled race
    // condition. Logging it at error triggers the log monitor to file tickets
    // for handled conditions. Downgrade to warn so the signal is still visible
    // without raising false alarms.
    const isDuplicateEntry = error.code === 'ER_DUP_ENTRY' || error.errno === 1062;
    // 999.5137: the prefix must also change — the log monitor matches \berror\b
    // in the raw text, not the console level, so [QUERY ERROR] at warn still
    // triggers ticket filing for this handled race condition.
    const prefix = isDuplicateEntry ? '[QUERY WARN]' : '[QUERY ERROR]';
    const logFn = isDuplicateEntry ? logger.warn : logger.error;
    logFn(`${prefix} ${error.message}: ${query.sql.substring(0, 200)}`);
  });

  return db;
}

module.exports = { createKnex };