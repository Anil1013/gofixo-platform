require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const providersRoutes = require('./routes/providers.routes');
const subscriptionsRoutes = require('./routes/subscriptions.routes');
const bookingsRoutes = require('./routes/bookings.routes');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_BASE_URL || '*' }));
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'gofixo-backend' });
});

app.use('/api/providers', providersRoutes);
app.use('/api/subscriptions', subscriptionsRoutes);
app.use('/api/bookings', bookingsRoutes);

// Generic error handler — never leak raw error details in production
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Gofixo backend running on port ${PORT}`));
