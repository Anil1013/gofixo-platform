const WINDOW_MS = 15 * 60 * 1000;
const MAX_BY_IP = 20;
const MAX_BY_ACCOUNT = 5;

const attempts = new Map();

function keyFor(kind, value) {
  return `${kind}:${String(value || '').trim().toLowerCase()}`;
}

function getEntry(key, now) {
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    const fresh = { count: 0, resetAt: now + WINDOW_MS };
    attempts.set(key, fresh);
    return fresh;
  }
  return current;
}

function checkLoginRateLimit(ip, role, phone) {
  const now = Date.now();
  const keys = [
    [keyFor('ip', ip), MAX_BY_IP],
    [keyFor('account', `${role}:${phone}`), MAX_BY_ACCOUNT],
  ];

  for (const [key, limit] of keys) {
    const entry = getEntry(key, now);
    if (entry.count >= limit) {
      return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    }
  }
  return 0;
}

function recordFailedLogin(ip, role, phone) {
  const now = Date.now();
  for (const key of [
    keyFor('ip', ip),
    keyFor('account', `${role}:${phone}`),
  ]) {
    const entry = getEntry(key, now);
    entry.count += 1;
  }
}

function clearLoginFailures(ip, role, phone) {
  attempts.delete(keyFor('account', `${role}:${phone}`));
}

module.exports = { checkLoginRateLimit, recordFailedLogin, clearLoginFailures };