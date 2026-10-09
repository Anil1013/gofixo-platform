const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const subscriptions = new Map(); // bookingId -> Set<WebSocket>
const sockets = new Map(); // WebSocket -> { id, role }

function removeSocket(ws) {
  for (const set of subscriptions.values()) set.delete(ws);
  for (const [bookingId, set] of subscriptions.entries()) {
    if (set.size === 0) subscriptions.delete(bookingId);
  }
  sockets.delete(ws);
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

async function authorizeBooking(user, bookingId) {
  const result = await pool.query(
    `SELECT id, customer_id, provider_id, status
     FROM bookings
     WHERE id = $1`,
    [bookingId]
  );
  if (result.rows.length === 0) return null;
  const booking = result.rows[0];

  if (user.role === 'customer' && booking.customer_id !== user.id) return null;
  if (user.role === 'provider' && booking.provider_id !== user.id) return null;
  if (['completed', 'cancelled', 'no_provider'].includes(booking.status)) return null;

  return booking;
}

function subscribe(ws, bookingId) {
  const id = Number(bookingId);
  if (!Number.isInteger(id) || id <= 0) return;
  let set = subscriptions.get(id);
  if (!set) {
    set = new Set();
    subscriptions.set(id, set);
  }
  set.add(ws);
  ws.subscriptions = ws.subscriptions || new Set();
  ws.subscriptions.add(id);
}

function unsubscribe(ws, bookingId) {
  const id = Number(bookingId);
  const set = subscriptions.get(id);
  if (set) {
    set.delete(ws);
    if (set.size === 0) subscriptions.delete(id);
  }
  if (ws.subscriptions) ws.subscriptions.delete(id);
}

function broadcastBooking(bookingId, payload) {
  const set = subscriptions.get(Number(bookingId));
  if (!set) return;
  for (const ws of set) send(ws, payload);
}

async function broadcastProviderLocation(providerId, lat, lng, updatedAt) {
  const result = await pool.query(
    `SELECT id
     FROM bookings
     WHERE provider_id = $1
       AND status IN ('accepted', 'ongoing')`,
    [providerId]
  );

  for (const row of result.rows) {
    broadcastBooking(row.id, {
      type: 'provider_location',
      booking_id: row.id,
      lat: Number(lat),
      lng: Number(lng),
      updated_at: updatedAt,
    });
  }
}

function attachRealtime(server) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }

    if (url.pathname !== '/api/realtime') {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get('token');
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\\r\\n\\r\\n');
      socket.destroy();
      return;
    }

    let user;
    try {
      user = jwt.verify(token, process.env.JWT_SECRET);
      if (!Number.isInteger(user.id) || !['customer', 'provider'].includes(user.role)) {
        throw new Error('Invalid realtime token');
      }
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\\r\\n\\r\\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, user);
    });
  });

  wss.on('connection', (ws, user) => {
    sockets.set(ws, user);
    ws.subscriptions = new Set();

    send(ws, { type: 'connected', role: user.role });

    ws.on('message', async (raw) => {
      try {
        const message = JSON.parse(raw.toString());

        if (message.type === 'subscribe_booking') {
          const booking = await authorizeBooking(user, message.booking_id);
          if (!booking) {
            send(ws, { type: 'error', error: 'Booking not available for realtime tracking' });
            return;
          }
          subscribe(ws, booking.id);
          send(ws, { type: 'subscribed', booking_id: booking.id });
          return;
        }

        if (message.type === 'unsubscribe_booking') {
          unsubscribe(ws, message.booking_id);
        }
      } catch {
        send(ws, { type: 'error', error: 'Invalid realtime message' });
      }
    });

    ws.on('close', () => removeSocket(ws));
    ws.on('error', () => removeSocket(ws));
  });

  return wss;
}

module.exports = {
  attachRealtime,
  broadcastProviderLocation,
};
