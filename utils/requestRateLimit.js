function createRateLimiter({ windowMs, maxRequests, keyPrefix = 'api', now = Date.now, maxEntries = 10000 }) {
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error('windowMs must be positive');
  if (!Number.isInteger(maxRequests) || maxRequests <= 0) throw new Error('maxRequests must be a positive integer');
  const entries = new Map();

  return function rateLimit(req, res, next) {
    const timestamp = now();
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const key = keyPrefix + ':' + ip;
    let entry = entries.get(key);

    if (!entry || entry.resetAt <= timestamp) {
      entry = { count: 0, resetAt: timestamp + windowMs };
    }
    entry.count += 1;
    entries.set(key, entry);

    if (entries.size > maxEntries) {
      for (const [entryKey, value] of entries) {
        if (value.resetAt <= timestamp) entries.delete(entryKey);
      }
      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey === undefined) break;
        entries.delete(oldestKey);
      }
    }

    if (entry.count > maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - timestamp) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many requests. Please wait and try again.' });
    }
    return next();
  };
}

module.exports = { createRateLimiter };
