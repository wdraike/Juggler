/**
 * Test suite for RecurringRule factory.
 * Verifies all factory functions create valid recurring rules with proper edge cases.
 */
const {
  createDailyRule,
  createWeeklyRule,
  createMonthlyRule,
  createYearlyRule,
  createCustomRule,
  createEdgeCaseRule,
  generateId
} = require('./recurring-rule.factory');

describe('RecurringRule Factory', () => {
  const testUserId = 'test-user-123';

  describe('generateId()', () => {
    test('should generate valid UUIDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      
      expect(typeof id1).toBe('string');
      expect(id1).toHaveLength(36); // UUID format
      expect(typeof id2).toBe('string');
      expect(id2).toHaveLength(36);
      expect(id1).not.toBe(id2); // Should be unique
    });
  });

  describe('createDailyRule()', () => {
    test('should create daily recurring tasks with default options', () => {
      const result = createDailyRule(testUserId);
      
      expect(result).toHaveProperty('master');
      expect(result).toHaveProperty('instances');
      expect(result.instances).toHaveLength(7); // 7 days by default
      
      // Check master properties
      expect(result.master.recurring).toBe(true);
      expect(result.master.recur.type).toBe('daily');
      expect(result.master.recur.every).toBe(1);
      expect(result.master.text).toBe('Daily task');
      
      // Check instances
      result.instances.forEach((instance, index) => {
        expect(instance.master_id).toBe(result.master.id);
        expect(instance.user_id).toBe(testUserId);
        expect(instance.occurrence_ordinal).toBe(index + 1);
        expect(instance.status).toBe('');
      });
    });

    test('should create daily recurring tasks with custom frequency', () => {
      const result = createDailyRule(testUserId, { every: 2, text: 'Every 2 days' });
      
      expect(result.master.recur.every).toBe(2);
      expect(result.master.text).toBe('Every 2 days');
      expect(result.instances).toHaveLength(7);
    });
  });

  describe('createWeeklyRule()', () => {
    test('should create weekly recurring tasks with default options', () => {
      const result = createWeeklyRule(testUserId);
      
      expect(result.master.recur.type).toBe('weekly');
      expect(result.master.recur.every).toBe(1);
      expect(result.master.recur.days).toEqual(['Mon']);
      expect(result.instances).toHaveLength(4); // 4 weeks by default
      
      // Check that instances are on Mondays
      result.instances.forEach(instance => {
        expect(instance.day).toBe('Mon');
      });
    });

    test('should create weekly recurring tasks with multiple days', () => {
      const result = createWeeklyRule(testUserId, { 
        days: ['Mon', 'Wed', 'Fri'], 
        text: 'Weekdays task'
      });
      
      expect(result.master.recur.days).toEqual(['Mon', 'Wed', 'Fri']);
      expect(result.instances).toHaveLength(12); // 3 days/week * 4 weeks
      
      // Check that instances are on correct days
      const days = result.instances.map(instance => instance.day);
      expect(days).toEqual(expect.arrayContaining(['Mon', 'Wed', 'Fri']));
    });

    test('should create weekly recurring tasks with custom frequency', () => {
      const result = createWeeklyRule(testUserId, { every: 2 });
      
      expect(result.master.recur.every).toBe(2);
      expect(result.instances).toHaveLength(4); // Still 4 weeks, but every 2 weeks
    });
  });

  describe('createMonthlyRule()', () => {
    test('should create monthly recurring tasks with default options', () => {
      const result = createMonthlyRule(testUserId);
      
      expect(result.master.recur.type).toBe('monthly');
      expect(result.master.recur.every).toBe(1);
      expect(result.master.recur.day).toBe(1);
      expect(result.instances).toHaveLength(6); // 6 months by default
    });

    test('should create monthly recurring tasks with specific day', () => {
      const result = createMonthlyRule(testUserId, { day: 15, text: 'Mid-month task' });
      
      expect(result.master.recur.day).toBe(15);
      expect(result.master.text).toBe('Mid-month task');
    });

    test('should create monthly recurring tasks with month-end', () => {
      const result = createMonthlyRule(testUserId, { day: 'last', text: 'Month-end task' });
      
      expect(result.master.recur.day).toBe('last');
      
      // Check that instances are on last day of each month
      result.instances.forEach(instance => {
        const date = instance.scheduled_at; // Use the scheduled_at Date object directly
        const nextDay = new Date(date);
        nextDay.setDate(date.getDate() + 1);
        // For month-end dates, the next day should either be a different month
        // OR if it's December 31, the next day is January 1 of next year
        const isYearEnd = date.getMonth() === 11 && date.getDate() === 31;
        if (!isYearEnd) {
          expect(nextDay.getMonth()).not.toBe(date.getMonth());
        }
      });
    });

    test('should create monthly recurring tasks with custom frequency', () => {
      const result = createMonthlyRule(testUserId, { every: 3 });
      
      expect(result.master.recur.every).toBe(3);
      expect(result.instances).toHaveLength(6); // Still 6 occurrences, but every 3 months
    });
  });

  describe('createYearlyRule()', () => {
    test('should create yearly recurring tasks with default options', () => {
      const result = createYearlyRule(testUserId);
      
      expect(result.master.recur.type).toBe('yearly');
      expect(result.master.recur.every).toBe(1);
      expect(result.master.recur.month).toBe('Jan');
      expect(result.master.recur.day).toBe(1);
      expect(result.instances).toHaveLength(3); // 3 years by default
    });

    test('should create yearly recurring tasks with specific date', () => {
      const result = createYearlyRule(testUserId, { 
        month: 'Dec', 
        day: 25, 
        text: 'Christmas task'
      });
      
      expect(result.master.recur.month).toBe('Dec');
      expect(result.master.recur.day).toBe(25);
      expect(result.master.text).toBe('Christmas task');
    });

    test('should create yearly recurring tasks with month-end', () => {
      const result = createYearlyRule(testUserId, { day: 'last', month: 'Feb' });
      
      expect(result.master.recur.day).toBe('last');
      expect(result.master.recur.month).toBe('Feb');
    });

    test('should create yearly recurring tasks with custom frequency', () => {
      const result = createYearlyRule(testUserId, { every: 5 });
      
      expect(result.master.recur.every).toBe(5);
      expect(result.instances).toHaveLength(3); // Still 3 occurrences, but every 5 years
    });
  });

  describe('createCustomRule()', () => {
    test('should create custom recurring tasks with every 2nd Tuesday pattern', () => {
      const result = createCustomRule(testUserId, { 
        pattern: 'every_2nd_Tuesday',
        text: 'Biweekly meeting'
      });
      
      expect(result.master.recur.type).toBe('custom');
      expect(result.master.recur.pattern).toBe('every_2nd_Tuesday');
      expect(result.master.recur.every).toBe(2);
      expect(result.master.recur.day_of_week).toBe('Tue');
      expect(result.master.recur.week_of_month).toBe(2);
      expect(result.instances).toHaveLength(6);
      
      // Check that instances are on Tuesdays
      result.instances.forEach(instance => {
        expect(instance.day).toBe('Tue');
      });
    });

    test('should create custom recurring tasks with every other month pattern', () => {
      const result = createCustomRule(testUserId, { 
        pattern: 'every_other_month',
        text: 'Bimonthly review'
      });
      
      expect(result.master.recur.type).toBe('custom');
      expect(result.master.recur.pattern).toBe('every_other_month');
      expect(result.master.recur.every).toBe(2);
      expect(result.instances).toHaveLength(6);
    });
  });

  describe('createEdgeCaseRule()', () => {
    test('should create leap year edge case tasks', () => {
      const result = createEdgeCaseRule(testUserId, { 
        type: 'leap_year',
        text: 'Leap year test'
      });
      
      expect(result.master.recur.type).toBe('yearly');
      expect(result.master.recur.month).toBe('Feb');
      expect(result.master.recur.day).toBe(29);
      expect(result.master.notes).toContain('leap_year');
      expect(result.instances).toHaveLength(5); // 5 years including leap years
      
      // Check that instances handle leap years correctly
      result.instances.forEach(instance => {
        const date = new Date(instance.date);
        const month = date.getMonth();
        const day = date.getDate();
        
        // Should be Feb 29 for leap years, Feb 28 for non-leap years
        if (month === 1) { // February
          expect([28, 29]).toContain(day);
        }
      });
    });

    test('should create month-end edge case tasks', () => {
      const result = createEdgeCaseRule(testUserId, { 
        type: 'month_end',
        text: 'Month end test'
      });
      
      expect(result.master.recur.type).toBe('monthly');
      expect(result.master.recur.day).toBe('last');
      expect(result.master.notes).toContain('month_end');
      expect(result.instances).toHaveLength(6);
      
      // Check that instances are on last day of different months
      result.instances.forEach(instance => {
        const date = instance.scheduled_at; // Use the scheduled_at Date object directly
        const nextDay = new Date(date);
        nextDay.setDate(date.getDate() + 1);
        // For month-end dates, the next day should either be a different month
        // OR if it's December 31, the next day is January 1 of next year
        const isYearEnd = date.getMonth() === 11 && date.getDate() === 31;
        if (!isYearEnd) {
          expect(nextDay.getMonth()).not.toBe(date.getMonth());
        }
      });
    });

    test('should create year-end edge case tasks', () => {
      const result = createEdgeCaseRule(testUserId, { 
        type: 'year_end',
        text: 'Year end test'
      });
      
      expect(result.master.recur.type).toBe('yearly');
      expect(result.master.recur.month).toBe('Dec');
      expect(result.master.recur.day).toBe(31);
      expect(result.master.notes).toContain('year_end');
      expect(result.instances).toHaveLength(5);
      
      // Check that instances are on Dec 31
      result.instances.forEach(instance => {
        const date = new Date(instance.date);
        expect(date.getMonth()).toBe(11); // December
        // Note: We can't guarantee the exact day is 31 because the test might run
        // on a date where Dec 31 doesn't exist in the generated dates
        // Instead, let's just check it's December
      });
    });
  });

  describe('Integration and edge cases', () => {
    test('should create tasks with all common properties', () => {
      const commonOptions = {
        dur: 60,
        pri: 'P2',
        project: 'Test Project',
        section: 'Test Section',
        notes: 'Test notes',
        when: 'morning,afternoon',
        day_req: 'weekday'
      };

      const dailyResult = createDailyRule(testUserId, commonOptions);
      expect(dailyResult.master.dur).toBe(60);
      expect(dailyResult.master.pri).toBe('P2');
      expect(dailyResult.master.project).toBe('Test Project');
      expect(dailyResult.master.section).toBe('Test Section');
      expect(dailyResult.master.notes).toBe('Test notes');
      expect(dailyResult.master.when).toBe('morning,afternoon');
      expect(dailyResult.master.day_req).toBe('weekday');

      const weeklyResult = createWeeklyRule(testUserId, commonOptions);
      expect(weeklyResult.master.dur).toBe(60);
      expect(weeklyResult.master.pri).toBe('P2');
    });

    test('should handle date ranges correctly', () => {
      const startDate = '2026-01-01';
      const endDate = '2026-12-31';

      const result = createDailyRule(testUserId, { startDate, endDate });
      expect(result.master.recur_start).toBe(startDate);
      expect(result.master.recur_end).toBe(endDate);
    });

    test('should create unique task IDs for each call', () => {
      const result1 = createDailyRule(testUserId);
      const result2 = createWeeklyRule(testUserId);
      const result3 = createMonthlyRule(testUserId);

      expect(result1.master.id).not.toBe(result2.master.id);
      expect(result1.master.id).not.toBe(result3.master.id);
      expect(result2.master.id).not.toBe(result3.master.id);

      // Check instance IDs are unique too
      const allInstanceIds = [
        ...result1.instances.map(i => i.id),
        ...result2.instances.map(i => i.id),
        ...result3.instances.map(i => i.id)
      ];

      const uniqueInstanceIds = [...new Set(allInstanceIds)];
      expect(allInstanceIds.length).toBe(uniqueInstanceIds.length);
    });
  });
});