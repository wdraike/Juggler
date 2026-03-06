/**
 * Date/time helper functions — shared between frontend and backend
 */

var DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function inferYear(month) {
  var now = new Date();
  var currentMonth = now.getMonth() + 1;
  var year = now.getFullYear();
  if (month < currentMonth - 6) return year + 1;
  return year;
}

function parseDate(dateStr) {
  if (!dateStr || dateStr === "TBD") return null;
  var parts = dateStr.split("/").map(Number);
  return new Date(inferYear(parts[0]), parts[0] - 1, parts[1]);
}

function formatDateKey(d) {
  return (d.getMonth() + 1) + "/" + d.getDate();
}

function getWeekStart(d) {
  var dt = new Date(d);
  var day = dt.getDay();
  dt.setDate(dt.getDate() - day);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  var s = timeStr.trim();
  var m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm|a|p)/i);
  if (m12) {
    var h = parseInt(m12[1]), min = parseInt(m12[2]), ap = m12[3].toLowerCase();
    if ((ap === "pm" || ap === "p") && h !== 12) h += 12;
    if ((ap === "am" || ap === "a") && h === 12) h = 0;
    return h * 60 + min;
  }
  var mR = s.match(/^(\d{1,2}):(\d{2})\s*-/);
  if (mR) {
    var rh = parseInt(mR[1]), rm = parseInt(mR[2]);
    if (rh >= 1 && rh <= 5) rh += 12;
    return rh * 60 + rm;
  }
  return null;
}

function toTime24(t12) {
  if (!t12) return "";
  var m = t12.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm|a|p)/i);
  if (!m) return "";
  var h = parseInt(m[1]), min = m[2], ap = (m[3] || "").toLowerCase();
  if (ap.startsWith("p") && h < 12) h += 12;
  if (ap.startsWith("a") && h === 12) h = 0;
  return (h < 10 ? "0" : "") + h + ":" + min;
}

function fromTime24(t24) {
  if (!t24) return "";
  var parts = t24.split(":");
  var h = parseInt(parts[0]), min = parts[1];
  var ap = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return h + ":" + min + " " + ap;
}

function toDateISO(md) {
  if (!md) return "";
  var parts = md.split("/");
  if (parts.length < 2) return "";
  var mon = parseInt(parts[0]), day = parseInt(parts[1]);
  var year = inferYear(mon);
  return year + "-" + (mon < 10 ? "0" : "") + mon + "-" + (day < 10 ? "0" : "") + day;
}

function fromDateISO(iso) {
  if (!iso) return "";
  var parts = iso.split("-");
  return parseInt(parts[1]) + "/" + parseInt(parts[2]);
}

function formatHour(h) {
  if (h === 0) return "12 AM";
  if (h < 12) return h + " AM";
  if (h === 12) return "12 PM";
  return (h - 12) + " PM";
}

function getDayName(dateStr) {
  var d = parseDate(dateStr);
  if (!d) return "";
  return DAY_NAMES[d.getDay()];
}

module.exports = {
  inferYear,
  parseDate,
  formatDateKey,
  getWeekStart,
  isSameDay,
  parseTimeToMinutes,
  toTime24,
  fromTime24,
  toDateISO,
  fromDateISO,
  formatHour,
  getDayName
};
