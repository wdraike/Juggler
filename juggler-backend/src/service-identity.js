/**
 * Service Identity — centralized product/app identifiers for StriveRS
 *
 * All product and app references should come from here, not hardcoded strings.
 * Override via environment variables to rename without code changes.
 */

module.exports = {
  APP_ID: process.env.APP_ID || 'juggler',
  PRODUCT_LABEL: process.env.PRODUCT_LABEL || 'juggler',
  SERVICE_NAME: process.env.SERVICE_NAME || 'strivers',
};
