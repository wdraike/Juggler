/**
 * useTimezone — Determines the active timezone for the app.
 *
 * Priority:
 * 1. User preference override (from config.timezoneOverride)
 * 2. Browser-detected timezone
 * 3. User profile timezone from DB
 *
 * Returns the active timezone, its source, and all three candidates.
 */

import { useMemo } from 'react';
import { getBrowserTimezone } from '../utils/timezone';

export function useTimezone(authUser, config) {
  var override = config && config.timezoneOverride ? config.timezoneOverride : null;
  var browser = useMemo(function() { return getBrowserTimezone(); }, []);
  var profile = (authUser && authUser.timezone) || 'America/New_York';

  var activeTimezone = override || browser || profile;
  var source = override ? 'setting' : browser ? 'browser' : 'profile';

  return {
    activeTimezone: activeTimezone,
    source: source,
    browserTimezone: browser,
    profileTimezone: profile,
    overrideTimezone: override
  };
}
