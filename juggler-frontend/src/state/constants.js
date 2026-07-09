/**
 * Constants extracted from task_tracker_v7_28
 */
import { isTerminalStatus } from '../shared/task-status';

export const CAL_PROVIDER_NAMES = {
  gcal:  'Google Calendar',
  msft:  'Microsoft Calendar',
  apple: 'Apple Calendar',
};

export const PRI_COLORS = {
  P1: "#E11D48", P2: "#D97706", P3: "#2E4A7A", P4: "#5C5A55",
};

// PRI_RANK lives in juggler-shared (999.1426 / 999.1185(e)) — re-exported here
// so existing imports keep working. Do NOT restate the literal in frontend code.
export const PRI_RANK = require('juggler-shared/scheduler/constants').PRI_RANK;

// Pause status tokens (999.1231; the pause-indigo shared token deferred from
// 999.1245). BRAND.indigo family (#4338CA — theme/colors.js). This is the ONE
// home for the pause palette; it was previously hardcoded in constants.js,
// StatusToggle.jsx, and TaskCard.jsx.
export const PAUSE_TOKENS = { bg: "#E0E7FF", bgDark: "#1E1B4B", color: "#4338CA", colorDark: "#A5B4FC" };

// ── Canonical status descriptor table (999.1231) ────────────────────────────
// The ONE display-token source for every task lifecycle status: glyph (`icon`),
// imperative action label (`label`), tooltip (`tip`), and light/dark badge
// tokens. Previously forked between this file's STATUS_OPTIONS and
// StatusToggle.jsx's ALL_STATUSES (disagreeing on skip glyph/palette, open
// glyph, and the wip option). Resolve glyph/token questions HERE, never in a
// component. Decisions:
//   - skip palette: StatusToggle's slate palette wins (newer, WCAG-checked).
//   - skip glyph: U+23ED ("next track") wins — semantically "skip ahead" and
//     already pinned by DailyView tests.
//   - open glyph: U+25CB (open circle) wins over the old em-dash.
//   - selectable:false rows (cancelled, missed) are backend-set statuses that
//     render badges but are never user-toggle buttons (999.882 alias pattern,
//     now also applied to 'missed').
// Semantics (which transitions are LEGAL) stay in shared/task-status.js +
// STATUS_VALID_TRANSITIONS below; 999.1181 owns the semantics-layer unification.
const CANCEL_DESCRIPTOR = { value: "cancel", icon: "✕", label: "Cancel", tip: "Cancel — won't do", bg: "#FEE2E2", bgDark: "#3A0A10", color: "#8B2635", colorDark: "#FCA5A5", selectable: true };

export const STATUS_DESCRIPTORS = [
  { value: "", icon: "○", label: "Open", tip: "Open — not started", bg: "#F5F0E8", bgDark: "#2C2B28", color: "#5C5A55", colorDark: "#B0A898", selectable: true },
  { value: "done", icon: "✓", label: "Complete", tip: "Complete — mark this task finished", bg: "#D1FAE5", bgDark: "#0A3622", color: "#2D6A4F", colorDark: "#6EE7B7", selectable: true },
  { value: "wip", icon: "⌛", label: "Start", tip: "Start — mark as in progress", bg: "#FEF3C7", bgDark: "#3A2A08", color: "#9E6B3B", colorDark: "#E8C878", selectable: true },
  CANCEL_DESCRIPTOR,
  { value: "skip", icon: "⏭", label: "Skip", tip: "Skip — not today, keep the schedule", bg: "#F1F5F9", bgDark: "#1E293B", color: "#475569", colorDark: "#94A3B8", selectable: true },
  { value: "pause", icon: "⏸", label: "Pause", tip: "Pause — temporarily inactive", ...PAUSE_TOKENS, selectable: true },
  // Backend-set terminal statuses — display badge + reopen only (999.882 alias
  // pattern). 'cancelled' mirrors 'cancel' tokens exactly; 'missed' (auto-set by
  // the scheduler on past recurring instances — runSchedule.js) reuses the
  // cancel palette with its own glyph so a missed instance is no longer
  // renderless (999.1231 finding 2).
  { ...CANCEL_DESCRIPTOR, value: "cancelled", label: "Cancelled", tip: "Cancelled — series/instance cancelled", selectable: false },
  { ...CANCEL_DESCRIPTOR, value: "missed", icon: "⊘", label: "Missed", tip: "Missed — the scheduled occurrence passed without being completed", selectable: false },
];

// User-selectable toggle options (grid cards, detail-header picker). Includes
// wip (999.1231: the picker previously could not set WIP while cards could).
export const STATUS_OPTIONS = STATUS_DESCRIPTORS.filter(s => s.selectable);

// juggler-cal-history Plan B: faded opacity for past terminal-state tasks (D-10).
export const PAST_OPACITY = 0.60;

// Full display map — includes the backend-set 'cancelled' and 'missed' entries.
export const STATUS_MAP = Object.fromEntries(STATUS_DESCRIPTORS.map(s => [s.value, s]));

// ── Status transition map (999.1231) ────────────────────────────────────────
// Single UI-side source for "which status buttons are enabled" — previously
// forked between StatusToggle.jsx VALID_TRANSITIONS and an inline map in
// TaskDetailHeader.jsx (which lacked wip). Terminal → reopen ("") only:
// cancelled + missed are BOTH terminal and reactivation is an explicit
// un-terminal action (David ruling 2026-07-06, resolves 999.844).
//   "" (open) → done, wip, skip, cancel, pause
//   wip       → done, "" (reopen), skip, cancel
//   terminal  → "" (reopen only)
export const STATUS_VALID_TRANSITIONS = {
  '':          { 'done': 1, 'wip': 1, 'skip': 1, 'cancel': 1, 'pause': 1 },
  'wip':       { 'done': 1, '': 1, 'skip': 1, 'cancel': 1 },
  'done':      { '': 1 },
  'cancel':    { '': 1 },
  'cancelled': { '': 1 },
  'skip':      { '': 1 },
  'pause':     { '': 1 },
  'missed':    { '': 1 },
};

export function canTransitionTo(current, target) {
  var map = STATUS_VALID_TRANSITIONS[current || ''];
  return !!(map && map[target]);
}

export const TASK_DEFAULTS = {
  where: "anywhere", when: "morning,lunch,afternoon,evening,night",
  dayReq: "any", dur: 30, notes: "", deadline: "", earliestStart: "",
  section: "", dependsOn: []
};

export const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
export const DAY_NAMES_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

export const GRID_START = 6;  // 6 AM
export const GRID_END = 23;   // 11 PM
export const GRID_HOURS_COUNT = GRID_END - GRID_START + 1;

// Canonical location→tint map (999.1245). Brand tokens only (theme/colors.js
// BRAND + brand guide palette) — every shipped location gets exactly one color,
// used identically in the grid, daily view, and settings so users can rely on
// location=color. Do NOT fork this map locally in a component.
export const LOC_TINT = { home: "#2E4A7A", work: "#C8942A", transit: "#5C5A55", downtown: "#2D6A4F", gym: "#8B2635", errand: "#0D9488" /* BRAND.teal */ };

// Fallback tint for custom/unknown location ids (BRAND.indigo — the extended
// functional-accent token DailyView already used). Use this everywhere a
// location id may not be in LOC_TINT; never invent an ad-hoc purple (999.1245).
export const LOC_TINT_FALLBACK = "#4338CA";

export const DEFAULT_LOCATIONS = [
  { id: "home", name: "Home", icon: "🏠" },
  { id: "work", name: "Work", icon: "🏢" },
  { id: "transit", name: "Transit", icon: "🚗" },
  { id: "downtown", name: "Downtown", icon: "🏙️" },
  { id: "gym", name: "Gym", icon: "🏋️" },
];

export const DEFAULT_TOOLS = [
  { id: "phone", name: "Phone", icon: "📱" },
  { id: "personal_pc", name: "Personal PC", icon: "💻" },
  { id: "work_pc", name: "Work PC", icon: "🖥️" },
  { id: "printer", name: "Printer", icon: "🖨️" },
  { id: "car", name: "Car", icon: "🚗" },
];

export const DEFAULT_TOOL_MATRIX = {
  home: ["phone", "personal_pc", "car"],
  work: ["phone", "work_pc", "printer"],
  transit: ["phone"],
  downtown: ["phone", "car"],
  gym: ["phone"],
};

export const DEFAULT_WEEKDAY_BLOCKS = [
  { id: "morning", tag: "morning", name: "Morning", start: 360, end: 480, color: "#C8942A", icon: "☀️", loc: "home" },
  { id: "biz1", tag: "biz", name: "Biz", start: 480, end: 720, color: "#2E4A7A", icon: "💼", loc: "work" },
  { id: "lunch", tag: "lunch", name: "Lunch", start: 720, end: 780, color: "#2D6A4F", icon: "🍽️", loc: "work" },
  { id: "biz2", tag: "biz", name: "Biz", start: 780, end: 1020, color: "#2E4A7A", icon: "💼", loc: "work" },
  { id: "evening", tag: "evening", name: "Evening", start: 1020, end: 1260, color: "#9E6B3B", icon: "🌙", loc: "home" },
  { id: "night", tag: "night", name: "Night", start: 1260, end: 1380, color: "#475569", icon: "🌑", loc: "home" },
];

export const DEFAULT_WEEKEND_BLOCKS = [
  { id: "morning", tag: "morning", name: "Morning", start: 420, end: 720, color: "#C8942A", icon: "☀️", loc: "home" },
  { id: "afternoon", tag: "afternoon", name: "Afternoon", start: 720, end: 1020, color: "#C8942A", icon: "🌤️", loc: "home" },
  { id: "evening", tag: "evening", name: "Evening", start: 1020, end: 1260, color: "#9E6B3B", icon: "🌙", loc: "home" },
  { id: "night", tag: "night", name: "Night", start: 1260, end: 1380, color: "#475569", icon: "🌑", loc: "home" },
];

export const DEFAULT_TIME_BLOCKS = {
  Mon: DEFAULT_WEEKDAY_BLOCKS, Tue: DEFAULT_WEEKDAY_BLOCKS, Wed: DEFAULT_WEEKDAY_BLOCKS,
  Thu: DEFAULT_WEEKDAY_BLOCKS, Fri: DEFAULT_WEEKDAY_BLOCKS,
  Sat: DEFAULT_WEEKEND_BLOCKS, Sun: DEFAULT_WEEKEND_BLOCKS,
};

export const DEFAULT_SCHEDULE_TEMPLATES = {
  weekday: {
    name: "Weekday", icon: "🏢", system: true,
    blocks: DEFAULT_WEEKDAY_BLOCKS.map(function(b) { return Object.assign({}, b); }),
    locOverrides: {}
  },
  weekend: {
    name: "Weekend", icon: "🏠", system: true,
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
  morning: "☀️", biz: "💼", lunch: "🍽️",
  afternoon: "🌤️", evening: "🌙", night: "🌑",
  fixed: "📌"
};

export function applyDefaults(t) {
  var out = Object.assign({}, TASK_DEFAULTS, t);
  if (!out.dependsOn) out.dependsOn = [];
  return out;
}

export function locBgTint(locId, alpha) {
  return (LOC_TINT[locId] || "#9E6B3B") + (alpha || "18");
}

var LOC_ICONS = {
  home: "🏠", work: "🏢", transit: "🚗",
  downtown: "🏙️", gym: "🏋️",
  phone: "📱", personal_pc: "💻", work_pc: "💻",
  tablet: "📱", car: "🚗"
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

// Import isTerminalStatus from shared library
export { isTerminalStatus };
// juggler-cal-history Plan B: import from shared lib/task-status.js
