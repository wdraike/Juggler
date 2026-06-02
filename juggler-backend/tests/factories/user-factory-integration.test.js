/**
 * Integration test for User factory with comprehensive fixtures
 */

const { createComprehensiveTestDataset } = require('./comprehensive.factory');
const {
  createFreeUser,
  createProUser,
  createPremiumUser,
  createUserWithGCalIntegration,
  createUserWithMSFTIntegration,
  createUserWithAppleIntegration,
} = require('./user.factory');

describe('User Factory Integration', () => {
  describe('Comprehensive dataset integration', () => {
    it('should create users with different subscription levels', () => {
      const dataset = createComprehensiveTestDataset();
      
      const freeUser = dataset.users.find(u => u.id === 'free-user-001');
      const proUser = dataset.users.find(u => u.id === 'pro-user-001');
      const premiumUser = dataset.users.find(u => u.id === 'premium-user-001');
      
      expect(freeUser).toBeDefined();
      expect(freeUser._plan).toBe('free');
      expect(freeUser.name).toBe('Free User');
      
      expect(proUser).toBeDefined();
      expect(proUser._plan).toBe('pro-monthly');
      expect(proUser.name).toBe('Pro User');
      
      expect(premiumUser).toBeDefined();
      expect(premiumUser._plan).toBe('premium-annual');
      expect(premiumUser.name).toBe('Premium User');
    });

    it('should create users with proper IDs and structure', () => {
      const dataset = createComprehensiveTestDataset();
      
      for (const user of dataset.users) {
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('email');
        expect(user).toHaveProperty('name');
        expect(user).toHaveProperty('timezone');
        expect(user).toHaveProperty('created_at');
        expect(user).toHaveProperty('updated_at');
      }
    });
  });

  describe('Individual factory functions', () => {
    it('should create free user', () => {
      const user = createFreeUser({ id: 'test-free' });
      expect(user._plan).toBe('free');
      expect(user.name).toBe('Free User');
    });

    it('should create pro user with different billing cycles', () => {
      const monthlyUser = createProUser('monthly', { id: 'test-pro-monthly' });
      const annualUser = createProUser('annual', { id: 'test-pro-annual' });
      
      expect(monthlyUser._plan).toBe('pro-monthly');
      expect(annualUser._plan).toBe('pro-annual');
    });

    it('should create premium user with different billing cycles', () => {
      const monthlyUser = createPremiumUser('monthly', { id: 'test-premium-monthly' });
      const annualUser = createPremiumUser('annual', { id: 'test-premium-annual' });
      
      expect(monthlyUser._plan).toBe('premium-monthly');
      expect(annualUser._plan).toBe('premium-annual');
    });

    it('should create users with calendar integrations', () => {
      const gcalResult = createUserWithGCalIntegration({ userId: 'test-gcal' });
      const msftResult = createUserWithMSFTIntegration({ userId: 'test-msft' });
      const appleResult = createUserWithAppleIntegration({ userId: 'test-apple' });
      
      expect(gcalResult.calendar.provider).toBe('gcal');
      expect(msftResult.calendar.provider).toBe('msft');
      expect(appleResult.calendar.provider).toBe('apple');
    });
  });

  describe('User factory consistency', () => {
    it('should maintain consistent user structure across all factory methods', () => {
      const basicUser = createFreeUser();
      const proUser = createProUser('monthly');
      const premiumUser = createPremiumUser('annual');
      const gcalUserResult = createUserWithGCalIntegration();
      const gcalUser = gcalUserResult.user;
      
      const users = [basicUser, proUser, premiumUser, gcalUser];
      
      for (const user of users) {
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('email');
        expect(user).toHaveProperty('name');
        expect(user).toHaveProperty('timezone');
        expect(user).toHaveProperty('created_at');
        expect(user).toHaveProperty('updated_at');
      }
    });
  });
});