/**
 * apple-cal-ctag.test.js — CTag / sync token edge cases for Apple CalDAV
 */
var { checkForChanges } = require('../src/lib/apple-cal-api');

describe('BF-9: CTag URL trailing-slash normalization', () => {
  it('returns hasChanges:false when token matches but URLs differ by trailing slash', async () => {
    var mockClient = {
      fetchCalendars: jest.fn().mockResolvedValue([
        { url: 'https://caldav.icloud.com/123/calendars/home', ctag: 'abc123', syncToken: null }
      ])
    };
    // Stored URL has trailing slash; server returns without
    var result = await checkForChanges(
      mockClient,
      'https://caldav.icloud.com/123/calendars/home/',
      'abc123'
    );
    expect(result.hasChanges).toBe(false);
  });

  it('returns hasChanges:true when token genuinely changed', async () => {
    var mockClient = {
      fetchCalendars: jest.fn().mockResolvedValue([
        { url: 'https://caldav.icloud.com/123/calendars/home/', ctag: 'new-token', syncToken: null }
      ])
    };
    var result = await checkForChanges(
      mockClient,
      'https://caldav.icloud.com/123/calendars/home/',
      'old-token'
    );
    expect(result.hasChanges).toBe(true);
    expect(result.syncToken).toBe('new-token');
  });

  it('returns hasChanges:false when both URLs have trailing slash and token matches', async () => {
    var mockClient = {
      fetchCalendars: jest.fn().mockResolvedValue([
        { url: 'https://caldav.icloud.com/123/calendars/home/', ctag: 'same-token', syncToken: null }
      ])
    };
    var result = await checkForChanges(
      mockClient,
      'https://caldav.icloud.com/123/calendars/home/',
      'same-token'
    );
    expect(result.hasChanges).toBe(false);
  });

  it('handles server returning null/empty calendars gracefully', async () => {
    var mockClient = {
      fetchCalendars: jest.fn().mockResolvedValue([])
    };
    var result = await checkForChanges(
      mockClient,
      'https://caldav.icloud.com/123/calendars/home/',
      'some-token'
    );
    // No calendar found → treat as changed (conservative)
    expect(result).toBeDefined();
    expect(typeof result.hasChanges).toBe('boolean');
  });
});
