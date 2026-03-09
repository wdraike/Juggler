/**
 * Constants extracted from task_tracker_v7_28
 */

export const PRI_COLORS = {
  P1: "#DC2626", P2: "#D97706", P3: "#2563EB", P4: "#6B7280",
};

export const PRI_RANK = { P1: 100, P2: 80, P3: 50, P4: 20 };

export const STATUS_OPTIONS = [
  { value: "", label: "\u2014", bg: "#FFFFFF", bgDark: "#1E293B", color: "#9CA3AF", colorDark: "#7E8FA6", tip: "Open \u2014 not started" },
  { value: "done", label: "\u2713", bg: "#D1FAE5", bgDark: "#064E3B", color: "#065F46", colorDark: "#6EE7B7", tip: "Done \u2014 completed" },
  { value: "wip", label: "\u231B", bg: "#FEF3C7", bgDark: "#78350F", color: "#92400E", colorDark: "#FCD34D", tip: "WIP \u2014 work in progress" },
  { value: "cancel", label: "\u2715", bg: "#FEE2E2", bgDark: "#7F1D1D", color: "#991B1B", colorDark: "#FCA5A5", tip: "Cancelled \u2014 won't do" },
  { value: "skip", label: "\u23ED", bg: "#F1F5F9", bgDark: "#334155", color: "#64748B", colorDark: "#94A3B8", tip: "Skipped \u2014 not today" },
  { value: "other", label: "\u2192", bg: "#EDE9FE", bgDark: "#4C1D95", color: "#5B21B6", colorDark: "#C4B5FD", tip: "Redirected \u2014 doing something else" },
];

export const STATUS_MAP = Object.fromEntries(STATUS_OPTIONS.map(s => [s.value, s]));

export const TASK_DEFAULTS = {
  where: "anywhere", when: "morning,lunch,afternoon,evening",
  dayReq: "any", dur: 30, notes: "", due: "", startAfter: "",
  section: "", dependsOn: []
};

export const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
export const DAY_NAMES_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

export const GRID_START = 6;  // 6 AM
export const GRID_END = 23;   // 11 PM
export const GRID_HOURS_COUNT = GRID_END - GRID_START + 1;

export const LOC_TINT = { home: "#3B82F6", work: "#F59E0B", transit: "#9CA3AF", downtown: "#10B981", gym: "#EF4444" };

export const DEFAULT_LOCATIONS = [
  { id: "home", name: "Home", icon: "\uD83C\uDFE0" },
  { id: "work", name: "Work", icon: "\uD83C\uDFE2" },
  { id: "transit", name: "Transit", icon: "\uD83D\uDE97" },
  { id: "downtown", name: "Downtown", icon: "\uD83C\uDFD9\uFE0F" },
  { id: "gym", name: "Gym", icon: "\uD83C\uDFCB\uFE0F" },
];

export const DEFAULT_TOOLS = [
  { id: "phone", name: "Phone", icon: "\uD83D\uDCF1" },
  { id: "personal_pc", name: "Personal PC", icon: "\uD83D\uDCBB" },
  { id: "work_pc", name: "Work PC", icon: "\uD83D\uDDA5\uFE0F" },
  { id: "printer", name: "Printer", icon: "\uD83D\uDDA8\uFE0F" },
  { id: "car", name: "Car", icon: "\uD83D\uDE97" },
];

export const DEFAULT_TOOL_MATRIX = {
  home: ["phone", "personal_pc", "car"],
  work: ["phone", "work_pc", "printer"],
  transit: ["phone"],
  downtown: ["phone", "car"],
  gym: ["phone"],
};

export const DEFAULT_WEEKDAY_BLOCKS = [
  { id: "morning", tag: "morning", name: "Morning", start: 360, end: 480, color: "#F59E0B", icon: "\u2600\uFE0F", loc: "home" },
  { id: "biz1", tag: "biz", name: "Biz", start: 480, end: 720, color: "#2563EB", icon: "\uD83D\uDCBC", loc: "work" },
  { id: "lunch", tag: "lunch", name: "Lunch", start: 720, end: 780, color: "#059669", icon: "\uD83C\uDF7D\uFE0F", loc: "work" },
  { id: "biz2", tag: "biz", name: "Biz", start: 780, end: 1020, color: "#2563EB", icon: "\uD83D\uDCBC", loc: "work" },
  { id: "evening", tag: "evening", name: "Evening", start: 1020, end: 1260, color: "#7C3AED", icon: "\uD83C\uDF19", loc: "home" },
  { id: "night", tag: "night", name: "Night", start: 1260, end: 1380, color: "#475569", icon: "\uD83C\uDF11", loc: "home" },
];

export const DEFAULT_WEEKEND_BLOCKS = [
  { id: "morning", tag: "morning", name: "Morning", start: 420, end: 720, color: "#F59E0B", icon: "\u2600\uFE0F", loc: "home" },
  { id: "afternoon", tag: "afternoon", name: "Afternoon", start: 720, end: 1020, color: "#F59E0B", icon: "\uD83C\uDF24\uFE0F", loc: "home" },
  { id: "evening", tag: "evening", name: "Evening", start: 1020, end: 1260, color: "#7C3AED", icon: "\uD83C\uDF19", loc: "home" },
  { id: "night", tag: "night", name: "Night", start: 1260, end: 1380, color: "#475569", icon: "\uD83C\uDF11", loc: "home" },
];

export const DEFAULT_TIME_BLOCKS = {
  Mon: DEFAULT_WEEKDAY_BLOCKS, Tue: DEFAULT_WEEKDAY_BLOCKS, Wed: DEFAULT_WEEKDAY_BLOCKS,
  Thu: DEFAULT_WEEKDAY_BLOCKS, Fri: DEFAULT_WEEKDAY_BLOCKS,
  Sat: DEFAULT_WEEKEND_BLOCKS, Sun: DEFAULT_WEEKEND_BLOCKS,
};

export const DEFAULT_SCHEDULE_TEMPLATES = {
  weekday: {
    name: "Weekday", icon: "\uD83C\uDFE2", system: true,
    blocks: DEFAULT_WEEKDAY_BLOCKS.map(function(b) { return Object.assign({}, b); }),
    locOverrides: {}
  },
  weekend: {
    name: "Weekend", icon: "\uD83C\uDFE0", system: true,
    blocks: DEFAULT_WEEKEND_BLOCKS.map(function(b) { return Object.assign({}, b); }),
    locOverrides: {}
  }
};

export const DEFAULT_TEMPLATE_DEFAULTS = {
  Mon: "weekday", Tue: "weekday", Wed: "weekday", Thu: "weekday", Fri: "weekday",
  Sat: "weekend", Sun: "weekend"
};

export const DEFAULT_WEEKLY_SCHEDULE = {
  Mon: "work", Tue: "work", Wed: "work", Thu: "work", Fri: "work",
  Sat: "home", Sun: "home",
};

export const WHEN_TAG_ICONS = {
  morning: "\u2600\uFE0F", biz: "\uD83D\uDCBC", lunch: "\uD83C\uDF7D\uFE0F",
  afternoon: "\uD83C\uDF24\uFE0F", evening: "\uD83C\uDF19", night: "\uD83C\uDF11",
  fixed: "\uD83D\uDCCC"
};

export function applyDefaults(t) {
  var out = Object.assign({}, TASK_DEFAULTS, t);
  if (!out.dependsOn) out.dependsOn = [];
  return out;
}

export function locBgTint(locId, alpha) {
  return (LOC_TINT[locId] || "#8B5CF6") + (alpha || "18");
}

var LOC_ICONS = {
  home: "\uD83C\uDFE0", work: "\uD83C\uDFE2", transit: "\uD83D\uDE97",
  downtown: "\uD83C\uDFD9\uFE0F", gym: "\uD83C\uDFCB\uFE0F",
  phone: "\uD83D\uDCF1", personal_pc: "\uD83D\uDCBB", work_pc: "\uD83D\uDCBB",
  tablet: "\uD83D\uDCF1", car: "\uD83D\uDE97"
};
export function locIcon(locId) {
  return LOC_ICONS[locId] || "";
}
export function registerLocations(locations) {
  if (!locations) return;
  locations.forEach(function(l) {
    if (l.id && l.icon && !LOC_ICONS[l.id]) LOC_ICONS[l.id] = l.icon;
  });
}
