/**
 * Test suite for CalendarEvent factory
 */

const { 
  createCalendarEventTestSuite, 
  createCalendarEvent,
  createGoogleCalendarEvent,
  createMicrosoftOutlookEvent,
  createAppleCalendarEvent,
  createEventWithAttachments,
  createEventWithConflicts,
  createEventInErrorState,
  createDeletedEvent,
  createEventNeedingRecreation,
  createMultipleCalendarEvents
} = require('./calendar-event.factory');

// Mock user ID for testing
const testUserId = 'test-user-12345';

describe('CalendarEvent Factory', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('createCalendarEvent() - Basic Functionality', () => {
    test('should create a basic calendar event with default values', () => {
      const event = createCalendarEvent(testUserId);
      
      expect(event.user_id).toBe(testUserId);
      expect(event.provider).toBe('gcal'); // default provider
      expect(event.status).toBe('active'); // default status
      expect(event.origin).toBe('juggler'); // default origin
      expect(event.event_summary).toBe('Test Event'); // default title
      expect(event.event_start).toBeDefined(); // should have start time
      expect(event.event_end).toBeDefined(); // should have end time
      expect(event.provider_event_id).toBeDefined(); // should have provider event ID
      expect(event.id).toBeDefined(); // should have UUID
    });

    test('should create events for different providers', () => {
      const providers = ['gcal', 'msft', 'apple'];
      
      providers.forEach(provider => {
        const event = createCalendarEvent(testUserId, { provider });
        expect(event.provider).toBe(provider);
        expect(event.provider_event_id).toBeDefined();
      });
    });

    test('should validate provider input', () => {
      expect(() => {
        createCalendarEvent(testUserId, { provider: 'invalid' });
      }).toThrow('Invalid provider');
    });

    test('should validate status input', () => {
      expect(() => {
        createCalendarEvent(testUserId, { status: 'invalid_status' });
      }).toThrow('Invalid status');
    });

    test('should require userId', () => {
      expect(() => {
        createCalendarEvent(null);
      }).toThrow('userId is required');
    });
  });

  describe('Provider-Specific Events', () => {
    test('should create Google Calendar events with proper formatting', () => {
      const event = createCalendarEvent(testUserId, { provider: 'gcal' });
      expect(event.provider_event_id).toMatch(/^gcal-/);
      expect(event.provider_metadata.gcal_specific).toBeDefined();
      expect(event.provider_metadata.gcal_specific.html_link).toBeDefined();
      expect(event.provider_metadata.gcal_specific.hangoutLink).toBeDefined();
    });

    test('should create Microsoft Outlook events with proper formatting', () => {
      const event = createCalendarEvent(testUserId, { provider: 'msft' });
      expect(event.provider_event_id).toMatch(/^AAMk/);
      expect(event.provider_metadata.msft_specific).toBeDefined();
      expect(event.provider_metadata.msft_specific.webLink).toBeDefined();
      expect(event.provider_metadata.msft_specific.onlineMeetingUrl).toBeDefined();
    });

    test('should create Apple Calendar events with proper formatting', () => {
      const event = createCalendarEvent(testUserId, { provider: 'apple' });
      expect(event.provider_event_id).toContain('-');
      expect(event.provider_metadata.apple_specific).toBeDefined();
      expect(event.provider_metadata.apple_specific.calendar_url).toBeDefined();
      expect(event.provider_metadata.apple_specific.etag).toBeDefined();
    });
  });

  describe('Event States and Sync Scenarios', () => {
    test('should create events with different sync states', () => {
      const states = ['active', 'deleted', 'conflict', 'error'];
      
      states.forEach(state => {
        const event = createCalendarEvent(testUserId, { status: state });
        expect(event.status).toBe(state);
      });
    });

    test('should create events with attachments', () => {
      const event = createCalendarEvent(testUserId, { with_attachments: true });
      expect(event.attachments).toBeDefined();
      expect(event.attachments.length).toBe(2);
      expect(event.attachments[0].name).toBeDefined();
      expect(event.attachments[0].url).toBeDefined();
    });

    test('should create events with conflicts', () => {
      const event = createCalendarEvent(testUserId, { with_conflicts: true });
      expect(event.conflict_info).toBeDefined();
      expect(event.conflict_info.conflict_type).toBe('time_overlap');
      expect(event.conflict_info.conflicting_events).toBeDefined();
    });

    test('should create events in error state', () => {
      const errorMessage = 'Network timeout';
      const event = createCalendarEvent(testUserId, {
        status: 'error',
        error_detail: errorMessage,
        miss_count: 1
      });
      expect(event.status).toBe('error');
      expect(event.error_detail).toBe(errorMessage);
      expect(event.miss_count).toBe(1);
    });

    test('should create events needing recreation', () => {
      const event = createCalendarEvent(testUserId, {
        miss_count: 5,
        status: 'active'
      });
      expect(event.miss_count).toBe(5);
      expect(event.sync_state).toBe('needs_recreate');
    });

    test('should handle different miss count scenarios', () => {
      const event1 = createCalendarEvent(testUserId, { miss_count: 0 });
      const event2 = createCalendarEvent(testUserId, { miss_count: 2 });
      const event3 = createCalendarEvent(testUserId, { miss_count: 3 });
      
      expect(event1.sync_state).toBe('pending');
      expect(event2.sync_state).toBe('pending');
      expect(event3.sync_state).toBe('needs_recreate');
    });
  });

  describe('Time and Date Handling', () => {
    test('should create all-day events', () => {
      const event = createCalendarEvent(testUserId, { all_day: true });
      expect(event.event_all_day).toBe(true);
    });

    test('should accept custom start and end times', () => {
      const customStart = '2026-06-15T10:00:00Z';
      const customEnd = '2026-06-15T12:00:00Z';
      
      const event = createCalendarEvent(testUserId, {
        start_time: customStart,
        end_time: customEnd
      });
      
      expect(event.event_start).toBe(customStart);
      expect(event.event_end).toBe(customEnd);
    });

    test('should generate default times for tomorrow', () => {
      const event = createCalendarEvent(testUserId);
      const startDate = new Date(event.event_start);
      const endDate = new Date(event.event_end);
      
      // Should be tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      expect(startDate.getDate()).toBe(tomorrow.getDate());
      expect(startDate.getHours()).toBe(12); // 12:00 PM
      expect(endDate.getHours()).toBe(13); // 1:00 PM
    });
  });

  describe('Task Association and Metadata', () => {
    test('should associate events with tasks', () => {
      const taskId = 'task-12345';
      const event = createCalendarEvent(testUserId, { task_id: taskId });
      expect(event.task_id).toBe(taskId);
    });

    test('should handle calendar IDs for multi-calendar support', () => {
      const calendarId = 'https://caldav.icloud.com/123456789/calendars/work/';
      const event = createCalendarEvent(testUserId, {
        provider: 'apple',
        calendar_id: calendarId
      });
      expect(event.calendar_id).toBe(calendarId);
    });

    test('should include provider-specific metadata', () => {
      const event = createCalendarEvent(testUserId);
      expect(event.provider_metadata).toBeDefined();
      expect(event.provider_metadata.provider).toBe('gcal');
      expect(event.provider_metadata.event_id).toBeDefined();
    });

    test('should include sync timestamps', () => {
      const now = new Date().toISOString();
      const event = createCalendarEvent(testUserId, {
        synced_at: now,
        created_at: now,
        updated_at: now
      });
      
      expect(event.synced_at).toBe(now);
      expect(event.created_at).toBe(now);
      expect(event.updated_at).toBe(now);
    });
  });

  describe('Bulk Event Creation', () => {
    test('should create multiple events for different providers', () => {
      const events = createMultipleCalendarEvents(testUserId, 3);
      expect(events.length).toBe(3);
      expect(events[0].provider).toBe('gcal');
      expect(events[1].provider).toBe('msft');
      expect(events[2].provider).toBe('apple');
    });

    test('should create comprehensive test suite', () => {
      const suite = createCalendarEventTestSuite(testUserId);
      
      expect(suite.googleEvent).toBeDefined();
      expect(suite.microsoftEvent).toBeDefined();
      expect(suite.appleEvent).toBeDefined();
      expect(suite.errorEvent).toBeDefined();
      expect(suite.deletedEvent).toBeDefined();
      expect(suite.needsRecreationEvent).toBeDefined();
      expect(suite.multipleEvents).toBeDefined();
      expect(suite.multipleEvents.length).toBe(5);
    });
  });

  describe('Edge Cases and Validation', () => {
    test('should handle custom IDs', () => {
      const customId = 'custom-event-id-12345';
      const event = createCalendarEvent(testUserId, { id: customId });
      expect(event.id).toBe(customId);
    });

    test('should handle custom provider event IDs', () => {
      const customEventId = 'custom-provider-event-id';
      const event = createCalendarEvent(testUserId, {
        provider_event_id: customEventId
      });
      expect(event.provider_event_id).toBe(customEventId);
    });

    test('should handle different origin values', () => {
      const origins = ['juggler', 'provider', 'manual'];
      
      origins.forEach(origin => {
        const event = createCalendarEvent(testUserId, { origin });
        expect(event.origin).toBe(origin);
      });
    });

    test('should validate origin input', () => {
      expect(() => {
        createCalendarEvent(testUserId, { origin: 'invalid_origin' });
      }).toThrow('Invalid origin');
    });
  });

  describe('Hash and ETag Handling', () => {
    test('should handle various hash formats', () => {
      const event = createCalendarEvent(testUserId, {
        last_pushed_hash: 'abc123',
        last_pulled_hash: 'def456',
        last_user_hash: 'ghi789',
        provider_etag: '"etag-value-123"'
      });
      
      expect(event.last_pushed_hash).toBe('abc123');
      expect(event.last_pulled_hash).toBe('def456');
      expect(event.last_user_hash).toBe('ghi789');
      expect(event.provider_etag).toBe('"etag-value-123"');
    });

    test('should handle null hash values', () => {
      const event = createCalendarEvent(testUserId);
      expect(event.last_pushed_hash).toBeNull();
      expect(event.last_pulled_hash).toBeNull();
      expect(event.last_user_hash).toBeNull();
      expect(event.provider_etag).toBeNull();
    });
  });

  describe('Convenience Functions', () => {
    test('createGoogleCalendarEvent should create Google events', () => {
      const event = createGoogleCalendarEvent(testUserId);
      expect(event.provider).toBe('gcal');
    });

    test('createMicrosoftOutlookEvent should create Microsoft events', () => {
      const event = createMicrosoftOutlookEvent(testUserId);
      expect(event.provider).toBe('msft');
    });

    test('createAppleCalendarEvent should create Apple events', () => {
      const event = createAppleCalendarEvent(testUserId);
      expect(event.provider).toBe('apple');
    });

    test('createEventWithAttachments should create events with attachments', () => {
      const event = createEventWithAttachments(testUserId);
      expect(event.attachments).toBeDefined();
      expect(event.attachments.length).toBeGreaterThan(0);
    });

    test('createEventWithConflicts should create events with conflicts', () => {
      const event = createEventWithConflicts(testUserId);
      expect(event.conflict_info).toBeDefined();
    });

    test('createEventInErrorState should create error state events', () => {
      const event = createEventInErrorState(testUserId);
      expect(event.status).toBe('error');
      expect(event.error_detail).toBeDefined();
    });

    test('createDeletedEvent should create deleted events', () => {
      const event = createDeletedEvent(testUserId);
      expect(event.status).toBe('deleted');
    });

    test('createEventNeedingRecreation should create events needing recreation', () => {
      const event = createEventNeedingRecreation(testUserId);
      expect(event.miss_count).toBeGreaterThanOrEqual(3);
      expect(event.sync_state).toBe('needs_recreate');
    });
  });
});
