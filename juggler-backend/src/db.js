/**
 * Database connection module
 * Returns a Knex instance configured for the current environment.
 *
 * NOTE: @raike/lib-db is not yet installed as a package in this service.
 * Until the hexagonal migration is complete (JUG-HEX-P0, WBS 1.2),
 * this module uses knexfile.js directly.
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
