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

Phone + password login for both customers and providers — no SMS/OTP needed:
- `POST /api/auth/customer/register` — body: `{ name?, phone, password }`. Creates a customer account.
- Providers get their password set as part of `POST /api/providers/register` — body: `{ name, phone, type, password }`.
- `POST /api/auth/:role/login` (role = `customer` or `provider`) — body: `{ phone, password }`. Returns `{ token, user }`.
- `POST /api/auth/:role/reset-password` — body: `{ phone, new_password }`. Self-service, no verification step (by design, for now — anyone who knows the phone number could reset that account; revisit before a wider public launch).
- Send the token as `Authorization: Bearer <token>` on protected routes. Creating a booking requires a customer token; starting/confirming a booking requires the assigned provider's token.

## Ride/job start PIN

Replaces OTP verification for starting a booking:
- When a booking is created (`POST /api/bookings`), the response includes a `start_pin` (4 digits) — this is what the customer's app/dashboard shows them.
- The customer reads this PIN out to the provider in person when the provider arrives.
- `POST /api/bookings/:id/start` (provider auth) — body: `{ pin }`. If it matches, the booking moves from `requested` to `ongoing`. Wrong PIN or wrong provider is rejected.
- Payment confirmation (`/api/bookings/:id/confirm-payment`) still happens separately at the end, same as before.

## Matching & location

- `PATCH /api/providers/:id/location` (provider auth) — body: `{ lat, lng }`. The driver/worker app should call this periodically while online.
- `PATCH /api/providers/:id/availability` (provider auth) — body: `{ is_available }`. Blocked if the provider's subscription isn't active.
- `POST /api/bookings` — if `provider_id` is omitted, pass `provider_type` + `pickup_lat`/`pickup_lng` instead; the nearest available, KYC-approved provider of that type is auto-matched (Haversine distance in SQL) and marked busy.
- Run `config/migration_001_location.sql` once against `gofixo-db` to add the lat/lng columns this depends on.

## Admin auth

The admin panel now requires a login key before showing any data. Set `ADMIN_SECRET` in the backend's `.env`, and enter the same value in the admin panel's login screen (stored in the browser's sessionStorage, sent as the `x-admin-key` header on admin actions like KYC approve/reject).

## KYC documents

- `POST /api/providers/:id/documents` (provider auth, multipart form: `doc_type` + `file`) — uploads a document. `doc_type` is one of `aadhar`, `driving_license`, `vehicle_rc`, `vehicle_photo`, `profile_photo`, `police_verification`.
- Files are stored on the EC2 disk under `uploads/providers/:id/` with randomized filenames (not guessable), served at `/uploads/...`. Move to S3 once volume grows — disk storage is fine for this stage and avoids extra AWS cost/setup.
- `GET /api/providers` now also returns each provider's active `plan_name`, `earning_cap`, `total_earned_this_cycle`, `pending_amount` (cap remaining), and their uploaded `documents` — all shown directly in the admin panel's Providers table.
- Run `config/migration_002_documents.sql` once against `gofixo-db`.

## Next steps not yet wired up

- Reset-password flow has no verification step yet (see Authentication section note above)
- Notify the matched provider (push notification) that a booking was assigned to them
- Expand matching radius/fallback if no provider is found nearby
- Run `config/migration_003_password_pin.sql` once against `gofixo-db` for the password_hash and start_pin columns

Auto-deploy via GitHub Actions is now active for backend changes.
