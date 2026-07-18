/**
 * provider-origin-pull-decision.js — pure "pull a NON-juggler-origin event into
 * its task" use-case for cal-sync's sync().
 *
 * 999.1025 increment 8 (SIXTH EXTRACTION SEAM): carves the two remaining inline
 * pull decisions out of the per-ledger loop in
 * controllers/cal-sync.controller.js. These are the branches that run whenever
 * branch A (the juggler-origin full-sync push/pull/conflict block) did NOT — i.e.
 * an `else if (isIngestOnly)` / `else if (ledger.origin === pid && !terminal)`
 * chain — unified here into ONE pure decision. Decisions in, effects out: no DB,
 * no HTTP, no provider clients. Given a fully-resolved context it returns whether
 * to pull, whether that pull forces placement_mode = FIXED, and the log
 * descriptor(s) the controller must replay.
 *
 * WHAT IT DECIDES (pinned byte-for-byte by the W4 golden master pull/ingest axes):
 *   - INGEST-ONLY provider (ctx.isIngestOnly): pull UNCONDITIONALLY — it NEVER
 *     consults the external-edit predicate — as long as the task is neither
 *     juggler-origin (MCP-created; Juggler owns its scheduling fields) nor
 *     terminal. The pull FORCES placement_mode = FIXED and emits NO log
 *     (forcePlacementFixed: true, logs: []). Otherwise → noop.
 *   - PROVIDER-ORIGIN full-sync (ledger.origin === pid, task not terminal): pull
 *     ONLY when the event was modified externally since our last sync
 *     (isEventModifiedExternally — the >1000ms tolerance + Apple ETag fallback
 *     predicate reused verbatim). The pull does NOT force placement_mode (the
 *     adapter's own change-detection sets FIXED only on genuine date/time changes
 *     — forcing it for title/duration-only edits would spuriously promote flexible
 *     tasks; ROADMAP 999.012 BUG-2) and emits a 'pulled' log. Otherwise → noop.
 *   - anything else (ingest juggler-origin/terminal, provider-origin terminal,
 *     foreign origin, unmodified provider event) → action 'noop'.
 *
 * EFFECT SPLIT (justified): both pull outcomes request the SAME effects at the
 * call site — pAdapter.applyEventToTaskFields(event, tz, task), taskUpdates.push,
 * pStats/stats.pulled++ — differing only in (a) whether placement_mode is forced
 * to FIXED and (b) whether a 'pulled' log is replayed. Those two differences are
 * exactly what this descriptor carries; the adapter call (an effect) stays at the
 * call site. Unlike the conflict_provider log in external-edit-decision.js, the
 * provider-origin 'pulled' log's newValues read event.durationMinutes/event.title
 * directly (NOT the applied fields), so the log is fully built here.
 *
 * @param {Object} ctx
 *   @param {Object}  ctx.task            resolved task row (reads id/text/dur/status)
 *   @param {Object}  ctx.event           provider event (reads title/durationMinutes;
 *                                        lastModified/_etag via isEventModifiedExternally)
 *   @param {Object}  ctx.ledger          sync ledger row (reads origin/provider_event_id;
 *                                        last_modified_at/provider_etag via the predicate)
 *   @param {string}  ctx.pid             provider id ('gcal' | 'msft' | 'apple')
 *   @param {boolean} ctx.isIngestOnly    isIngestOnly(pid), resolved by the caller
 *   @param {string}  ctx.jugglerOrigin   the JUGGLER_ORIGIN sentinel ('juggler')
 *   @param {boolean} ctx.isTaskTerminal  isTerminalStatus(task.status), resolved by caller
 *   @param {Object}  ctx.calendarLabels  { pid: label } for sync_history rows
 * @returns {{
 *   action: 'pull'|'noop',
 *   forcePlacementFixed: boolean,
 *   logs: Array<{provider:string, action:string, opts:Object}>
 * }} 'pull' → caller runs applyEventToTaskFields, forces FIXED iff
 *    forcePlacementFixed, pushes the taskUpdate, bumps pulled, and replays `logs`;
 *    'noop' → caller does nothing (falls through to the ledger cache update).
 */
'use strict';

var { isEventModifiedExternally } = require('./event-modified-predicate');

// Fresh object per call (never a shared constant): the caller reads it read-only,
// but returning a new literal keeps the descriptor free of aliasing surprises and
// matches the sibling decide* use-cases.
function noop() {
  return { action: 'noop', forcePlacementFixed: false, logs: [] };
}

function decideProviderOriginPull(ctx) {
  var task = ctx.task;
  var event = ctx.event;
  var ledger = ctx.ledger;
  var pid = ctx.pid;

  // ── Ingest-only providers: pull event changes into task. Skip terminal tasks
  // and juggler-origin tasks (MCP-created) — Juggler owns their scheduling
  // fields. UNCONDITIONAL — does NOT consult the external-edit predicate. Forces
  // placement_mode = FIXED at the call site; emits no log. (Was the
  // `else if (isIngestOnly(pid))` branch.)
  if (ctx.isIngestOnly) {
    var isJugglerOrigin = ledger.origin === ctx.jugglerOrigin;
    if (!isJugglerOrigin && !ctx.isTaskTerminal) {
      return { action: 'pull', forcePlacementFixed: true, logs: [] };
    }
    return noop();
  }

  // ── Provider-origin task in full-sync mode: pull event changes when the event
  // was modified since our last sync. We never push to these events (we don't
  // own them), but we keep task fields (dur, text, time) current when the user
  // edits them on the provider side. Does NOT force placement_mode — the
  // adapter's change-detection already sets FIXED on genuine date/time changes.
  // (Was the `else if (ledger.origin === pid && !isTerminalStatus(task.status))`
  // branch; the external-edit test is the same PURE predicate — 999.1025 inc. 6.)
  if (ledger.origin === pid && !ctx.isTaskTerminal) {
    if (isEventModifiedExternally(event, ledger)) {
      return {
        action: 'pull',
        forcePlacementFixed: false,
        logs: [{
          provider: pid,
          action: 'pulled',
          opts: {
            taskId: task.id, taskText: task.text, eventId: ledger.provider_event_id,
            oldValues: { dur: task.dur, text: task.text },
            newValues: { dur: event.durationMinutes, text: event.title },
            detail: 'Provider-origin event edited — task refreshed from ' + pid,
            calendarName: ctx.calendarLabels[pid] || null
          }
        }]
      };
    }
    return noop();
  }

  return noop();
}

module.exports = { decideProviderOriginPull: decideProviderOriginPull };
