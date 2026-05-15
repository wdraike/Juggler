/**
 * Unit tests for safeStringify (src/mcp/safeStringify.js)
 *
 * Source: src/mcp/safeStringify.js
 *
 * safeStringify(value, indent?) — drop-in for JSON.stringify that handles
 * circular references via a WeakSet sentinel (replaces with '[Circular]').
 *
 * Export shape: module.exports = safeStringify (direct function, not named export).
 *
 * IMPORTANT: The replacer function checks `typeof val === 'object'` for
 * circular tracking. BigInt has typeof 'bigint' (not 'object'), so it falls
 * through to the native JSON.stringify serializer which DOES throw for BigInt.
 * This is the actual documented behavior — tests reflect it accurately.
 *
 * Default indent is 2 (the module sets `indent != null ? indent : 2`), so
 * plain-object output is pretty-printed unless indent=0 or a specific value
 * is passed. Tests that compare exact strings use indent=0 to get compact output.
 */

const safeStringify = require('../../src/mcp/safeStringify');

describe('safeStringify', () => {
  // ── Plain object ──────────────────────────────────────────────────────────
  test('serializes a plain object to a valid JSON string', () => {
    const result = safeStringify({ a: 1, b: 'hello' }, 0);
    expect(typeof result).toBe('string');
    const parsed = JSON.parse(result);
    expect(parsed.a).toBe(1);
    expect(parsed.b).toBe('hello');
  });

  test('default output is pretty-printed (indent=2)', () => {
    const result = safeStringify({ x: 1 });
    // With indent=2, the output will contain newlines/spaces
    expect(result).toContain('\n');
  });

  test('serializes nested objects correctly', () => {
    const obj = { outer: { inner: 42 } };
    const result = safeStringify(obj, 0);
    expect(JSON.parse(result)).toEqual(obj);
  });

  // ── Circular reference ────────────────────────────────────────────────────
  test('does NOT throw on a circular reference', () => {
    const obj = {};
    obj.self = obj;
    expect(() => safeStringify(obj)).not.toThrow();
  });

  test('circular reference is replaced with the string "[Circular]"', () => {
    const obj = {};
    obj.self = obj;
    const result = safeStringify(obj, 0);
    expect(typeof result).toBe('string');
    expect(result).toContain('[Circular]');
  });

  test('non-circular nested objects are NOT marked as circular', () => {
    const obj = { a: { x: 1 }, b: { y: 2 } };
    const result = safeStringify(obj, 0);
    expect(result).not.toContain('[Circular]');
    expect(JSON.parse(result)).toEqual(obj);
  });

  // ── BigInt (actual behavior: throws) ──────────────────────────────────────
  // The replacer only tracks objects (typeof 'object'). BigInt (typeof 'bigint')
  // is not intercepted and causes the underlying JSON.stringify to throw.
  test('BigInt inside an object DOES throw (native JSON limitation not worked around)', () => {
    expect(() => safeStringify({ n: BigInt(9007199254740993) })).toThrow();
  });

  // ── Undefined fields ──────────────────────────────────────────────────────
  // Standard JSON.stringify behavior: undefined values are omitted from objects.
  test('undefined field values are omitted from the output (standard JSON behavior)', () => {
    const result = safeStringify({ a: 1, b: undefined }, 0);
    const parsed = JSON.parse(result);
    expect(parsed.a).toBe(1);
    expect('b' in parsed).toBe(false);
    expect(result).not.toContain('"b"');
  });

  // ── Arrays ────────────────────────────────────────────────────────────────
  test('serializes a plain array', () => {
    const result = safeStringify([1, 2, 3], 0);
    expect(JSON.parse(result)).toEqual([1, 2, 3]);
  });

  // ── Primitive values ──────────────────────────────────────────────────────
  test('serializes a string value directly', () => {
    const result = safeStringify('hello world', 0);
    expect(result).toBe('"hello world"');
  });

  test('serializes null', () => {
    const result = safeStringify(null, 0);
    expect(result).toBe('null');
  });
});
