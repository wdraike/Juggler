/**
 * Test factory for User entities
 *
 * Users have: id, email, name, timezone, picture_url, google_id, created_at, updated_at
 * Plans are managed externally via payment service: free, pro-monthly, pro-annual, premium-monthly, premium-annual
 */

const crypto = require('crypto');

/**
 * Create a user object for testing
 * @param {Object} overrides - Optional field overrides
 * @returns {Object} User object
 */
function createUser(overrides = {}) {
  const id = overrides.id || crypto.randomUUID();
  const baseEmail = `user-${id.substring(0, 8)}@example.com`;

  return {
    id,
    email: baseEmail,
    name: 'Test User',
    picture_url: null,
    google_id: null,
    timezone: 'America/New_York',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a user object with a specific plan
 * Plan is stored externally in payment service, but this helper sets
 * metadata for test scenarios that need to track plan association.
 *
 * @param {string} plan - Plan ID: 'free', 'pro-monthly', 'pro-annual', 'premium-monthly', 'premium-annual'
 * @param {Object} overrides - Optional field overrides
 * @returns {Object} User object with plan metadata
 */
function createUserWithPlan(plan, overrides = {}) {
  const validPlans = ['free', 'pro-monthly', 'pro-annual', 'premium-monthly', 'premium-annual'];
  if (!validPlans.includes(plan)) {
    throw new Error(`Invalid plan: ${plan}. Must be one of: ${validPlans.join(', ')}`);
  }

  return createUser({
    ...overrides,
    // Plan is external, but we include it in test objects for convenience
    _plan: plan,
  });
}

module.exports = {
  createUser,
  createUserWithPlan,
};