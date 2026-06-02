/**
 * Location factory for juggler test suite.
 * Creates location entities for testing.
 */
const crypto = require('crypto');

/**
 * Create a location object for testing
 * @param {string} userId - User ID who owns this location
 * @param {Object} overrides - Optional field overrides
 * @returns {Object} Location object
 */
function createLocation(userId, overrides = {}) {
  return {
    id: overrides.id || crypto.randomUUID(),
    user_id: userId,
    location_id: overrides.location_id || `loc-${crypto.randomUUID().substring(0, 8)}`,
    name: overrides.name || 'Office',
    icon: overrides.icon || 'map-pin',
    sort_order: overrides.sort_order || 0,
    created_at: overrides.created_at || new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create multiple locations for a user
 * @param {string} userId - User ID
 * @param {number} count - Number of locations to create
 * @param {Object} options - Shared options for all locations
 * @returns {Array<Object>} Array of location objects
 */
function createLocations(userId, count, options = {}) {
  const locations = [];
  for (let i = 0; i < count; i++) {
    locations.push(createLocation(userId, {
      ...options,
      name: options.name ? `${options.name} ${i + 1}` : `Location ${i + 1}`,
      sort_order: i
    }));
  }
  return locations;
}

module.exports = {
  createLocation,
  createLocations,
};