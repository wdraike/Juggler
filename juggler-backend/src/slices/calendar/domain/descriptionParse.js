/**
 * descriptionParse.js — safe, provable extraction of the ONE genuinely
 * free-text field (notes) out of the composited provider description Juggler
 * builds on every push (GoogleCalendarAdapter.js buildEventBody /
 * MicrosoftCalendarAdapter.js buildMsftEventBody / apple-cal-api.js
 * buildVEvent — all three build the SAME shape):
 *
 *   Project: <project>       (only if task.project)
 *   Priority: <pri>          (only if task.pri)
 *   Notes: <notes>           (only if task.notes)
 *   Link: <url>              (only if task.url)
 *   <blank line>
 *   Synced from Raike & Sons
 *
 * 999.5283: the pull path (applyEventToTaskFields, all three adapters) never
 * read `event.description` at all for an already-linked task — a user's edit
 * to the event's description in Google/Outlook/iCloud calendar was silently
 * and permanently discarded on every sync, even though eventHash (which IS
 * description-sensitive) correctly detected "something about this event
 * changed" and triggered the pull in the first place.
 *
 * SCOPE DECISION (this ticket — David to re-open a separate ticket if a
 * broader contract is wanted): only `notes` round-trips. `project` and `pri`
 * are STRUCTURED/validated fields — writing an arbitrary parsed string into
 * `project` would need `ensureProject` (a side-effecting write this pure pull
 * mapper has no business triggering) and `pri` has a normalization/validation
 * contract (normalizePri) that a hand-parsed "Priority: <anything>" string
 * cannot satisfy. The app's OWN edit guard (task validation's
 * checkCalSyncEditGuard) already refuses to let a provider-origin cal-linked
 * task's project be edited via Juggler's own API at all (allowed fields are
 * only status/notes/pri/_allowUnfix) — round-tripping `project` from a
 * calendar description would grant MORE editing power through a calendar
 * edit than the app's own UI grants directly, which is an inconsistent
 * surface. `url` lives in the same composited block with no independent
 * delimiter and materially lower practical value than notes. `notes` is:
 * (a) the field the ticket's own reproduction edits ("Notes: USER EDITED
 * THIS ON GOOGLE CALENDAR"), (b) free text with no validation contract to
 * violate, and (c) the one field checkCalSyncEditGuard treats as always
 * user-editable regardless of a task's calendar origin — the closest thing
 * this codebase has to a stated intent that notes edits should flow.
 *
 * SAFETY CONTRACT (mirrors doneMarkText.js's undecorateTitle): RECONSTRUCT
 * the description Juggler would have pushed for the task's CURRENT
 * project/pri/url (fields we are deliberately NOT round-tripping — their
 * Juggler-side values remain the source of truth), with `notes` as the one
 * hole. Only if the incoming description matches that template up to the
 * notes content is it extracted; any structural drift (missing marker,
 * changed project/pri/url line, a user rewriting the whole description in
 * free prose) leaves task.notes untouched — we do not guess, matching
 * undecorateTitle's "prove it or leave it" philosophy. A user who genuinely
 * deletes the "Notes: " line entirely is treated the same way (left
 * untouched, not interpreted as "clear the notes") — the safe failure mode
 * is never writing over data we cannot prove the user meant to change.
 */

'use strict';

var MARKER_SUFFIX = '\n\nSynced from Raike & Sons';
var NOTES_PREFIX = 'Notes: ';

function buildTemplateParts(currentTask) {
  var before = [];
  if (currentTask && currentTask.project) before.push('Project: ' + currentTask.project);
  if (currentTask && currentTask.pri) before.push('Priority: ' + currentTask.pri);
  var after = [];
  if (currentTask && currentTask.url) after.push('Link: ' + currentTask.url);
  return { before: before, after: after };
}

/**
 * @param {string} description   the provider event's description/body text
 * @param {?Object} currentTask  rowToTask()-shaped current task (reads project/pri/url)
 * @returns {?string} the notes content if provably ours to extract, else null
 *   (null means: do not write task.notes — leave it as-is)
 */
function extractNotesFromDescription(description, currentTask) {
  if (typeof description !== 'string') return null;
  if (description.slice(-MARKER_SUFFIX.length) !== MARKER_SUFFIX) return null;

  var body = description.slice(0, description.length - MARKER_SUFFIX.length);
  var tpl = buildTemplateParts(currentTask);

  var prefix = tpl.before.length > 0 ? tpl.before.join('\n') + '\n' : '';
  if (body.slice(0, prefix.length) !== prefix) return null;
  var rest = body.slice(prefix.length);

  var suffix = tpl.after.length > 0 ? '\n' + tpl.after.join('\n') : '';
  if (suffix) {
    if (rest.slice(rest.length - suffix.length) !== suffix) return null;
    rest = rest.slice(0, rest.length - suffix.length);
  }

  // What remains must be exactly "Notes: <content>" — anything else (absent,
  // or structurally different) means either there is nothing to extract or
  // the structure has drifted enough that we cannot prove intent.
  if (rest.slice(0, NOTES_PREFIX.length) !== NOTES_PREFIX) return null;
  return rest.slice(NOTES_PREFIX.length);
}

module.exports = { extractNotesFromDescription: extractNotesFromDescription };
