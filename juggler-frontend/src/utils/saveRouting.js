/**
 * 999.15605 — which endpoint a task update has to take, and what the user reads
 * when one is refused.
 *
 * Every task edit — including the SINGLE-task edit form — saves through
 * `PUT /tasks/batch` (useTaskState.updateTask and its debounced flush). That
 * endpoint deliberately refuses `nextStart` ("Next Cycle Starts"):
 * BatchUpdateTasks.js has neither the anchor validation (resolveNextStartAnchor)
 * nor the recurrence redraw (resetRecurringInstances) that the field needs, so
 * accepting it there would persist an unvalidated anchor and leave stale future
 * instances on the grid — silently wrong rather than merely incomplete.
 *
 * Its error told the user to "edit it via the single-task update endpoint",
 * which the UI never used, so the field could not be changed at all.
 * `PUT /tasks/:id` (UpdateTask) has the full wiring; these updates go there.
 */

// Fields PUT /tasks/batch refuses. Keep in lockstep with the guard in
// juggler-backend/src/slices/task/application/commands/BatchUpdateTasks.js —
// if that guard grows a field, this list must grow with it or the UI is back to
// surfacing a raw 400 the user cannot act on.
export var SINGLE_ONLY_FIELDS = ['nextStart'];

// Fields that must travel WITH a peeled anchor rather than staying on the batch
// lane. `recur` is a template field, so a batch write carrying it calls
// resetRecurringInstances, which HARD-DELETES every future pending instance —
// including the very instance row the edit form is targeting. The follow-up
// anchor PUT would then 404 on a row the batch write just deleted, losing the
// anchor edit and rolling back a recurrence change the server had committed.
// Sent together, UpdateTask applies the pattern, snaps the anchor and redraws
// once, against one fetched row. All four are accepted by taskUpdateSchema
// (recur is typed; the rest ride .passthrough()).
export var ANCHOR_COMPANION_FIELDS = ['recur', 'recurStart', 'recurEnd', 'recurring'];

function needsSingleEndpoint(update) {
  if (!update) return false;
  for (var i = 0; i < SINGLE_ONLY_FIELDS.length; i++) {
    if (Object.prototype.hasOwnProperty.call(update, SINGLE_ONLY_FIELDS[i])) return true;
  }
  return false;
}

/**
 * Split pending updates by FIELD: the refused fields peel off into their own
 * single-endpoint payload, everything else stays in the batch payload.
 *
 * Sending the WHOLE update to PUT /tasks/:id looks tidier and is wrong — the
 * two endpoints do not accept the same thing:
 *   - PUT /tasks/:id is zod-validated (taskUpdateSchema) with
 *     `time: /^\d{2}:\d{2}/` and `date: /^\d{4}-\d{2}-\d{2}/`, while the edit
 *     form sends 12-hour text ("2:00 PM", fromTime24) and '' for a cleared
 *     field — both 400 there and both pass on the batch route, whose schema is
 *     a passthrough shape guard;
 *   - the batch path preserves the existing time-of-day when a date arrives
 *     without one (facade.js recurCleanup neighbourhood); UpdateTask has no
 *     such block, so the same edit would reset scheduled_at to local midnight;
 *   - the batch path honours the payload's per-task `_timezone`; UpdateTask
 *     converts against the X-Timezone display zone only.
 * Peeling off just the refused field keeps every ordinary field on the endpoint
 * that has always handled it, and hands the single endpoint a payload
 * (`{id, nextStart}`) that none of those three divergences can touch.
 *
 * The caller writes the batch lane FIRST and the singles after, so ordering is
 * deterministic rather than racing.
 *
 * @param {Array<object>} updates
 * @returns {{batch: Array<object>, singles: Array<object>}}
 */
export function routeUpdates(updates) {
  var batch = [];
  var singles = [];
  (updates || []).forEach(function(u) {
    if (!u) return;
    if (!needsSingleEndpoint(u)) { batch.push(u); return; }
    var rest = {};
    var single = {};
    Object.keys(u).forEach(function(k) {
      if (k === 'id') { rest.id = u.id; single.id = u.id; return; }
      if (SINGLE_ONLY_FIELDS.indexOf(k) >= 0 || ANCHOR_COMPANION_FIELDS.indexOf(k) >= 0) {
        single[k] = u[k];
      } else { rest[k] = u[k]; }
    });
    singles.push(single);
    // Only queue a batch write when there is something left to write. Object
    // keys other than `id` are the test — an `{id}`-only payload would be a
    // no-op UPDATE that still costs a round trip and an SSE echo.
    if (Object.keys(rest).some(function(k) { return k !== 'id'; })) { batch.push(rest); }
  });
  return { batch: batch, singles: singles };
}

// The batch endpoint prefixes every rejection with its position in the payload:
// "Update item 3 (t1784…-1): …". That is addressing information for a caller,
// not something a user editing one task can use.
var BATCH_ITEM_PREFIX = /^Update item \d+ \([^)]*\):\s*/;

/**
 * Turn a server error into something the person editing the task can act on.
 * Used wherever a save failure is shown, so a raw backend string never reaches
 * the screen (AC3).
 *
 * @param {?string} serverMsg
 * @returns {string}
 */
export function friendlySaveError(serverMsg) {
  var msg = typeof serverMsg === 'string' ? serverMsg.trim() : '';
  if (!msg) return 'That change could not be saved — please try again.';

  var stripped = msg.replace(BATCH_ITEM_PREFIX, '');

  // The refusal this ticket exists for. If routing ever regresses, the user gets
  // an instruction instead of a description of our endpoints. The field label is
  // taken FROM the message rather than hardcoded, so a second refused field
  // names itself instead of claiming to be "Next Cycle Starts".
  if (/is not supported in batch updates/i.test(stripped)) {
    var labelled = /["“]([^"”]+)["”]/.exec(stripped);
    var what = labelled ? '“' + labelled[1] + '”' : 'this field';
    return 'Open this task on its own to change ' + what + ' — it can’t be '
      + 'changed while editing several tasks at once.';
  }

  return stripped;
}
