/**
 * W5 (juggler-hex-h2) — Single-pool invariant.
 *
 * src/db.js must re-export lib/db's lazy-cached singleton, NOT build a second
 * knex instance from the same knexfile. If these two diverge, the service opens
 * TWO connection pools to the same DB (a resource/behavior regression).
 *
 * Pure-unit: asserts reference identity only. No live DB required (the knex
 * instance is constructed lazily but never connects until a query is issued).
 */

'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

describe('W5 single-pool invariant', function () {
  test('require("src/db") === lib/db.getDefaultDb() (one shared knex instance)', function () {
    var dbSingleton = require('../../src/db');
    var libDb = require('../../src/lib/db');
    expect(dbSingleton).toBe(libDb.getDefaultDb());
  });

  test('repeated getDefaultDb() calls return the same instance (no second pool)', function () {
    var libDb = require('../../src/lib/db');
    expect(libDb.getDefaultDb()).toBe(libDb.getDefaultDb());
  });
});
