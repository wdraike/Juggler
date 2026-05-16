/**
 * 04-adapter-gcal-edge.test.js — GCal adapter edge cases (mock-based)
 */
jest.setTimeout(30000);

var gcalAdapter = require('../../src/lib/cal-adapters/gcal.adapter');
var gcalApi = require('../../src/lib/gcal-api');

afterEach(() => jest.restoreAllMocks());

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
