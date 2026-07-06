#!/usr/bin/env node
/**
 * Verify that backend and frontend scheduler wrappers correctly re-export
 * all functions from the shared canonical modules.
 */

const path = require('path');

const schedulerModules = ['dateHelpers', 'dependencyHelpers', 'timeBlockHelpers', 'locationHelpers'];
const modules = [
  ...schedulerModules.map(mod => ({
    name: mod,
    shared: path.join(__dirname, 'scheduler', mod),
    backend: path.join(__dirname, '..', 'juggler-backend', 'src', 'scheduler', mod),
  })),
  {
    name: 'task-status',
    shared: path.join(__dirname, 'task-status'),
    backend: path.join(__dirname, '..', 'juggler-backend', 'src', 'lib', 'task-status'),
  },
  {
    name: 'proxy-config',
    shared: path.join(__dirname, 'proxy-config'),
    backend: path.join(__dirname, '..', 'juggler-backend', 'src', 'proxy-config'),
  },
];
let ok = true;

modules.forEach(({ name, shared: sharedPath, backend: backendPath }) => {
  const shared = require(sharedPath);
  const backend = require(backendPath);

  const sharedKeys = Object.keys(shared).sort();
  const backendKeys = Object.keys(backend).sort();

  if (JSON.stringify(sharedKeys) !== JSON.stringify(backendKeys)) {
    console.error(`MISMATCH: ${name} — shared has [${sharedKeys}], backend has [${backendKeys}]`);
    ok = false;
  }
});

if (ok) {
  console.log('All shared modules in sync.');
} else {
  process.exit(1);
}
