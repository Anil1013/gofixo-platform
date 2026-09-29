const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// Verifies a JWT and attaches { id, role, type } to req.user
function requireAuth(allowedRoles = []) {
  return (req, res, next) => {
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
      const account = await pool.query(`SELECT password_changed_at FROM ${table} WHERE id = $1`, [payload.id]);
      if (account.rows.length === 0) return res.status(401).json({ error: 'Invalid or expired token' });
      const changedAt = account.rows[0].password_changed_at;
      if (changedAt && payload.iat && Math.floor(new Date(changedAt).getTime() / 1000) > payload.iat) {
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
