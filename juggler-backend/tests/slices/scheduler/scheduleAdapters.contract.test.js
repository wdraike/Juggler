/**
 * H6 W2 — Scheduler Ports & Adapters contract test.
 *
 * Proves:
 *   - every adapter implements its port's full method set;
 *   - SchedulerTaskProvider re-exports the SAME mapper function objects the task
 *     slice facade owns (coupling cut, byte-identical mappers);
 *   - KnexScheduleRepository + InMemoryScheduleRepository enforce P1 (timestamp
 *     columns must be JS Date — fail-loud on non-Date);
 *   - the delta-write path writes ONLY the rows passed (S5 — no write-all),
 *     splitting batched scheduled_at/dur vs per-row, with NO Knex now-builder.
 */

'use strict';

process.env.NODE_ENV = 'test';

const ports = require('../../../src/slices/scheduler/domain/ports');
const TaskProviderPort = require('../../../src/slices/scheduler/domain/ports/TaskProviderPort');
const ScheduleRepositoryPort = require('../../../src/slices/scheduler/domain/ports/ScheduleRepositoryPort');
const WeatherProviderPort = require('../../../src/slices/scheduler/domain/ports/WeatherProviderPort');
const CalendarProviderPort = require('../../../src/slices/scheduler/domain/ports/CalendarProviderPort');
const ClockPort = require('../../../src/slices/scheduler/domain/ports/ClockPort');

const SchedulerTaskProvider = require('../../../src/slices/scheduler/adapters/SchedulerTaskProvider');
const KnexScheduleRepository = require('../../../src/slices/scheduler/adapters/KnexScheduleRepository');
const InMemoryScheduleRepository = require('../../../src/slices/scheduler/adapters/InMemoryScheduleRepository');
const SchedulerWeatherProvider = require('../../../src/slices/scheduler/adapters/SchedulerWeatherProvider');
const SchedulerCalendarProvider = require('../../../src/slices/scheduler/adapters/SchedulerCalendarProvider');
const MysqlClockAdapter = require('../../../src/slices/scheduler/adapters/MysqlClockAdapter');

const taskFacade = require('../../../src/slices/task/facade');

describe('H6 W2 — driven ports are defined', () => {
  test('the ports barrel exposes all driven-port contracts', () => {
    expect(Object.keys(ports).sort()).toEqual([
      'CalendarProviderPort', 'ClockPort', 'ScheduleCachePort',
      'ScheduleRepositoryPort', 'TaskProviderPort', 'WeatherProviderPort'
    ]);
  });
});

describe('H6 W2 — every adapter implements its port method set', () => {
  function assertImplements(adapter, methods) {
    methods.forEach(function (m) {
      expect(typeof adapter[m]).toBe('function');
    });
  }

  test('SchedulerTaskProvider implements TaskProviderPort', () => {
    assertImplements(new SchedulerTaskProvider(), TaskProviderPort.TASK_PROVIDER_PORT_METHODS);
  });
  test('KnexScheduleRepository implements ScheduleRepositoryPort', () => {
    assertImplements(new KnexScheduleRepository({ db: function () {} }),
      ScheduleRepositoryPort.SCHEDULE_REPOSITORY_PORT_METHODS);
  });
  test('InMemoryScheduleRepository implements ScheduleRepositoryPort', () => {
    assertImplements(new InMemoryScheduleRepository(),
      ScheduleRepositoryPort.SCHEDULE_REPOSITORY_PORT_METHODS);
  });
  test('SchedulerWeatherProvider implements WeatherProviderPort', () => {
    assertImplements(new SchedulerWeatherProvider({ roundCoord: function () {} }),
      WeatherProviderPort.WEATHER_PROVIDER_PORT_METHODS);
  });
  test('SchedulerCalendarProvider implements CalendarProviderPort', () => {
    assertImplements(new SchedulerCalendarProvider(),
      CalendarProviderPort.CALENDAR_PROVIDER_PORT_METHODS);
  });
  test('MysqlClockAdapter implements ClockPort', () => {
    assertImplements(new MysqlClockAdapter(), ClockPort.CLOCK_PORT_METHODS);
  });
});

describe('H6 W2 — SchedulerTaskProvider cuts the task.controller coupling', () => {
  test('re-exports the SAME mapper function objects the task slice facade owns', () => {
    const tp = new SchedulerTaskProvider();
    // Identity equality — not a copy. This is the byte-identical mapper the
    // golden-master pins; sourcing it from the facade (not the controller) is the
    // coupling cut.
    expect(tp.rowToTask).toBe(taskFacade.rowToTask);
    expect(tp.taskToRow).toBe(taskFacade.taskToRow);
    expect(tp.buildSourceMap).toBe(taskFacade.buildSourceMap);
  });

  test('loadSchedulableRows applies the user-scoped status/template filter', async () => {
    let captured = {};
    const fakeDb = function (table) {
      captured.table = table;
      const qb = {
        where: function (a, b) {
          if (typeof a === 'function') { /* the status sub-where */ captured.subWhere = true; }
          else captured.userScope = { col: a, val: b };
          return qb;
        },
        select: function () { captured.selected = true; return Promise.resolve([]); }
      };
      return qb;
    };
    const tp = new SchedulerTaskProvider();
    await tp.loadSchedulableRows(fakeDb, 'u-1');
    expect(captured.table).toBe('tasks_v');
    expect(captured.userScope).toEqual({ col: 'user_id', val: 'u-1' });
    expect(captured.subWhere).toBe(true);
    expect(captured.selected).toBe(true);
  });
});

describe('H6 W2 — P1: timestamp columns must be JS Date (fail-loud)', () => {
  test('InMemoryScheduleRepository.writeChanged rejects a non-Date updated_at', async () => {
    const repo = new InMemoryScheduleRepository();
    await expect(
      repo.writeChanged([{ id: 'x', dbUpdate: { scheduled_at: new Date(), updated_at: '2026-01-01 00:00:00' } }], { userId: 'u-1' })
    ).rejects.toThrow(/P1 violation/);
  });

  test('InMemoryScheduleRepository.writeChanged accepts a JS Date updated_at', async () => {
    const repo = new InMemoryScheduleRepository();
    const res = await repo.writeChanged(
      [{ id: 'x', dbUpdate: { scheduled_at: new Date(), updated_at: new Date() } }],
      { userId: 'u-1' }
    );
    expect(res.written).toBe(1);
  });

  test('KnexScheduleRepository.writeChanged rejects a non-Date scheduled_at (P1 guard)', async () => {
    // db is never reached — the P1 assert throws first.
    const repo = new KnexScheduleRepository({ db: function () {}, clock: { now: () => new Date() } });
    await expect(
      repo.writeChanged([{ id: 'x', dbUpdate: { scheduled_at: 'not-a-date' } }], { userId: 'u-1' })
    ).rejects.toThrow(/P1 violation/);
  });
});

describe('H6 W2 — S5: writeChanged writes ONLY the rows passed (delta, no write-all)', () => {
  test('InMemory: only the delta rows are applied; the audit log matches the delta', async () => {
    const repo = new InMemoryScheduleRepository({
      rows: { keep: { id: 'keep', user_id: 'u-1', scheduled_at: 'old' } }
    });
    const res = await repo.writeChanged([
      { id: 'a', dbUpdate: { scheduled_at: new Date(), updated_at: new Date() } },
      { id: 'b', dbUpdate: { unscheduled: 1, updated_at: new Date() } }
    ], { userId: 'u-1' });
    expect(res.written).toBe(2);
    // The untouched row is not in the write log.
    expect(repo.writes.map(function (w) { return w.id; }).sort()).toEqual(['a', 'b']);
    // The pre-existing row is unchanged (no write-all swept it).
    expect(repo._rows.keep.scheduled_at).toBe('old');
  });

  test('Knex: partitions batched (scheduled_at/dur) vs per-row (flag/status) — no now-builder', async () => {
    // Capture the calls tasksWrite receives; assert no Knex now-builder leaks in.
    const calls = { batched: [], perRow: [] };
    const fakeTasksWrite = {
      updateTasksWhere: function (trx, userId, applyWhere, fields, opts) {
        calls.batched.push({ userId: userId, fields: fields, opts: opts });
        return Promise.resolve();
      },
      updateTaskById: function (trx, id, dbUpdate, userId) {
        calls.perRow.push({ id: id, dbUpdate: dbUpdate, userId: userId });
        return Promise.resolve();
      }
    };
    // trx.raw stub so the CASE builders don't blow up.
    const fakeTrx = function () {};
    fakeTrx.raw = function (sql, bindings) { return { __raw: sql, bindings: bindings }; };

    const repo = new KnexScheduleRepository({
      db: fakeTrx, tasksWrite: fakeTasksWrite, clock: { now: () => new Date() }
    });

    const fixedNow = new Date('2026-06-16T12:00:00Z');
    await repo.writeChanged([
      { id: 'placed', dbUpdate: { scheduled_at: fixedNow, date: '2026-06-16', day: 'Tue', time: '08:00:00', unscheduled: null, updated_at: fixedNow, dur: 30 } },
      { id: 'flagged', dbUpdate: { unscheduled: 1, updated_at: fixedNow } }
    ], { userId: 'u-1' });

    // The placement went through the batched CASE path; the flag-only went per-row.
    expect(calls.batched.length).toBe(1);
    expect(calls.perRow.length).toBe(1);
    expect(calls.perRow[0].id).toBe('flagged');
    expect(calls.batched[0].opts).toEqual({ instanceOnly: true });
    // The batched update's updated_at is a JS Date (from clock.now()), never a builder.
    expect(calls.batched[0].fields.updated_at).toBeInstanceOf(Date);
  });
});

// juggler-anchor-column-cleanup (behavior_contract B5, TRACEABILITY.md): the
// rolling-anchor NULL-backfill repairs pre-feature masters (next_start NULL)
// from computed history, WITHOUT overwriting an anchor that is already set.
// Neither adapter previously had a dedicated test — this closes that gap.
describe('B5 — backfillRollingAnchorIfNull: NULL-only backfill, never overwrites a set anchor', () => {
  test('InMemory: NULL next_start is backfilled to the supplied anchor (1 row written)', async () => {
    const repo = new InMemoryScheduleRepository({
      rows: { 'm-1': { id: 'm-1', user_id: 'u-1', next_start: null } }
    });
    const n = await repo.backfillRollingAnchorIfNull('m-1', 'u-1', '2026-06-10');
    expect(n).toBe(1);
    expect(repo._rows['m-1'].next_start).toBe('2026-06-10');
    expect(repo._rows['m-1'].updated_at).toBeInstanceOf(Date);
  });

  test('InMemory: an ALREADY-SET next_start is left untouched (0 rows written) — the B5 no-overwrite guarantee', async () => {
    const repo = new InMemoryScheduleRepository({
      rows: { 'm-1': { id: 'm-1', user_id: 'u-1', next_start: '2026-05-01' } }
    });
    const n = await repo.backfillRollingAnchorIfNull('m-1', 'u-1', '2026-06-10');
    expect(n).toBe(0);
    // The real anchor value must survive unchanged — a value-swap mutation
    // (dropping the NULL guard) would flip this to '2026-06-10' and fail.
    expect(repo._rows['m-1'].next_start).toBe('2026-05-01');
  });

  test('InMemory: a row belonging to a DIFFERENT user is not backfilled (tenancy scoping)', async () => {
    const repo = new InMemoryScheduleRepository({
      rows: { 'm-1': { id: 'm-1', user_id: 'u-OTHER', next_start: null } }
    });
    const n = await repo.backfillRollingAnchorIfNull('m-1', 'u-1', '2026-06-10');
    expect(n).toBe(0);
    expect(repo._rows['m-1'].next_start).toBeNull();
  });

  test('Knex: scopes the UPDATE with whereNull(next_start) — the mechanism that guarantees no-overwrite', async () => {
    const calls = { where: null, whereNull: null, update: null };
    const qb = {
      where: function (cond) { calls.where = cond; return qb; },
      whereNull: function (col) { calls.whereNull = col; return qb; },
      update: function (fields) { calls.update = fields; return Promise.resolve(1); }
    };
    const fakeDb = function (table) { calls.table = table; return qb; };
    const fixedNow = new Date('2026-06-16T12:00:00Z');
    const repo = new KnexScheduleRepository({ db: fakeDb, clock: { now: () => fixedNow } });

    const result = await repo.backfillRollingAnchorIfNull('m-1', 'u-1', '2026-06-10');

    expect(calls.table).toBe('task_masters');
    expect(calls.where).toEqual({ id: 'm-1', user_id: 'u-1' });
    // This whereNull is the ENTIRE no-overwrite guarantee for the real DB path —
    // a mutation that drops it would let the update run unconditionally.
    expect(calls.whereNull).toBe('next_start');
    expect(calls.update).toEqual({ next_start: '2026-06-10', updated_at: fixedNow });
    expect(result).toBe(1);
  });
});
