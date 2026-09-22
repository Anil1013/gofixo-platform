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

## Matching & location

- `PATCH /api/providers/:id/location` (provider auth) — body: `{ lat, lng }`. The driver/worker app should call this periodically while online.
- `PATCH /api/providers/:id/availability` (provider auth) — body: `{ is_available }`. Blocked if the provider's subscription isn't active.
- `POST /api/bookings` — if `provider_id` is omitted, pass `provider_type` + `pickup_lat`/`pickup_lng` instead; the nearest available, KYC-approved provider of that type is auto-matched (Haversine distance in SQL) and marked busy.
- Run `config/migration_001_location.sql` once against `gofixo-db` to add the lat/lng columns this depends on.

## Admin auth

The admin panel now requires a login key before showing any data. Set `ADMIN_SECRET` in the backend's `.env`, and enter the same value in the admin panel's login screen (stored in the browser's sessionStorage, sent as the `x-admin-key` header on admin actions like KYC approve/reject).

## Next steps not yet wired up

- Move OTP storage from in-memory to a table with expiry (current version resets on server restart)
- Real SMS gateway integration
- Admin auth (KYC approve/reject is currently open — add an admin login before real launch)
- Notify the matched provider (push notification) that a booking was assigned to them
- Expand matching radius/fallback if no provider is found nearby

Auto-deploy via GitHub Actions is now active for backend changes.
