/**
 * useTimezone — Determines the active timezone for the app.
 *
 * Priority (TZ-DISPLAY-1/3):
 * 1. User preference override (from config.timezoneOverride)
 * 2. Configured user timezone (from config.userTimezone = users.timezone) — A1
 * 3. America/New_York default (the browser tz is never authoritative)
 *
 * browserTimezone is still surfaced (informational only — e.g. the settings UI
 * shows the auto-detected zone), but it does not drive activeTimezone.
 */

import { useMemo } from 'react';
import { getBrowserTimezone, resolveDisplayTimezone } from '../utils/timezone';

export function useTimezone(config) {
  var override = config && config.timezoneOverride ? config.timezoneOverride : null;
  var userTimezone = config && config.userTimezone ? config.userTimezone : null;
  var browser = useMemo(function() { return getBrowserTimezone(); }, []);

  // Configured users.timezone is authoritative; the browser is never used (A1 / TZ-DISPLAY-3).
  var activeTimezone = resolveDisplayTimezone({ override: override, userTimezone: userTimezone });
  var source = override ? 'setting' : userTimezone ? 'configured' : 'fallback';

  return {
    activeTimezone: activeTimezone,
    source: source,
    browserTimezone: browser,
    overrideTimezone: override,
    userTimezone: userTimezone
  };
}
