/**
 * Test factory for Calendar Event entities
 *
 * Calendar events map to cal_sync_ledger entries in the database.
 * Events have: id, user_id, title, start_time, end_time, provider, external_id
 *
 * Providers: gcal (Google Calendar), msft (Microsoft), apple (CalDAV)
 */

const crypto = require('crypto');

/**
 * Create a calendar event object for testing
 *
 * @param {string} userId - User ID that owns this event
 * @param {Object} options - Optional event configuration
 * @param {string} options.title - Event title/summary (default: 'Test Event')
 * @param {string} options.start_time - ISO timestamp for event start
 * @param {string} options.end_time - ISO timestamp for event end
 * @param {string} options.provider - Calendar provider: 'gcal', 'msft', 'apple' (default: 'gcal')
 * @param {string} options.external_id - Provider's event ID (auto-generated if not provided)
 * @param {boolean} options.all_day - Whether event is all-day (default: false)
 * @returns {Object} Calendar event object
 */
function createCalendarEvent(userId, options = {}) {
  if (!userId) {
    throw new Error('userId is required for createCalendarEvent');
  }

  const validProviders = ['gcal', 'msft', 'apple'];
  const provider = options.provider || 'gcal';

  if (!validProviders.includes(provider)) {
    throw new Error(`Invalid provider: ${provider}. Must be one of: ${validProviders.join(', ')}`);
  }

  // Generate default times: 1-hour event starting at noon tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(12, 0, 0, 0);

  const endTime = new Date(tomorrow);
  endTime.setHours(13, 0, 0, 0);

  return {
    id: options.id || crypto.randomUUID(),
    user_id: userId,
    title: options.title || 'Test Event',
    start_time: options.start_time || tomorrow.toISOString(),
    end_time: options.end_time || endTime.toISOString(),
    provider,
    external_id: options.external_id || `evt-${crypto.randomUUID().substring(0, 16)}`,
    all_day: options.all_day ?? false,
  };
}

module.exports = {
  createCalendarEvent,
};