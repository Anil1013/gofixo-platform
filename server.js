// Auto-deploy test
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');

const providersRoutes = require('./routes/providers.routes');
const subscriptionsRoutes = require('./routes/subscriptions.routes');
const bookingsRoutes = require('./routes/bookings.routes');
const authRoutes = require('./routes/auth.routes');

const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const allowedOrigins = (process.env.FRONTEND_BASE_URL || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : '*' }));
app.use(express.json());

// Uploaded KYC documents (Aadhar, DL, RC, photos) — filenames include a random token so URLs aren't guessable
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'gofixo-backend' });
});

app.use('/api/providers', providersRoutes);
app.use('/api/subscriptions', subscriptionsRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/auth', authRoutes);

// Generic error handler — never leak raw error details in production
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Gofixo backend running on port ${PORT}`));
