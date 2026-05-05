'use strict';

const { validate } = require('../../src/middleware/validate');
const { taskCreateSchema, taskUpdateSchema } = require('../../src/schemas/task.schema');
const { projectSchema, projectUpdateSchema } = require('../../src/schemas/project.schema');
const { preferencesSchema } = require('../../src/schemas/config.schema');

function makeRes() {
  const res = {};
  res.status = (code) => { res._code = code; return { json: (body) => { res._body = body; } }; };
  return res;
}

describe('validate middleware', () => {
  it('passes a valid task create body', () => {
    const req = { body: { text: 'Write tests', dur: 30, pri: 'P2' } };
    const res = makeRes();
    let called = false;
    validate(taskCreateSchema)(req, res, () => { called = true; });
    expect(called).toBe(true);
  });

  it('applies defaults (pri defaults to P3)', () => {
    const req = { body: { text: 'Do something' } };
    const res = makeRes();
    validate(taskCreateSchema)(req, res, () => {});
    expect(req.body.pri).toBe('P3');
  });

  it('rejects empty text field', () => {
    const req = { body: { text: '' } };
    const res = makeRes();
    validate(taskCreateSchema)(req, res, () => {});
    expect(res._code).toBe(400);
    expect(res._body.error).toBe('Validation failed');
  });

  it('rejects invalid pri value', () => {
    const req = { body: { text: 'Task', pri: 'P9' } };
    const res = makeRes();
    validate(taskCreateSchema)(req, res, () => {});
    expect(res._code).toBe(400);
  });

  it('rejects text over 500 chars', () => {
    const req = { body: { text: 'x'.repeat(501) } };
    const res = makeRes();
    validate(taskCreateSchema)(req, res, () => {});
    expect(res._code).toBe(400);
  });

  it('rejects dur below minimum (5)', () => {
    const req = { body: { text: 'Quick task', dur: 3 } };
    const res = makeRes();
    validate(taskCreateSchema)(req, res, () => {});
    expect(res._code).toBe(400);
  });

  it('accepts taskUpdateSchema with partial fields', () => {
    const req = { body: { status: 'done' } };
    const res = makeRes();
    let called = false;
    validate(taskUpdateSchema)(req, res, () => { called = true; });
    expect(called).toBe(true);
  });

  it('rejects taskUpdateSchema with invalid status', () => {
    const req = { body: { status: 'invalid' } };
    const res = makeRes();
    validate(taskUpdateSchema)(req, res, () => {});
    expect(res._code).toBe(400);
  });

  it('rejects taskUpdateSchema with bad date format', () => {
    const req = { body: { date: '05-05-2026' } };
    const res = makeRes();
    validate(taskUpdateSchema)(req, res, () => {});
    expect(res._code).toBe(400);
  });
});

describe('project schema', () => {
  it('passes a valid project', () => {
    const req = { body: { name: 'My Project', color: '#ff0000' } };
    const res = makeRes();
    let called = false;
    validate(projectSchema)(req, res, () => { called = true; });
    expect(called).toBe(true);
  });

  it('rejects project with empty name', () => {
    const req = { body: { name: '' } };
    const res = makeRes();
    validate(projectSchema)(req, res, () => {});
    expect(res._code).toBe(400);
  });

  it('rejects project with invalid color format', () => {
    const req = { body: { name: 'Test', color: 'red' } };
    const res = makeRes();
    validate(projectSchema)(req, res, () => {});
    expect(res._code).toBe(400);
  });

  it('accepts partial update with no name (projectUpdateSchema)', () => {
    const req = { body: { color: '#abc' } };
    const res = makeRes();
    let called = false;
    validate(projectUpdateSchema)(req, res, () => { called = true; });
    expect(called).toBe(true);
  });
});

describe('preferences schema', () => {
  it('passes valid preferences', () => {
    const req = { body: { temperatureUnit: 'C', weekStartsOn: 1 } };
    const res = makeRes();
    let called = false;
    validate(preferencesSchema)(req, res, () => { called = true; });
    expect(called).toBe(true);
  });

  it('rejects invalid temperatureUnit', () => {
    const req = { body: { temperatureUnit: 'K' } };
    const res = makeRes();
    validate(preferencesSchema)(req, res, () => {});
    expect(res._code).toBe(400);
  });

  it('passes through unknown prefs keys (passthrough)', () => {
    const req = { body: { someNewPref: true } };
    const res = makeRes();
    let called = false;
    validate(preferencesSchema)(req, res, () => { called = true; });
    expect(called).toBe(true);
  });
});
