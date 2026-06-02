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

/**
 * Create a free user
 * @param {Object} overrides - Optional field overrides
 * @returns {Object} Free user object
 */
function createFreeUser(overrides = {}) {
  return createUserWithPlan('free', {
    name: 'Free User',
    ...overrides,
  });
}

/**
 * Create a pro user (monthly or annual)
 * @param {string} billingCycle - 'monthly' or 'annual'
 * @param {Object} overrides - Optional field overrides
 * @returns {Object} Pro user object
 */
function createProUser(billingCycle = 'monthly', overrides = {}) {
  const plan = `pro-${billingCycle}`;
  return createUserWithPlan(plan, {
    name: `Pro User (${billingCycle})`,
    ...overrides,
  });
}

/**
 * Create a premium user (monthly or annual)
 * @param {string} billingCycle - 'monthly' or 'annual'
 * @param {Object} overrides - Optional field overrides
 * @returns {Object} Premium user object
 */
function createPremiumUser(billingCycle = 'monthly', overrides = {}) {
  const plan = `premium-${billingCycle}`;
  return createUserWithPlan(plan, {
    name: `Premium User (${billingCycle})`,
    ...overrides,
  });
}

/**
 * Create a user with Google Calendar integration
 * @param {Object} options - Configuration options
 * @param {string} [options.userId] - User ID to use (will generate if not provided)
 * @param {Object} [options.userOverrides] - User field overrides
 * @param {Object} [options.calendarOverrides] - Calendar configuration overrides
 * @returns {Object} User with GCal integration
 */
function createUserWithGCalIntegration(options = {}) {
  const { userId, userOverrides = {}, calendarOverrides = {} } = options;
  
  const user = createUser({
    id: userId || crypto.randomUUID(),
    google_id: `gcal-${userId || crypto.randomUUID().substring(0, 12)}`,
    ...userOverrides,
  });

  return {
    user,
    calendar: {
      provider: 'gcal',
      calendar_id: calendarOverrides.calendar_id || 'primary',
      display_name: calendarOverrides.display_name || 'Primary Calendar',
      enabled: calendarOverrides.enabled !== undefined ? calendarOverrides.enabled : true,
      sync_direction: calendarOverrides.sync_direction || 'full',
    }
  };
}

/**
 * Create a user with Microsoft Calendar integration
 * @param {Object} options - Configuration options
 * @param {string} [options.userId] - User ID to use (will generate if not provided)
 * @param {Object} [options.userOverrides] - User field overrides
 * @param {Object} [options.calendarOverrides] - Calendar configuration overrides
 * @returns {Object} User with MSFT integration
 */
function createUserWithMSFTIntegration(options = {}) {
  const { userId, userOverrides = {}, calendarOverrides = {} } = options;
  
  const user = createUser({
    id: userId || crypto.randomUUID(),
    ...userOverrides,
  });

  return {
    user,
    calendar: {
      provider: 'msft',
      calendar_id: calendarOverrides.calendar_id || 'AAMkAD',
      display_name: calendarOverrides.display_name || 'Work Calendar',
      enabled: calendarOverrides.enabled !== undefined ? calendarOverrides.enabled : true,
      sync_direction: calendarOverrides.sync_direction || 'full',
    }
  };
}

/**
 * Create a user with Apple Calendar integration
 * @param {Object} options - Configuration options
 * @param {string} [options.userId] - User ID to use (will generate if not provided)
 * @param {Object} [options.userOverrides] - User field overrides
 * @param {Object} [options.calendarOverrides] - Calendar configuration overrides
 * @returns {Object} User with Apple integration
 */
function createUserWithAppleIntegration(options = {}) {
  const { userId, userOverrides = {}, calendarOverrides = {} } = options;
  
  const user = createUser({
    id: userId || crypto.randomUUID(),
    ...userOverrides,
  });

  return {
    user,
    calendar: {
      provider: 'apple',
      calendar_id: calendarOverrides.calendar_id || 'https://caldav.icloud.com/123456/calendars/primary/',
      display_name: calendarOverrides.display_name || 'iCloud Calendar',
      enabled: calendarOverrides.enabled !== undefined ? calendarOverrides.enabled : true,
      sync_direction: calendarOverrides.sync_direction || 'full',
    }
  };
}

/**
 * Create a user with multiple calendar integrations
 * @param {Object} options - Configuration options
 * @param {string} [options.userId] - User ID to use (will generate if not provided)
 * @param {Object} [options.userOverrides] - User field overrides
 * @param {Array} [options.providers=['gcal', 'msft', 'apple']] - Which calendar providers to include
 * @returns {Object} User with multiple calendar integrations
 */
function createUserWithMultipleCalendars(options = {}) {
  const { userId, userOverrides = {}, providers = ['gcal', 'msft', 'apple'] } = options;
  
  const user = createUser({
    id: userId || crypto.randomUUID(),
    google_id: providers.includes('gcal') ? `gcal-${userId || crypto.randomUUID().substring(0, 12)}` : null,
    ...userOverrides,
  });

  const calendars = [];
  
  if (providers.includes('gcal')) {
    calendars.push({
      provider: 'gcal',
      calendar_id: 'primary',
      display_name: 'Primary Calendar',
      enabled: true,
      sync_direction: 'full',
    });
  }

  if (providers.includes('msft')) {
    calendars.push({
      provider: 'msft',
      calendar_id: 'AAMkAD',
      display_name: 'Work Calendar',
      enabled: true,
      sync_direction: 'full',
    });
  }

  if (providers.includes('apple')) {
    calendars.push({
      provider: 'apple',
      calendar_id: 'https://caldav.icloud.com/123456/calendars/primary/',
      display_name: 'iCloud Calendar',
      enabled: true,
      sync_direction: 'full',
    });
  }

  return {
    user,
    calendars,
  };
}

/**
 * Create a comprehensive user dataset with all subscription levels and integrations
 * @returns {Object} Dataset with users of different types
 */
function createUserDataset() {
  const dataset = {
    users: [],
    calendars: [],
  };

  // Free user
  const freeUser = createFreeUser({ id: 'free-user-001' });
  dataset.users.push(freeUser);

  // Pro users (monthly and annual)
  const proMonthlyUser = createProUser('monthly', { id: 'pro-monthly-user-001' });
  const proAnnualUser = createProUser('annual', { id: 'pro-annual-user-001' });
  dataset.users.push(proMonthlyUser, proAnnualUser);

  // Premium users (monthly and annual)
  const premiumMonthlyUser = createPremiumUser('monthly', { id: 'premium-monthly-user-001' });
  const premiumAnnualUser = createPremiumUser('annual', { id: 'premium-annual-user-001' });
  dataset.users.push(premiumMonthlyUser, premiumAnnualUser);

  // User with Google Calendar integration
  const gcalUserResult = createUserWithGCalIntegration({ userId: 'gcal-user-001' });
  dataset.users.push(gcalUserResult.user);
  dataset.calendars.push(gcalUserResult.calendar);

  // User with Microsoft Calendar integration
  const msftUserResult = createUserWithMSFTIntegration({ userId: 'msft-user-001' });
  dataset.users.push(msftUserResult.user);
  dataset.calendars.push(msftUserResult.calendar);

  // User with Apple Calendar integration
  const appleUserResult = createUserWithAppleIntegration({ userId: 'apple-user-001' });
  dataset.users.push(appleUserResult.user);
  dataset.calendars.push(appleUserResult.calendar);

  // User with multiple calendar integrations
  const multiCalendarResult = createUserWithMultipleCalendars({ 
    userId: 'multi-calendar-user-001',
    providers: ['gcal', 'msft', 'apple']
  });
  dataset.users.push(multiCalendarResult.user);
  dataset.calendars.push(...multiCalendarResult.calendars);

  return dataset;
}

module.exports = {
  createUser,
  createUserWithPlan,
  createFreeUser,
  createProUser,
  createPremiumUser,
  createUserWithGCalIntegration,
  createUserWithMSFTIntegration,
  createUserWithAppleIntegration,
  createUserWithMultipleCalendars,
  createUserDataset,
};