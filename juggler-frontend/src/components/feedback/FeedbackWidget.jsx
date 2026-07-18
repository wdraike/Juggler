/**
 * Juggler adapter for the shared feedback widget (999.1363 leg C). Behavior
 * and a11y live in the vendored shared widget (src/vendor/bug-reporter-widget,
 * synced from bug-reporter-service — see its build-widget.js for why hosts
 * vendor-copy); this file owns only juggler wiring: client construction,
 * auth user, juggler's AnnotationCanvas, and the theme->token bridge.
 */
import React from 'react';
import FeedbackDialog from '../../vendor/bug-reporter-widget/FeedbackDialog';
import { createBugReporterClient } from 'bug-reporter-client';
import { useAuth } from '../auth/AuthProvider';
import { getAccessToken } from '../../services/apiClient';
import { services } from '../../proxy-config';
import AnnotationCanvas from './AnnotationCanvas';

// 999.1351: Direct cross-origin call to bug-reporter-service via env-aware
// URL (ruling option (b)). In proxied envs, services.bugs.backend resolves to
// https://bugs.raikegroup.com; on localhost, http://localhost:5030.
// Old baseUrl:'/api' relied on dev proxy and 404'd in prod.
// 999.1350: getToken MUST be apiClient's getAccessToken (the real token store),
// never a raw localStorage key.
var bugReporter = createBugReporterClient({
  baseUrl: (services.bugs && services.bugs.backend ? services.bugs.backend : '') + '/api',
  getToken: getAccessToken,
  sourceApp: 'juggler'
});

// Bridge juggler's getTheme(darkMode) object onto the shared widget's
// --brfw-* tokens (CSS vars inherit into the fixed-position dialog).
function tokenVars(theme) {
  return {
    '--brfw-surface': theme.bgSecondary,
    '--brfw-field': theme.inputBg,
    '--brfw-text': theme.text,
    '--brfw-text-muted': theme.textSecondary,
    '--brfw-border': theme.border,
    '--brfw-accent': theme.accent,
    '--brfw-accent-contrast': '#1A2B4A', // on-gold text, as the old dialog's primary button
    '--brfw-hover': theme.bgHover,
    '--brfw-success': theme.success,
    '--brfw-error': theme.error,
    // Translucent tint of theme.error — reads correctly on both the dark
    // navy and light cream dialog surfaces (no dedicated theme key exists).
    '--brfw-error-bg': 'rgba(139, 38, 53, 0.15)',
  };
}

export default function FeedbackWidget({ open, onClose, theme }) {
  var { user } = useAuth();
  return (
    <div style={theme ? tokenVars(theme) : undefined}>
      <FeedbackDialog
        open={open}
        onClose={onClose}
        client={bugReporter}
        user={user}
        AnnotationCanvas={AnnotationCanvas}
      />
    </div>
  );
}
