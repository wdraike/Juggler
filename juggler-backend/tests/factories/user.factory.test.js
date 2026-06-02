/**
 * Test suite for User factory
 */

const {
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
} = require('./user.factory');

describe('User Factory', () => {
  describe('createUser', () => {
    it('should create a basic user with default values', () => {
      const user = createUser();
      
      expect(user).toHaveProperty('id');
      expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(user.email).toContain('@example.com');
      expect(user.name).toBe('Test User');
      expect(user.timezone).toBe('America/New_York');
      expect(user.created_at).toBeDefined();
      expect(user.updated_at).toBeDefined();
    });

    it('should allow field overrides', () => {
      const user = createUser({
        name: 'Custom User',
        timezone: 'Europe/London',
        picture_url: 'https://example.com/pic.jpg',
      });
      
      expect(user.name).toBe('Custom User');
      expect(user.timezone).toBe('Europe/London');
      expect(user.picture_url).toBe('https://example.com/pic.jpg');
    });
  });

  describe('createUserWithPlan', () => {
    it('should create a user with a valid plan', () => {
      const user = createUserWithPlan('premium-annual');
      expect(user._plan).toBe('premium-annual');
    });

    it('should throw error for invalid plan', () => {
      expect(() => createUserWithPlan('invalid-plan')).toThrow('Invalid plan');
    });
  });

  describe('createFreeUser', () => {
    it('should create a free user', () => {
      const user = createFreeUser();
      expect(user._plan).toBe('free');
      expect(user.name).toBe('Free User');
    });
  });

  describe('createProUser', () => {
    it('should create a pro user with monthly billing', () => {
      const user = createProUser('monthly');
      expect(user._plan).toBe('pro-monthly');
      expect(user.name).toBe('Pro User (monthly)');
    });

    it('should create a pro user with annual billing', () => {
      const user = createProUser('annual');
      expect(user._plan).toBe('pro-annual');
      expect(user.name).toBe('Pro User (annual)');
    });
  });

  describe('createPremiumUser', () => {
    it('should create a premium user with monthly billing', () => {
      const user = createPremiumUser('monthly');
      expect(user._plan).toBe('premium-monthly');
      expect(user.name).toBe('Premium User (monthly)');
    });

    it('should create a premium user with annual billing', () => {
      const user = createPremiumUser('annual');
      expect(user._plan).toBe('premium-annual');
      expect(user.name).toBe('Premium User (annual)');
    });
  });

  describe('Calendar Integrations', () => {
    describe('createUserWithGCalIntegration', () => {
      it('should create user with Google Calendar integration', () => {
        const result = createUserWithGCalIntegration();
        
        expect(result.user).toBeDefined();
        expect(result.user.google_id).toContain('gcal-');
        expect(result.calendar).toBeDefined();
        expect(result.calendar.provider).toBe('gcal');
        expect(result.calendar.calendar_id).toBe('primary');
      });

      it('should allow custom user ID and overrides', () => {
        const result = createUserWithGCalIntegration({
          userId: 'custom-user-id',
          userOverrides: { name: 'GCal User' },
          calendarOverrides: { display_name: 'Custom Calendar' }
        });
        
        expect(result.user.id).toBe('custom-user-id');
        expect(result.user.name).toBe('GCal User');
        expect(result.calendar.display_name).toBe('Custom Calendar');
      });
    });

    describe('createUserWithMSFTIntegration', () => {
      it('should create user with Microsoft Calendar integration', () => {
        const result = createUserWithMSFTIntegration();
        
        expect(result.user).toBeDefined();
        expect(result.calendar).toBeDefined();
        expect(result.calendar.provider).toBe('msft');
        expect(result.calendar.calendar_id).toBe('AAMkAD');
      });
    });

    describe('createUserWithAppleIntegration', () => {
      it('should create user with Apple Calendar integration', () => {
        const result = createUserWithAppleIntegration();
        
        expect(result.user).toBeDefined();
        expect(result.calendar).toBeDefined();
        expect(result.calendar.provider).toBe('apple');
        expect(result.calendar.calendar_id).toContain('https://caldav.icloud.com');
      });
    });

    describe('createUserWithMultipleCalendars', () => {
      it('should create user with multiple calendar integrations', () => {
        const result = createUserWithMultipleCalendars({
          providers: ['gcal', 'msft', 'apple']
        });
        
        expect(result.user).toBeDefined();
        expect(result.user.google_id).toContain('gcal-');
        expect(result.calendars).toHaveLength(3);
        
        const providers = result.calendars.map(c => c.provider);
        expect(providers).toContain('gcal');
        expect(providers).toContain('msft');
        expect(providers).toContain('apple');
      });

      it('should allow selecting specific providers', () => {
        const result = createUserWithMultipleCalendars({
          providers: ['gcal', 'apple']
        });
        
        expect(result.calendars).toHaveLength(2);
        const providers = result.calendars.map(c => c.provider);
        expect(providers).toContain('gcal');
        expect(providers).toContain('apple');
        expect(providers).not.toContain('msft');
      });
    });
  });

  describe('createUserDataset', () => {
    it('should create a comprehensive dataset with all user types', () => {
      const dataset = createUserDataset();
      
      expect(dataset.users).toHaveLength(9); // 1 free + 2 pro + 2 premium + 3 calendar + 1 multi
      expect(dataset.calendars).toHaveLength(6); // 1 gcal + 1 msft + 1 apple + 3 multi
      
      // Check we have all the expected user types
      const plans = dataset.users.map(u => u._plan).filter(p => p);
      expect(plans).toContain('free');
      expect(plans).toContain('pro-monthly');
      expect(plans).toContain('pro-annual');
      expect(plans).toContain('premium-monthly');
      expect(plans).toContain('premium-annual');
    });
  });
});