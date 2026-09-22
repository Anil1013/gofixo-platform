# Gofixo Backend

Ride (Bike/Auto/Cab) + Pronto (home services) platform — subscription-based provider model.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env`, fill in real DATABASE_URL and JWT_SECRET
3. Create the `gofixo-db` database on the RDS instance, then run:
   ```
   psql $DATABASE_URL -f config/schema.sql
   ```
4. `npm run dev` (local) or `npm start` (production, e.g. on EC2 via PM2)

## Structure

- `server.js` — app entry point
- `config/db.js` — PostgreSQL pool connection
- `config/schema.sql` — full database schema (providers, subscriptions, bookings, ratings, earnings log)
- `routes/providers.routes.js` — provider registration + lookup
- `routes/subscriptions.routes.js` — plan subscribe/renew + status check
- `routes/bookings.routes.js` — create booking, provider payment-confirmation (gates next booking + checks earning cap)

## Next steps not yet wired up

- JWT auth middleware (login/OTP for providers and customers)
- Matching logic (nearest available provider)
- Admin routes (manage subscription_plans, view disputes)
- Seed data for subscription_plans (the Bike/Car/General/Skilled tiers already agreed)

Auto-deploy via GitHub Actions is now active for backend changes.
