import '@testing-library/jest-dom';

// 999.5036: raise the per-test timeout to 120s (matching RO's 999.5033 fix).
// jsdom+MUI suites' per-test time scales with CPU contention, so the default
// 5000ms timeout blows under machine load — the failure mode is 'Exceeded
// timeout of Nms', not an assertion diff, and it false-REDs the vinatieri
// pre-push gate. 120s gives enough headroom for the slowest suites
// (20-35s wall at low load) to survive contention without masking real hangs.
jest.setTimeout(120000);

// jsdom does not implement ResizeObserver — mock it globally so CalendarGrid
// (which uses new ResizeObserver in a useEffect) doesn't crash in unit tests.
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
