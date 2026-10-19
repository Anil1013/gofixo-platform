const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const keyFile = path.join(__dirname, '..', '.vapid-keys.json');
const subject = process.env.VAPID_SUBJECT || 'mailto:admin@gofixo.mob13r.com';
let firebaseAdmin = null;
let firebaseInitAttempted = false;

function loadOrCreateKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  try {
    if (fs.existsSync(keyFile)) {
      const saved = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
      if (saved.publicKey && saved.privateKey) return saved;
    }
  } catch (err) { console.error('Could not read VAPID key file:', err.message); }
  const generated = webpush.generateVAPIDKeys();
  try { fs.writeFileSync(keyFile, JSON.stringify(generated), { mode: 0o600, flag: 'wx' }); }
  catch (err) { if (err.code !== 'EEXIST') throw err; }
  if (fs.existsSync(keyFile)) {
    try { return JSON.parse(fs.readFileSync(keyFile, 'utf8')); } catch { return generated; }
  }
  return generated;
}

const keys = loadOrCreateKeys();
webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);

function getFirebaseAdmin() {
  if (firebaseAdmin) return firebaseAdmin;
  if (firebaseInitAttempted) return null;
  firebaseInitAttempted = true;
  try {
    const admin = require('firebase-admin');
    if (admin.apps.length) firebaseAdmin = admin;
    else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: 'gofixo' });
      firebaseAdmin = admin;
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'gofixo' });
      firebaseAdmin = admin;
    } else {
      console.warn('FCM is not configured: set FIREBASE_SERVICE_ACCOUNT_JSON in backend secrets.');
    }
  } catch (err) {
    console.error('Firebase Admin initialization failed:', err.message);
  }
  return firebaseAdmin;
}

async function sendProviderFcm(token, payload, { cancelled = false } = {}) {
  if (!token) return false;
  const admin = getFirebaseAdmin();
  if (!admin) return false;
  const bookingId = String(payload.booking_id || '');
  const tag = `gofixo-booking-${bookingId}`;
  const message = {
    token,
    data: Object.fromEntries(Object.entries({ ...payload, type: cancelled ? 'booking_cancelled' : 'booking_request' }).map(([k, v]) => [k, String(v ?? '')])),
    android: {
      priority: 'high',
      notification: {
        channelId: 'gofixo_requests',
        tag,
        ...(cancelled ? {} : { sound: 'default' }),
      },
    },
    apns: {
      headers: { 'apns-priority': cancelled ? '5' : '10' },
      payload: { aps: cancelled ? { 'content-available': 1 } : { sound: 'default' } },
    },
    notification: {
      title: cancelled ? 'Gofixo — Request taken' : (payload.title || 'Gofixo — New service request'),
      body: cancelled ? 'Another partner accepted this request.' : (payload.body || 'A new nearby request is available.'),
    },
  };
  try {
    await admin.messaging().send(message);
    return true;
  } catch (err) {
    if (err.code === 'messaging/registration-token-not-registered' || err.code === 'messaging/invalid-registration-token') return { expired: true };
    console.error('Provider FCM error:', err.message);
    return false;
  }
}

async function sendProviderPush(subscription, payload) {
  if (!subscription) return false;
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 35 });
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) return { expired: true };
    console.error('Provider web push error:', err.message);
    return false;
  }
}

module.exports = {
  sendProviderPush,
  sendProviderFcm,
  getVapidPublicKey: () => keys.publicKey,
};
