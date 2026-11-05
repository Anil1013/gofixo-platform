const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_SECRET = 'TestAdminSecret123';
const { requireAdmin } = require('../middleware/admin');

function invoke(ip, key) {
  let nextCalled = false;
  let statusCode = 200;
  const headers = {};
  const body = {};
  const req = { ip, headers: key === undefined ? {} : { 'x-admin-key': key } };
  const res = {
    set(name, value) { headers[name] = value; return this; },
    status(code) { statusCode = code; return this; },
    json(value) { Object.assign(body, value); return this; },
  };
  requireAdmin(req, res, () => { nextCalled = true; });
  return { nextCalled, statusCode, headers, body };
}

test('admin middleware accepts the configured key and rejects invalid keys', () => {
  assert.equal(invoke('192.0.2.1', 'TestAdminSecret123').nextCalled, true);
  assert.equal(invoke('192.0.2.2', 'wrong').statusCode, 401);
});

test('admin middleware blocks repeated invalid keys per IP', () => {
  const ip = '192.0.2.99';
  for (let i = 0; i < 10; i++) assert.equal(invoke(ip, 'wrong').statusCode, 401);
  const blocked = invoke(ip, 'TestAdminSecret123');
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.nextCalled, false);
});
