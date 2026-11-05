const WINDOW_MS = 15 * 60 * 1000;
const MAX_BY_IP = 20;
const MAX_BY_ACCOUNT = 5;

const attempts = new Map();
const MAX_TRACKED_KEYS = 20000;

function pruneAttempts(now) {
  if (attempts.size < MAX_TRACKED_KEYS) return;
  for (const [key, value] of attempts) {
    if (value.resetAt <= now) attempts.delete(key);
  }
  while (attempts.size > MAX_TRACKED_KEYS) {
    const oldest = attempts.keys().next().value;
    if (oldest === undefined) break;
    attempts.delete(oldest);
  }
}

function keyFor(kind, value) {
  return `${kind}:${String(value || '').trim().toLowerCase()}`;
}

function getEntry(key, now) {
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    pruneAttempts(now);
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
  // Clear the account bucket after a successful login but keep the IP bucket
  // so a successful login cannot erase unrelated attempts from the same IP.
  attempts.delete(keyFor('account', `${role}:${phone}`));
}

module.exports = { checkLoginRateLimit, recordFailedLogin, clearLoginFailures };