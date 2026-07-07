/**
 * FeedbackDialog — bugReporter getToken source (999.1350).
 *
 * bugReporter's getToken used to read localStorage.getItem('token') directly —
 * a key juggler never writes to (the real access token lives in apiClient's
 * in-memory store, mirrored to localStorage under 'juggler-access-token' via
 * setAccessToken/getAccessToken). Every feedback submission ran with no
 * Authorization header and 401'd. This only checks the module-level
 * bugReporter config (not a full render — the dialog itself has real DOM/
 * auth/timer dependencies out of scope for this fix).
 */
jest.mock('bug-reporter-client', () => ({
  createBugReporterClient: jest.fn(() => ({ submitFeedback: jest.fn(), getMyFeedback: jest.fn() })),
}));

// AnnotationCanvas pulls in react-konva -> konva -> the native 'canvas' package,
// which isn't installed for this jest/node environment (pre-existing, unrelated
// gap). Mocked out — this test only needs FeedbackDialog's module-level
// bugReporter config, not AnnotationCanvas itself.
jest.mock('../AnnotationCanvas', () => function MockAnnotationCanvas() { return null; });

import { createBugReporterClient } from 'bug-reporter-client';
import { setAccessToken, clearAccessToken, getAccessToken } from '../../../services/apiClient';
import '../FeedbackDialog';

// Capture immediately — FeedbackDialog's module-level createBugReporterClient(...)
// call only happens once (on import, above). CRA's jest config sets resetMocks:true,
// which wipes mock.calls before every test, so this MUST be read before any test runs.
const bugReporterConfig = createBugReporterClient.mock.calls[0][0];

describe('FeedbackDialog — bugReporter getToken source', () => {
  afterEach(() => {
    clearAccessToken();
  });

  test('getToken is apiClient.getAccessToken, not a hardcoded localStorage key', () => {
    expect(bugReporterConfig.getToken).toBe(getAccessToken);
  });

  test('getToken reflects the real in-memory access token set via apiClient', () => {
    setAccessToken('real-access-token-xyz');
    expect(bugReporterConfig.getToken()).toBe('real-access-token-xyz');

    clearAccessToken();
    expect(bugReporterConfig.getToken()).toBeNull();
  });
});
