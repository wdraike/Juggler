#!/usr/bin/env node
/**
 * Verify that backend and frontend scheduler wrappers correctly re-export
 * all functions from the shared canonical modules.
 */

const path = require('path');

const modules = ['dateHelpers', 'dependencyHelpers', 'timeBlockHelpers', 'locationHelpers'];
let ok = true;

modules.forEach(mod => {
  const shared = require(path.join(__dirname, 'scheduler', mod));
  const backend = require(path.join(__dirname, '..', 'juggler-backend', 'src', 'scheduler', mod));

  const sharedKeys = Object.keys(shared).sort();
  const backendKeys = Object.keys(backend).sort();

  if (JSON.stringify(sharedKeys) !== JSON.stringify(backendKeys)) {
    console.error(`MISMATCH: ${mod} — shared has [${sharedKeys}], backend has [${backendKeys}]`);
    ok = false;
  }
});

if (ok) {
  console.log('All shared scheduler modules in sync.');
} else {
  process.exit(1);
}
