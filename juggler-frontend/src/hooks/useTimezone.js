/**
 * useTimezone — Determines the active timezone for the app.
 *
 * Priority:
 * 1. User preference override (from config.timezoneOverride)
 * 2. Browser-detected timezone
 * 3. Hardcoded fallback
 */

import { useMemo } from 'react';
import { getBrowserTimezone } from '../utils/timezone';

export function useTimezone(config) {
  var override = config && config.timezoneOverride ? config.timezoneOverride : null;
  var browser = useMemo(function() { return getBrowserTimezone(); }, []);

  var activeTimezone = override || browser || 'America/New_York';
  var source = override ? 'setting' : browser ? 'browser' : 'fallback';

  return {
    activeTimezone: activeTimezone,
    source: source,
    browserTimezone: browser,
    overrideTimezone: override
  };
}
