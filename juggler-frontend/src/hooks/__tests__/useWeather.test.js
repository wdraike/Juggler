/**
 * useWeather — periodic refresh behaviour
 *
 * Verifies that the hook re-fetches after 55 minutes (timer) and on
 * visibilitychange when the tab becomes visible after > 55 min idle.
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react';
import useWeather from '../useWeather';

// Mock apiClient
jest.mock('../../services/apiClient', () => ({
  get: jest.fn(),
  post: jest.fn()
}));

import apiClient from '../../services/apiClient';

const MOCK_FORECAST = {
  hourly: {
    time: ['2026-05-20T14:00'],
    temperature_2m: [72],
    precipitation_probability: [10],
    precipitation: [0],
    cloudcover: [20],
    weathercode: [1],
    relativehumidity_2m: [40]
  }
};

function makeLocations() {
  return [{ id: 'home', lat: 37.6, lon: -77.6 }];
}

beforeEach(() => {
  jest.useFakeTimers();
  apiClient.get.mockResolvedValue({ data: MOCK_FORECAST });
  apiClient.post.mockResolvedValue({ data: {} });
  // Suppress navigator.geolocation noise
  Object.defineProperty(global.navigator, 'geolocation', {
    value: undefined, configurable: true
  });
  Object.defineProperty(document, 'visibilityState', {
    value: 'visible', writable: true, configurable: true
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

test('fetches weather on mount', async () => {
  const { result, unmount } = renderHook(() => useWeather(makeLocations(), 'F'));
  await act(async () => { await Promise.resolve(); });
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(apiClient.get).toHaveBeenCalledWith('/weather', expect.objectContaining({
    params: expect.objectContaining({ lat: 37.6, lon: -77.6 })
  }));
  expect(result.current.weatherByDate).toBeDefined();
  // Should have parsed at least one date key from the mock forecast
  const dateKeys = Object.keys(result.current.weatherByDate);
  expect(dateKeys.length).toBeGreaterThan(0);
  unmount();
});

test('re-fetches after 55-minute interval', async () => {
  const { unmount } = renderHook(() => useWeather(makeLocations(), 'F'));
  await act(async () => { await Promise.resolve(); });

  const callsBefore = apiClient.get.mock.calls.length;

  // Advance past the 55-minute interval
  await act(async () => {
    jest.advanceTimersByTime(55 * 60 * 1000 + 1000);
    await Promise.resolve();
  });

  expect(apiClient.get.mock.calls.length).toBe(callsBefore + 1);
  unmount();
});

test('re-fetches on visibilitychange when tab was hidden > 55 min', async () => {
  const { unmount } = renderHook(() => useWeather(makeLocations(), 'F'));
  await act(async () => { await Promise.resolve(); });

  const callsAfterMount = apiClient.get.mock.calls.length;

  // Simulate tab hidden for 56 minutes
  document.visibilityState = 'hidden';
  await act(async () => { jest.advanceTimersByTime(56 * 60 * 1000); });

  // Tab becomes visible again
  document.visibilityState = 'visible';
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
  });

  expect(apiClient.get.mock.calls.length).toBeGreaterThan(callsAfterMount);
  unmount();
});

test('does NOT re-fetch on visibilitychange when tab was hidden < 55 min', async () => {
  const { unmount } = renderHook(() => useWeather(makeLocations(), 'F'));
  await act(async () => { await Promise.resolve(); });

  const callsAfterMount = apiClient.get.mock.calls.length;

  // Simulate tab hidden for only 10 minutes
  document.visibilityState = 'hidden';
  await act(async () => { jest.advanceTimersByTime(10 * 60 * 1000); });

  document.visibilityState = 'visible';
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
  });

  // No additional fetch — interval not yet elapsed
  expect(apiClient.get.mock.calls.length).toBe(callsAfterMount);
  unmount();
});

test('interval does NOT fire when tab is hidden', async () => {
  document.visibilityState = 'hidden';
  const { unmount } = renderHook(() => useWeather(makeLocations(), 'F'));
  await act(async () => { await Promise.resolve(); });

  const callsAfterMount = apiClient.get.mock.calls.length;

  await act(async () => {
    jest.advanceTimersByTime(55 * 60 * 1000 + 1000);
    await Promise.resolve();
  });

  // Interval skips because tab is hidden
  expect(apiClient.get.mock.calls.length).toBe(callsAfterMount);
  unmount();
});
