/**
 * JSON.stringify that silently replaces circular references instead of throwing.
 * Drop-in replacement for JSON.stringify(value, null, 2) in MCP tool responses.
 */
function safeStringify(value, indent) {
  var seen = new WeakSet();
  return JSON.stringify(value, function(_key, val) {
    if (val !== null && typeof val === 'object') {
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
    }
    return val;
  }, indent != null ? indent : 2);
}

module.exports = safeStringify;
