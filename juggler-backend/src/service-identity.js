/**
 * Service Identity — centralized product/app identifiers for StriveRS
 *
 * All product and app references should come from here, not hardcoded strings.
 * Override via environment variables to rename without code changes.
 *
 * Values are read through lib/config (typed env access) rather than touching
 * process.env directly — the declared defaults live in the lib/config schema.
 */

const config = require('./lib/config');

module.exports = {
  APP_ID: config.getString('APP_ID'),
  PRODUCT_LABEL: config.getString('PRODUCT_LABEL'),
  SERVICE_NAME: config.getString('SERVICE_NAME'),
};
