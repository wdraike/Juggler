/**
 * API Client — Axios instance with JWT bearer token + auto-refresh via auth-service
 * Access token persisted in localStorage for session survival across page reloads.
 */

import axios from 'axios';
import { getBrowserTimezone } from '../utils/timezone';

const { apiBase, authServiceUrl } = require('../proxy-config');
const TZ_OVERRIDE_KEY = 'juggler-tz-override';
const API_BASE = apiBase;
const AUTH_SERVICE_URL = authServiceUrl;
const TOKEN_KEY = 'juggler-access-token';

const apiClient = axios.create({
  baseURL: API_BASE,
  withCredentials: true
});

let accessToken = localStorage.getItem(TOKEN_KEY);
let refreshPromise = null;

export function setAccessToken(token) {
  accessToken = token;
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function getAccessToken() {
  return accessToken;
}

export function clearAccessToken() {
  accessToken = null;
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Get the active timezone for API requests.
 * Priority: manual override (localStorage) > browser detection > fallback.
 */
function getActiveTimezone() {
  try {
    var override = localStorage.getItem(TZ_OVERRIDE_KEY);
    if (override) return override;
  } catch (e) { /* ignore */ }
  return getBrowserTimezone() || 'America/New_York';
}

export { TZ_OVERRIDE_KEY };

// Request interceptor — attach Bearer token + timezone
apiClient.interceptors.request.use(config => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  config.headers['X-Timezone'] = getActiveTimezone();
  return config;
});

// Response interceptor — auto-refresh on any 401 via auth-service
apiClient.interceptors.response.use(
  response => response,
  async error => {
    const originalRequest = error.config;
    const isRefreshRequest = originalRequest._isRefreshAttempt;

    if (error.response?.status === 401 &&
        !originalRequest._retry &&
        !isRefreshRequest) {
      originalRequest._retry = true;

      try {
        // Deduplicate refresh requests
        if (!refreshPromise) {
          const refreshToken = localStorage.getItem('juggler-refresh-token');
          if (!refreshToken) throw new Error('No refresh token');

          refreshPromise = axios.post(`${AUTH_SERVICE_URL}/api/auth/refresh`, {
            refreshToken
          });
        }

        const { data } = await refreshPromise;
        refreshPromise = null;

        setAccessToken(data.tokens.accessToken);
        if (data.tokens.refreshToken) {
          localStorage.setItem('juggler-refresh-token', data.tokens.refreshToken);
        }

        originalRequest.headers.Authorization = `Bearer ${data.tokens.accessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        refreshPromise = null;
        clearAccessToken();
        localStorage.removeItem('juggler-refresh-token');
        window.dispatchEvent(new Event('auth:logout'));
        return Promise.reject(refreshError);
      }
    }

    // Handle 403 subscription required — dispatch event for upgrade prompt
    if (error.response?.status === 403 && error.response?.data?.error === 'Subscription required') {
      window.dispatchEvent(new CustomEvent('subscription:required', {
        detail: {
          product: error.response.data.product || require('../proxy-config').appId,
          required_plans: error.response.data.required_plans
        }
      }));
    }

    // Handle 403/429 limit errors — dispatch event for limit prompt
    if (error.response?.data?.code === 'ENTITY_LIMIT_REACHED' ||
        error.response?.data?.code === 'USAGE_LIMIT_REACHED' ||
        error.response?.data?.code === 'FEATURE_NOT_AVAILABLE') {
      window.dispatchEvent(new CustomEvent('plan:limit-reached', {
        detail: error.response.data
      }));
    }

    return Promise.reject(error);
  }
);

export default apiClient;
