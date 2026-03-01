#!/usr/bin/env node
/**
 * API test script — exercises every backend endpoint.
 * Usage:  TEST_TOKEN=<jwt> node scripts/test-api.js
 *         or: TEST_TOKEN=<jwt> API_PORT=5002 node scripts/test-api.js
 */

const http = require('http');
const crypto = require('crypto');

const TOKEN = process.env.TEST_TOKEN;
if (!TOKEN) {
  console.error('Set TEST_TOKEN env var (run seed-test-user.js first)');
  process.exit(1);
}

const HOST = process.env.API_HOST || '127.0.0.1';
const PORT = parseInt(process.env.API_PORT || '5002', 10);

let passed = 0;
let failed = 0;
const results = [];

function genId() {
  return 'test_' + crypto.randomBytes(8).toString('hex');
}

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: HOST,
      port: PORT,
      path,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      }
    };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);

    const r = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, json, raw: data });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function assert(name, condition) {
  if (condition) {
    passed++;
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    results.push({ name, ok: false });
    console.log(`  FAIL  ${name}`);
  }
}

async function run() {
  console.log(`\nRunning API tests against ${HOST}:${PORT}\n`);

  // Health endpoints
  {
    const r = await req('GET', '/health/immediate');
    assert('GET /health/immediate returns 200', r.status === 200);
    assert('GET /health/immediate has status ok', r.json?.status === 'ok');
  }
  {
    const r = await req('GET', '/health');
    assert('GET /health returns 200', r.status === 200);
    assert('GET /health has db connected', r.json?.db === 'connected');
  }

  // Auth
  {
    const r = await req('GET', '/api/auth/me');
    assert('GET /api/auth/me returns 200', r.status === 200);
    assert('GET /api/auth/me has user email', !!r.json?.user?.email);
  }

  // Config
  {
    const r = await req('GET', '/api/config');
    assert('GET /api/config returns 200', r.status === 200);
  }

  // Preferences persistence
  {
    const r1 = await req('PUT', '/api/config/preferences', { value: { gridZoom: 80, splitDefault: false, splitMinDefault: 15, schedFloor: 480 } });
    assert('PUT /api/config/preferences returns 200', r1.status === 200);
    const r2 = await req('GET', '/api/config');
    const prefs = r2.json?.preferences;
    assert('Preferences persisted gridZoom=80', prefs?.gridZoom === 80);
    // Reset
    await req('PUT', '/api/config/preferences', { value: { gridZoom: 60, splitDefault: false, splitMinDefault: 15, schedFloor: 480 } });
  }

  // Tasks CRUD
  var taskId = genId();
  {
    const r = await req('POST', '/api/tasks', {
      id: taskId, text: 'Test task from API', dur: 30, pri: 'P2', date: '3/1'
    });
    assert('POST /api/tasks returns 201', r.status === 201);
    assert('POST /api/tasks returns task id', r.json?.task?.id === taskId);
  }
  {
    const r = await req('GET', '/api/tasks');
    assert('GET /api/tasks returns 200', r.status === 200);
    assert('GET /api/tasks returns array', Array.isArray(r.json?.tasks));
  }
  {
    const r = await req('PUT', `/api/tasks/${taskId}`, { text: 'Updated test task' });
    assert('PUT /api/tasks/:id returns 200', r.status === 200);
  }
  {
    const r = await req('PUT', `/api/tasks/${taskId}/status`, { status: 'done' });
    assert('PUT /api/tasks/:id/status returns 200', r.status === 200);
  }
  {
    const r = await req('DELETE', `/api/tasks/${taskId}`);
    assert('DELETE /api/tasks/:id returns 200', r.status === 200);
  }

  // Batch tasks
  var batchId1 = genId(), batchId2 = genId();
  {
    const r = await req('POST', '/api/tasks/batch', {
      tasks: [
        { id: batchId1, text: 'Batch 1', dur: 15, pri: 'P3' },
        { id: batchId2, text: 'Batch 2', dur: 15, pri: 'P3' }
      ]
    });
    assert('POST /api/tasks/batch returns 201', r.status === 201);
    assert('POST /api/tasks/batch created 2', r.json?.created === 2);
  }
  {
    const r = await req('PUT', '/api/tasks/batch', {
      updates: [
        { id: batchId1, pri: 'P1' },
        { id: batchId2, pri: 'P1' }
      ]
    });
    assert('PUT /api/tasks/batch returns 200', r.status === 200);
    assert('PUT /api/tasks/batch updated 2', r.json?.updated === 2);
    // Cleanup
    await req('DELETE', `/api/tasks/${batchId1}`);
    await req('DELETE', `/api/tasks/${batchId2}`);
  }

  // Projects
  let projectId;
  {
    const r = await req('POST', '/api/config/projects', { name: 'Test Project', color: '#FF0000' });
    assert('POST /api/config/projects returns 201', r.status === 201);
    projectId = r.json?.project?.id;
    assert('POST /api/config/projects returns project id', !!projectId);
  }
  if (projectId) {
    const r = await req('DELETE', `/api/config/projects/${projectId}`);
    assert('DELETE /api/config/projects/:id returns 200', r.status === 200);
  }

  // Locations (via data import round-trip since PUT /locations is caught by /:key route)
  {
    const r = await req('GET', '/api/config');
    assert('GET /api/config returns locations', Array.isArray(r.json?.locations));
  }

  // Tools (via data import round-trip since PUT /tools is caught by /:key route)
  {
    const r = await req('GET', '/api/config');
    assert('GET /api/config returns tools', Array.isArray(r.json?.tools));
  }

  // Data export
  {
    const r = await req('GET', '/api/data/export');
    assert('GET /api/data/export returns 200', r.status === 200);
    assert('GET /api/data/export has v7 flag', r.json?.v7 === true);
  }

  // Data import (also exercises locations/tools/projects persistence)
  {
    const r = await req('POST', '/api/data/import', {
      extraTasks: [
        { id: 'import-test-1', text: 'Imported task', dur: 30, pri: 'P3' }
      ],
      statuses: {},
      directions: {},
      locations: [{ id: 'home', name: 'Home', icon: '\uD83C\uDFE0' }],
      tools: [{ id: 'phone', name: 'Phone', icon: '\uD83D\uDCF1' }],
      projects: [{ name: 'ImportedProject', color: '#00FF00' }]
    });
    assert('POST /api/data/import returns 200', r.status === 200);
    assert('POST /api/data/import has projects count', typeof r.json?.counts?.projects === 'number');
    assert('POST /api/data/import has locations count', r.json?.counts?.locations === 1);
    assert('POST /api/data/import has tools count', r.json?.counts?.tools === 1);
  }

  // Verify import persisted
  {
    const r = await req('GET', '/api/data/export');
    assert('Export after import has tasks', r.json?.extraTasks?.length >= 1);
    assert('Export after import has locations', r.json?.locations?.length >= 1);
    assert('Export after import has tools', r.json?.tools?.length >= 1);
  }

  // Google Calendar endpoints
  {
    const r = await req('GET', '/api/gcal/status');
    assert('GET /api/gcal/status returns 200', r.status === 200);
    assert('GET /api/gcal/status has connected field', typeof r.json?.connected === 'boolean');
  }
  {
    const r = await req('GET', '/api/gcal/connect');
    assert('GET /api/gcal/connect returns 200', r.status === 200);
    assert('GET /api/gcal/connect has authUrl with google', r.json?.authUrl?.includes('accounts.google.com'));
  }
  {
    const r = await req('POST', '/api/gcal/disconnect');
    assert('POST /api/gcal/disconnect returns 200', r.status === 200);
    assert('POST /api/gcal/disconnect returns disconnected', r.json?.disconnected === true);
  }
  {
    // Push/pull should return 400 when not connected (no tokens)
    const r = await req('POST', '/api/gcal/push', { from: '2026-03-01', to: '2026-03-07' });
    assert('POST /api/gcal/push returns 400 when not connected', r.status === 400);
  }
  {
    const r = await req('POST', '/api/gcal/pull', { from: '2026-03-01', to: '2026-03-07' });
    assert('POST /api/gcal/pull returns 400 when not connected', r.status === 400);
  }

  // Summary
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${'='.repeat(40)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
