/**
 * merged-follower-cleanup.js — pure "which merged followers to tear down" planner
 * for cal-sync's sync() Phase 3a.
 *
 * 999.1025 increment 10 (TENTH EXTRACTION SEAM): carves the merged-follower
 * cleanup decision out of the per-provider block in
 * controllers/cal-sync.controller.js. Decisions in, effects out: no DB, no HTTP.
 * Given the run's merged-follower map and this provider's ledger rows it returns
 * three flat lists; the mutation buffers (splitDeleteQueue / ledgerUpdates /
 * ledgeredTaskIds) stay effects at the call site.
 *
 * WHAT IT DECIDES (pinned by W4 golden axis N — split-chunk merge choreography):
 * each chunk that got absorbed into a contiguous run (by mergeContiguousSplitChunks)
 * should have its own provider event removed and its ledger row marked
 * deleted_local — the leader's expanded event now covers its slot. For each
 * follower id, find its ACTIVE ledger row for this provider:
 *   - no active row (a new merge before that chunk ever synced on its own) → skip
 *     it entirely (contributes to none of the three lists).
 *   - active row WITH a provider_event_id → queue that event id for delete, mark
 *     the ledger row for deleted_local, and drop the follower from the pushed set.
 *   - active row WITHOUT a provider_event_id → still mark the ledger row +
 *     unledger the follower, but queue NO event delete (nothing on the provider).
 *
 * ORDER: followers are visited in Object.keys(mergedFollowers) order (insertion
 * order for the string keys the controller uses), so the returned lists preserve
 * the exact append order the inline loop produced.
 *
 * @param {Object} ctx
 *   @param {Object}        ctx.mergedFollowers  { followerTaskId: true }
 *   @param {Array<Object>} ctx.ledgerRows       this provider's ledger rows
 *                                               (ledgerByProvider[pid]); each reads
 *                                               task_id / status / id / provider_event_id
 * @returns {{
 *   deleteEventIds:   Array<string>,          // provider_event_ids to delete
 *   ledgerDeletes:    Array<{id:*}>,          // ledger rows to mark deleted_local
 *   unledgerTaskIds:  Array<string>           // followers to drop from ledgeredTaskIds
 * }}
 */
'use strict';

function planMergedFollowerCleanup(ctx) {
  var mergedFollowers = ctx.mergedFollowers || {};
  var ledgerRows = ctx.ledgerRows || [];
  var deleteEventIds = [];
  var ledgerDeletes = [];
  var unledgerTaskIds = [];

  Object.keys(mergedFollowers).forEach(function (followerId) {
    var row = ledgerRows.find(function (l) {
      return l.task_id === followerId && l.status === 'active';
    });
    if (!row) return;
    if (row.provider_event_id) deleteEventIds.push(row.provider_event_id);
    ledgerDeletes.push({ id: row.id });
    unledgerTaskIds.push(followerId);
  });

  return {
    deleteEventIds: deleteEventIds,
    ledgerDeletes: ledgerDeletes,
    unledgerTaskIds: unledgerTaskIds
  };
}

module.exports = { planMergedFollowerCleanup: planMergedFollowerCleanup };
