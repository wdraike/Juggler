'use strict';

/**
 * Unit tests for src/lib/push-service.js (backlog 999.252).
 *
 * No DB. web-push is exercised via an injected fake client (deps.webpushClient)
 * and via env-var gating. Covers:
 *   - fail-soft no-op when VAPID keys absent
 *   - getPublicKey / isEnabled reflect env
 *   - sendPush delivers to every subscription
 *   - sendPush prunes 410/404 (gone) subscriptions, keeps others
 *   - non-gone failures are counted, not pruned
 */

// Mock web-push so setVapidDetails does not enforce real VAPID key formatting —
// these unit tests cover push-service logic (gating + send + prune), not the
// web-push library's own key validation. sendPush is exercised via injected
// fake clients (deps.webpushClient), so the module mock here only neutralizes
// setVapidDetails for the config path.
jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

const pushService = require('../src/lib/push-service');

const ORIG_ENV = { ...process.env };

function setVapid(on) {
  if (on) {
    process.env.VAPID_PUBLIC_KEY = 'BPublicKeyTestValue000000000000000000000000000000000000000000000000000000000000000000';
    process.env.VAPID_PRIVATE_KEY = 'privateKeyTestValue0000000000000000000000000';
    process.env.VAPID_SUBJECT = 'mailto:test@example.com';
  } else {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
  }
  pushService._resetConfigForTests();
}

afterEach(() => {
  process.env = { ...ORIG_ENV };
  pushService._resetConfigForTests();
});

describe('push-service VAPID config', () => {
  test('isEnabled() is false and getPublicKey() is null when keys absent', () => {
    setVapid(false);
    expect(pushService.isEnabled()).toBe(false);
    expect(pushService.getPublicKey()).toBeNull();
  });

  test('isEnabled() is true and getPublicKey() returns the key when configured', () => {
    setVapid(true);
    expect(pushService.isEnabled()).toBe(true);
    expect(pushService.getPublicKey()).toBe(process.env.VAPID_PUBLIC_KEY);
  });
});

describe('push-service.sendPush', () => {
  test('no-op (enabled:false) when VAPID not configured — does not load subs', async () => {
    setVapid(false);
    const loadSubscriptions = jest.fn();
    const deleteSubscription = jest.fn();
    const res = await pushService.sendPush(
      { loadSubscriptions, deleteSubscription }, 'user-1', { title: 'hi' }
    );
    expect(res).toEqual({ enabled: false, sent: 0, pruned: 0, failed: 0 });
    expect(loadSubscriptions).not.toHaveBeenCalled();
  });

  test('sends payload to every stored subscription', async () => {
    setVapid(true);
    const subs = [
      { id: 's1', endpoint: 'https://push.example/a', p256dh: 'k1', auth: 'a1' },
      { id: 's2', endpoint: 'https://push.example/b', p256dh: 'k2', auth: 'a2' },
    ];
    const sendNotification = jest.fn().mockResolvedValue({ statusCode: 201 });
    const deleteSubscription = jest.fn();
    const res = await pushService.sendPush(
      {
        loadSubscriptions: async () => subs,
        deleteSubscription,
        webpushClient: { sendNotification },
      },
      'user-1',
      { title: 'reminder', body: 'do the thing' }
    );
    expect(res).toEqual({ enabled: true, sent: 2, pruned: 0, failed: 0 });
    expect(sendNotification).toHaveBeenCalledTimes(2);
    // Verify the encrypted payload + keys shape passed to web-push.
    const [subscriptionArg, bodyArg] = sendNotification.mock.calls[0];
    expect(subscriptionArg).toEqual({
      endpoint: 'https://push.example/a',
      keys: { p256dh: 'k1', auth: 'a1' },
    });
    expect(JSON.parse(bodyArg)).toEqual({ title: 'reminder', body: 'do the thing' });
    expect(deleteSubscription).not.toHaveBeenCalled();
  });

  test('prunes subscriptions that return 410 Gone and 404, keeps live ones', async () => {
    setVapid(true);
    const subs = [
      { id: 'live', endpoint: 'https://push.example/live', p256dh: 'k', auth: 'a' },
      { id: 'gone410', endpoint: 'https://push.example/g1', p256dh: 'k', auth: 'a' },
      { id: 'gone404', endpoint: 'https://push.example/g2', p256dh: 'k', auth: 'a' },
    ];
    const sendNotification = jest.fn()
      .mockResolvedValueOnce({ statusCode: 201 })            // live
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { statusCode: 404 }));
    const deleted = [];
    const deleteSubscription = jest.fn(async (id) => { deleted.push(id); });

    const res = await pushService.sendPush(
      {
        loadSubscriptions: async () => subs,
        deleteSubscription,
        webpushClient: { sendNotification },
      },
      'user-1',
      { title: 'x' }
    );

    expect(res).toEqual({ enabled: true, sent: 1, pruned: 2, failed: 0 });
    expect(deleted.sort()).toEqual(['gone404', 'gone410']);
  });

  test('non-gone failures are counted as failed, not pruned', async () => {
    setVapid(true);
    const subs = [{ id: 's1', endpoint: 'https://push.example/a', p256dh: 'k', auth: 'a' }];
    const sendNotification = jest.fn()
      .mockRejectedValue(Object.assign(new Error('server error'), { statusCode: 500 }));
    const deleteSubscription = jest.fn();
    const res = await pushService.sendPush(
      {
        loadSubscriptions: async () => subs,
        deleteSubscription,
        webpushClient: { sendNotification },
      },
      'user-1',
      { title: 'x' }
    );
    expect(res).toEqual({ enabled: true, sent: 0, pruned: 0, failed: 1 });
    expect(deleteSubscription).not.toHaveBeenCalled();
  });

  test('returns sent:0 when configured but user has no subscriptions', async () => {
    setVapid(true);
    const res = await pushService.sendPush(
      { loadSubscriptions: async () => [], deleteSubscription: jest.fn() },
      'user-1',
      { title: 'x' }
    );
    expect(res).toEqual({ enabled: true, sent: 0, pruned: 0, failed: 0 });
  });
});
