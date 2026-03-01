/**
 * Effective priority computation extracted from task_tracker_v7_28 lines 602-619
 */

import { parseDate } from './dateHelpers';

export function effectivePriority(task, refDate) {
  var priRank = { P1: 4000, P2: 3000, P3: 2000, P4: 1000 };
  var base = priRank[task.pri] || 0;
  if (!task.due || !refDate) return base;
  var dd = parseDate(task.due);
  if (!dd) return base;
  var ref = (refDate instanceof Date) ? refDate : parseDate(refDate);
  if (!ref) return base;
  var days = Math.ceil((dd - ref) / 86400000);
  if (days < 0) return base + 600;  // overdue
  if (days === 0) return base + 500; // due today
  if (days <= 1) return base + 400;
  if (days <= 3) return base + 300;
  if (days <= 7) return base + 200;
  return base;
}
