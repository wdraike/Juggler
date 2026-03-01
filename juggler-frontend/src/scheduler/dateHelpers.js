/**
 * Date/time helper functions extracted from task_tracker_v7_28
 */

import { DAY_NAMES } from '../state/constants';

export function parseDate(dateStr) {
  if (!dateStr || dateStr === "TBD") return null;
  const parts = dateStr.split("/").map(Number);
  return new Date(2026, parts[0] - 1, parts[1]);
}

export function formatDateKey(d) {
  return (d.getMonth() + 1) + "/" + d.getDate();
}

export function getWeekStart(d) {
  const dt = new Date(d);
  const day = dt.getDay();
  dt.setDate(dt.getDate() - day);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function parseTimeToMinutes(timeStr) {
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

export function toTime24(t12) {
  if (!t12) return "";
  var m = t12.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm|a|p)/i);
  if (!m) return "";
  var h = parseInt(m[1]), min = m[2], ap = (m[3] || "").toLowerCase();
  if (ap.startsWith("p") && h < 12) h += 12;
  if (ap.startsWith("a") && h === 12) h = 0;
  return (h < 10 ? "0" : "") + h + ":" + min;
}

export function fromTime24(t24) {
  if (!t24) return "";
  var parts = t24.split(":");
  var h = parseInt(parts[0]), min = parts[1];
  var ap = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return h + ":" + min + " " + ap;
}

export function toDateISO(md) {
  if (!md) return "";
  var parts = md.split("/");
  if (parts.length < 2) return "";
  var mon = parseInt(parts[0]), day = parseInt(parts[1]);
  return "2026-" + (mon < 10 ? "0" : "") + mon + "-" + (day < 10 ? "0" : "") + day;
}

export function fromDateISO(iso) {
  if (!iso) return "";
  var parts = iso.split("-");
  return parseInt(parts[1]) + "/" + parseInt(parts[2]);
}

export function formatHour(h) {
  if (h === 0) return "12 AM";
  if (h < 12) return h + " AM";
  if (h === 12) return "12 PM";
  return (h - 12) + " PM";
}

export function getDayName(dateStr) {
  var d = parseDate(dateStr);
  if (!d) return "";
  return DAY_NAMES[d.getDay()];
}
