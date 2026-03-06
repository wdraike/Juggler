/**
 * API Client — Axios instance with JWT bearer token + auto-refresh
 * Access token persisted in localStorage for session survival across page reloads.
 */

import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || '/api';
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

// Request interceptor — attach Bearer token
apiClient.interceptors.request.use(config => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// Response interceptor — auto-refresh on any 401 (except the refresh endpoint itself)
apiClient.interceptors.response.use(
  response => response,
  async error => {
    const originalRequest = error.config;
    const isRefreshRequest = originalRequest.url?.includes('/auth/refresh');

    if (error.response?.status === 401 &&
        !originalRequest._retry &&
        !isRefreshRequest) {
      originalRequest._retry = true;

      try {
        // Deduplicate refresh requests
        if (!refreshPromise) {
          refreshPromise = axios.post(API_BASE + '/auth/refresh', {}, { withCredentials: true });
        }

        const { data } = await refreshPromise;
        refreshPromise = null;

        setAccessToken(data.accessToken);
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        refreshPromise = null;
        clearAccessToken();
        window.dispatchEvent(new Event('auth:logout'));
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
