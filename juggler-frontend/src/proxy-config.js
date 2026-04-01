/**
 * Service URL Resolution — Shared across all Raike frontends & backends
 *
 * Detects the environment (localhost, localdev, production) and resolves
 * all service URLs automatically. Single source of truth for the entire
 * platform — no hardcoded URLs needed in app code.
 *
 * Frontend usage (browser — detects via window.location.hostname):
 *   const { authServiceUrl, billingFrontendUrl } = require('./proxy-config');
 *
 * Backend usage (Node.js — detects via RAIKE_ENV or individual env vars):
 *   const { services } = require('./proxy-config');
 *   const paymentUrl = services.billing.backend;
 */

// ─── Environment definitions ────────────────────────────────────────────
// Add new environments here — no other files need to change.

const ENVIRONMENTS = {
  localdev: {
    suffix: '.localdev.raikegroup.com',
    services: {
      auth:    { url: 'https://auth.localdev.raikegroup.com' },
      juggler: { url: 'https://strivers.localdev.raikegroup.com' },
      resume:  { url: 'https://climbrs.localdev.raikegroup.com' },
      billing: { url: 'https://billing.localdev.raikegroup.com' },
      bugs:    { url: 'https://bugs.localdev.raikegroup.com' },
    },
    cookieDomain: '.raikegroup.com',
    homeUrl: 'https://auth.localdev.raikegroup.com',
  },
  production: {
    suffix: '.raikegroup.com',
    services: {
      auth:    { url: 'https://auth.raikegroup.com' },
      juggler: { url: 'https://strivers.raikegroup.com' },
      resume:  { url: 'https://climbrs.raikegroup.com' },
      billing: { url: 'https://billing.raikegroup.com' },
      bugs:    { url: 'https://bugs.raikegroup.com' },
    },
    cookieDomain: '.raikegroup.com',
    homeUrl: 'https://raikegroup.com',
  },
  localhost: {
    suffix: null,
    services: {
      auth:    { frontend: 'http://localhost:3001', backend: 'http://localhost:5010' },
      juggler: { frontend: 'http://localhost:3002', backend: 'http://localhost:5002' },
      resume:  { frontend: 'http://localhost:3000', backend: 'http://localhost:5001' },
      billing: { frontend: 'http://localhost:3003', backend: 'http://localhost:5020' },
      bugs:    { frontend: 'http://localhost:3004', backend: 'http://localhost:5030' },
    },
    cookieDomain: 'localhost',
    homeUrl: 'http://localhost:3001',
  },
};

// ─── Environment detection ──────────────────────────────────────────────

function detect() {
  // Browser: detect from hostname (must use bracket notation to avoid CRA inlining)
  var w = window;
  var hostname = w && w.location ? w.location.hostname : '';

  // Check most-specific first (localdev before raikegroup.com)
  if (hostname.indexOf('.localdev.raikegroup.com') >= 0) {
    return { name: 'localdev', ...ENVIRONMENTS.localdev };
  }
  if (hostname.indexOf('.raikegroup.com') >= 0) {
    return { name: 'production', ...ENVIRONMENTS.production };
  }

  return { name: 'localhost', ...ENVIRONMENTS.localhost };
}

const env = detect();
const isProxied = env.name !== 'localhost';

// ─── Service URL resolver ───────────────────────────────────────────────
// In proxied environments (localdev/production), frontend and backend share
// the same URL — Caddy routes /api/* to the backend, everything else to frontend.
// On localhost, they're separate ports.

function resolveService(name) {
  const svc = env.services[name];
  if (!svc) return { frontend: null, backend: null };

  if (svc.url) {
    // Proxied: single URL for both frontend and backend
    return { frontend: svc.url, backend: svc.url };
  }
  // Localhost: separate ports
  return { frontend: svc.frontend, backend: svc.backend };
}

const services = {
  auth:    resolveService('auth'),
  juggler: resolveService('juggler'),
  resume:  resolveService('resume'),
  billing: resolveService('billing'),
  bugs:    resolveService('bugs'),
};

// ─── Backwards-compatible exports ───────────────────────────────────────
// These match the original proxy-config API so existing code doesn't break.

function envVar(name) {
  return typeof process !== 'undefined' && process.env && process.env[name];
}

const authServiceUrl = services.auth.backend
  || envVar('REACT_APP_AUTH_SERVICE_URL')
  || 'http://localhost:5010';

const authFrontendUrl = services.auth.frontend
  || envVar('REACT_APP_AUTH_FRONTEND_URL')
  || 'http://localhost:3001';

const apiBase = isProxied
  ? '/api'
  : (envVar('REACT_APP_API_URL') || '/api');

/**
 * Origins where Google OAuth is configured and authorized.
 */
const googleAuthorizedOrigins = [
  'http://localhost:3001',
  ...Object.keys(ENVIRONMENTS)
    .filter(k => k !== 'localhost')
    .map(k => ENVIRONMENTS[k].services.auth.url),
];

const isGoogleOrigin = typeof window !== 'undefined'
  && googleAuthorizedOrigins.includes(window.location.origin);

// ─── Product label → service key mapping ────────────────────────────────
// Maps the database productId (label) to the proxy-config service key.
// Used by payment frontend to route users to the correct app after checkout.
const productLabelToServiceKey = {
  'juggler': 'juggler',
  'resume-optimizer': 'resume',
};

// Detect which app we are based on hostname (browser) or APP_ID env var (Node)
const appId = (() => {
  const fromEnv = typeof process !== 'undefined' && process.env && process.env.APP_ID;
  if (fromEnv) return fromEnv;
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname;
  if (host.includes('strivers') || host.includes('juggler') || host === 'localhost' && window.location.port === '3002') return 'juggler';
  if (host.includes('climbrs') || host.includes('resume') || host === 'localhost' && window.location.port === '3000') return 'resume-optimizer';
  if (host.includes('billing') || host === 'localhost' && window.location.port === '3003') return 'billing';
  if (host.includes('bugs') || host === 'localhost' && window.location.port === '3004') return 'bug-reporter';
  if (host.includes('auth') || host === 'localhost' && window.location.port === '3001') return 'auth';
  return null;
})();

// ─── Exports ────────────────────────────────────────────────────────────

export {
  services,
  ENVIRONMENTS,
  productLabelToServiceKey,
  appId,
  isProxied,
  authServiceUrl,
  authFrontendUrl,
  apiBase,
  googleAuthorizedOrigins,
  isGoogleOrigin,
};

export const environment = env.name;
export const cookieDomain = env.cookieDomain;
export const homeUrl = env.homeUrl;
