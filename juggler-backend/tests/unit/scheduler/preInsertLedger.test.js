/**
 * Unit tests for preInsertLedger.js — the explicit read/write interface for the
 * Phase 1/1I pre-insert ledger state.
 *
 * Traceability: 999.1435 (Leg C from SPIKE 999.1108).
 */
'use strict';

var { createPreInsertLedger } = require('../../../src/scheduler/preInsertLedger');

describe('preInsertLedger', function () {
  test('raw rows: set and get', function () {
    var ledger = createPreInsertLedger();
    expect(ledger.getRawRow('r1')).toBeNull();

    ledger.setRawRows([
      { id: 'r1', scheduled_at: '2026-07-17 10:00:00' },
      { id: 'r2', scheduled_at: null }
    ]);

    expect(ledger.getRawRow('r1')).toEqual({ id: 'r1', scheduled_at: '2026-07-17 10:00:00' });
    expect(ledger.getRawRow('r2')).toEqual({ id: 'r2', scheduled_at: null });
    expect(ledger.getRawRow('missing')).toBeNull();
  });

  test('phase1 inserts: record and lookup', function () {
    var ledger = createPreInsertLedger();
    expect(ledger.wasPhase1Inserted('p1')).toBe(false);

    var nowISO = '2026-07-17T15:00:00.000Z';
    ledger.recordPhase1Inserts([
      { id: 'p1', dur: 30, created_at: new Date(), updated_at: new Date() },
      { id: 'p2', dur: 45, created_at: new Date(), updated_at: new Date() }
    ], nowISO);

    expect(ledger.wasPhase1Inserted('p1')).toBe(true);
    expect(ledger.wasPhase1Inserted('p2')).toBe(true);
    expect(ledger.wasPhase1Inserted('r1')).toBe(false);

    var p1 = ledger.getPhase1InsertedRow('p1');
    expect(p1.dur).toBe(30);
    expect(p1.created_at).toBe(nowISO);
    expect(p1.updated_at).toBe(nowISO);
  });

  test('unified getRow prefers rawRow, falls back to phase1', function () {
    var ledger = createPreInsertLedger();
    ledger.setRawRows([{ id: 'r1', kind: 'raw' }]);
    ledger.recordPhase1Inserts([{ id: 'p1', kind: 'phase1' }], '2026-07-17T00:00:00Z');

    expect(ledger.getRow('r1').kind).toBe('raw');
    expect(ledger.getRow('p1').kind).toBe('phase1');
    expect(ledger.getRow('missing')).toBeNull();
    expect(ledger.hasRow('r1')).toBe(true);
    expect(ledger.hasRow('p1')).toBe(true);
    expect(ledger.hasRow('missing')).toBe(false);
  });

  test('in-memory chunks: add and get', function () {
    var ledger = createPreInsertLedger();
    expect(ledger.getInMemoryChunkCount()).toBe(0);
    expect(ledger.getInMemoryChunks()).toEqual([]);

    var chunk1 = { id: 'c1', taskType: 'recurring_instance', _inMemoryChunk: true };
    var chunk2 = { id: 'c2', taskType: 'recurring_instance', _inMemoryChunk: true };
    ledger.addInMemoryChunk(chunk1);
    ledger.addInMemoryChunk(chunk2);

    expect(ledger.getInMemoryChunkCount()).toBe(2);
    expect(ledger.getInMemoryChunks()).toEqual([chunk1, chunk2]);
  });

  test('pendingById: build from pendingUpdates and lookup', function () {
    var ledger = createPreInsertLedger();
    expect(ledger.getPendingUpdate('t1')).toBeUndefined();

    ledger.buildPendingById([
      { id: 't1', dbUpdate: { scheduled_at: '2026-07-17 10:00:00', date: '2026-07-17' } },
      { id: 't1', dbUpdate: { unscheduled: null } }, // second update for same ID — merged
      { id: 't2', dbUpdate: { unscheduled: 1 } }
    ]);

    var p1 = ledger.getPendingUpdate('t1');
    expect(p1.scheduled_at).toBe('2026-07-17 10:00:00');
    expect(p1.date).toBe('2026-07-17');
    expect(p1.unscheduled).toBeNull();
    expect(ledger.getPendingUpdate('t2').unscheduled).toBe(1);
  });

  test('getNoLimboArgs returns all three maps', function () {
    var ledger = createPreInsertLedger();
    ledger.setRawRows([{ id: 'r1' }]);
    ledger.recordPhase1Inserts([{ id: 'p1' }], '2026-07-17T00:00:00Z');
    ledger.buildPendingById([{ id: 't1', dbUpdate: { unscheduled: 1 } }]);

    var args = ledger.getNoLimboArgs();
    expect(args.rawRowById).toBe(ledger.getRawRowById());
    expect(args.phase1InsertedById).toBe(ledger.getPhase1InsertedById());
    expect(args.pendingById).toBe(ledger.getPendingById());
    expect(args.rawRowById.r1).toBeDefined();
    expect(args.phase1InsertedById.p1).toBeDefined();
    expect(args.pendingById.t1.unscheduled).toBe(1);
  });

  test('getRawRowById returns live reference for changeset compat', function () {
    var ledger = createPreInsertLedger();
    ledger.setRawRows([{ id: 'r1' }]);
    var map = ledger.getRawRowById();
    expect(map.r1).toBeDefined();
    // Mutating the returned map reflects in the ledger (live reference, not a copy)
    map.r2 = { id: 'r2' };
    expect(ledger.getRawRow('r2')).toEqual({ id: 'r2' });
  });
});