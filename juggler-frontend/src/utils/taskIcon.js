var iconCache = new Map(); // text → emoji string ('' = checked, no keyword match)
var pendingAI = new Set(); // texts currently being AI-fetched

var KEYWORD_MAP = [
  [/\b(run|jog|sprint)\b/, '🏃'],
  [/\b(walk|stroll|hike)\b/, '🚶'],
  [/\b(bike|cycle|cycling|bicycle)\b/, '🚴'],
  [/\b(gym|workout|lift|weights|exercise|strength)\b/, '💪'],
  [/\b(swim|swimming|pool|laps?)\b/, '🏊'],
  [/\b(yoga|stretch|pilates)\b/, '🧘'],
  [/\b(meditat|mindful|breathe)\b/, '🧘'],
  [/\b(code|coding|debug|deploy|commit|refactor|build|pr|pull request)\b/, '💻'],
  [/\b(design|mockup|figma|wireframe|sketch)\b/, '🎨'],
  [/\b(write|writing|draft|essay|blog|report|article)\b/, '✍️'],
  [/\b(email|inbox|reply|respond)\b/, '📧'],
  [/\b(meeting|standup|sync|zoom|teams|call|interview|1:1)\b/, '📞'],
  [/\b(read|reading|study|learn|research|review)\b/, '📚'],
  [/\b(plan|planning|schedule|organise|organize|prep)\b/, '📋'],
  [/\b(groceries|grocery|shopping|errands?|store|pharmacy)\b/, '🛒'],
  [/\b(cook|cooking|meal prep|dinner|lunch|breakfast|recipe|bake)\b/, '🍳'],
  [/\b(clean|cleaning|tidy|laundry|vacuum|dishes|mop|sweep|mow)\b/, '🧹'],
  [/\b(doctor|dentist|meds|medication|appointment|therapy|physio)\b/, '💊'],
  [/\b(sleep|nap|rest)\b/, '😴'],
  [/\b(pay|bill|invoice|budget|taxes|bank|finance)\b/, '💰'],
  [/\b(drive|commute|flight|airport|travel|trip|pack)\b/, '✈️'],
  [/\b(dinner with|lunch with|coffee with|hang|party|social)\b/, '🍽️'],
  [/\b(call mom|call dad|call family|catch up)\b/, '📱'],
];

var EMOJI_PREFIX_RE = /^[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2702}-\u{27B0}]/u;

/**
 * Synchronous keyword-based icon lookup.
 * Returns an emoji string, or null if no match / user already typed an emoji.
 */
export function getTaskIcon(text) {
  if (!text) return null;

  // If user typed an emoji at the start, don't override
  if (EMOJI_PREFIX_RE.test(text)) return null;

  // Check module-level cache
  if (iconCache.has(text)) {
    var cached = iconCache.get(text);
    return cached === '' ? null : cached;
  }

  var lower = text.toLowerCase();

  for (var i = 0; i < KEYWORD_MAP.length; i++) {
    var pattern = KEYWORD_MAP[i][0];
    var icon = KEYWORD_MAP[i][1];
    if (pattern.test(lower)) {
      iconCache.set(text, icon);
      return icon;
    }
  }

  // Confirmed miss — mark as checked
  iconCache.set(text, '');
  return null;
}

/**
 * Async AI fallback. Calls onResult(icon) if AI returns a result.
 * No-ops if already cached, already in flight, or not a confirmed miss.
 */
export function requestAIIcon(text, onResult) {
  if (!text) return;

  var cached = iconCache.get(text);

  // Already have a real icon
  if (cached) return;

  // Not yet confirmed as a keyword miss (undefined = not yet checked)
  if (cached !== '') return;

  // Already in flight
  if (pendingAI.has(text)) return;

  pendingAI.add(text);

  fetch('/api/tasks/suggest-icon?text=' + encodeURIComponent(text))
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data && data.icon) {
        iconCache.set(text, data.icon);
        if (typeof onResult === 'function') onResult(data.icon);
      }
    })
    .catch(function () {
      // Fail silently
    })
    .finally(function () {
      pendingAI.delete(text);
    });
}
