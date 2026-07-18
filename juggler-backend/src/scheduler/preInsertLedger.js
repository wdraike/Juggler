/**
 * preInsertLedger.js — Explicit read/write interface for the Phase 1/1I pre-insert ledger.
 *
 * The "pre-insert ledger" tracks recurring instance/chunk rows from their creation
 * (Phase 1 DB INSERT + Phase 1I in-memory expansion) through the persist pipeline
 * (placement writes, unplaced marking, Phase 9 past-due, no-limbo sweep).
 *
 * Before this module existed, four state variables were declared inline in
 * runScheduleAndPersist and read/patched across 28 non-contiguous locations:
 *   rawRowById         — id → raw DB row from the initial load (pre-Phase-1)
 *   phase1InsertedById — id → raw row for rows inserted in Phase 1 this run
 *   inMemoryChunks      — Array of in-memory chunk task objects for the scheduler
 *   pendingById         — id → merged dbUpdate object (accumulated pendingUpdates)
 *
 * This module encapsulates those four variables behind a defined interface so every
 * read and write goes through a named method, making the data flow explicit and
 * auditable. The golden-master persist harness (goldenMaster.persist.test.js) pins
 * the end-to-end DB behavior — the row-delta must stay bit-for-bit identical.
 *
 * Traceability: 999.1435 (Leg C from SPIKE 999.1108).
 */

'use strict';

/**
 * Create a PreInsertLedger instance.
 * @returns {object} ledger with read/write methods
 */
function createPreInsertLedger() {
  // id → raw DB row from the initial load (pre-Phase-1 snapshot).
  // Populated by setRawRows before Phase 1 runs.
  var rawRowById = {};

  // id → raw row for rows inserted by Phase 1 this run.
  // These rows are NOT in rawRowById because taskRows was loaded before the INSERT.
  // Populated by recordPhase1Inserts.
  var phase1InsertedById = {};

  // In-memory chunk task objects built from master fields for the scheduler.
  // These correspond to the Phase-1 inserted DB rows but carry scheduler-ready fields.
  var inMemoryChunks = [];

  // id → merged dbUpdate object, accumulated from pendingUpdates before the
  // no-limbo sweep and the overdue synthesis read it.
  var pendingById = {};

  return {
    // ── Raw rows (pre-Phase-1 load) ──────────────────────────────────────

    /**
     * Set the raw rows from the initial DB load (pre-Phase-1).
     * Called once after taskRows is available, before the persist section.
     * @param {Array} rows — raw DB rows from the initial load
     */
    setRawRows: function (rows) {
      for (var i = 0; i < rows.length; i++) {
        rawRowById[rows[i].id] = rows[i];
      }
    },

    /**
     * Get a raw row by ID from the pre-Phase-1 snapshot only.
     * Returns null for Phase-1 inserted rows — use getRow() for unified lookup.
     * @param {string} id
     * @returns {object|null}
     */
    getRawRow: function (id) {
      return rawRowById[id] || null;
    },

    /**
     * Get the full rawRowById map (for changeset computation compatibility).
     * @returns {object}
     */
    getRawRowById: function () {
      return rawRowById;
    },

    // ── Phase 1 inserts ──────────────────────────────────────────────────

    /**
     * Record rows that were pre-inserted in Phase 1.
     * Each row is normalized with ISO created_at/updated_at for changeset projection.
     * @param {Array} insertRows — rows that were INSERTed into the DB
     * @param {string} nowISO    — ISO timestamp for created_at/updated_at normalization
     */
    recordPhase1Inserts: function (insertRows, nowISO) {
      for (var i = 0; i < insertRows.length; i++) {
        var r = insertRows[i];
        phase1InsertedById[r.id] = Object.assign({}, r, {
          created_at: nowISO,
          updated_at: nowISO
        });
      }
    },

    /**
     * Get a Phase-1 inserted row by ID.
     * @param {string} id
     * @returns {object|null}
     */
    getPhase1InsertedRow: function (id) {
      return phase1InsertedById[id] || null;
    },

    /**
     * Get the full phase1InsertedById map (for computeNoLimboUpdates compatibility).
     * @returns {object}
     */
    getPhase1InsertedById: function () {
      return phase1InsertedById;
    },

    /**
     * Check whether a row was inserted in Phase 1 this run.
     * @param {string} id
     * @returns {boolean}
     */
    wasPhase1Inserted: function (id) {
      return Object.prototype.hasOwnProperty.call(phase1InsertedById, id);
    },

    // ── Unified lookup ───────────────────────────────────────────────────

    /**
     * Get a raw row by ID from either the pre-Phase-1 snapshot or Phase-1 inserts.
     * This is the unified lookup used by the no-limbo sweep and changeset computation.
     * @param {string} id
     * @returns {object|null}
     */
    getRow: function (id) {
      return rawRowById[id] || phase1InsertedById[id] || null;
    },

    /**
     * Check whether a row exists in the ledger (pre-Phase-1 or Phase-1 inserted).
     * @param {string} id
     * @returns {boolean}
     */
    hasRow: function (id) {
      return Object.prototype.hasOwnProperty.call(rawRowById, id)
        || Object.prototype.hasOwnProperty.call(phase1InsertedById, id);
    },

    // ── In-memory chunks ─────────────────────────────────────────────────

    /**
     * Add an in-memory chunk task object.
     * @param {object} chunk — scheduler-ready task object for a pre-inserted chunk
     */
    addInMemoryChunk: function (chunk) {
      inMemoryChunks.push(chunk);
    },

    /**
     * Get all in-memory chunk task objects.
     * @returns {Array}
     */
    getInMemoryChunks: function () {
      return inMemoryChunks;
    },

    /**
     * Get the count of in-memory chunks.
     * @returns {number}
     */
    getInMemoryChunkCount: function () {
      return inMemoryChunks.length;
    },

    // ── Pending updates ─────────────────────────────────────────────────

    /**
     * Build pendingById from the pendingUpdates array (merges by ID).
     * Called once after all pendingUpdates are collected, before the no-limbo sweep.
     * @param {Array} pendingUpdates — array of { id, dbUpdate }
     */
    buildPendingById: function (pendingUpdates) {
      for (var i = 0; i < pendingUpdates.length; i++) {
        var p = pendingUpdates[i];
        pendingById[p.id] = Object.assign(pendingById[p.id] || {}, p.dbUpdate);
      }
    },

    /**
     * Get a merged pending update by ID.
     * @param {string} id
     * @returns {object|undefined}
     */
    getPendingUpdate: function (id) {
      return pendingById[id];
    },

    /**
     * Get the full pendingById map (for computeNoLimboUpdates and overdue synthesis).
     * @returns {object}
     */
    getPendingById: function () {
      return pendingById;
    },

    // ── No-limbo sweep args ───────────────────────────────────────────────

    /**
     * Get the arguments needed by computeNoLimboUpdates.
     * Returns the three maps the pure function needs, avoiding scattered reads.
     * @returns {{ rawRowById: object, phase1InsertedById: object, pendingById: object }}
     */
    getNoLimboArgs: function () {
      return {
        rawRowById: rawRowById,
        phase1InsertedById: phase1InsertedById,
        pendingById: pendingById
      };
    }
  };
}

module.exports = { createPreInsertLedger: createPreInsertLedger };