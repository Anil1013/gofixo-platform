// Simple admin check — compares a header against ADMIN_SECRET
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || key !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Invalid admin key' });
  }
  next();
}

module.exports = { requireAdmin };
