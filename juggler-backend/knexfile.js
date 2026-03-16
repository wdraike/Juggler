require('dotenv').config();

// Keep-alive: validate connections before use and periodically ping idle ones
var poolConfig = {
  min: 2,
  max: 10,
  acquireTimeoutMillis: 30000,
  idleTimeoutMillis: 60000,
  reapIntervalMillis: 1000,
  createRetryIntervalMillis: 200,
  // Validate connection on checkout — catches silently dropped connections
  afterCreate: function(conn, done) {
    conn.query('SET SESSION wait_timeout=28800', function(err) {
      if (err) return done(err, conn);
      conn.query('SELECT 1', function(err2) {
        done(err2, conn);
      });
    });
  }
};

module.exports = {
  development: {
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST || '127.0.0.1',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'juggler',
      charset: 'utf8mb4',
      timezone: '+00:00',
      multipleStatements: true,
      dateStrings: true
    },
    pool: poolConfig,
    migrations: {
      directory: './src/db/migrations',
      tableName: 'knex_migrations'
    }
  },

  production: {
    client: 'mysql2',
    connection: process.env.CLOUD_SQL_CONNECTION_NAME ? {
      socketPath: `/cloudsql/${process.env.CLOUD_SQL_CONNECTION_NAME}`,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      charset: 'utf8mb4',
      timezone: '+00:00',
      dateStrings: true
    } : {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      charset: 'utf8mb4',
      timezone: '+00:00',
      dateStrings: true,
      ssl: process.env.DB_SSL === 'true' ? {
        rejectUnauthorized: false
      } : undefined
    },
    pool: Object.assign({}, poolConfig, { max: 20 }),
    migrations: {
      directory: './src/db/migrations',
      tableName: 'knex_migrations'
    }
  }
};
