// Self-check: date-range filter logic — run with `node dateFilter.test.js`
// ponytail: one assert-based demo, no framework.

const { formatDateKey, getWeekStart } = require('/Users/david/Documents/Software Dev/raike-and-sons/juggler/shared/scheduler/dateHelpers');

// Re-implement the predicate for testing (same logic as PriorityView.jsx)
function taskMatchesDateFilter(task, dateFilter, todayKey) {
  if (!dateFilter || dateFilter === 'all') return true;
  var taskDate = task.date && task.date !== 'TBD' ? task.date : null;

  if (dateFilter === 'nodate') return !taskDate;
  if (!taskDate) return false;

  if (dateFilter === 'today') return taskDate === todayKey;
  if (dateFilter === 'tomorrow') {
    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return taskDate === formatDateKey(tomorrow);
  }
  if (dateFilter === 'overdue') return taskDate < todayKey;
  if (dateFilter === 'thisweek') {
    var ws = getWeekStart(new Date());
    var we = new Date(ws); we.setDate(we.getDate() + 6);
    return taskDate >= formatDateKey(ws) && taskDate <= formatDateKey(we);
  }
  if (dateFilter === 'nextweek') {
    var nws = getWeekStart(new Date()); nws.setDate(nws.getDate() + 7);
    var nwe = new Date(nws); nwe.setDate(nwe.getDate() + 6);
    return taskDate >= formatDateKey(nws) && taskDate <= formatDateKey(nwe);
  }
  if (dateFilter === 'thismonth') {
    var now = new Date();
    var mStart = formatDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
    var mEnd = formatDateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    return taskDate >= mStart && taskDate <= mEnd;
  }
  return true;
}

var today = formatDateKey(new Date());
var tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
var tomorrowKey = formatDateKey(tomorrow);
var ws = getWeekStart(new Date());
var weekEnd = new Date(ws); weekEnd.setDate(weekEnd.getDate() + 6);
var nextWs = new Date(ws); nextWs.setDate(nextWs.getDate() + 7);
var nextWe = new Date(nextWs); nextWe.setDate(nextWe.getDate() + 6);
var now = new Date();
var monthStart = formatDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
var monthEnd = formatDateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0));

var yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);

var cases = [
  // [task, filter, expected, label]
  [{ date: today }, 'all', true, 'all filter passes any task'],
  [{ date: today }, 'today', true, 'today matches today'],
  [{ date: tomorrowKey }, 'today', false, 'tomorrow does not match today'],
  [{ date: tomorrowKey }, 'tomorrow', true, 'tomorrow matches tomorrow'],
  [{ date: today }, 'tomorrow', false, 'today does not match tomorrow'],
  [{ date: formatDateKey(yesterday) }, 'overdue', true, 'yesterday is overdue'],
  [{ date: today }, 'overdue', false, 'today is not overdue'],
  [{ date: null }, 'nodate', true, 'null date matches nodate'],
  [{ date: 'TBD' }, 'nodate', true, 'TBD date matches nodate'],
  [{ date: today }, 'nodate', false, 'dated task does not match nodate'],
  [{ date: null }, 'today', false, 'null date does not match today'],
  [{ date: formatDateKey(ws) }, 'thisweek', true, 'week start matches thisweek'],
  [{ date: formatDateKey(weekEnd) }, 'thisweek', true, 'week end matches thisweek'],
  [{ date: formatDateKey(nextWs) }, 'thisweek', false, 'next week does not match thisweek'],
  [{ date: formatDateKey(nextWs) }, 'nextweek', true, 'next week start matches nextweek'],
  [{ date: formatDateKey(nextWe) }, 'nextweek', true, 'next week end matches nextweek'],
  [{ date: today }, 'nextweek', false, 'today does not match nextweek'],
  [{ date: monthStart }, 'thismonth', true, 'month start matches thismonth'],
  [{ date: monthEnd }, 'thismonth', true, 'month end matches thismonth'],
  [{ date: today }, 'thismonth', true, 'today matches thismonth'],
  [{ date: null }, 'thismonth', false, 'null date does not match thismonth'],
];

var failures = 0;
cases.forEach(function(c) {
  var actual = taskMatchesDateFilter(c[0], c[1], today);
  if (actual !== c[2]) {
    console.error('FAIL: ' + c[3] + ' — expected ' + c[2] + ' got ' + actual);
    failures++;
  }
});

if (failures === 0) {
  console.log('All ' + cases.length + ' date-range filter assertions passed.');
  process.exit(0);
} else {
  console.error(failures + ' assertion(s) failed.');
  process.exit(1);
}