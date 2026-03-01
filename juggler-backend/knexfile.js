require('dotenv').config();

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
    pool: {
      min: 2,
      max: 10,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 100,
      afterCreate: (conn, done) => {
        conn.query('SELECT 1', (err) => done(err, conn));
      }
    },
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
    pool: {
      min: 2,
      max: 25,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 100,
      afterCreate: (conn, done) => {
        conn.query('SELECT 1', (err) => done(err, conn));
      }
    },
    migrations: {
      directory: './src/db/migrations',
      tableName: 'knex_migrations'
    }
  }
};
