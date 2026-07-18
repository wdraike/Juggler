/**
 * ingest-event-decision.js — pure "what becomes of a remote event that has no
 * ledger yet" use-case for cal-sync's sync() Phase 3b (re-ingest / promote-skip).
 *
 * 999.1025 increment 9 (SEVENTH EXTRACTION SEAM): carves the per-event fate
 * decision out of the Phase 3b loop in controllers/cal-sync.controller.js — the
 * loop that walks every fetched provider event NOT already claimed by an earlier
 * phase (no active/deleted ledger row, sibling-key dedup already applied). Each
 * such event resolves to exactly one of five outcomes. This function returns the
 * outcome (and the pure field derivations for a promotion); every EFFECT — the
 * task/ledger INSERT buffers, taskUpdates, stats counters, logSyncAction, the
 * orphan deleteEvent HTTP call, and the processedEventIds/processedTaskIds
 * bookkeeping — stays at the call site. Decisions in, effects out: no DB, no
 * HTTP, no clock, no crypto.
 *
 * WHAT IT DECIDES (evaluated in this EXACT order — the golden master's G-ingest
 * axis pins the whole ladder byte-for-byte):
 *   1. LINK — the event is already bound to a local task via that task's
 *      provider-event-id column (existingTask). No task is created; the caller
 *      records a ledger row binding the two. `origin` is the PROVIDER id when the
 *      task was itself provider-ingested (its id is prefixed `<pid>_`), else the
 *      juggler sentinel (a Juggler-owned task the user manually linked).
 *   2. SKIP-PAST — a past event (isPast) with no ledger. The caller inserts a
 *      task_id-NULL "skip" ledger row: it never becomes a task and future syncs
 *      won't re-ingest it. This is the "skip accounting" half of the phase.
 *   3. ORPHAN-RECLAIM — the event body carries a Juggler round-trip marker
 *      ("Synced from …") AND a still-unprocessed local task matches it by
 *      title+date (orphanMatch). The caller re-links that task to the event
 *      (dual-write recovery) rather than creating a duplicate.
 *   4. ORPHAN-DELETE — a Juggler round-trip marker but NO matching task: the
 *      source task is gone (e.g. a regenerated recurring instance). The caller
 *      deletes the stale remote event so duplicates don't accumulate.
 *   5. PROMOTE — a genuine new future event → a new task. The PROMOTION decision
 *      (which placement_mode; all-day vs reminder vs fixed; the derived
 *      when/dur) is pure and returned here; the caller assembles the row (random
 *      id, tz scheduled_at, hashing) and buffers the INSERTs.
 *
 * EFFECT SPLIT (justified): no log descriptor is returned. Unlike the sibling
 * decisions whose logs were fully determined by pure inputs, every log this
 * phase emits references a call-site value — the loop key `evId` (the
 * deleted_local orphan log; distinct from event.id under Apple's dual-key
 * indexing) or the freshly-generated `newTaskId` (the created / possible_duplicate
 * logs) — so all logSyncAction calls stay at the call site, mirroring how
 * external-edit-decision.js leaves its 'pull' log there.
 *
 * @param {Object} ctx
 *   @param {Object}  ctx.event               provider event (reads isAllDay/
 *                                             isTransparent/durationMinutes for the
 *                                             promotion derivations)
 *   @param {?Object} ctx.existingTask        local task already bound to this event
 *                                             via its event-id column, or null
 *                                             (resolved by the caller)
 *   @param {boolean} ctx.isPast              isEventPast(...), resolved by the caller
 *   @param {boolean} ctx.isJugglerOriginBody event body carries a "Synced from …"
 *                                             marker (resolved by the caller)
 *   @param {?Object} ctx.orphanMatch         unprocessed local task matching the
 *                                             round-trip event by title+date, or null
 *   @param {string}  ctx.calIngestMode       per-calendar ingest mode ('task' |
 *                                             'reminder'), resolved by the caller
 *   @param {string}  ctx.pid                 provider id ('gcal' | 'msft' | 'apple')
 *   @param {string}  ctx.jugglerOrigin       the JUGGLER_ORIGIN sentinel ('juggler')
 * @returns {{ action: 'link', origin: string }
 *          | { action: 'skip-past' }
 *          | { action: 'orphan-reclaim' }
 *          | { action: 'orphan-delete' }
 *          | { action: 'promote', dur: number, when: string,
 *              placementMode: string, isReminder: boolean }}
 */
'use strict';

var { PLACEMENT_MODES } = require('../../../lib/placementModes');

function decideIngestEvent(ctx) {
  var event = ctx.event;
  var existingTask = ctx.existingTask;

  // 1. Already linked to a task via the task's event-id column → record a ledger
  //    binding; no task created. origin is the provider when the task was itself
  //    provider-ingested (id prefixed '<pid>_'), else the juggler sentinel.
  if (existingTask) {
    var origin = existingTask.id.startsWith(ctx.pid + '_') ? ctx.pid : ctx.jugglerOrigin;
    return { action: 'link', origin: origin };
  }

  // 2. Past event with no ledger → task_id-NULL skip row (never a task, blocks
  //    re-ingestion).
  if (ctx.isPast) {
    return { action: 'skip-past' };
  }

  // 3. Juggler round-trip event ("Synced from …"): reclaim the source task if it
  //    is still here and unprocessed, otherwise delete the stale remote event.
  if (ctx.isJugglerOriginBody) {
    if (ctx.orphanMatch) {
      return { action: 'orphan-reclaim' };
    }
    return { action: 'orphan-delete' };
  }

  // 4. Genuine new future event → promote to a task. Field derivations (the
  //    promotion decision) are pure; row assembly stays at the call site.
  var isAllDay = !!event.isAllDay;
  var isReminder = !isAllDay && ctx.calIngestMode === 'reminder';
  var placementMode = event.isTransparent
    ? PLACEMENT_MODES.REMINDER
    : (isAllDay
      ? PLACEMENT_MODES.ALL_DAY
      : (isReminder ? PLACEMENT_MODES.REMINDER : PLACEMENT_MODES.FIXED));

  return {
    action: 'promote',
    dur: isAllDay ? 0 : event.durationMinutes,
    when: isAllDay ? 'allday' : '',
    placementMode: placementMode,
    isReminder: isReminder
  };
}

module.exports = { decideIngestEvent: decideIngestEvent };
