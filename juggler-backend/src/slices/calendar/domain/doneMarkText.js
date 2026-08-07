/**
 * doneMarkText.js — single source of truth for the "✓ " done-mark prefix
 * applied to provider-facing event titles (GCal `summary`, MSFT `subject`,
 * Apple ICS `SUMMARY`).
 *
 * 999.5272: the PUSH side already stripped-then-prepended so repeated pushes
 * of a done task stayed idempotent (GoogleCalendarAdapter.js, Microsoft-
 * CalendarAdapter.js, lib/apple-cal-api.js — landed 6556408b, 2026-05-08) —
 * but each of the three copied the same two-line regex independently. The
 * PULL side (`applyEventToTaskFields` in all three adapters) had NO strip at
 * all: `text: event.title` wrote the provider's decorated title straight
 * into the stored task text. Round trip: task marked done -> pushed summary
 * gains "✓ " -> task REOPENED (terminal tasks are excluded from pull, so
 * reopening is required to reach this path) -> event judged newer -> pull
 * writes "✓ <text>" into storage. It then stuck forever, because the
 * non-done push branch sent `task.text` verbatim instead of the stripped
 * text, so a contaminated title never self-healed on the next push.
 *
 * Consolidating both directions into ONE helper — used by every push builder
 * AND every pull mapper — is the fix for both defects: a strip that only
 * exists in one of six call sites is exactly how the pull side was missed
 * the first time.
 */

'use strict';

var DONE_MARK = '✓';
var DONE_MARK_PREFIX_RE = /^(✓\s+)+/;

/**
 * Strip any number of leading "✓ " marks. Never mutates; returns '' for
 * falsy input (mirrors the pre-existing inline `task.text.replace(...)`
 * behavior, which assumed a string — this is the same contract, just named).
 */
function stripDoneMark(text) {
  return (text || '').replace(DONE_MARK_PREFIX_RE, '');
}

/**
 * Build the provider-facing title for a task: exactly ONE leading mark when
 * done (regardless of how many marks the input already carries, so repeated
 * pushes of a done task are idempotent), and the text VERBATIM when active.
 *
 * The active branch deliberately does NOT strip. "✓ " is not reserved — a user
 * may legitimately name a task "✓ Deploy checklist", and stripping on the
 * active push would silently rename their provider event and, on the next pull,
 * erase the character from the app too. Stored text is the user's; we decorate
 * it on the way out and undecorate on the way in (see undecorateTitle), we do
 * not edit it.
 */
function applyDoneMark(text, isDone) {
  return isDone ? DONE_MARK + ' ' + stripDoneMark(text) : (text || '');
}

/**
 * Undecorate a provider title on the way IN, but only when the leading mark is
 * provably OURS.
 *
 * We know it is ours when removing it yields exactly the text we already store:
 * that is the round trip of applyDoneMark(storedText, true). Anything else — a
 * user's own leading mark, a title genuinely renamed provider-side, an event
 * created outside the app — is returned untouched, because we cannot prove the
 * character is ours and deleting a user's data on a guess is worse than
 * carrying it.
 *
 * Consequence, accepted deliberately: a task whose title was ALREADY
 * contaminated by the pre-999.5272 pull (stored as "✓ X" while the provider
 * also says "✓ X") does not self-heal here — stripping would not match the
 * stored text. Those rows need the one-shot normalisation tracked with this
 * item; dev-bed measured zero of them.
 *
 * @param {string} providerTitle title as it exists on the provider
 * @param {string} currentText   task text as currently stored, may be undefined
 */
function undecorateTitle(providerTitle, currentText) {
  var stripped = stripDoneMark(providerTitle);
  if (stripped === providerTitle) return providerTitle; // nothing to undecorate
  return stripped === (currentText || '') ? stripped : providerTitle;
}

module.exports = {
  DONE_MARK: DONE_MARK,
  DONE_MARK_PREFIX_RE: DONE_MARK_PREFIX_RE,
  stripDoneMark: stripDoneMark,
  applyDoneMark: applyDoneMark,
  undecorateTitle: undecorateTitle
};
