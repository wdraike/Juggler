/**
 * FeedbackWidget — bugReporter client config guards (999.1363 leg C; carries
 * the old FeedbackDialog suite's 999.1350 pin forward).
 *
 * 999.1350: getToken used to read localStorage.getItem('token') — a key
 * juggler never writes (the real token lives in apiClient's store under
 * 'juggler-access-token'). Every submission 401'd. The guard: getToken MUST
 * be apiClient's getAccessToken, by identity.
 * 999.1351: baseUrl must be the env-aware bug-reporter URL, not '/api'.
 */
jest.mock('bug-reporter-client', () => ({
  createBugReporterClient: jest.fn(() => ({ submitFeedback: jest.fn(), getMyFeedback: jest.fn() })),
}));

// AnnotationCanvas pulls react-konva -> native canvas, unavailable in jsdom.
jest.mock('../AnnotationCanvas', () => function MockAnnotationCanvas() { return null; });

// The vendored shared dialog is not under test here (pinned in bug-reporter-
// service + RO's integration suite) — module-level client config is.
jest.mock('../../../vendor/bug-reporter-widget/FeedbackDialog', () =>
  function MockSharedFeedbackDialog() { return null; }
);

import { createBugReporterClient } from 'bug-reporter-client';
import { getAccessToken } from '../../../services/apiClient';

test('bugReporter client: getToken is apiClient.getAccessToken (999.1350), env-aware baseUrl (999.1351), sourceApp juggler', () => {
  // Evaluated here, not at file scope — react-scripts resetMocks:true wipes
  // mock.calls before each test, so the module-level factory call must happen
  // inside the test.
  require('../FeedbackWidget');
  expect(createBugReporterClient).toHaveBeenCalledTimes(1);
  const cfg = createBugReporterClient.mock.calls[0][0];
  expect(cfg.getToken).toBe(getAccessToken);
  expect(cfg.baseUrl).toBe('http://localhost:5030/api');
  expect(cfg.sourceApp).toBe('juggler');
});
