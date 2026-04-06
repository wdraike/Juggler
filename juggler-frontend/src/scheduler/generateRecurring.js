/**
 * Recurring task generator — re-exports from shared module.
 * The frontend no longer calls this directly (expansion happens server-side),
 * but kept as a thin wrapper in case it's needed.
 */

import { applyDefaults } from '../state/constants';
import { expandRecurring } from './expandRecurring';

export function generateRecurringPure(taskList, startDate, endDate) {
  var results = expandRecurring(taskList, startDate, endDate, {
    maxIter: 400,
    checkDupes: true
  });
  return results.map(function(t) { return applyDefaults(t); });
}
