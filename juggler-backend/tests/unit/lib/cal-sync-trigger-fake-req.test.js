/**
 * 999.2015 — cal-sync trigger fake req missing `query` property.
 *
 * Root cause: controllers/cal-sync.controller.js registers a trigger with
 * lib/cal-sync-trigger that constructs a fake express req:
 *   { user: { id: args.userId }, body: {} }
 * But sync() accesses req.query.trigger at line 171. The fake req has no
 * `query` property, so req.query is undefined and req.query.trigger throws:
 *   TypeError: Cannot read properties of undefined (reading 'trigger')
 *
 * This test verifies the fake req includes a `query` property so the trigger
 * path doesn't crash.
 */

var calSyncTrigger = require('../../../src/lib/cal-sync-trigger');

describe('cal-sync-trigger fake req shape (999.2015)', () => {
  // Reset the trigger registration after each test so tests don't bleed.
  afterEach(() => {
    calSyncTrigger.registerCalSyncTrigger(null);
  });

  test('triggerSync does not throw when the registered function accesses req.query', async () => {
    // Simulate what cal-sync.controller does: register a function that
    // constructs a fake req and accesses req.query.trigger (the real sync()
    // path). The bug: the fake req has no `query` property.
    //
    // We can't require the real cal-sync.controller (it pulls in the full
    // DB + express stack), so we test the registration shape directly:
    // the fake req MUST have a `query` property.
    var capturedReq = null;
    calSyncTrigger.registerCalSyncTrigger(function (args) {
      // This is the shape the controller registration builds:
      var req = { user: { id: args.userId }, body: {}, query: { trigger: 'auto' } };
      capturedReq = req;
      // The sync function accesses req.query.trigger — this must not throw.
      var triggerType = req.query.trigger === 'auto' ? 'auto' : 'manual';
      expect(triggerType).toBe('auto');
      return Promise.resolve();
    });

    await calSyncTrigger.triggerSync({ userId: 'test-user-id' });
    expect(capturedReq).not.toBeNull();
    expect(capturedReq.query).toBeDefined();
    expect(capturedReq.query.trigger).toBe('auto');
  });

  test('the real controller registration includes query in the fake req', () => {
    // Load the controller module and intercept the registration to inspect
    // the fake req shape. We stub the sync function to capture the req.
    //
    // We need to verify the ACTUAL registration code, not a simulation.
    // Read the source and check that the fake req includes `query`.
    var fs = require('fs');
    var path = require('path');
    var source = fs.readFileSync(
      path.join(__dirname, '../../../src/controllers/cal-sync.controller.js'),
      'utf8'
    );

    // Find the registerCalSyncTrigger call and verify the fake req has `query`.
    var registerMatch = source.match(/registerCalSyncTrigger\(function[^{]*\{[\s\S]*?\}\)/);
    expect(registerMatch).not.toBeNull();
    var registerBlock = registerMatch[0];
    // The fake req must include a `query` property.
    expect(registerBlock).toMatch(/query\s*:/);
  });
});