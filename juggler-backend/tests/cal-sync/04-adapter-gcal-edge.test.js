/**
 * 04-adapter-gcal-edge.test.js — GCal adapter edge cases (mock-based)
 */
jest.setTimeout(30000);

var gcalAdapter = require('../../src/lib/cal-adapters/gcal.adapter');
var gcalApi = require('../../src/lib/gcal-api');

afterEach(() => jest.restoreAllMocks());

// ─── normalizeEvent: allday events ───────────────────────────────────────────

describe('normalizeEvent: allday events', () => {
  it('allday event with date-only start produces isAllDay:true', () => {
    var event = {
      id: 'allday-1',
      status: 'confirmed',
      summary: 'All day event',
      start: { date: '2026-06-15' },
      end: { date: '2026-06-16' }
    };
    var norm = gcalAdapter.normalizeEvent(event);
    expect(norm.isAllDay).toBe(true);
    expect(norm.startDateTime).toBe('2026-06-15');
  });

  it('timed event has isAllDay:false', () => {
    var event = {
      id: 'timed-1',
      status: 'confirmed',
      summary: 'Timed event',
      start: { dateTime: '2026-06-15T10:00:00-04:00' },
      end: { dateTime: '2026-06-15T11:00:00-04:00' }
    };
    var norm = gcalAdapter.normalizeEvent(event);
    expect(norm.isAllDay).toBe(false);
  });
});

// ─── buildEventBody: absent fields (PATCH-safe) ──────────────────────────────

describe('buildEventBody: absent fields (PATCH-safe)', () => {
  it('colorId absent from buildEventBody output', () => {
    var task = {
      id: 't1', text: 'Meeting', date: '2026-06-01', time: '10:00 AM',
      dur: 30, when: 'morning', status: 'todo', url: null
    };
    var body = gcalAdapter.buildEventBody(task, 2026, 'America/New_York');
    expect(body).not.toHaveProperty('colorId');
  });

  it('attendees absent from buildEventBody output', () => {
    var task = {
      id: 't1', text: 'Meeting', date: '2026-06-01', time: '10:00 AM',
      dur: 30, when: 'morning', status: 'todo', url: null
    };
    var body = gcalAdapter.buildEventBody(task, 2026, 'America/New_York');
    expect(body).not.toHaveProperty('attendees');
  });
});

// ─── hasChanges: 410 expired sync token ──────────────────────────────────────

describe('hasChanges: 410 expired sync token', () => {
  it('returns hasChanges:true when checkForChanges returns tokenInvalid', async () => {
    // gcalApi.checkForChanges handles 410 internally and returns
    // { hasChanges: true, tokenInvalid: true } rather than throwing.
    jest.spyOn(gcalApi, 'checkForChanges').mockResolvedValue(
      { hasChanges: true, tokenInvalid: true }
    );
    var user = { id: 'u1', gcal_sync_token: 'stale-token', gcal_refresh_token: 'rf' };

    var result = await gcalAdapter.hasChanges('access-token', user);
    expect(result.hasChanges).toBe(true);
    expect(result.tokenInvalid).toBe(true);
  });
});

// ─── BF-4: cancelled events ──────────────────────────────────────────────────

describe('BF-4: cancelled GCal events filtered from listEvents', () => {
  it('excludes status=cancelled events from listEvents result', async () => {
    jest.spyOn(gcalApi, 'listEvents').mockResolvedValue({
      items: [
        {
          id: 'live-event',
          status: 'confirmed',
          summary: 'Team meeting',
          start: { dateTime: '2026-06-01T10:00:00-04:00' },
          end: { dateTime: '2026-06-01T10:30:00-04:00' }
        },
        {
          id: 'cancelled-instance_20260601',
          status: 'cancelled',
          recurringEventId: 'cancelled-instance',
          originalStartTime: { dateTime: '2026-06-01T09:00:00-04:00' }
        }
      ],
      nextSyncToken: 'tok1'
    });

    var result = await gcalAdapter.listEvents('mock-token', '2026-06-01', '2026-06-08', null);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('live-event');
    expect(result.find(function(e) { return e.id === 'cancelled-instance_20260601'; })).toBeUndefined();
  });
});
