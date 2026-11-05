# Gofixo Backend

Gofixo is a Ride (Bike/Auto/Car) + Home Services backend with customer/provider authentication, provider KYC, subscriptions, booking matching, ratings, earnings and realtime tracking support.

## Production deployment

The production process is pinned to `/home/ubuntu/gofixo-platform/server.js` through `ecosystem.config.cjs`. GitHub Actions deploys the `main` branch, restarts PM2, verifies the local API health endpoints, and then verifies the public API at `https://gofixo.mob13r.com/api/auth/health`. A deployment is considered failed when the public health endpoint is not HTTP 200.

The backend listens on port 4000 by default.

## Authentication

Customer:
- `POST /api/auth/customer/register`
- `POST /api/auth/customer/login`
- `POST /api/auth/customer/forgot-password` (creates an admin-visible reset request; does not change the password)

Provider:
- `POST /api/providers/register`
- `POST /api/auth/provider/login`
- `POST /api/auth/provider/forgot-password` (creates an admin-visible reset request; does not change the password)

Admins resolve reset requests from the Customers or Providers console. Passwords are bcrypt-hashed and password changes invalidate existing JWT sessions.

Password rules: minimum 8 characters with at least one letter and one number.

Protected requests use:
`Authorization: Bearer <token>`

## Booking lifecycle

`requested -> accepted -> arrived -> ongoing -> completed` (arrival is optional for a booking).

Customers can cancel before the job starts. Partners can cancel an accepted/arrived booking before the customer PIN starts the job. Requests are offered only to the matching approved specialty within 10 km, with a GPS location refreshed in the last 3 minutes. The first eligible provider to atomically accept wins. A request that remains unaccepted for 15 minutes becomes `no_provider`; home-service wallet reservations are released on cancellation, timeout, or when all eligible partners decline. The backend expiry sweep runs independently of the mobile app.

For ride bookings, the customer app previews the Google route and fare. At booking creation the backend independently recomputes the Google Routes distance and calculates the fare from that server-verified distance; client-supplied distance/fare values are not authoritative.

## Provider eligibility

A provider must have:
- account KYC approved by an administrator
- the requested individual specialty approved and enabled
- an active subscription for ride bookings (home-service partners do not use the ride subscription)
- an available/online account status
- GPS updated within the last 3 minutes
- no other active booking

Location is considered fresh for 5 minutes.

## Booking start PIN

A 4-digit start PIN is created with the booking. The customer sees it; the provider must receive it from the customer in person.

`POST /api/bookings/:id/start`

Body:
`{ "pin": "1234" }`

A successful start clears the PIN and changes the booking to `ongoing`.

## Payment and earnings

`POST /api/bookings/:id/confirm-payment`

Current settlement model:
- Home-service bookings are paid from the customer's Gofixo Wallet. The amount is reserved when the booking is created and captured only when the partner confirms completion.
- Customer wallet top-ups use the official Gofixo UPI QR and require admin verification against the actual bank credit before wallet balance changes.
- Ride bookings currently use cash settlement with the partner; ride partners use the subscription/earning-cap model.
- Home-service commission is separate from ride subscriptions. The default home-service commission is configured by `GOFIXO_COMMISSION_PERCENT` (default 20%).
- Home-service partner payouts are recorded as pending. An admin must make the actual bank/UPI transfer and record its reference before marking the payout paid; automatic payout-provider integration is not enabled.

Completing an ongoing booking records the locked fare, commission, partner earning and payment ledger entries in a database transaction. Ride subscription earnings update the active plan and can exhaust it at its earning cap.

## KYC documents

Provider documents are uploaded with:
`POST /api/providers/:id/documents`

The upload is multipart with `doc_type` and `file`.

Allowed file types: JPG, JPEG, PNG, WEBP and PDF. Maximum file size is 15 MB. The backend checks the file signature against its extension and reported MIME type before saving. Stored KYC files are not publicly exposed. Uploading documents does not automatically approve account KYC; an administrator must review and approve the account and each required specialty.

## Maps and routing

The Flutter Android app uses Google Maps for the interactive map, Google Places for address autocomplete/details, and Google Routes API for road distance, route geometry, turn instructions and traffic-aware ETA. The backend keeps the Google API key in its environment and verifies ride distance again when creating a booking. The Android app uses the Google Maps SDK key supplied through the Android build configuration. Public Places autocomplete/details, text resolution and Routes endpoints have per-IP request limits to reduce abuse and unexpected Google API charges. These limits are process-local; use a shared rate-limit store if the backend is scaled to multiple instances.

## Realtime

The backend provides:
`/api/realtime?token=<JWT>`

Authenticated customer/provider sockets can subscribe to a booking and receive provider-location events. The mobile app also has polling as a fallback.

## Database

Run `config/schema.sql` for a new database. Production startup also applies additive compatibility changes for fields/tables introduced after the initial schema.

## Manual UPI wallet top-ups

Customer wallet top-ups use the configured Gofixo UPI QR and are **not** credited from a screenshot or UTR alone.

The admin console's **Wallet top-ups** tab lets an admin set the payee name and securely upload the personal UPI QR image (PNG/JPEG/WebP, up to 1 MB). The QR is stored in the backend database and returned only to authenticated customers; it is not committed to GitHub or exposed as a public static asset. The QR image is the supported payment method; the app does not require or expose a UPI ID. Optional environment fallbacks are `GOFIXO_UPI_PAYEE_NAME` and `GOFIXO_UPI_QR_IMAGE_URL` (HTTPS only).

The customer app calls `GET /api/wallet/topup-config`, submits amount + UTR to `POST /api/wallet/topup-intent`, and can review submissions at `GET /api/wallet/topup-requests`. Amounts are limited to ₹50–₹50,000. UTRs are unique across all requests. Submitting a UTR never changes the wallet balance.

The admin console's **Wallet top-ups** tab also configures the official QR, reviews pending requests, verifies bank-confirmed amounts, or rejects claims. Admin endpoints use the existing `x-admin-key` / `ADMIN_SECRET` protection:
- `GET /api/wallet/admin/topups?status=pending_verification`
- `POST /api/wallet/admin/topups/:id/verify` with `{ "verified_amount": 500, "bank_reference": "bank statement reference", "note": "optional" }`
- `POST /api/wallet/admin/topups/:id/reject` with `{ "note": "reason" }`

Verify only after matching the payment against the actual bank record. The confirmed amount must exactly match the submitted amount. Wallet credit, status transition and audit entry are performed in one database transaction. All displayed audit timestamps use Asia/Kolkata.

## Mobile releases

The customer and partner mobile experience is Flutter in `mobile/`; the supported native release target is Android. The release workflow verifies APK signing. OTA patches are published for the current app build and include a migration patch for legacy build `1000004` (Gofixo 1.0.4). A new full APK version requires updating both `mobile/pubspec.yaml` and `mobile/version.json`.

GitHub tag releases `v*` build a signed APK and publish:
- `gofixo-release.apk`
- `gofixo-version.json`

Release signing uses GitHub Actions secrets:
- `GOFIXO_KEYSTORE_B64`
- `GOFIXO_STORE_PASSWORD`
- `GOFIXO_KEY_PASSWORD`
- `GOFIXO_KEY_ALIAS`

Never commit `.env`, signing keys, VAPID private keys, or uploaded documents.
