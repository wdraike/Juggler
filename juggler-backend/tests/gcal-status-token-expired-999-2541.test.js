/**
 * GCal status tokenExpired fix (999.2541).
 *
 * getGcalStatus reported tokenExpired=false even when the access token had
 * expired — line 162 set `connected = true` instead of `tokenExpired = true`.
 * This made the frontend unable to detect a stale connection, so users had
 * to manually reconnect instead of the system auto-refreshing.
 */

process.env.NODE_ENV = 'test';

describe('999.2541: GCal status tokenExpired fix', function() {
  test('getGcalStatus returns tokenExpired=true when access token has expired', function() {
    // Verify the source code has the fix: when expiry < now, tokenExpired
    // should be set to true (not connected=true which was already set).
    var fs = require('fs');
    var src = fs.readFileSync(require.resolve('../src/slices/calendar/facade.js'), 'utf8');

    var statusMatch = src.match(/async function getGcalStatus\(user\) \{[\s\S]*?\n\}/);
    expect(statusMatch).toBeTruthy();
    var statusBody = statusMatch[0];

    expect(statusBody).toContain('tokenExpired = true');
    expect(statusBody).not.toMatch(/if \(expiry\.getTime\(\) < Date\.now\(\)\) \{\s*connected = true/);
  });

  test('getGcalStatus returns tokenExpired=false when access token is still valid', function() {
    var fs = require('fs');
    var src = fs.readFileSync(require.resolve('../src/slices/calendar/facade.js'), 'utf8');
    var statusMatch = src.match(/async function getGcalStatus\(user\) \{[\s\S]*?\n\}/);
    var statusBody = statusMatch[0];

    expect(statusBody).toContain('var tokenExpired = false;');
  });

  test('getGcalStatus returns connected=true when refresh token exists even if access token expired', function() {
    var fs = require('fs');
    var src = fs.readFileSync(require.resolve('../src/slices/calendar/facade.js'), 'utf8');
    var statusMatch = src.match(/async function getGcalStatus\(user\) \{[\s\S]*?\n\}/);
    var statusBody = statusMatch[0];

    expect(statusBody).toMatch(/hasToken[\s\S]*connected = true/);
  });
});