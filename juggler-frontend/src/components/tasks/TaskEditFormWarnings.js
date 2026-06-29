/**
 * TaskEditFormWarnings — config warnings extracted from TaskEditForm (999.965).
 */
import { fromDateISO, parseDate } from '../../scheduler/dateHelpers';

export function useConfigWarnings({
  marker, when, placementMode, scheduleTemplates, templateDefaults,
  dayReq, taskLoc, deadline, date, time
}) {
  var whenParts = when ? when.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
  var isAllDay = placementMode === 'all_day';
  var isFixed = placementMode === 'fixed';

  var configWarnings = (function() {
    if (marker) return [];
    var isAnytime = whenParts.length === 0 || (whenParts.length === 1 && whenParts[0] === 'anytime');
    if (isAnytime || isAllDay || isFixed) return [];
    if (!scheduleTemplates || !templateDefaults) return [];
    var dayCodeMap = { Su: 'Sun', M: 'Mon', T: 'Tue', W: 'Wed', R: 'Thu', F: 'Fri', Sa: 'Sat' };
    var weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    var weekends = ['Sat', 'Sun'];
    var allDays = weekdays.concat(weekends);
    var eligibleDays;
    if (!dayReq || dayReq === 'any') { eligibleDays = allDays; }
    else if (dayReq === 'weekday') { eligibleDays = weekdays; }
    else if (dayReq === 'weekend') { eligibleDays = weekends; }
    else { eligibleDays = dayReq.split(',').map(function(c) { return dayCodeMap[c]; }).filter(Boolean); }
    if (taskLoc.length > 0 && whenParts.length > 0) {
      var matchingBlocks = [];
      eligibleDays.forEach(function(dn) {
        var tmplId = templateDefaults[dn];
        var tmpl = tmplId && scheduleTemplates[tmplId];
        if (!tmpl) return;
        (tmpl.blocks || []).forEach(function(b) { if (whenParts.indexOf(b.tag) >= 0) matchingBlocks.push(b); });
      });
      if (matchingBlocks.length > 0) {
        var hasLocMatch = matchingBlocks.some(function(b) { return taskLoc.some(function(loc) { return loc === b.loc; }); });
        if (!hasLocMatch) {
          var blockLocs = {};
          matchingBlocks.forEach(function(b) { if (b.loc) blockLocs[b.loc] = true; });
          return ['Location mismatch: task needs "' + taskLoc.join('" or "') + '" but matching time blocks use "' + Object.keys(blockLocs).join('", "') + '".'];
        }
      }
    }
    return [];
  })();

  if (deadline && dayReq && dayReq !== 'any') {
    var deadlineDate = parseDate(fromDateISO(deadline));
    if (deadlineDate && !isNaN(deadlineDate.getTime())) {
      var deadlineDayCode = ['Su','M','T','W','R','F','Sa'][deadlineDate.getDay()];
      var deadlineDayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][deadlineDate.getDay()];
      var allowed = dayReq === 'weekday' ? ['M','T','W','R','F'] : dayReq === 'weekend' ? ['Su','Sa'] : dayReq.split(',');
      if (allowed.indexOf(deadlineDayCode) < 0) {
        configWarnings.push('Deadline (' + deadlineDayName + ') conflicts with day requirement — task may not be schedulable before the deadline.');
      }
    }
  }

  return { configWarnings, whenParts, isAllDay, isFixed };
}
