const crypto = require('crypto');

const failedAttempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 10;
const MAX_TRACKED_IPS = 10000;

function requireAdmin(req, res, next) {
  const now = Date.now();
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
  let entry = failedAttempts.get(ip);

  if (entry && entry.resetAt <= now) {
    failedAttempts.delete(ip);
    entry = null;
  }
  if (entry && entry.count >= MAX_FAILED_ATTEMPTS) {
    res.set('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
    return res.status(429).json({ error: 'Too many invalid admin key attempts. Please wait and try again.' });
  }

  const expected = Buffer.from(String(process.env.ADMIN_SECRET || ''), 'utf8');
  const supplied = Buffer.from(String(req.headers['x-admin-key'] || ''), 'utf8');
  const valid = expected.length > 0 &&
    supplied.length === expected.length &&
    crypto.timingSafeEqual(supplied, expected);

  if (!valid) {
    if (!entry) entry = { count: 0, resetAt: now + WINDOW_MS };
    entry.count += 1;
    failedAttempts.set(ip, entry);
    if (failedAttempts.size > MAX_TRACKED_IPS) {
      for (const [key, value] of failedAttempts) {
        if (value.resetAt <= now) failedAttempts.delete(key);
      }
      while (failedAttempts.size > MAX_TRACKED_IPS) {
        const oldest = failedAttempts.keys().next().value;
        if (oldest === undefined) break;
        failedAttempts.delete(oldest);
      }
    }
    return res.status(401).json({ error: 'Invalid admin key' });
  }

  failedAttempts.delete(ip);
  return next();
}

module.exports = { requireAdmin };
