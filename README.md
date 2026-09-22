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

## Authentication

OTP-based login for both customers and providers:
- `POST /api/auth/:role/otp/request` (role = `customer` or `provider`) — body: `{ phone }`. Returns an OTP (TEMPORARY: returned directly in the response since no SMS gateway is connected yet — replace with a real provider like MSG91/Twilio before launch, and stop returning the OTP in the response).
- `POST /api/auth/:role/otp/verify` — body: `{ phone, otp, name? }`. Returns `{ token, user }`. Customers are auto-created on first verify; providers must already be registered via `/api/providers/register`.
- Send the token as `Authorization: Bearer <token>` on protected routes. Creating a booking requires a customer token; confirming payment requires the assigned provider's token.

## Next steps not yet wired up

- Move OTP storage from in-memory to a table with expiry (current version resets on server restart)
- Real SMS gateway integration
- Matching logic (nearest available provider)
- Admin auth (KYC approve/reject is currently open — add an admin login before real launch)
- Seed data for subscription_plans (the Bike/Car/General/Skilled tiers already agreed) — done, see schema.sql notes

Auto-deploy via GitHub Actions is now active for backend changes.
