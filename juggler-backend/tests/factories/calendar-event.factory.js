/**
 * Comprehensive CalendarEvent factory for Juggler service
 * 
 * Creates calendar events for all supported providers (Google, Microsoft, Apple)
 * with various states, conflicts, and attachments.
 * 
 * Maps to cal_sync_ledger table in database.
 */

const crypto = require('crypto');

/**
 * Create a comprehensive calendar event for testing
 * 
 * @param {string} userId - User ID that owns this event
 * @param {Object} options - Optional event configuration
 * @param {string} options.title - Event title/summary (default: 'Test Event')
 * @param {string} options.start_time - ISO timestamp for event start
 * @param {string} options.end_time - ISO timestamp for event end
 * @param {string} options.provider - Calendar provider: 'gcal', 'msft', 'apple' (default: 'gcal')
 * @param {string} options.provider_event_id - Provider's event ID (auto-generated if not provided)
 * @param {string} options.calendar_id - Calendar ID for multi-calendar support
 * @param {string} options.origin - Origin: 'juggler', 'provider', 'manual' (default: 'juggler')
 * @param {boolean} options.all_day - Whether event is all-day (default: false)
 * @param {string} options.status - Sync status: 'active', 'deleted', 'conflict', 'error' (default: 'active')
 * @param {number} options.miss_count - Consecutive sync misses (default: 0)
 * @param {string} options.error_detail - Error message if status is 'error'
 * @param {string} options.last_pushed_hash - Hash of last pushed state
 * @param {string} options.last_pulled_hash - Hash of last pulled state
 * @param {string} options.last_user_hash - Hash of user-editable fields
 * @param {string} options.provider_etag - Provider's ETag for change detection
 * @param {string} options.task_id - Associated task ID
 * @param {boolean} options.with_attachments - Add attachments to event (default: false)
 * @param {boolean} options.with_conflicts - Create conflicting event (default: false)
 * @param {string} options.sync_state - Provider sync state: 'synced', 'pending', 'failed', 'needs_recreate'
 * @returns {Object} Calendar event object matching cal_sync_ledger schema
 */
function createCalendarEvent(userId, options = {}) {
  if (!userId) {
    throw new Error('userId is required for createCalendarEvent');
  }

  const validProviders = ['gcal', 'msft', 'apple'];
  const validStatuses = ['active', 'deleted', 'conflict', 'error'];
  const validOrigins = ['juggler', 'provider', 'manual'];

  const provider = options.provider || 'gcal';

  if (!validProviders.includes(provider)) {
    throw new Error(`Invalid provider: ${provider}. Must be one of: ${validProviders.join(', ')}`);
  }

  if (options.status && !validStatuses.includes(options.status)) {
    throw new Error(`Invalid status: ${options.status}. Must be one of: ${validStatuses.join(', ')}`);
  }

  if (options.origin && !validOrigins.includes(options.origin)) {
    throw new Error(`Invalid origin: ${options.origin}. Must be one of: ${validOrigins.join(', ')}`);
  }

  // Generate default times: 1-hour event starting at noon tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(12, 0, 0, 0);

  const endTime = new Date(tomorrow);
  endTime.setHours(13, 0, 0, 0);

  // Generate provider-specific event ID format
  const generateProviderEventId = () => {
    switch (provider) {
      case 'gcal':
        return `gcal-${crypto.randomUUID().substring(0, 16)}`;
      case 'msft':
        return `AAMk${crypto.randomUUID().substring(0, 8)}`;
      case 'apple':
        return `${crypto.randomUUID().substring(0, 8)}-${crypto.randomUUID().substring(0, 4)}-${crypto.randomUUID().substring(0, 4)}-${crypto.randomUUID().substring(0, 4)}-${crypto.randomUUID().substring(0, 12)}`;
      default:
        return `evt-${crypto.randomUUID().substring(0, 16)}`;
    }
  };

  // Generate attachments if requested
  const generateAttachments = () => {
    if (!options.with_attachments) return undefined;

    return [
      {
        id: crypto.randomUUID(),
        name: 'meeting_notes.pdf',
        url: 'https://example.com/attachments/meeting_notes.pdf',
        mime_type: 'application/pdf',
        size: 12345
      },
      {
        id: crypto.randomUUID(),
        name: 'agenda.docx',
        url: 'https://example.com/attachments/agenda.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 8765
      }
    ];
  };

  // Generate conflict information if requested
  const generateConflictInfo = () => {
    if (!options.with_conflicts) return undefined;

    return {
      conflict_type: 'time_overlap',
      conflicting_events: [
        {
          id: crypto.randomUUID(),
          title: 'Conflicting Meeting',
          start_time: options.start_time || tomorrow.toISOString(),
          end_time: options.end_time || endTime.toISOString()
        }
      ],
      resolution_status: 'unresolved',
      resolution_strategy: 'manual'
    };
  };

  // Generate provider-specific metadata
  const generateProviderMetadata = () => {
    const baseMetadata = {
      provider,
      event_id: options.provider_event_id || generateProviderEventId(),
      summary: options.title || 'Test Event',
      start: options.start_time || tomorrow.toISOString(),
      end: options.end_time || endTime.toISOString(),
      all_day: options.all_day ?? false
    };

    switch (provider) {
      case 'gcal':
        return {
          ...baseMetadata,
          gcal_specific: {
            html_link: `https://calendar.google.com/calendar/event?eid=${baseMetadata.event_id}`,
            iCalUID: `${baseMetadata.event_id}@google.com`,
            hangoutLink: `https://meet.google.com/${crypto.randomUUID().substring(0, 10)}`
          }
        };
      case 'msft':
        return {
          ...baseMetadata,
          msft_specific: {
            webLink: `https://outlook.live.com/calendar/0/view/day/${baseMetadata.event_id}`,
            onlineMeetingUrl: `https://teams.microsoft.com/l/meetup-join/${crypto.randomUUID().substring(0, 16)}`,
            organizer: {
              emailAddress: {
                address: 'organizer@example.com',
                name: 'Organizer'
              }
            }
          }
        };
      case 'apple':
        return {
          ...baseMetadata,
          apple_specific: {
            calendar_url: options.calendar_id || 'https://caldav.icloud.com/123456789/calendars/primary/',
            etag: `"${crypto.randomUUID()}"`,
            sequence: 0
          }
        };
      default:
        return baseMetadata;
    }
  };

  // Determine sync state based on options
  const determineSyncState = () => {
    if (options.error_detail) return 'failed';
    if (options.miss_count && options.miss_count >= 3) return 'needs_recreate';
    if (options.with_conflicts) return 'conflict';
    if (options.last_pushed_hash || options.last_pulled_hash) return 'synced';
    return options.sync_state || 'pending';
  };

  const event = {
    id: options.id || crypto.randomUUID(),
    user_id: userId,
    provider,
    task_id: options.task_id || null,
    provider_event_id: options.provider_event_id || generateProviderEventId(),
    calendar_id: options.calendar_id || null,
    origin: options.origin || 'juggler',
    event_summary: options.title || 'Test Event',
    event_start: options.start_time || tomorrow.toISOString(),
    event_end: options.end_time || endTime.toISOString(),
    event_all_day: options.all_day ?? false,
    last_modified_at: options.last_modified_at || null,
    task_updated_at: options.task_updated_at || null,
    status: options.status || 'active',
    miss_count: options.miss_count || 0,
    error_detail: options.error_detail || null,
    last_pushed_hash: options.last_pushed_hash || null,
    last_pulled_hash: options.last_pulled_hash || null,
    last_user_hash: options.last_user_hash || null,
    provider_etag: options.provider_etag || null,
    synced_at: options.synced_at || null,
    created_at: options.created_at || new Date().toISOString(),
    updated_at: options.updated_at || new Date().toISOString(),
    
    // Extended metadata (not in DB but useful for testing)
    provider_metadata: generateProviderMetadata(),
    attachments: generateAttachments(),
    conflict_info: generateConflictInfo(),
    sync_state: determineSyncState()
  };

  return event;
}

/**
 * Create a Google Calendar event
 */
function createGoogleCalendarEvent(userId, options = {}) {
  return createCalendarEvent(userId, { ...options, provider: 'gcal' });
}

/**
 * Create a Microsoft Outlook event
 */
function createMicrosoftOutlookEvent(userId, options = {}) {
  return createCalendarEvent(userId, { ...options, provider: 'msft' });
}

/**
 * Create an Apple Calendar event
 */
function createAppleCalendarEvent(userId, options = {}) {
  return createCalendarEvent(userId, { ...options, provider: 'apple' });
}

/**
 * Create a calendar event with attachments
 */
function createEventWithAttachments(userId, options = {}) {
  return createCalendarEvent(userId, { ...options, with_attachments: true });
}

/**
 * Create a calendar event with conflicts
 */
function createEventWithConflicts(userId, options = {}) {
  return createCalendarEvent(userId, { ...options, with_conflicts: true });
}

/**
 * Create a calendar event in error state
 */
function createEventInErrorState(userId, options = {}) {
  return createCalendarEvent(userId, {
    ...options,
    status: 'error',
    error_detail: options.error_detail || 'Sync failed: Network timeout',
    miss_count: options.miss_count || 1
  });
}

/**
 * Create a deleted calendar event
 */
function createDeletedEvent(userId, options = {}) {
  return createCalendarEvent(userId, {
    ...options,
    status: 'deleted',
    miss_count: options.miss_count || 0
  });
}

/**
 * Create a calendar event that needs recreation (multiple sync misses)
 */
function createEventNeedingRecreation(userId, options = {}) {
  return createCalendarEvent(userId, {
    ...options,
    miss_count: options.miss_count || 5,
    status: 'active'
  });
}

/**
 * Create multiple calendar events for a user
 */
function createMultipleCalendarEvents(userId, count = 3, options = {}) {
  const events = [];
  const providers = ['gcal', 'msft', 'apple'];

  for (let i = 0; i < count; i++) {
    const provider = providers[i % providers.length];
    
    // Create events spread over different days
    const eventDate = new Date();
    eventDate.setDate(eventDate.getDate() + i + 1);
    eventDate.setHours(9 + i, 0, 0, 0);
    
    const endDate = new Date(eventDate);
    endDate.setHours(endDate.getHours() + 1);

    events.push(createCalendarEvent(userId, {
      ...options,
      provider,
      title: `Event ${i + 1} - ${provider.toUpperCase()}`,
      start_time: eventDate.toISOString(),
      end_time: endDate.toISOString(),
      task_id: options.task_id ? `${options.task_id}_${i}` : null
    }));
  }

  return events;
}

/**
 * Create a comprehensive test suite of calendar events
 */
function createCalendarEventTestSuite(userId) {
  return {
    googleEvent: createGoogleCalendarEvent(userId, {
      title: 'Google Team Meeting',
      with_attachments: true
    }),
    
    microsoftEvent: createMicrosoftOutlookEvent(userId, {
      title: 'Microsoft Project Review',
      with_conflicts: true
    }),
    
    appleEvent: createAppleCalendarEvent(userId, {
      title: 'Apple Design Session',
      calendar_id: 'https://caldav.icloud.com/123456789/calendars/work/'
    }),
    
    errorEvent: createEventInErrorState(userId, {
      title: 'Failed Sync Event',
      error_detail: 'Authentication token expired'
    }),
    
    deletedEvent: createDeletedEvent(userId, {
      title: 'Cancelled Meeting'
    }),
    
    needsRecreationEvent: createEventNeedingRecreation(userId, {
      title: 'Missing Event - Needs Recreate'
    }),
    
    multipleEvents: createMultipleCalendarEvents(userId, 5)
  };
}

module.exports = {
  createCalendarEvent,
  createGoogleCalendarEvent,
  createMicrosoftOutlookEvent,
  createAppleCalendarEvent,
  createEventWithAttachments,
  createEventWithConflicts,
  createEventInErrorState,
  createDeletedEvent,
  createEventNeedingRecreation,
  createMultipleCalendarEvents,
  createCalendarEventTestSuite
};