import '@testing-library/jest-dom';

// jsdom does not implement ResizeObserver — mock it globally so CalendarGrid
// (which uses new ResizeObserver in a useEffect) doesn't crash in unit tests.
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
