/**
 * Service worker registration (backlog 999.258).
 *
 * Opt-in-safe: the SW is only registered in a production build
 * (process.env.NODE_ENV === 'production') and only when the page is served from
 * a secure context that supports service workers. In dev (react-scripts start)
 * NOTHING is registered, so a bad SW can never brick the dev server.
 *
 * Update flow: when a new SW version is found and installed while an old one
 * still controls the page, we call the optional onUpdate callback so the app
 * can surface an "update available — reload" affordance. We also tell the new
 * SW to skipWaiting and reload once it takes control, so users are never stuck
 * on stale assets across a deploy.
 */

const SW_URL = `${process.env.PUBLIC_URL || ''}/service-worker.js`;

/**
 * @param {{ onSuccess?: (reg: ServiceWorkerRegistration) => void,
 *           onUpdate?: (reg: ServiceWorkerRegistration) => void }} [config]
 */
export function register(config = {}) {
  if (process.env.NODE_ENV !== 'production') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  // If PUBLIC_URL is on a different origin (CDN), the SW won't work — skip.
  if (process.env.PUBLIC_URL) {
    try {
      const publicUrl = new URL(process.env.PUBLIC_URL, window.location.href);
      if (publicUrl.origin !== window.location.origin) return;
    } catch (_e) {
      return;
    }
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(SW_URL)
      .then((registration) => {
        // Reload once a new SW takes control (after skipWaiting), so the page
        // runs against the freshly-activated assets.
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return;
          refreshing = true;
          window.location.reload();
        });

        registration.onupdatefound = () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.onstatechange = () => {
            if (installing.state !== 'installed') return;
            if (navigator.serviceWorker.controller) {
              // A previous SW controls the page → a genuine update is waiting.
              if (typeof config.onUpdate === 'function') {
                config.onUpdate(registration);
              } else {
                // Default: activate the new SW immediately; controllerchange
                // above reloads the page onto fresh assets.
                if (registration.waiting) {
                  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                }
              }
            } else if (typeof config.onSuccess === 'function') {
              // First install — content cached for offline use.
              config.onSuccess(registration);
            }
          };
        };
      })
      .catch((error) => {
        // Registration failure must never break the app.
        // eslint-disable-next-line no-console
        console.error('Service worker registration failed:', error);
      });
  });
}

export function unregister() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready
    .then((registration) => registration.unregister())
    .catch(() => { /* no-op */ });
}
