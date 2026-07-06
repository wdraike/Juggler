/**
 * Service URL resolution — re-exports from shared/proxy-config.js
 *
 * The canonical source of truth lives in shared/proxy-config.js. This used
 * to be a full hand-copied fork that drifted from the backend's copy
 * (999.1201) — it is now a thin re-export shim, same idiom as
 * juggler-frontend/src/scheduler/*.js and src/shared/task-status.js.
 */
const shared = require('juggler-shared/proxy-config');

export const {
  services,
  environment,
  cookieDomain,
  homeUrl,
  ENVIRONMENTS,
  productLabelToServiceKey,
  appId,
  isProxied,
  authServiceUrl,
  authFrontendUrl,
  apiBase,
  googleAuthorizedOrigins,
  isGoogleOrigin,
} = shared;
