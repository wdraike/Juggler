/* eslint-disable no-restricted-globals */
/**
 * Juggler service worker — conservative offline support (backlog 999.258).
 *
 * Strategy (deliberately cautious to avoid the stale-asset trap):
 *   - Static build assets (JS/CSS/fonts/images under /static, plus same-origin
 *     icons/favicon): CACHE-FIRST against a VERSIONED cache. A new deploy bumps
 *     CACHE_VERSION → old caches are deleted on `activate`, so users are never
 *     stuck on stale assets.
 *   - Navigations (HTML documents): NETWORK-FIRST, falling back to the cached
 *     app shell, then to a static offline page. The app shell is never cached
 *     stale beyond a deploy because index.html is fetched network-first.
 *   - API calls (same-origin /api/*): NETWORK-ONLY. We NEVER serve stale API
 *     data offline — an offline API request returns a clear 503 offline
 *     response so the UI can show an offline state, not stale data.
 *
 * skipWaiting + clients.claim let a new SW version take over promptly; the
 * companion registration module (src/serviceWorkerRegistration.js) surfaces an
 * "update available" affordance and reloads on the new SW activating.
 *
 * EXTENSIBILITY (backlog 999.252 — push notifications):
 *   The `push` / `notificationclick` / `pushsubscriptionchange` handlers will be
 *   added to THIS file in the clearly-marked section near the bottom. The
 *   caching listeners above are self-contained and will not need rework — push
 *   handlers are independent event listeners.
 */

// Bump this string on every deploy that ships changed static assets. Changing
// it invalidates all prior caches on the next `activate`.
const CACHE_VERSION = 'v1';
const STATIC_CACHE = `juggler-static-${CACHE_VERSION}`;
const SHELL_CACHE = `juggler-shell-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';

// Caches owned by THIS version. Any cache not in this set is purged on activate.
const CURRENT_CACHES = [STATIC_CACHE, SHELL_CACHE];

// ─── Install: precache the offline fallback + app shell ──────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      // Precache the offline page and the app shell. Use {cache:'reload'} so we
      // pull fresh copies past the HTTP cache during install.
      await shell.addAll([
        new Request(OFFLINE_URL, { cache: 'reload' }),
        new Request('/index.html', { cache: 'reload' }),
      ]).catch(() => { /* offline at install time — non-fatal */ });
      // Take over without waiting for existing tabs to close.
      await self.skipWaiting();
    })()
  );
});

// ─── Activate: drop caches from prior versions, then claim clients ───────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => !CURRENT_CACHES.includes(name))
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

// ─── Fetch routing ───────────────────────────────────────────────────────────
function isApiRequest(url) {
  // Same-origin API calls only. Cross-origin auth-service calls fall through to
  // the network untouched (the SW only intercepts requests it routes).
  return url.origin === self.location.origin && url.pathname.startsWith('/api/');
}

function isStaticAsset(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/static/')) return true;
  return /\.(?:js|css|woff2?|ttf|otf|eot|png|jpg|jpeg|gif|svg|webp|ico)$/i.test(url.pathname);
}

// NETWORK-ONLY for API: never serve stale data. On failure, return a clear,
// machine-readable offline response so the UI can show an offline state.
async function handleApi(request) {
  try {
    return await fetch(request);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'offline', message: 'You appear to be offline. Live data is unavailable.' }),
      { status: 503, headers: { 'Content-Type': 'application/json', 'X-Offline': 'true' } }
    );
  }
}

// CACHE-FIRST for versioned static assets, with background population.
async function handleStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    // Only cache successful, basic/cors responses (skip opaque/error).
    if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // No cached copy and offline — let the browser surface the failure.
    return Response.error();
  }
}

// NETWORK-FIRST for navigations, falling back to cached shell, then offline page.
async function handleNavigate(request) {
  const shell = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    // Keep the shell fresh for offline fallback.
    if (response && response.status === 200) {
      shell.put('/index.html', response.clone());
    }
    return response;
  } catch (err) {
    const cachedShell = await shell.match('/index.html');
    if (cachedShell) return cachedShell;
    const offline = await shell.match(OFFLINE_URL);
    if (offline) return offline;
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET; never interfere with mutations (POST/PUT/PATCH/DELETE).
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }

  // Only intercept http(s); ignore chrome-extension:, etc.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (isApiRequest(url)) {
    event.respondWith(handleApi(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigate(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(handleStatic(request));
    return;
  }

  // Everything else: pass through to the network (no interception).
});

// Allow the page to tell a waiting SW to activate immediately (update flow).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUSH NOTIFICATIONS — backlog 999.252.
//
// Independent of the caching logic above. The backend (notify-reminder.js) sends
// a JSON payload of shape:
//   { type:'task-reminder', taskId, title, body, url }
// via Web Push. We show an OS notification on `push`, and focus/deep-link the app
// on `notificationclick`.
// ─────────────────────────────────────────────────────────────────────────────

// Default fields used when a push arrives with no/garbled payload.
const PUSH_DEFAULT_TITLE = 'Juggler reminder';
const PUSH_ICON = '/favicon.svg';
const PUSH_BADGE = '/favicon.svg';

self.addEventListener('push', (event) => {
  // Parse the payload defensively — a malformed push must still notify, not throw.
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (e) {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || PUSH_DEFAULT_TITLE;
  const options = {
    body: payload.body || '',
    icon: PUSH_ICON,
    badge: PUSH_BADGE,
    // tag de-dupes repeated reminders for the same task into one notification.
    tag: payload.taskId ? `task-${payload.taskId}` : undefined,
    renotify: !!payload.taskId,
    // Stash the deep-link URL + task id for the click handler.
    data: {
      url: payload.url || '/',
      taskId: payload.taskId || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Resolve a notification's deep-link to a SAME-ORIGIN url only — defense in
// depth against an open-redirect / attacker URL reaching openWindow/navigate
// (elmo WARN, 999.252). Anything off-origin (or a `//host` protocol-relative
// url, or javascript:) collapses to the app root.
function safeNotificationUrl(raw) {
  try {
    const resolved = new URL(raw || '/', self.location.origin);
    return resolved.origin === self.location.origin ? resolved.pathname + resolved.search : '/';
  } catch (e) {
    return '/';
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = safeNotificationUrl(event.notification.data && event.notification.data.url);

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // If an app tab is already open, focus it (and navigate it if it can).
      for (const client of allClients) {
        // Same-origin app tab — focus and try to deep-link.
        if (client.url && new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client && targetUrl !== '/') {
            try { await client.navigate(targetUrl); } catch (e) { /* navigation blocked — focus is enough */ }
          }
          return;
        }
      }

      // No open tab — open a new one at the deep-link.
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});

// Browser rotated the subscription — the page will re-subscribe on next load via
// the opt-in helper. We cannot re-POST here without the user's auth token, so we
// simply let it lapse; getSubscriptionState() on next visit reflects the change.
self.addEventListener('pushsubscriptionchange', () => {
  // Intentionally a no-op beyond letting the browser drop the old subscription.
  // Re-subscription is driven by the authenticated page (pushNotifications.js),
  // which holds the JWT needed to persist the new endpoint on the server.
});
