/**
 * Project factory for juggler test suite.
 * Creates project entities for testing.
 */
const crypto = require('crypto');

/**
 * Create a project object for testing
 * @param {string} userId - User ID who owns this project
 * @param {Object} overrides - Optional field overrides
 * @returns {Object} Project object
 */
function createProject(userId, overrides = {}) {
  return {
    id: overrides.id || crypto.randomUUID(),
    user_id: userId,
    name: overrides.name || 'Test Project',
    color: overrides.color || '#6366F1',
    icon: overrides.icon || 'briefcase',
    sort_order: overrides.sort_order || 0,
    created_at: overrides.created_at || new Date().toISOString(),
    updated_at: overrides.updated_at || new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create multiple projects for a user
 * @param {string} userId - User ID
 * @param {number} count - Number of projects to create
 * @param {Object} options - Shared options for all projects
 * @returns {Array<Object>} Array of project objects
 */
function createProjects(userId, count, options = {}) {
  const projects = [];
  for (let i = 0; i < count; i++) {
    projects.push(createProject(userId, {
      ...options,
      name: options.name ? `${options.name} ${i + 1}` : `Project ${i + 1}`,
      sort_order: i
    }));
  }
  return projects;
}

module.exports = {
  createProject,
  createProjects,
};