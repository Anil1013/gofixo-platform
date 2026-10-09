const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const keyFile = path.join(__dirname, '..', '.vapid-keys.json');
const subject = process.env.VAPID_SUBJECT || 'mailto:admin@gofixo.mob13r.com';

function loadOrCreateKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    };
  }

  try {
    if (fs.existsSync(keyFile)) {
      const saved = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
      if (saved.publicKey && saved.privateKey) return saved;
    }
  } catch (err) {
    console.error('Could not read VAPID key file:', err.message);
  }

  const generated = webpush.generateVAPIDKeys();
  try {
    fs.writeFileSync(keyFile, JSON.stringify(generated), { mode: 0o600, flag: 'wx' });
  } catch (err) {
    // Another process may have created it concurrently.
    if (err.code !== 'EEXIST') throw err;
  }
  if (fs.existsSync(keyFile)) {
    try {
      return JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    } catch {
      return generated;
    }
  }
  return generated;
}

const keys = loadOrCreateKeys();
webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);

async function sendProviderPush(subscription, payload) {
  if (!subscription) return false;
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 35 });
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      return { expired: true };
    }
    console.error('Provider push error:', err.message);
    return false;
  }
}

module.exports = {
  sendProviderPush,
  getVapidPublicKey: () => keys.publicKey,
};
