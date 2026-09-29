const webpush = require('web-push');

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT || 'mailto:admin@gofixo.mob13r.com';

let configured = false;
if (publicKey && privateKey) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

async function sendProviderPush(subscription, payload) {
  if (!configured || !subscription) return false;
  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify(payload),
      { TTL: 35 }
    );
    return true;
  } catch (err) {
    // 404/410 means the browser subscription is no longer valid.
    if (err.statusCode === 404 || err.statusCode === 410) {
      return { expired: true };
    }
    console.error('Provider push error:', err.message);
    return false;
  }
}

module.exports = {
  sendProviderPush,
  getVapidPublicKey: () => publicKey || null,
};
