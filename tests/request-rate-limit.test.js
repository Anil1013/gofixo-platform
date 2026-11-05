const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimiter } = require('../utils/requestRateLimit');

function invoke(middleware, ip) {
  let nextCalled = false;
  let statusCode = 200;
  const headers = {};
  const responseBody = {};
  const res = {
    set(name, value) { headers[name] = value; return this; },
    status(code) { statusCode = code; return this; },
    json(body) { Object.assign(responseBody, body); return this; },
  };
  middleware({ ip }, res, () => { nextCalled = true; });
  return { nextCalled, statusCode, headers, body: responseBody };
}

test('rate limiter allows the configured number of requests and then returns 429', () => {
  const limit = createRateLimiter({ windowMs: 60000, maxRequests: 2, now: () => 1000 });
  assert.equal(invoke(limit, '10.0.0.1').nextCalled, true);
  assert.equal(invoke(limit, '10.0.0.1').nextCalled, true);
  const blocked = invoke(limit, '10.0.0.1');
  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.headers['Retry-After'], '60');
});

test('rate limiter isolates clients and resets an expired window', () => {
  let clock = 1000;
  const limit = createRateLimiter({ windowMs: 1000, maxRequests: 1, now: () => clock });
  assert.equal(invoke(limit, '10.0.0.1').nextCalled, true);
  assert.equal(invoke(limit, '10.0.0.2').nextCalled, true);
  assert.equal(invoke(limit, '10.0.0.1').statusCode, 429);
  clock = 2001;
  assert.equal(invoke(limit, '10.0.0.1').nextCalled, true);
});
