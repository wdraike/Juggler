/**
 * Unit tests for the Web Push opt-in helper (backlog 999.252).
 *
 * The browser Push API (serviceWorker, PushManager, Notification) is stubbed on
 * the JSDOM globals; apiClient is mocked so we assert the network contract
 * (vapid-key fetch, subscribe/unsubscribe POSTs) without a real backend.
 */

jest.mock('../apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

import apiClient from '../apiClient';
import {
  isPushSupported,
  urlBase64ToUint8Array,
  subscribeToPush,
  unsubscribeFromPush,
  getSubscriptionState,
} from '../pushNotifications';

// A valid base64url VAPID public key (65 bytes uncompressed P-256 point).
const VAPID = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUUw4bsxqd-Ckg6P_k';

function installPushApi({ existingSubscription = null } = {}) {
  const subscribe = jest.fn().mockResolvedValue(makeSub('https://push.example/new'));
  const getSubscription = jest.fn().mockResolvedValue(existingSubscription);
  const registration = { pushManager: { subscribe, getSubscription } };

  global.navigator.serviceWorker = { ready: Promise.resolve(registration) };
  global.PushManager = function PushManager() {};
  global.Notification = {
    permission: 'default',
    requestPermission: jest.fn().mockResolvedValue('granted'),
  };
  // window is the JSDOM global; expose PushManager + Notification on it too.
  window.PushManager = global.PushManager;
  window.Notification = global.Notification;
  global.atob = (s) => Buffer.from(s, 'base64').toString('binary');

  return { subscribe, getSubscription, registration };
}

function makeSub(endpoint) {
  return {
    endpoint,
    unsubscribe: jest.fn().mockResolvedValue(true),
    toJSON: () => ({ endpoint, keys: { p256dh: 'pk', auth: 'au' } }),
  };
}

beforeEach(() => {
  apiClient.get.mockReset();
  apiClient.post.mockReset();
  delete global.navigator.serviceWorker;
  delete global.PushManager;
  delete global.Notification;
});

describe('isPushSupported / urlBase64ToUint8Array', () => {
  test('isPushSupported true when SW + PushManager + Notification present', () => {
    installPushApi();
    expect(isPushSupported()).toBe(true);
  });

  test('isPushSupported false when PushManager missing', () => {
    expect(isPushSupported()).toBe(false);
  });

  test('urlBase64ToUint8Array decodes a base64url string to the matching bytes', () => {
    global.atob = (s) => Buffer.from(s, 'base64').toString('binary');
    const arr = urlBase64ToUint8Array(VAPID);
    expect(arr).toBeInstanceOf(Uint8Array);
    // Decode the same string independently (base64url → base64) and compare.
    const expected = Buffer.from(VAPID.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    expect(arr.length).toBe(expected.length);
    expect(Array.from(arr)).toEqual(Array.from(expected));
  });
});

describe('subscribeToPush', () => {
  test('requests permission, fetches the VAPID key, subscribes, and POSTs the subscription', async () => {
    const { subscribe } = installPushApi();
    apiClient.get.mockResolvedValue({ data: { publicKey: VAPID, enabled: true } });
    apiClient.post.mockResolvedValue({ data: { ok: true } });

    const sub = await subscribeToPush();

    expect(global.Notification.requestPermission).toHaveBeenCalled();
    expect(apiClient.get).toHaveBeenCalledWith('/push/vapid-public-key');
    // subscribe called with userVisibleOnly + a Uint8Array applicationServerKey.
    expect(subscribe).toHaveBeenCalledTimes(1);
    const opts = subscribe.mock.calls[0][0];
    expect(opts.userVisibleOnly).toBe(true);
    expect(opts.applicationServerKey).toBeInstanceOf(Uint8Array);
    // POSTed the browser subscription JSON to the backend.
    expect(apiClient.post).toHaveBeenCalledWith('/push/subscribe', {
      endpoint: 'https://push.example/new',
      keys: { p256dh: 'pk', auth: 'au' },
    });
    expect(sub.endpoint).toBe('https://push.example/new');
  });

  test('throws (and does not subscribe) when permission is denied', async () => {
    const { subscribe } = installPushApi();
    global.Notification.requestPermission.mockResolvedValue('denied');

    await expect(subscribeToPush()).rejects.toThrow(/blocked/i);
    expect(subscribe).not.toHaveBeenCalled();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  test('throws when the server reports push not configured', async () => {
    installPushApi();
    apiClient.get.mockResolvedValue({ data: { publicKey: null, enabled: false } });

    await expect(subscribeToPush()).rejects.toThrow(/not configured/i);
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  test('reuses an existing subscription rather than re-subscribing', async () => {
    const existing = makeSub('https://push.example/existing');
    const { subscribe } = installPushApi({ existingSubscription: existing });
    apiClient.get.mockResolvedValue({ data: { publicKey: VAPID, enabled: true } });
    apiClient.post.mockResolvedValue({ data: { ok: true } });

    await subscribeToPush();

    expect(subscribe).not.toHaveBeenCalled();
    expect(apiClient.post).toHaveBeenCalledWith('/push/subscribe', {
      endpoint: 'https://push.example/existing',
      keys: { p256dh: 'pk', auth: 'au' },
    });
  });
});

describe('unsubscribeFromPush', () => {
  test('unsubscribes locally and tells the server', async () => {
    const existing = makeSub('https://push.example/gone');
    installPushApi({ existingSubscription: existing });
    apiClient.post.mockResolvedValue({ data: { ok: true } });

    await unsubscribeFromPush();

    expect(existing.unsubscribe).toHaveBeenCalled();
    expect(apiClient.post).toHaveBeenCalledWith('/push/unsubscribe', {
      endpoint: 'https://push.example/gone',
    });
  });

  test('no-op when there is no active subscription', async () => {
    installPushApi({ existingSubscription: null });
    await unsubscribeFromPush();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('getSubscriptionState', () => {
  test('reports subscribed:true when a subscription exists', async () => {
    installPushApi({ existingSubscription: makeSub('https://push.example/s') });
    global.Notification.permission = 'granted';
    const state = await getSubscriptionState();
    expect(state).toEqual({ supported: true, permission: 'granted', subscribed: true });
  });

  test('reports supported:false when Push API absent', async () => {
    const state = await getSubscriptionState();
    expect(state.supported).toBe(false);
    expect(state.subscribed).toBe(false);
  });
});
