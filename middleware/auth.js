const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// Verifies a JWT and attaches { id, role, type } to req.user
function requireAuth(allowedRoles = []) {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    const token = header.split(' ')[1];
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (allowedRoles.length && !allowedRoles.includes(payload.role)) {
        return res.status(403).json({ error: 'Not authorized for this action' });
      }
      const table = payload.role === 'customer' ? 'customers' : payload.role === 'provider' ? 'service_providers' : null;
      if (!table || !Number.isInteger(payload.id)) return res.status(401).json({ error: 'Invalid or expired token' });
      // Compare the password-change timestamp inside PostgreSQL so a TIMESTAMP
      // value is not re-interpreted using the Node process timezone.
      const account = await pool.query(
        `SELECT FLOOR(EXTRACT(EPOCH FROM password_changed_at)) > $2 AS password_changed
         FROM ${table}
         WHERE id = $1`,
        [payload.id, payload.iat || 0]
      );
      if (account.rows.length === 0) return res.status(401).json({ error: 'Invalid or expired token' });
      if (account.rows[0].password_changed) {
        return res.status(401).json({ error: 'Session expired — please log in again' });
      }
      req.user = payload;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

module.exports = { requireAuth };
