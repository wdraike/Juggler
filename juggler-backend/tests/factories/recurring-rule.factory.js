/**
 * RecurringRule factory for juggler test suite.
 * Creates comprehensive recurring rule configurations covering edge cases.
 *
 * Recurrence rule structure:
 *   recur: { type: 'daily'|'weekly'|'monthly'|'yearly'|'custom', days?: string[], every?: number }
 *
 * Edge cases covered:
 *   - Daily recurring rules
 *   - Weekly recurring rules (specific days)
 *   - Monthly recurring rules (day-of-month, month-end)
 *   - Yearly recurring rules (leap years, specific dates)
 *   - Complex patterns (every 2nd Tuesday, every other month)
 *   - Date boundaries (month-end, year-end)
 *   - Leap year handling
 */
const crypto = require('crypto');

/**
 * Generate a task ID in juggler format.
 * @returns {string} UUID-based ID
 */
function generateId() {
  return crypto.randomUUID();
}

/**
 * Create a daily recurring rule.
 *
 * @param {Object} options - Daily recurrence options
 * @param {number} [options.every=1] - Frequency (every N days)
 * @param {string} [options.startDate] - Start date (YYYY-MM-DD)
 * @param {string} [options.endDate] - End date (YYYY-MM-DD)
 * @param {string} [options.text='Daily task'] - Task title
 * @param {number} [options.dur=30] - Duration in minutes
 * @param {string} [options.pri='P3'] - Priority
 * @param {string} [options.project] - Project name
 * @returns {{ master: Object, instances: Array<Object> }} Master and instances
 */
function createDailyRule(userId, options = {}) {
  const masterId = generateId();
  const now = new Date();

  const master = {
    id: masterId,
    user_id: userId,
    text: options.text || 'Daily task',
    dur: options.dur ?? 30,
    pri: options.pri || 'P3',
    project: options.project || null,
    section: options.section || null,
    notes: options.notes || null,
    location: options.location || null,
    tools: options.tools || null,
    when: options.when || 'morning,lunch,afternoon,evening,night',
    day_req: options.day_req || 'any',
    deadline: options.deadline || null,
    recurring: true,
    recur: {
      type: 'daily',
      every: options.every ?? 1
    },
    recur_start: options.startDate || null,
    recur_end: options.endDate || null,
    split: false,
    placement_mode: 'flexible',
    disabled_at: null,
    disabled_reason: null,
    created_at: now,
    updated_at: now
  };

  // Create instances for the first 7 days as examples
  const instances = [];
  const instanceCount = 7; // One week of instances

  for (let i = 0; i < instanceCount; i++) {
    const instanceId = generateId();
    const daysToAdd = i * (options.every ?? 1);
    const scheduledDate = new Date();
    scheduledDate.setDate(scheduledDate.getDate() + daysToAdd);

    instances.push({
      id: instanceId,
      master_id: masterId,
      user_id: userId,
      occurrence_ordinal: i + 1,
      split_ordinal: 1,
      split_total: 1,
      split_group: null,
      dur: options.dur ?? 30,
      scheduled_at: scheduledDate,
      date: scheduledDate.toISOString().split('T')[0],
      day: scheduledDate.toLocaleDateString('en-US', { weekday: 'short' }),
      time: scheduledDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
      status: '',
      date_pinned: false,
      time_remaining: null,
      unscheduled: null,
      created_at: now,
      updated_at: now
    });
  }

  return { master, instances };
}

/**
 * Create a weekly recurring rule.
 *
 * @param {Object} options - Weekly recurrence options
 * @param {number} [options.every=1] - Frequency (every N weeks)
 * @param {Array<string>} [options.days=['Mon']] - Days of week (Mon, Tue, Wed, Thu, Fri, Sat, Sun)
 * @param {string} [options.startDate] - Start date (YYYY-MM-DD)
 * @param {string} [options.endDate] - End date (YYYY-MM-DD)
 * @param {string} [options.text='Weekly task'] - Task title
 * @param {number} [options.dur=30] - Duration in minutes
 * @param {string} [options.pri='P3'] - Priority
 * @param {string} [options.project] - Project name
 * @returns {{ master: Object, instances: Array<Object> }} Master and instances
 */
function createWeeklyRule(userId, options = {}) {
  const masterId = generateId();
  const now = new Date();

  const days = options.days || ['Mon'];
  const everyWeeks = options.every ?? 1;

  const master = {
    id: masterId,
    user_id: userId,
    text: options.text || 'Weekly task',
    dur: options.dur ?? 30,
    pri: options.pri || 'P3',
    project: options.project || null,
    section: options.section || null,
    notes: options.notes || null,
    location: options.location || null,
    tools: options.tools || null,
    when: options.when || 'morning,lunch,afternoon,evening,night',
    day_req: options.day_req || 'any',
    deadline: options.deadline || null,
    recurring: true,
    recur: {
      type: 'weekly',
      every: everyWeeks,
      days: days
    },
    recur_start: options.startDate || null,
    recur_end: options.endDate || null,
    split: false,
    placement_mode: 'flexible',
    disabled_at: null,
    disabled_reason: null,
    created_at: now,
    updated_at: now
  };

  // Create instances for the first 4 weeks as examples
  const instances = [];
  const weeksToGenerate = 4;

  for (let week = 0; week < weeksToGenerate; week++) {
    for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
      const instanceId = generateId();
      const weeksToAdd = week * everyWeeks;
      const scheduledDate = new Date();
      scheduledDate.setDate(scheduledDate.getDate() + (weeksToAdd * 7));

      // Set to the specific day of week
      const targetDay = days[dayIndex];
      const dayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
      const currentDay = scheduledDate.getDay();
      const daysToAdd = (dayMap[targetDay] - currentDay + 7) % 7;
      scheduledDate.setDate(scheduledDate.getDate() + daysToAdd);

      const occurrenceOrdinal = week * days.length + dayIndex + 1;

      instances.push({
        id: instanceId,
        master_id: masterId,
        user_id: userId,
        occurrence_ordinal: occurrenceOrdinal,
        split_ordinal: 1,
        split_total: 1,
        split_group: null,
        dur: options.dur ?? 30,
        scheduled_at: scheduledDate,
        date: scheduledDate.toISOString().split('T')[0],
        day: targetDay,
        time: scheduledDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
        status: '',
        date_pinned: false,
        time_remaining: null,
        unscheduled: null,
        created_at: now,
        updated_at: now
      });
    }
  }

  return { master, instances };
}

/**
 * Create a monthly recurring rule.
 *
 * @param {Object} options - Monthly recurrence options
 * @param {number} [options.every=1] - Frequency (every N months)
 * @param {number|'last'} [options.day=1] - Day of month (1-31) or 'last' for month-end
 * @param {string} [options.startDate] - Start date (YYYY-MM-DD)
 * @param {string} [options.endDate] - End date (YYYY-MM-DD)
 * @param {string} [options.text='Monthly task'] - Task title
 * @param {number} [options.dur=30] - Duration in minutes
 * @param {string} [options.pri='P3'] - Priority
 * @param {string} [options.project] - Project name
 * @returns {{ master: Object, instances: Array<Object> }} Master and instances
 */
function createMonthlyRule(userId, options = {}) {
  const masterId = generateId();
  const now = new Date();

  const day = options.day ?? 1;
  const everyMonths = options.every ?? 1;

  const master = {
    id: masterId,
    user_id: userId,
    text: options.text || 'Monthly task',
    dur: options.dur ?? 30,
    pri: options.pri || 'P3',
    project: options.project || null,
    section: options.section || null,
    notes: options.notes || null,
    location: options.location || null,
    tools: options.tools || null,
    when: options.when || 'morning,lunch,afternoon,evening,night',
    day_req: options.day_req || 'any',
    deadline: options.deadline || null,
    recurring: true,
    recur: {
      type: 'monthly',
      every: everyMonths,
      day: day
    },
    recur_start: options.startDate || null,
    recur_end: options.endDate || null,
    split: false,
    placement_mode: 'flexible',
    disabled_at: null,
    disabled_reason: null,
    created_at: now,
    updated_at: now
  };

  // Create instances for the first 6 months as examples
  const instances = [];
  const monthsToGenerate = 6;

  for (let month = 0; month < monthsToGenerate; month++) {
    const instanceId = generateId();
    const monthsToAdd = month * everyMonths;
    const scheduledDate = new Date();
    scheduledDate.setMonth(scheduledDate.getMonth() + monthsToAdd);

    if (day === 'last') {
      // Set to last day of month
      scheduledDate.setMonth(scheduledDate.getMonth() + 1, 0);
      // Ensure we're at midnight to avoid timezone issues
      scheduledDate.setHours(0, 0, 0, 0);
    } else {
      // Set to specific day of month
      const targetDay = Math.min(day, new Date(scheduledDate.getFullYear(), scheduledDate.getMonth() + 1, 0).getDate());
      scheduledDate.setDate(targetDay);
      scheduledDate.setHours(0, 0, 0, 0);
    }

    instances.push({
      id: instanceId,
      master_id: masterId,
      user_id: userId,
      occurrence_ordinal: month + 1,
      split_ordinal: 1,
      split_total: 1,
      split_group: null,
      dur: options.dur ?? 30,
      scheduled_at: scheduledDate,
      date: scheduledDate.toISOString().split('T')[0],
      day: scheduledDate.toLocaleDateString('en-US', { weekday: 'short' }),
      time: scheduledDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
      status: '',
      date_pinned: false,
      time_remaining: null,
      unscheduled: null,
      created_at: now,
      updated_at: now
    });
  }

  return { master, instances };
}

/**
 * Create a yearly recurring rule.
 *
 * @param {Object} options - Yearly recurrence options
 * @param {number} [options.every=1] - Frequency (every N years)
 * @param {string} [options.month='Jan'] - Month (Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec)
 * @param {number|'last'} [options.day=1] - Day of month (1-31) or 'last' for month-end
 * @param {string} [options.startDate] - Start date (YYYY-MM-DD)
 * @param {string} [options.endDate] - End date (YYYY-MM-DD)
 * @param {string} [options.text='Yearly task'] - Task title
 * @param {number} [options.dur=30] - Duration in minutes
 * @param {string} [options.pri='P3'] - Priority
 * @param {string} [options.project] - Project name
 * @returns {{ master: Object, instances: Array<Object> }} Master and instances
 */
function createYearlyRule(userId, options = {}) {
  const masterId = generateId();
  const now = new Date();

  const month = options.month || 'Jan';
  const day = options.day ?? 1;
  const everyYears = options.every ?? 1;

  const monthMap = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

  const master = {
    id: masterId,
    user_id: userId,
    text: options.text || 'Yearly task',
    dur: options.dur ?? 30,
    pri: options.pri || 'P3',
    project: options.project || null,
    section: options.section || null,
    notes: options.notes || null,
    location: options.location || null,
    tools: options.tools || null,
    when: options.when || 'morning,lunch,afternoon,evening,night',
    day_req: options.day_req || 'any',
    deadline: options.deadline || null,
    recurring: true,
    recur: {
      type: 'yearly',
      every: everyYears,
      month: month,
      day: day
    },
    recur_start: options.startDate || null,
    recur_end: options.endDate || null,
    split: false,
    placement_mode: 'flexible',
    disabled_at: null,
    disabled_reason: null,
    created_at: now,
    updated_at: now
  };

  // Create instances for the first 3 years as examples
  const instances = [];
  const yearsToGenerate = 3;

  for (let year = 0; year < yearsToGenerate; year++) {
    const instanceId = generateId();
    const yearsToAdd = year * everyYears;
    const scheduledDate = new Date();
    scheduledDate.setFullYear(scheduledDate.getFullYear() + yearsToAdd);
    scheduledDate.setMonth(monthMap[month]);

    if (day === 'last') {
      // Set to last day of month
      scheduledDate.setMonth(scheduledDate.getMonth() + 1, 0);
      // Ensure we're at midnight to avoid timezone issues
      scheduledDate.setHours(0, 0, 0, 0);
    } else {
      // Set to specific day of month
      const targetDay = Math.min(day, new Date(scheduledDate.getFullYear(), scheduledDate.getMonth() + 1, 0).getDate());
      scheduledDate.setDate(targetDay);
      scheduledDate.setHours(0, 0, 0, 0);
    }

    instances.push({
      id: instanceId,
      master_id: masterId,
      user_id: userId,
      occurrence_ordinal: year + 1,
      split_ordinal: 1,
      split_total: 1,
      split_group: null,
      dur: options.dur ?? 30,
      scheduled_at: scheduledDate,
      date: scheduledDate.toISOString().split('T')[0],
      day: scheduledDate.toLocaleDateString('en-US', { weekday: 'short' }),
      time: scheduledDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
      status: '',
      date_pinned: false,
      time_remaining: null,
      unscheduled: null,
      created_at: now,
      updated_at: now
    });
  }

  return { master, instances };
}

/**
 * Create a custom recurring rule (complex patterns).
 *
 * @param {Object} options - Custom recurrence options
 * @param {string} [options.pattern='every_2nd_Tuesday'] - Pattern type
 * @param {string} [options.startDate] - Start date (YYYY-MM-DD)
 * @param {string} [options.endDate] - End date (YYYY-MM-DD)
 * @param {string} [options.text='Custom recurring task'] - Task title
 * @param {number} [options.dur=30] - Duration in minutes
 * @param {string} [options.pri='P3'] - Priority
 * @param {string} [options.project] - Project name
 * @returns {{ master: Object, instances: Array<Object> }} Master and instances
 */
function createCustomRule(userId, options = {}) {
  const masterId = generateId();
  const now = new Date();
  const pattern = options.pattern || 'every_2nd_Tuesday';

  // Parse pattern to determine recurrence details
  let recurConfig = {};
  if (pattern === 'every_2nd_Tuesday') {
    recurConfig = {
      type: 'custom',
      pattern: 'every_2nd_Tuesday',
      every: 2,
      day_of_week: 'Tue',
      week_of_month: 2
    };
  } else if (pattern === 'every_other_month') {
    recurConfig = {
      type: 'custom',
      pattern: 'every_other_month',
      every: 2,
      month_interval: 2
    };
  } else if (pattern === 'biweekly') {
    recurConfig = {
      type: 'custom',
      pattern: 'biweekly',
      every: 2,
      days: ['Mon', 'Wed', 'Fri']
    };
  }

  const master = {
    id: masterId,
    user_id: userId,
    text: options.text || 'Custom recurring task',
    dur: options.dur ?? 30,
    pri: options.pri || 'P3',
    project: options.project || null,
    section: options.section || null,
    notes: options.notes || null,
    location: options.location || null,
    tools: options.tools || null,
    when: options.when || 'morning,lunch,afternoon,evening,night',
    day_req: options.day_req || 'any',
    deadline: options.deadline || null,
    recurring: true,
    recur: recurConfig,
    recur_start: options.startDate || null,
    recur_end: options.endDate || null,
    split: false,
    placement_mode: 'flexible',
    disabled_at: null,
    disabled_reason: null,
    created_at: now,
    updated_at: now
  };

  // Create sample instances based on pattern
  const instances = [];
  const instancesToGenerate = 6;

  if (pattern === 'every_2nd_Tuesday') {
    // Generate 6 occurrences of "every 2nd Tuesday"
    for (let i = 0; i < instancesToGenerate; i++) {
      const instanceId = generateId();
      const monthsToAdd = i * 2;
      const scheduledDate = new Date();
      scheduledDate.setMonth(scheduledDate.getMonth() + monthsToAdd);

      // Find the 2nd Tuesday of the month
      let tuesdayCount = 0;
      let day = 1;
      while (tuesdayCount < 2 && day <= 31) {
        const testDate = new Date(scheduledDate.getFullYear(), scheduledDate.getMonth(), day);
        if (testDate.getDay() === 2) { // Tuesday
          tuesdayCount++;
          if (tuesdayCount === 2) {
            scheduledDate.setDate(day);
            break;
          }
        }
        day++;
      }

      instances.push({
        id: instanceId,
        master_id: masterId,
        user_id: userId,
        occurrence_ordinal: i + 1,
        split_ordinal: 1,
        split_total: 1,
        split_group: null,
        dur: options.dur ?? 30,
        scheduled_at: scheduledDate,
        date: scheduledDate.toISOString().split('T')[0],
        day: 'Tue',
        time: scheduledDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
        status: '',
        date_pinned: false,
        time_remaining: null,
        unscheduled: null,
        created_at: now,
        updated_at: now
      });
    }
  } else if (pattern === 'every_other_month') {
    // Generate 6 occurrences of "every other month"
    for (let i = 0; i < instancesToGenerate; i++) {
      const instanceId = generateId();
      const monthsToAdd = i * 2;
      const scheduledDate = new Date();
      scheduledDate.setMonth(scheduledDate.getMonth() + monthsToAdd);
      scheduledDate.setDate(15); // Mid-month

      instances.push({
        id: instanceId,
        master_id: masterId,
        user_id: userId,
        occurrence_ordinal: i + 1,
        split_ordinal: 1,
        split_total: 1,
        split_group: null,
        dur: options.dur ?? 30,
        scheduled_at: scheduledDate,
        date: scheduledDate.toISOString().split('T')[0],
        day: scheduledDate.toLocaleDateString('en-US', { weekday: 'short' }),
        time: scheduledDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
        status: '',
        date_pinned: false,
        time_remaining: null,
        unscheduled: null,
        created_at: now,
        updated_at: now
      });
    }
  }

  return { master, instances };
}

/**
 * Create edge case scenarios for recurring rules.
 *
 * @param {Object} options - Edge case options
 * @param {string} [options.type='leap_year'] - Edge case type
 * @param {string} [options.startDate] - Start date (YYYY-MM-DD)
 * @param {string} [options.endDate] - End date (YYYY-MM-DD)
 * @param {string} [options.text='Edge case recurring task'] - Task title
 * @param {number} [options.dur=30] - Duration in minutes
 * @param {string} [options.pri='P3'] - Priority
 * @param {string} [options.project] - Project name
 * @returns {{ master: Object, instances: Array<Object> }} Master and instances
 */
function createEdgeCaseRule(userId, options = {}) {
  const masterId = generateId();
  const now = new Date();
  const edgeCaseType = options.type || 'leap_year';

  let recurConfig = {};
  let instances = [];

  if (edgeCaseType === 'leap_year') {
    // Leap year handling - Feb 29
    recurConfig = {
      type: 'yearly',
      every: 1,
      month: 'Feb',
      day: 29
    };

    // Generate instances including leap years
    const currentYear = now.getFullYear();
    const yearsToGenerate = [currentYear, currentYear + 1, currentYear + 2, currentYear + 3, currentYear + 4];

    for (let i = 0; i < yearsToGenerate.length; i++) {
      const instanceId = generateId();
      const year = yearsToGenerate[i];
      const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
      const scheduledDate = new Date(year, 1, 29); // Feb 29
      scheduledDate.setHours(0, 0, 0, 0); // Ensure midnight to avoid timezone issues

      // For non-leap years, use Feb 28
      if (!isLeapYear) {
        scheduledDate.setDate(28);
      }

      instances.push({
        id: instanceId,
        master_id: masterId,
        user_id: userId,
        occurrence_ordinal: i + 1,
        split_ordinal: 1,
        split_total: 1,
        split_group: null,
        dur: options.dur ?? 30,
        scheduled_at: scheduledDate,
        date: scheduledDate.toISOString().split('T')[0],
        day: scheduledDate.toLocaleDateString('en-US', { weekday: 'short' }),
        time: scheduledDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
        status: '',
        date_pinned: false,
        time_remaining: null,
        unscheduled: null,
        created_at: now,
        updated_at: now
      });
    }

  } else if (edgeCaseType === 'month_end') {
    // Month-end handling - different month lengths
    recurConfig = {
      type: 'monthly',
      every: 1,
      day: 'last'
    };

    // Generate instances for months with different lengths
    const monthsToGenerate = [
      { month: 1, year: now.getFullYear() }, // Jan (31 days)
      { month: 3, year: now.getFullYear() }, // Apr (30 days)
      { month: 1, year: now.getFullYear() + 1 }, // Jan next year
      { month: 11, year: now.getFullYear() }, // Dec (31 days)
      { month: 5, year: now.getFullYear() }, // Jun (30 days)
      { month: 1, year: now.getFullYear() + 2 } // Jan in 2 years
    ];

    for (let i = 0; i < monthsToGenerate.length; i++) {
      const instanceId = generateId();
      const { month, year } = monthsToGenerate[i];
      const scheduledDate = new Date(year, month, 0); // Last day of month
      scheduledDate.setHours(0, 0, 0, 0); // Ensure midnight to avoid timezone issues

      instances.push({
        id: instanceId,
        master_id: masterId,
        user_id: userId,
        occurrence_ordinal: i + 1,
        split_ordinal: 1,
        split_total: 1,
        split_group: null,
        dur: options.dur ?? 30,
        scheduled_at: scheduledDate,
        date: scheduledDate.toISOString().split('T')[0],
        day: scheduledDate.toLocaleDateString('en-US', { weekday: 'short' }),
        time: scheduledDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
        status: '',
        date_pinned: false,
        time_remaining: null,
        unscheduled: null,
        created_at: now,
        updated_at: now
      });
    }

  } else if (edgeCaseType === 'year_end') {
    // Year-end handling - Dec 31
    recurConfig = {
      type: 'yearly',
      every: 1,
      month: 'Dec',
      day: 31
    };

    // Generate instances for year-end
    for (let i = 0; i < 5; i++) {
      const instanceId = generateId();
      const year = now.getFullYear() + i;
      const scheduledDate = new Date(year, 11, 31); // Dec 31

      instances.push({
        id: instanceId,
        master_id: masterId,
        user_id: userId,
        occurrence_ordinal: i + 1,
        split_ordinal: 1,
        split_total: 1,
        split_group: null,
        dur: options.dur ?? 30,
        scheduled_at: scheduledDate,
        date: scheduledDate.toISOString().split('T')[0],
        day: scheduledDate.toLocaleDateString('en-US', { weekday: 'short' }),
        time: scheduledDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
        status: '',
        date_pinned: false,
        time_remaining: null,
        unscheduled: null,
        created_at: now,
        updated_at: now
      });
    }
  }

  const master = {
    id: masterId,
    user_id: userId,
    text: options.text || `Edge case: ${edgeCaseType} recurring task`,
    dur: options.dur ?? 30,
    pri: options.pri || 'P3',
    project: options.project || null,
    section: options.section || null,
    notes: `Edge case test: ${edgeCaseType}`,
    location: options.location || null,
    tools: options.tools || null,
    when: options.when || 'morning,lunch,afternoon,evening,night',
    day_req: options.day_req || 'any',
    deadline: options.deadline || null,
    recurring: true,
    recur: recurConfig,
    recur_start: options.startDate || null,
    recur_end: options.endDate || null,
    split: false,
    placement_mode: 'flexible',
    disabled_at: null,
    disabled_reason: null,
    created_at: now,
    updated_at: now
  };

  return { master, instances };
}

module.exports = {
  createDailyRule,
  createWeeklyRule,
  createMonthlyRule,
  createYearlyRule,
  createCustomRule,
  createEdgeCaseRule,
  generateId
};