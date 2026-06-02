/**
 * Tool factory for juggler test suite.
 * Creates tool entities for testing.
 */
const crypto = require('crypto');

/**
 * Create a tool object for testing
 * @param {string} userId - User ID who owns this tool
 * @param {Object} overrides - Optional field overrides
 * @returns {Object} Tool object
 */
function createTool(userId, overrides = {}) {
  return {
    id: overrides.id || crypto.randomUUID(),
    user_id: userId,
    tool_id: overrides.tool_id || `tool-${crypto.randomUUID().substring(0, 8)}`,
    name: overrides.name || 'Laptop',
    icon: overrides.icon || 'laptop',
    sort_order: overrides.sort_order || 0,
    created_at: overrides.created_at || new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create multiple tools for a user
 * @param {string} userId - User ID
 * @param {number} count - Number of tools to create
 * @param {Object} options - Shared options for all tools
 * @returns {Array<Object>} Array of tool objects
 */
function createTools(userId, count, options = {}) {
  const tools = [];
  for (let i = 0; i < count; i++) {
    tools.push(createTool(userId, {
      ...options,
      name: options.name ? `${options.name} ${i + 1}` : `Tool ${i + 1}`,
      sort_order: i
    }));
  }
  return tools;
}

module.exports = {
  createTool,
  createTools,
};