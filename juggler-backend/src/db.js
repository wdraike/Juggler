/**
 * Database connection module
 * Returns a Knex instance configured for the current environment
 */

const knex = require('knex');

const environment = process.env.NODE_ENV || 'development';
const knexfile = require('../knexfile.js');
const config = knexfile[environment];

if (!config) {
  throw new Error(`No database configuration found for environment: ${environment}`);
}

const db = knex(config);

module.exports = db;
