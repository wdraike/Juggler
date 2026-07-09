'use strict';

/**
 * Unit tests — src/schemas/route-schemas.js (999.1212 JUG-TEST-ROUTE-SCHEMAS).
 *
 * Pure unit, NO DB. Accept/reject table per exported schema. These are route-edge
 * shape guards (999.1039, defense-in-depth over the facade's authoritative
 * validation) — the tests pin BOTH directions:
 *   - a schema edit that starts REJECTING valid client payloads fails an accept row;
 *   - a schema edit that starts ACCEPTING malformed payloads fails a reject row.
 */

const {
  batchCreateRouteSchema,
  batchUpdateRouteSchema,
  taskStatusRouteSchema,
  projectReorderSchema,
  locationReplaceSchema,
  toolReplaceSchema,
  impersonationStartSchema,
  appleCalConnectSchema,
  appleCalSelectSchema,
  appleCalSelectCalendarsSchema,
  appleCalAutoSyncSchema,
} = require('../../src/schemas/route-schemas');

// Table-driven helper: each row is [label, body, expectSuccess].
function runTable(schema, rows) {
  for (const [label, body, expectSuccess] of rows) {
    test(label, () => {
      const result = schema.safeParse(body);
      if (result.success !== expectSuccess) {
        // Surface zod's reason on unexpected rejects to make failures debuggable.
        const detail = result.success ? '(parsed OK)' : JSON.stringify(result.error.issues);
        throw new Error(`expected success=${expectSuccess}, got ${result.success} ${detail}`);
      }
      expect(result.success).toBe(expectSuccess);
    });
  }
}

const validTask = () => ({ text: 'Write tests', dur: 30, pri: 'P2', notes: 'n', project: 'Work' });

describe('batchCreateRouteSchema', () => {
  runTable(batchCreateRouteSchema, [
    ['accepts one minimal task', { tasks: [{ text: 'a' }] }, true],
    ['accepts a full task patch + unknown keys (passthrough at both levels)', { tasks: [{ ...validTask(), customFlag: 1 }], source: 'mcp' }, true],
    ['accepts 100 tasks (max boundary)', { tasks: Array.from({ length: 100 }, validTask) }, true],
    ['accepts deadline null (nullable)', { tasks: [{ text: 'a', deadline: null }] }, true],
    ['rejects empty tasks array (min 1)', { tasks: [] }, false],
    ['rejects 101 tasks (max 100)', { tasks: Array.from({ length: 101 }, validTask) }, false],
    ['rejects missing tasks key', {}, false],
    ['rejects tasks as object (not array)', { tasks: { text: 'a' } }, false],
    ['rejects dur 0 (min 1)', { tasks: [{ text: 'a', dur: 0 }] }, false],
    ['rejects dur 481 (max 480)', { tasks: [{ text: 'a', dur: 481 }] }, false],
    ['rejects non-integer dur', { tasks: [{ text: 'a', dur: 30.5 }] }, false],
    ['rejects unknown priority P5', { tasks: [{ text: 'a', pri: 'P5' }] }, false],
    ['rejects text over 500 chars', { tasks: [{ text: 'x'.repeat(501) }] }, false],
    ['rejects notes over 10000 chars', { tasks: [{ text: 'a', notes: 'x'.repeat(10001) }] }, false],
    ['rejects recurring as string', { tasks: [{ text: 'a', recurring: 'yes' }] }, false],
  ]);
});

describe('batchUpdateRouteSchema', () => {
  runTable(batchUpdateRouteSchema, [
    ['accepts one update with id', { updates: [{ id: 't1', status: 'done' }] }, true],
    ['accepts 2000 updates (max boundary)', { updates: Array.from({ length: 2000 }, (_, i) => ({ id: `t${i}` })) }, true],
    ['rejects update missing id (required on update, unlike create)', { updates: [{ text: 'a' }] }, false],
    ['rejects empty-string id (min 1)', { updates: [{ id: '' }] }, false],
    ['rejects empty updates array (min 1)', { updates: [] }, false],
    ['rejects 2001 updates (max 2000)', { updates: Array.from({ length: 2001 }, (_, i) => ({ id: `t${i}` })) }, false],
    ['rejects missing updates key', {}, false],
  ]);
});

describe('taskStatusRouteSchema', () => {
  runTable(taskStatusRouteSchema, [
    ["accepts '' (clear status)", { status: '' }, true],
    ["accepts 'wip'", { status: 'wip' }, true],
    ["accepts 'done' with completedAt + direction", { status: 'done', completedAt: '2026-07-09T10:00:00Z', direction: 'fwd' }, true],
    ["accepts 'cancel'", { status: 'cancel' }, true],
    ["accepts 'skip'", { status: 'skip' }, true],
    ["accepts 'pause'", { status: 'pause' }, true],
    ["accepts 'disabled'", { status: 'disabled' }, true],
    ['rejects missing status', {}, false],
    ["rejects unknown status 'bogus'", { status: 'bogus' }, false],
    // Pinned CURRENT behavior: 'missed' is a valid DB task status (see migration
    // 20260509000300) but is system-set, and this route enum deliberately does
    // not let clients set it. If a client-settable 'missed' is ever wanted, this
    // row must be flipped consciously.
    ["rejects 'missed' (system-set status, not client-settable via this route)", { status: 'missed' }, false],
    ['rejects non-string completedAt', { status: 'done', completedAt: 123 }, false],
  ]);
});

describe('projectReorderSchema', () => {
  runTable(projectReorderSchema, [
    ['accepts mixed number/string ids', { ids: [1, '2', 3] }, true],
    ['accepts empty ids array (no min)', { ids: [] }, true],
    ['accepts 500 ids (max boundary)', { ids: Array.from({ length: 500 }, (_, i) => i) }, true],
    ['rejects 501 ids (max 500)', { ids: Array.from({ length: 501 }, (_, i) => i) }, false],
    ['rejects ids as non-array', { ids: 'abc' }, false],
    ['rejects boolean id element', { ids: [true] }, false],
    ['rejects missing ids key', {}, false],
  ]);
});

describe('locationReplaceSchema', () => {
  runTable(locationReplaceSchema, [
    ['accepts { locations: [obj] } wrapper (BUG-999.1221 shape)', { locations: [{ id: 'l1', name: 'Home' }] }, true],
    ['accepts empty locations array (replace-all with none)', { locations: [] }, true],
    ['rejects a BARE array body (must be the object wrapper)', [{ id: 'l1' }], false],
    ['rejects locations as string', { locations: 'Home' }, false],
    ['rejects array element that is not an object', { locations: ['Home'] }, false],
    ['rejects 501 locations (max 500)', { locations: Array.from({ length: 501 }, () => ({})) }, false],
    ['rejects missing locations key', {}, false],
  ]);
});

describe('toolReplaceSchema', () => {
  runTable(toolReplaceSchema, [
    ['accepts { tools: [obj] } wrapper (BUG-999.1221 shape)', { tools: [{ id: 'tool1', name: 'Laptop' }] }, true],
    ['accepts empty tools array', { tools: [] }, true],
    ['rejects a BARE array body', [{ id: 'tool1' }], false],
    ['rejects tools as string', { tools: 'Laptop' }, false],
    ['rejects 501 tools (max 500)', { tools: Array.from({ length: 501 }, () => ({})) }, false],
    ['rejects missing tools key', {}, false],
  ]);
});

describe('impersonationStartSchema (admin-sensitive)', () => {
  runTable(impersonationStartSchema, [
    ['accepts targetUserId alone', { targetUserId: 'u42' }, true],
    ['accepts targetUserId + reason', { targetUserId: 'u42', reason: 'support ticket 991' }, true],
    ['rejects missing targetUserId', { reason: 'x' }, false],
    ['rejects empty targetUserId (min 1)', { targetUserId: '' }, false],
    ['rejects reason over 500 chars', { targetUserId: 'u42', reason: 'x'.repeat(501) }, false],
    ['rejects non-string targetUserId', { targetUserId: 42 }, false],
  ]);
});

describe('appleCalConnectSchema', () => {
  runTable(appleCalConnectSchema, [
    ['accepts username + password', { username: 'user@icloud.com', password: 'app-specific-pass' }, true],
    ['accepts optional serverUrl when a valid URL', { username: 'u', password: 'p', serverUrl: 'https://caldav.icloud.com' }, true],
    ['rejects missing password', { username: 'u' }, false],
    ['rejects missing username', { password: 'p' }, false],
    ['rejects empty username (min 1)', { username: '', password: 'p' }, false],
    ['rejects empty password (min 1)', { username: 'u', password: '' }, false],
    ['rejects username over 200 chars', { username: 'x'.repeat(201), password: 'p' }, false],
    ['rejects password over 200 chars', { username: 'u', password: 'x'.repeat(201) }, false],
    ['rejects serverUrl that is not a URL', { username: 'u', password: 'p', serverUrl: 'not-a-url' }, false],
  ]);
});

describe('appleCalSelectSchema', () => {
  runTable(appleCalSelectSchema, [
    ['accepts a non-empty calendarUrl', { calendarUrl: '/123456/calendars/home/' }, true],
    ['rejects empty calendarUrl (min 1)', { calendarUrl: '' }, false],
    ['rejects missing calendarUrl', {}, false],
    ['rejects calendarUrl over 2000 chars', { calendarUrl: 'x'.repeat(2001) }, false],
  ]);
});

describe('appleCalSelectCalendarsSchema', () => {
  runTable(appleCalSelectCalendarsSchema, [
    ['accepts one calendar object', { calendars: [{ url: '/cal/1', name: 'Home' }] }, true],
    ['rejects empty calendars array (min 1)', { calendars: [] }, false],
    ['rejects missing calendars key', {}, false],
    ['rejects non-object calendar element', { calendars: ['/cal/1'] }, false],
  ]);
});

describe('appleCalAutoSyncSchema', () => {
  runTable(appleCalAutoSyncSchema, [
    ['accepts enabled: true', { enabled: true }, true],
    ['accepts enabled: false', { enabled: false }, true],
    ["rejects enabled: 'true' (string, no coercion)", { enabled: 'true' }, false],
    ['rejects enabled: 1 (number, no coercion)', { enabled: 1 }, false],
    ['rejects missing enabled', {}, false],
  ]);
});

describe('passthrough behavior (route guards must not strip unknown keys)', () => {
  test('taskStatusRouteSchema keeps unknown keys in parsed output', () => {
    const result = taskStatusRouteSchema.safeParse({ status: 'done', clientTag: 'abc' });
    expect(result.success).toBe(true);
    expect(result.data.clientTag).toBe('abc');
  });

  test('projectReorderSchema keeps unknown keys in parsed output', () => {
    const result = projectReorderSchema.safeParse({ ids: [1], origin: 'drag' });
    expect(result.success).toBe(true);
    expect(result.data.origin).toBe('drag');
  });
});
