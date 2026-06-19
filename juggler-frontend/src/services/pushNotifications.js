/**
 * pushNotifications — client-side Web Push opt-in helper (backlog 999.252).
 *
 * Coordinates the browser Push API + the backend /api/push routes:
 *   - isPushSupported(): feature-detects SW + PushManager + Notification.
 *   - getSubscriptionState(): current permission + whether already subscribed.
 *   - subscribeToPush(): request permission, fetch the VAPID key, subscribe via
 *     pushManager, and POST the subscription to /api/push/subscribe.
 *   - unsubscribeFromPush(): unsubscribe locally and POST /api/push/unsubscribe.
 *
 * All network calls go through the shared apiClient (JWT-injecting axios).
 */

import apiClient from './apiClient';

/** Feature-detect everything Web Push needs. */
export function isPushSupported() {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Current Notification permission ('granted' | 'denied' | 'default' | 'unsupported'). */
export function getPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/**
 * VAPID public keys are base64url; the Push API needs a Uint8Array. Convert.
 */
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** Get the active SW registration (the one that controls this page). */
async function getRegistration() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service workers are not supported in this browser.');
  }
  const reg = await navigator.serviceWorker.ready;
  return reg;
}

/**
 * Report whether the user currently has an active push subscription.
 * @returns {Promise<{supported:boolean, permission:string, subscribed:boolean}>}
 */
export async function getSubscriptionState() {
  const supported = isPushSupported();
  const permission = getPermission();
  if (!supported) {
    return { supported: false, permission, subscribed: false };
  }
  try {
    const reg = await getRegistration();
    const existing = await reg.pushManager.getSubscription();
    return { supported: true, permission, subscribed: !!existing };
  } catch {
    // SW/registration unavailable — treat as not-subscribed; not an error to surface.
    return { supported: true, permission, subscribed: false };
  }
}

/** Fetch the server VAPID public key. Returns { publicKey, enabled }. */
export async function fetchVapidKey() {
  const { data } = await apiClient.get('/push/vapid-public-key');
  return data;
}

/**
 * Full opt-in flow. Returns the stored subscription on success.
 * Throws with a human-readable message on permission-denied or any failure so
 * the caller (UI) can surface it.
 */
export async function subscribeToPush() {
  if (!isPushSupported()) {
    throw new Error('Push notifications are not supported in this browser.');
  }

  // 1. Permission. Notification.requestPermission resolves to the new state.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked. Enable them in your browser settings to receive reminders.'
        : 'Notification permission was not granted.'
    );
  }

  // 2. VAPID key from the server.
  const { publicKey, enabled } = await fetchVapidKey();
  if (!enabled || !publicKey) {
    throw new Error('Push notifications are not configured on the server yet.');
  }

  // 3. Subscribe via the Push API.
  const reg = await getRegistration();
  // Reuse an existing subscription if present (avoids duplicate endpoints).
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  // 4. Persist on the server.
  await apiClient.post('/push/subscribe', subscription.toJSON());
  return subscription;
}

/**
 * Unsubscribe: remove the browser subscription AND tell the server.
 * Best-effort on the server call so a network blip does not leave the UI stuck.
 */
export async function unsubscribeFromPush() {
  if (!isPushSupported()) return;
  const reg = await getRegistration();
  const subscription = await reg.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await apiClient.post('/push/unsubscribe', { endpoint });
}
